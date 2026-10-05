import { useCallback, useEffect, useRef, useState } from "react"

import type { SetupSummary } from "@/hooks/useFaceAnalysis"

/** Stable per-tab session id so two tabs never overwrite each other's state. */
const SESSION_ID = (() => {
  try {
    const key = "aria_session_id"
    let v = sessionStorage.getItem(key)
    if (!v) {
      v =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
          : Math.random().toString(36).slice(2) + Date.now().toString(36)
      sessionStorage.setItem(key, v)
    }
    return v
  } catch {
    return "default"
  }
})()

/** fetch wrapper that always carries the session id header. */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("X-Session-Id", SESSION_ID)
  return fetch(url, { ...init, headers })
}

export type PersonaInfo = {
  id: string
  label: string
  tagline: string
  icon: string
  accent: string
  /** advanced interviewer modes (adversarial / stress) */
  advanced?: boolean
  audio_url?: string
}

export type Question = {
  id: number
  type: string
  question: string
  why: string
  competency?: string
}

export type EvidenceItem = {
  /** the observation */
  point: string
  /** verbatim words from the answer or resume; empty for a general suggestion */
  quote: string
  /** "answer" | "resume" | "general" */
  source: string
  /** true when the quote was found verbatim in the source text */
  verified: boolean
}

export type RetryDimension = {
  key: string
  max: number
  before: number
  after: number
  delta: number
}

/** Deterministic comparison of a retry against the previous attempt. */
export type RetryDiff = {
  attempt: number
  score_before: number
  score_after: number
  score_delta: number
  dimensions: RetryDimension[]
  added_words: string[]
  removed_words: string[]
  numbers_added: string[]
  word_count_before: number
  word_count_after: number
  summary: string
}

export type ScoreRecord = {
  /** id of the question this answer belongs to */
  question_id?: number
  question: string
  type: string
  competency?: string
  persona?: string
  answer: string
  score: number
  raw_score?: number
  /** "technical" or "behavioral" — the rubric used to score it */
  rubric?: string
  breakdown?: Record<string, number>
  verdict: string
  strengths: EvidenceItem[]
  improvements: EvidenceItem[]
  red_flags?: EvidenceItem[]
  hr_tip?: string
  /** camera-setup metrics recorded for this answer (never scored) */
  setup?: SetupSummary | null
  answer_revision: string
  spoken_feedback: string
  /** observable delivery metrics (fillers, pace) — coaching signals, not scored */
  speech?: SpeechMetrics
  /** attempt number (1 = first answer) present on retry records */
  attempt?: number
  /** present on retry records */
  diff?: RetryDiff
  /** "voice" (transcribed, correctable) or "typed" */
  source?: string
  /** true once the candidate corrected the transcript and we re-scored */
  edited?: boolean
  /** present on a re-score: the score before the correction */
  score_before?: number
  score_delta?: number
}

export type SpeechMetrics = {
  words: number
  duration_s?: number | null
  wpm?: number | null
  filler_count: number
  fillers_per_100_words: number
  top_fillers: { word: string; count: number }[]
  restarts: number
  longest_sentence_words: number
  notes: string[]
}

export type ResumeClaim = {
  claim: string
  quote: string
  source: string
  probes: string[]
}

export type SowItem = {
  point: string
  quote?: string
  source?: string
  example?: string
  rewrite?: string
  competency?: string
}

export type SowReport = {
  strengths: SowItem[]
  weaknesses: SowItem[]
  opportunities: SowItem[]
  claims: ResumeClaim[]
  provenance_note?: string
}

export type ReadinessComponent = {
  key: string
  label: string
  value: number | null
  weight: number
  note?: string
}

export type Readiness = {
  overall: number
  components: ReadinessComponent[]
  scale_note?: string
  missing_components?: string[]
}

export type LearningResource = {
  title: string
  provider: string
  url: string
  difficulty?: string
  estimated_time?: string
  why?: string
  offline_alternative?: string
  verified?: string
}

export type LearningItem = {
  topic: string
  priority: string
  why: string
  evidence?: string
  origin: string
  resource: LearningResource
  practice_task: string
  mini_drill: string
  retest: string
  estimated_effort?: string
}

export type LearningPlan = {
  items: LearningItem[]
  method_note?: string
}

