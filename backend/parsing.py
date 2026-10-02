"""Resume document parsing.

Strategy (best quality first, graceful degradation):
  1. PyMuPDF  - layout-aware text extraction, handles columns/tables far
                better than a naive reader.
  2. Tesseract OCR - for scanned/image PDFs where step 1 finds no real text.
  3. Plain text  - .txt/.md uploads.

The extracted text is then handed to the LLM for structured field extraction
(see coach.py), which is what actually drives question generation.
"""

from __future__ import annotations

import io
import re

# a real text page yields far more than this; below it we assume a scan
MIN_TEXT_CHARS = 120
OCR_DPI = 200


def extract_document(filename: str, data: bytes) -> dict:
    """Return {text, pages, method, warnings, audit} for an uploaded document."""
    name = (filename or "").lower()
    if name.endswith(".pdf") or data[:4] == b"%PDF":
        return _extract_pdf(data)
    if name.endswith((".txt", ".md", ".markdown", ".rtf")):
        text = _clean(data.decode("utf-8", errors="ignore"))
        return {
            "text": text,
            "pages": 1,
            "method": "plain",
            "warnings": [],
            "audit": _build_audit(text, "plain", 1, 0, 0, []),
        }
    # unknown extension: try text, warn
    text = _clean(data.decode("utf-8", errors="ignore"))
    return {
        "text": text,
        "pages": 1,
        "method": "plain",
        "warnings": [
            "unrecognised file type — read as plain text (PDF and TXT work best)"
        ],
        "audit": _build_audit(text, "plain", 1, 0, 0, []),
    }


def _extract_pdf(data: bytes) -> dict:
    import pymupdf  # PyMuPDF

    warnings: list[str] = []
    doc = pymupdf.open(stream=data, filetype="pdf")
    try:
        pages = doc.page_count
        raw_pages = [page.get_text("text") for page in doc]
        text = _clean("\n".join(raw_pages))
        method = "text"

        # how many pages actually produced usable text?
        usable = sum(1 for p in raw_pages if len(p.strip()) >= MIN_TEXT_CHARS)
        if usable == 0 or len(text) < MIN_TEXT_CHARS:
            warnings.append(
                "little or no embedded text — ran OCR (looks like a scanned resume)"
            )
            ocr_text, ocr_pages = _ocr_pdf(doc)
            if len(ocr_text) > len(text):
                text = ocr_text
                method = "ocr"
                if ocr_pages:
                    pages = ocr_pages
        elif usable < pages:
            warnings.append(
                f"{pages - usable} of {pages} page(s) had little text — "
                "try a text-based PDF if the analysis looks thin"
            )

        if len(text) < 40:
            raise ValueError(
                "could not read this PDF (even with OCR). Is it password protected "
                "or a low-resolution scan?"
            )
        audit = _audit_pdf(doc, text, method)
        return {
            "text": text,
            "pages": pages,
            "method": method,
            "warnings": warnings,
            "audit": audit,
        }
    finally:
        doc.close()


def _ocr_pdf(doc) -> tuple[str, int]:
    """OCR every page with Tesseract (LSTM models)."""
    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:  # pragma: no cover
        raise ValueError(
            "this looks like a scanned PDF and OCR is unavailable "
            "(pip install pytesseract, and the tesseract binary)"
        ) from exc

    out: list[str] = []
    pages = 0
    for page in doc:
        pix = page.get_pixmap(dpi=OCR_DPI)
        image = Image.open(io.BytesIO(pix.tobytes("png")))
        out.append(pytesseract.image_to_string(image))
        pages += 1
    return _clean("\n".join(out)), pages


# --------------------------------------------------------------------- ATS audit
#
# Deterministic (no LLM). Parses the file the way an ATS would and reports, with
# evidence, where the machine's reading diverges from what the candidate wrote.
# This is the "show your work" half of the product.

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")
_LINKEDIN_RE = re.compile(r"linkedin\.com/", re.IGNORECASE)

_SECTION_PATTERNS = {
    "summary": r"\b(summary|objective|profile|about me)\b",
    "experience": r"\b(experience|employment|work history|professional background)\b",
    "education": r"\b(education|academic)\b",
    "skills": r"\b(skills|technical skills|technologies|competencies)\b",
    "projects": r"\b(projects|portfolio)\b",
    "certifications": r"\b(certifications?|certificates?|licen[cs]es?)\b",
    "awards": r"\b(awards?|honou?rs?|achievements?)\b",
}

_STANDARD_SECTIONS = list(_SECTION_PATTERNS)


def _flag(severity: str, title: str, detail: str, evidence: str = "") -> dict:
    return {
        "severity": severity,
        "title": title,
        "detail": detail,
        "evidence": evidence,
    }


def _longest_line(text: str, limit: int = 140) -> str:
    """A representative raw line — longest is where column-splicing shows up."""
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    if not lines:
        return ""
    longest = max(lines, key=len)
    return longest[:limit] + ("\u2026" if len(longest) > limit else "")


