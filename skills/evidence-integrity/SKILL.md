---
name: evidence-integrity
description: Prevent resume/interview hallucinations, unsupported achievements, invented metrics, and misleading career claims.
---
# Evidence Integrity

Every generated resume claim or personalized recommendation must be classified:
VERIFIED_FROM_RESUME
VERIFIED_FROM_USER_INPUT
INFERRED
SUGGESTED_BUT_UNVERIFIED

Never silently convert INFERRED into VERIFIED.

When improving bullets:
- preserve facts
- preserve dates and titles
- preserve technologies actually present
- never invent metrics
- never invent employers or projects
- never fabricate certifications
- never claim interview performance improved unless there is before/after evidence

Provide a "claim provenance" panel for high-risk edits.

For interview coaching, distinguish:
- model explanation
- candidate transcript
- evaluator judgment
- learning recommendation