export type ProgressReport = {
  timeline: {
    session: number
    date: string
    avg_score: number
    answers: number
    persona: string
    has_jd: boolean
  }[]
  improvement: number | null
  weakest_competency: {
    competency: string
    avg_score: number
    attempts: number
  } | null
  next_action: string | null
  behaviour?: BehaviourStats
  computed_from?: string
}

export type ParseFlag = {
  severity: string
  title: string
  detail: string
  evidence?: string
}

export type ParseAudit = {
  words?: number
  chars?: number
  columns?: number
  tables?: number
  images?: number
  repeated_headers?: string[]
  sections?: Record<string, boolean>
  missing_sections?: string[]
  contact?: { email?: boolean; phone?: boolean; linkedin?: boolean }
  flags?: ParseFlag[]
}

export type Requirement = {
  requirement: string
  kind?: string
  /** verbatim resume span, or "" when the resume shows nothing */
  evidence: string
  /** strong | partial | gap | unknown */
  confidence: string
  /** high | medium | low */
  importance: string
  why?: string
}

export type Coverage = {
  summary?: string
  requirements?: Requirement[]
  gaps?: number
  matched?: number
}

export type StructuredResume = {
  name?: string
  headline?: string
  years_experience?: number | null
  skills?: string[]
  experience?: { company: string; role: string; period?: string }[]
  education?: { institution: string; degree: string; year?: string }[]
  top_achievements?: string[]
  strengths?: string[]
  probe_areas?: string[]
  profile?: string
}

export type InterviewState = {
  filename: string
  profile: string
  structured: StructuredResume
  questions: Question[]
  answers: ScoreRecord[]
  currentQuestion: Question | null
  parse: {
    method?: string
    pages?: number
    warnings?: string[]
    /** raw text exactly as the parser extracted it — what an ATS receives */
    text?: string
    audit?: ParseAudit
  }
  /** the job description the questions are grounded in, if any */
  jd?: string
  coverage?: Coverage
  /** explicit strengths / weaknesses / opportunities, every item evidenced */
  sow_report?: SowReport
  /** explainable practice-readiness profile (never a hiring prediction) */
  readiness?: Readiness
  /** gap-driven learning plan with curated resources */
  learning_plan?: LearningPlan
  /** the configured session length from coach.INTERVIEW_LENGTH (never hard-coded here) */
  interview_length?: number
  setupSummary?: SetupSummaryReport | null
  /** confidence as behaviour chosen (cumulative, local history) */
  behaviour?: BehaviourStats
}

export type RetryTarget = { question: Question; index: number }

export type BehaviourStats = {
  sessions: number
  answered: number
  corrected: number
  retried: number
  improved: number
}

export type SetupSummaryReport = {
  available: boolean
  answers_analysed?: number
  face_visible_pct?: number
  avg_facing_pct?: number
  multi_face_flags?: number
  notes?: string[]
}

const EMPTY: InterviewState = {
  filename: "",
  profile: "",
  structured: {},
  questions: [],
  answers: [],
  currentQuestion: null,
  parse: {},
  jd: "",
  coverage: undefined,
  sow_report: undefined,
  readiness: undefined,
  learning_plan: undefined,
  interview_length: undefined,
  setupSummary: null,
  behaviour: undefined,
}

