/**
 * The canonical scoring rubrics — ONE definition, mirrored from
 * `backend/coach.py` (DIMENSIONS / TECH_DIMENSIONS).
 *
 * Why this file exists: a technical answer is NOT judged on STAR structure or
 * self-awareness-first. Showing "HR scorecard" above a correct/incorrect
 * technical answer was actively misleading, so the labels, weights and the
 * one-line description of each rubric live here and nowhere else in the UI.
 *
 * If you change a weight here you must change `TECH_DIMENSIONS` / `DIMENSIONS`
 * in backend/coach.py to match — tests/test_core.py asserts the pair agrees.
 */

export type RubricKey = "technical" | "behavioral"

export type RubricDimension = {
  /** the shared dimension key used by the backend breakdown */
  key: string
  /** what this dimension means for THIS rubric */
  label: string
  /** maximum points (the five sum to 100) */
  max: number
}

export type Rubric = {
  key: RubricKey
  /** short name used in the UI */
  label: string
  /** one honest sentence describing what this rubric rewards */
  summary: string
  dimensions: RubricDimension[]
}

export const BEHAVIOURAL_RUBRIC: Rubric = {
  key: "behavioral",
  label: "Behavioural rubric",
  summary:
    "Did they answer it, with structure and evidence? STAR-shaped, concrete, owned.",
  dimensions: [
    { key: "relevance_structure", label: "Structure (STAR)", max: 25 },
    { key: "specificity_evidence", label: "Evidence & numbers", max: 25 },
    { key: "impact_ownership", label: "Impact & ownership", max: 20 },
    { key: "communication", label: "Clarity", max: 15 },
    { key: "self_awareness", label: "Self-awareness", max: 15 },
  ],
}

export const TECHNICAL_RUBRIC: Rubric = {
  key: "technical",
  label: "Technical rubric",
  summary:
    "Was the core answer correct, and did the reasoning, trade-offs and edge cases hold up?",
  dimensions: [
    { key: "relevance_structure", label: "Correctness & approach", max: 20 },
    { key: "specificity_evidence", label: "Reasoning & depth", max: 25 },
    { key: "impact_ownership", label: "Trade-offs & alternatives", max: 20 },
    { key: "communication", label: "Clarity of explanation", max: 15 },
    { key: "self_awareness", label: "Edge cases & limits", max: 20 },
  ],
}

export const RUBRICS: Record<RubricKey, Rubric> = {
  technical: TECHNICAL_RUBRIC,
  behavioral: BEHAVIOURAL_RUBRIC,
}

/** Rubric for a question. `rubric` comes from the scorer; `type` is the fallback. */
export function rubricFor(
  rubric: string | undefined | null,
  type?: string | undefined | null
): Rubric {
  if (rubric === "technical") return TECHNICAL_RUBRIC
  if (rubric === "behavioral") return BEHAVIOURAL_RUBRIC
  return String(type || "").toLowerCase() === "technical"
    ? TECHNICAL_RUBRIC
    : BEHAVIOURAL_RUBRIC
}

/** "Scoring your answer against the technical rubric…" — never "HR scorecard". */
export function scoringLine(
  rubric: string | undefined | null,
  type?: string | undefined | null
): string {
  return `Scoring your answer against the ${rubricFor(rubric, type).label.toLowerCase()}…`
}