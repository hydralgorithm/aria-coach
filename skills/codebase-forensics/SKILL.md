---
name: codebase-forensics
description: Inspect and understand an unfamiliar codebase before editing it. Build an architecture map, trace data flow, find dead code and fragile seams, and identify the smallest safe change points.
---
# Codebase Forensics

## Procedure
- Inventory directories, package manifests, environment files, routes, API endpoints, model integrations, storage, auth, uploads, tests, and build/deploy configuration.
- Identify frontend entrypoints, backend entrypoints, state management, API boundaries, and AI orchestration.
- Trace the complete path for: resume upload -> parsing -> analysis -> results; job description -> matching -> gap analysis; interview setup -> question generation -> transcript/audio -> evaluation -> feedback -> progress persistence.
- Search for duplicate logic, hard-coded prompts, silent exception handling, unused components, unreachable routes, unsafe environment-variable usage, and inconsistent data contracts.
- Read the actual implementation around every important claim. Do not infer architecture from filenames alone.

## Output
Provide:
1. architecture diagram in text
2. important files and responsibilities
3. request/data/model flow
4. external services and data leaving the device
5. likely bugs/fragile areas
6. recommended change points with rationale
7. confidence level for each finding

Never rewrite the application merely to make it cleaner.
