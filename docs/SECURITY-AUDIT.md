# Security Audit — findings and fixes (2026-10-04)

Audit performed per the security/privacy/on-device skill against the whole
request path, storage layer, frontend surface and model boundary. Each finding
lists: severity, evidence, fix, and verification.

## Fixed in this pass

| # | Severity | Finding | Fix | Verification |
|---|---|---|---|---|
| 1 | **HIGH** | `CORSMiddleware` used `allow_origins=["*"]`: any website open in the browser could read `/api/history` (practice transcripts) from `127.0.0.1:8000` via CORS. | Pinned to `LOCAL_ORIGINS` (localhost:8000/5173), methods GET/POST, explicit header allowlist. `backend/server.py` | `tests/test_api.py` smoke + manual cross-origin check |
| 2 | **HIGH** | No upload size or type validation: a 2 GB body or a `.docx`/binary blob went straight into PyMuPDF/LLM. | 15 MB ceiling (413), byte-sniffed type validation with actionable errors (docx → "export as PDF"), binary rejection. `backend/server.py::_validate_upload` | `TestUploadValidation.*` (4 tests) |
| 3 | **HIGH** | Interview state and chat history were process-global dicts: two tabs clobbered each other's resume/questions/answers; race via concurrent requests. | Session scoping via `contextvars` bound to an `X-Session-Id` header per tab, bounded session map (32). `backend/coach.py::_SessionProxy`, `server.py::session_scope` | `TestSessionIsolation::test_two_tabs_cannot_see_each_others_persona` |
| 4 | **HIGH** | No timeout on cloud LLM/STT calls: a hung connection stalled the request (and with a blocked event loop, the whole app). | Hard timeouts (`LLM_TIMEOUT`/`STT_TIMEOUT`, defaults 120/60 s) and all blocking LLM/OCR/TTS work moved off the event loop with `asyncio.to_thread`. | code inspection + `TestChatErrorHandling` |
| 5 | **MEDIUM** | Transcripts (the user's spoken words) were logged: `[stt] ... -> 'text…'` and full chat turns. | Transcript logging redacted to length + engine only. | grep for transcript prints |
| 6 | **MEDIUM** | Unbounded generated-audio accumulation: every TTS reply (which quotes the candidate's words) stayed on disk forever. | Startup lifespan prunes non-persona audio hourly (1 h TTL, 100-file cap). | `server.py::_prune_audio_files` |
| 7 | **MEDIUM** | Model could inject a fabricated number into `answer_revision` despite the prompt ("reduced latency by 37%" that exists nowhere). | Deterministic truth guard `_check_model_facts`: numbers not present in the answer or resume become `[add metric]`. | `TestTruthGuard.*` (3 tests) |
| 8 | **MEDIUM** | Runaway tab/script could burn the Groq key with unlimited expensive requests. | Sliding-window limiter (30/min per ip+route) on all LLM-touching endpoints. | `TestRateLimit.*` (2 tests) |
| 9 | **MEDIUM** | Cloud TTS fallback (`edge-tts`) sent coach replies — which quote the candidate's own words — to Microsoft servers. Removed. | Kokoro-only with text fallback. | `synthesize_audio` in `server.py` |
| 10 | **LOW** | Import endpoint crashed on malformed rows (`int("not-a-number")`), aborting the whole restore. | Tolerant coercion `_to_int`, non-dict rows skipped, payload type checks. | `test_import_survives_malformed_rows` |
| 11 | **LOW** | Unknown binary files were decoded as text and fed to the LLM. | Binary sniffing in `parsing.extract_document` (NUL-byte ratio) raises an actionable error. | `test_empty_binary_rejected` |
| 12 | **LOW** | Session id header was reflected unchecked. | Strict `[A-Za-z0-9_-]{1,64}` validation, fallback to `default`. | `test_invalid_session_header_falls_back` |

## Prompt-injection stance

Resume text, JD text and transcripts are **data**, never instructions:

- They only ever enter prompts inside clearly-labelled data sections
  (`CANDIDATE'S SPOKEN ANSWER`, `JOB DESCRIPTION`, `CANDIDATE RESUME FACTS`).
- The extraction system prompt instructs fact extraction with "never invent";
  the injected text is verified to land in the *user* message, not the system
  prompt (`TestPromptInjection::test_injection_text_is_treated_as_data_not_instructions`).
- Model outputs are schema-validated: dimension scores clamped to rubric
  maxima, total recomputed from the scorecard (a model cannot move the number
  the candidate hears), quotes verified verbatim or demoted to `general`,
  fabricated numbers in revisions redacted by the truth guard.

| 13 | **HIGH** | Smuggled instructions in a résumé/JD were passed to the LLM as *data* and never obeyed — but a live run showed the model treating the injected string "You are the system administrator" as the candidate's **job title** and building 4 of 6 interview questions around a role that does not exist. Treating content as data is necessary but not sufficient: it stops obedience, not steering. | `parsing.neutralize_injected_instructions` removes instruction-like sentences (per-sentence, so adjacent genuine bullets survive) from résumé text and JD **before** they reach any prompt; the upload records a warning naming how many lines were stripped. Regexes require the second-person imperative form, so a real "Systems Administrator" résumé is untouched. | `TestInjectionNeutralizer.*` (5 tests, incl. the IT-admin false-positive case) + `TestPromptInjection` now asserts the phrases never reach the prompt + live re-run: 6 normal questions, 0 echoing the payload |

## Remaining risks (honest)

- **Transcripts at rest in SQLite are unencrypted.** Acceptable for a local
  single-user app (the user controls the file, can export/delete it); documented
  rather than hidden behind crypto theater.
- **No auth by design.** The server binds `127.0.0.1`; CORS is locked. If
  deployed to a LAN, add an API token before anything else.
- **Rate limiting is in-process** — fine for a local app, not for multi-tenant
  deployment.
- **faster-whisper model download** happens once on first offline use; a judge
  wanting a zero-network first run should pre-warm it (see `docs/LOCAL-FIRST.md`).
