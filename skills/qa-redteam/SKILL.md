---
name: qa-redteam
description: Stress-test the application for functional bugs, AI failure modes, security issues, broken UX, and demo-critical regressions.
---
# QA & Red Team

Test the complete happy path:
resume upload -> parse -> profile -> JD -> gap report -> interview -> transcript -> evaluation -> learning plan -> re-drill -> progress.

Also test:
- empty/huge/corrupt PDFs and DOCX
- image-heavy and multi-column resumes
- missing contact fields
- duplicate skills
- contradictory dates
- malicious prompt-injection text
- unsupported file types
- no network
- slow model
- model failure/timeouts
- malformed model JSON
- microphone denial
- transcript errors
- repeated interview sessions
- refresh/navigation during a session
- concurrent users/sessions if applicable

For every failure:
severity, reproduction, root cause, smallest fix, regression test.

P0 = blocks the live demo or violates a core PS requirement.
P1 = materially damages a core workflow.
P2 = polish/edge case.