export function useInterview(
  playAudio: (url: string) => Promise<void>,
  stopAudio?: () => void
) {
  const [state, setState] = useState<InterviewState>(EMPTY)
  const [personas, setPersonas] = useState<PersonaInfo[]>([])
  const [persona, setPersona] = useState<string>("standard")
  const [analyzing, setAnalyzing] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** the question currently being retried, if any (out-of-band scoring) */
  const [retryTarget, setRetryTarget] = useState<RetryTarget | null>(null)
  /** retry result per question id, compared against the first attempt */
  const [retryResults, setRetryResults] = useState<Record<number, ScoreRecord>>(
    {}
  )
  const [retrying, setRetrying] = useState(false)
  const personaAbortRef = useRef<AbortController | null>(null)

  // personality modes live on the backend so prompts and UI never drift
  useEffect(() => {
    apiFetch("/api/personas")
      .then((r) => r.json())
      .then((d: { personas?: PersonaInfo[]; active?: string }) => {
        setPersonas(d.personas ?? [])
        if (d.active) setPersona(d.active)
      })
      .catch(() => {})
  }, [])

  // Refresh safety: the backend keeps this tab's session (keyed by the stable
  // per-tab X-Session-Id), so a reload restores the interview instead of
  // silently dropping it. Empty state (no resume yet) is left alone.
  useEffect(() => {
    let cancelled = false
    apiFetch("/api/interview/state")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        if ((d.questions?.length ?? 0) > 0) {
          setState((prev) => ({
            ...prev,
            filename: d.filename ?? "",
            profile: d.profile ?? "",
            structured: d.structured ?? {},
            questions: d.questions ?? [],
            answers: d.answers ?? [],
            currentQuestion:
              (d.answers?.length ?? 0) < (d.questions?.length ?? 0)
                ? d.questions[d.answers.length]
                : null,
            parse: d.parse ?? {},
            jd: d.jd ?? "",
            coverage: d.coverage ?? {},
            sow_report: d.sow_report ?? undefined,
            readiness: d.readiness ?? undefined,
            learning_plan: d.learning_plan ?? undefined,
            interview_length: d.interview_length ?? undefined,
            behaviour: d.behaviour ?? undefined,
          }))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const activePersona =
    personas.find((p) => p.id === persona) ?? null

  const choosePersona = useCallback(
    async (id: string) => {
      // 1. Immediately cut off whatever audio was currently speaking
      stopAudio?.()

      // 2. Cancel any pending persona switch request
      personaAbortRef.current?.abort()
      const controller = new AbortController()
      personaAbortRef.current = controller

      setPersona(id)
      setError(null)

      // 3. If pre-loaded audio exists for this persona, start playing it IMMEDIATELY (0ms latency!)
      const target = personas.find((p) => p.id === id)
      let startedImmediate = false
      if (target?.audio_url) {
        startedImmediate = true
        void playAudio(target.audio_url)
      }

      try {
        const res = await apiFetch("/api/interview/persona", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: id }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || `http ${res.status}`)

        // If not already started, play now
        if (!startedImmediate && data.audio_url) {
          void playAudio(data.audio_url)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : "could not switch mode")
      } finally {
        if (personaAbortRef.current === controller) {
          personaAbortRef.current = null
        }
      }
    },
    [personas, playAudio, stopAudio]
  )

  const loadResume = useCallback(
    async (file: File, jd = "") => {
      setError(null)
      setAnalyzing(true)
      try {
        const form = new FormData()
        form.append("file", file)
        form.append("persona", persona)
        form.append("jd", jd)
        const res = await apiFetch("/api/interview/resume", {
          method: "POST",
          body: form,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || `http ${res.status}`)
        setRetryResults({})
        setRetryTarget(null)
        setState({
          filename: data.filename ?? file.name,
          profile: data.profile ?? "",
          structured: data.structured ?? {},
          questions: data.questions ?? [],
          answers: [],
          currentQuestion: data.current_question ?? null,
          parse: data.parse ?? {},
          jd: data.jd ?? "",
          coverage: data.coverage ?? {},
          sow_report: data.sow_report ?? undefined,
          readiness: data.readiness ?? undefined,
          learning_plan: data.learning_plan ?? undefined,
          interview_length: data.interview_length ?? undefined,
        })
        if (data.audio_url) void playAudio(data.audio_url)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "could not read that resume"
        )
      } finally {
        setAnalyzing(false)
      }
    },
    [persona, playAudio]
  )

  /** Ground the questions in a pasted job description (before answering). */
  const applyJd = useCallback(async (jd: string) => {
    setError(null)
    setAnalyzing(true)
    try {
      const res = await apiFetch("/api/interview/jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: jd }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `http ${res.status}`)
      setRetryResults({})
      setRetryTarget(null)
      setState((prev) => ({
        ...prev,
        jd: data.jd ?? jd,
        coverage: data.coverage ?? {},
        questions: data.questions ?? [],
        answers: [],
        currentQuestion: data.current_question ?? null,
        sow_report: data.sow_report ?? prev.sow_report,
        readiness: data.readiness ?? prev.readiness,
        learning_plan: data.learning_plan ?? prev.learning_plan,
        interview_length: data.interview_length ?? prev.interview_length,
      }))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "could not ground the questions"
      )
    } finally {
      setAnalyzing(false)
    }
  }, [])

  const submitAnswer = useCallback(
    async (
      answer: string,
      setup?: SetupSummary | null,
      edited = false,
      source: "voice" | "typed" = "typed",
      durationS?: number | null
    ) => {
      setError(null)
      setScoring(true)
      try {
        const res = await apiFetch("/api/interview/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: answer,
            setup: setup ?? null,
            edited,
            source,
            duration_s: durationS ?? null,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || `http ${res.status}`)
        setState((prev) => ({
          ...prev,
          answers: [...prev.answers, data as ScoreRecord],
          currentQuestion: data.next_question ?? null,
          structured: data.state?.structured ?? prev.structured,
          profile: data.state?.profile ?? prev.profile,
          sow_report: data.state?.sow_report ?? prev.sow_report,
          readiness: data.state?.readiness ?? prev.readiness,
          learning_plan: data.state?.learning_plan ?? prev.learning_plan,
          interview_length: data.state?.interview_length ?? prev.interview_length,
          setupSummary:
            data.state?.setup_summary ?? prev.setupSummary,
          behaviour: data.state?.behaviour ?? prev.behaviour,
        }))
        if (data.audio_url) void playAudio(data.audio_url)
      } catch (err) {
        setError(err instanceof Error ? err.message : "scoring failed")
      } finally {
        setScoring(false)
      }
    },
    [playAudio]
  )

  /** Re-answer an earlier question; score it out-of-band with a diff. */
  const retryAnswer = useCallback(
    async (
      answer: string,
      setup: SetupSummary | null,
      questionId: number,
      edited = false,
      durationS?: number | null
    ) => {
      setError(null)
      setRetrying(true)
      try {
        const res = await apiFetch("/api/interview/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: answer,
            setup: { ...(setup ?? {}), duration_s: durationS ?? null },
            edited,
            question_id: questionId,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || `http ${res.status}`)
        setRetryResults((prev) => ({ ...prev, [questionId]: data as ScoreRecord }))
        setRetryTarget(null)
        if (data.behaviour) {
          const behaviour = data.behaviour as BehaviourStats
          setState((prev) => ({ ...prev, behaviour }))
        }
        if (data.audio_url) void playAudio(data.audio_url)
      } catch (err) {
        setError(err instanceof Error ? err.message : "retry scoring failed")
      } finally {
        setRetrying(false)
      }
    },
    [playAudio]
  )

  /** Park a transcript at the gate instead of scoring it immediately. */
  const rescoreAnswer = useCallback(
    async (questionId: number, text: string) => {
      setError(null)
      setScoring(true)
      try {
        const res = await apiFetch("/api/interview/rescore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text.trim(), question_id: questionId }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || `http ${res.status}`)
        const { state: _s, next_question: _n, audio_url: _a, ...patch } = data
        setState((prev) => {
          const index = prev.answers.findIndex((a) => a.question_id === questionId)
          if (index < 0) return prev
          const answers = [...prev.answers]
          answers[index] = { ...answers[index], ...patch }
          return {
            ...prev,
            answers,
            behaviour: data.state?.behaviour ?? prev.behaviour,
          }
        })
        if (data.audio_url) void playAudio(data.audio_url)
      } catch (err) {
        setError(err instanceof Error ? err.message : "re-scoring failed")
      } finally {
        setScoring(false)
      }
    },
    [playAudio]
  )

  /** Begin retrying a question already answered this session. */
  const startRetry = useCallback((question: Question, index: number) => {
    setError(null)
    setRetryTarget({ question, index })
  }, [])

  const cancelRetry = useCallback(() => setRetryTarget(null), [])

  const reset = useCallback(async () => {
    setState(EMPTY)
    setError(null)
    setRetryTarget(null)
    setRetryResults({})
    await apiFetch("/api/interview/reset", { method: "POST" }).catch(() => {})
  }, [])

  return {
    ...state,
    personas,
    persona,
    activePersona,
    analyzing,
    scoring,
    error,
    retryTarget,
    retryResults,
    retrying,
    choosePersona,
    loadResume,
    applyJd,
    submitAnswer,
    retryAnswer,
    rescoreAnswer,
    startRetry,
    cancelRetry,
    reset,
  }
}
