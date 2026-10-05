---
name: ps-compliance-auditor
description: Audit the implementation against the official AI-Powered Resume & Interview Coach problem statement and produce an evidence-based coverage matrix.
---
# PS Compliance Auditor

Create a requirement matrix with one row for every PS statement:

- personalized resume analysis
- strengths, weaknesses, opportunities
- ATS-compatible resume guidance
- target-role-specific mock interview
- communication feedback
- confidence coaching
- technical-knowledge feedback
- actionable post-interview feedback
- personalized learning resources
- preparation strategies
- continuous practice/improvement
- fast/private/accessible guidance
- on-device AI and secure user data

For each row classify:
- IMPLEMENTED
- PARTIAL
- MISSING
- CLAIMED_BUT_UNPROVEN

For every status cite exact files, functions, routes, UI elements, models, tests, or demo steps. "The UI says it" is not evidence of implementation.

Mark any cloud-only inference as a direct risk to the on-device requirement.

Output a PS coverage percentage only as an internal project-completeness metric. Explain the weighting used; never present it as an official judging score.
