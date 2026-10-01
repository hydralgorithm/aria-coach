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
    """Return {text, pages, method, warnings} for an uploaded document."""
    name = (filename or "").lower()
    if name.endswith(".pdf") or data[:4] == b"%PDF":
        return _extract_pdf(data)
    if name.endswith((".txt", ".md", ".markdown", ".rtf")):
        return {
            "text": _clean(data.decode("utf-8", errors="ignore")),
            "pages": 1,
            "method": "plain",
            "warnings": [],
        }
    # unknown extension: try text, warn
    return {
        "text": _clean(data.decode("utf-8", errors="ignore")),
        "pages": 1,
        "method": "plain",
        "warnings": [
            "unrecognised file type — read as plain text (PDF and TXT work best)"
        ],
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
        return {"text": text, "pages": pages, "method": method, "warnings": warnings}
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


_WS = re.compile(r"[ \t\u00a0]+")
_BLANK_LINES = re.compile(r"\n{3,}")


def _clean(text: str) -> str:
    """Tidy whitespace while keeping line structure for the LLM."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _WS.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = _BLANK_LINES.sub("\n\n", text)
    return text.strip()