def _detect_columns(page) -> int:
    """2 if the page's text blocks sit in two side-by-side columns, else 1."""
    blocks = [b for b in page.get_text("blocks") if b[6] == 0 and b[4].strip()]
    if len(blocks) < 8:
        return 1
    width = page.rect.width or 1.0
    pairs = 0
    for i in range(len(blocks)):
        ax0, ay0, ax1, ay1 = blocks[i][:4]
        for j in range(i + 1, len(blocks)):
            bx0, by0, bx1, by1 = blocks[j][:4]
            overlap = min(ay1, by1) - max(ay0, by0)
            if overlap < 0.4 * min(ay1 - ay0, by1 - by0):
                continue
            if ax1 < bx0:
                gap = bx0 - ax1
            elif bx1 < ax0:
                gap = ax0 - bx1
            else:
                continue
            if gap > 0.08 * width:
                pairs += 1
    return 2 if pairs >= 4 else 1


def _repeated_furniture(page_blocks: list) -> list[str]:
    """Text repeated at the top/bottom of 2+ pages (headers, footers, page numbers)."""
    counts: dict[str, int] = {}
    for blocks, height in page_blocks:
        if height <= 0:
            continue
        seen: set[str] = set()
        for b in blocks:
            text = " ".join(str(b[4]).split())
            if not text or len(text) > 150:
                continue
            if b[1] < 0.08 * height or b[3] > 0.92 * height:
                seen.add(text)
        for text in seen:
            counts[text] = counts.get(text, 0) + 1
    return [t for t, c in counts.items() if c >= 2]


def _audit_pdf(doc, text: str, method: str) -> dict:
    columns = 1
    tables = 0
    images = 0
    page_blocks: list = []
    for page in doc:
        blocks = [b for b in page.get_text("blocks") if b[6] == 0 and b[4].strip()]
        page_blocks.append((blocks, page.rect.height))
        columns = max(columns, _detect_columns(page))
        try:
            tables += len(page.find_tables().tables)
        except Exception:
            pass
        try:
            images += len(page.get_images(full=True))
        except Exception:
            pass
    furniture = _repeated_furniture(page_blocks)
    return _build_audit(text, method, columns, tables, images, furniture)


def _has_phone(text: str) -> bool:
    for match in _PHONE_RE.finditer(text):
        if sum(ch.isdigit() for ch in match.group(0)) >= 8:
            return True
    return False


def _build_audit(
    text: str,
    method: str,
    columns: int,
    tables: int,
    images: int,
    furniture: list[str],
) -> dict:
    lower = text.lower()
    sections = {
        name: bool(re.search(pattern, lower))
        for name, pattern in _SECTION_PATTERNS.items()
    }
    missing = [s for s in _STANDARD_SECTIONS if not sections.get(s)]
    contact = {
        "email": bool(_EMAIL_RE.search(text)),
        "phone": _has_phone(text),
        "linkedin": bool(_LINKEDIN_RE.search(text)),
    }
    snippet = _longest_line(text)
    flags: list[dict] = []

    if method == "ocr":
        flags.append(
            _flag(
                "high",
                "Scanned or image-only PDF",
                "This file has little or no embedded text, so a parser only sees "
                "anything if it runs OCR. Many ATS deployments do not OCR - they "
                "index the file as effectively empty.",
                snippet,
            )
        )
    if columns >= 2:
        flags.append(
            _flag(
                "high",
                "Two-column layout",
                "Text blocks sit side by side. Parsers that read left-to-right "
                "across the page splice two columns into one line, so a job title "
                "can end up glued to an unrelated bullet.",
                snippet,
            )
        )
    if tables:
        flags.append(
            _flag(
                "medium",
                f"{tables} table(s) detected",
                "Table cells are often read in the wrong order, or dropped "
                "entirely. Keep experience and skills as plain lines, not tables.",
                snippet,
            )
        )
    if furniture:
        quoted = ", ".join(f"\u201c{t}\u201d" for t in furniture[:2])
        flags.append(
            _flag(
                "medium",
                "Repeating header/footer",
                f"{quoted} appears at the top or bottom of more than one page. "
                "The parser can staple it into the middle of an entry.",
                snippet,
            )
        )
    if images and method != "ocr":
        flags.append(
            _flag(
                "low",
                f"{images} image(s) in the file",
                "Text baked into an image (a logo, an icon, a graphic skill bar) is "
                "invisible to a parser unless it OCRs the picture.",
                "",
            )
        )
    if missing:
        sev = "medium" if ("experience" in missing or "skills" in missing) else "low"
        flags.append(
            _flag(
                sev,
                "Standard section heading missing",
                "Could not find: "
                + ", ".join(missing)
                + ". Use conventional headings (Experience, Education, Skills) - "
                "unusual labels do not map to an ATS field.",
                snippet,
            )
        )
    if not contact["email"]:
        flags.append(
            _flag(
                "high",
                "No email address found",
                "The parser could not extract an email. If a human can read it but "
                "the machine cannot, it is likely inside an image or a text box.",
                "",
            )
        )
    if "\ufffd" in text:
        flags.append(
            _flag(
                "medium",
                "Encoding artefacts",
                "Some characters came through as the replacement glyph (\ufffd), "
                "usually bullet symbols or smart quotes in a non-standard font.",
                snippet,
            )
        )

    return {
        "words": len(text.split()),
        "chars": len(text),
        "columns": columns,
        "tables": tables,
        "images": images,
        "repeated_headers": furniture[:4],
        "sections": sections,
        "missing_sections": missing,
        "contact": contact,
        "flags": flags,
    }


_WS = re.compile(r"[ \t\u00a0]+")
_BLANK_LINES = re.compile(r"\n{3,}")


def _clean(text: str) -> str:
    """Tidy whitespace while keeping line structure for the LLM."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _WS.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = _BLANK_LINES.sub("\n\n", text)
    return text.strip()
