import { useCallback, useEffect, useRef, useState } from "react"

import type { SetupSummary } from "@/hooks/useFaceAnalysis"

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
  /** attempt number (1 = first answer) present on retry records */
  attempt?: number
  /** present on retry records */
  diff?: RetryDiff
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
  setupSummary?: SetupSummaryReport | null
  /** confidence as behaviour chosen (cumulative, local history) */
  behaviour?: BehaviourStats
}

export type PendingAnswer = {
  /** the raw transcript, exactly as the mic heard it */
  text: string
  /** camera-setup summary captured when the answer finished */
  setup: SetupSummary | null
  /** when set, the transcript is a retry of this question rather than a new answer */
  retryQuestionId?: number
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
  /**
   * A transcribed answer waiting at the transcript gate. The user sees and can
   * edit exactly what the mic heard before it is scored — nothing is scored
   * until they confirm.
   */
  const [pending, setPending] = useState<PendingAnswer | null>(null)
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
    fetch("/api/personas")
      .then((r) => r.json())
      .then((d: { personas?: PersonaInfo[]; active?: string }) => {
        setPersonas(d.personas ?? [])
        if (d.active) setPersona(d.active)
      })
      .catch(() => {})
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
        const res = await fetch("/api/interview/persona", {
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
        const res = await fetch("/api/interview/resume", {
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
      const res = await fetch("/api/interview/jd", {
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
      edited = false
    ) => {
      setError(null)
      setScoring(true)
      try {
        const res = await fetch("/api/interview/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: answer, setup: setup ?? null, edited }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || `http ${res.status}`)
        setState((prev) => ({
          ...prev,
          answers: [...prev.answers, data as ScoreRecord],
          currentQuestion: data.next_question ?? null,
          structured: data.state?.structured ?? prev.structured,
          profile: data.state?.profile ?? prev.profile,
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
      edited = false
    ) => {
      setError(null)
      setRetrying(true)
      try {
        const res = await fetch("/api/interview/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: answer,
            setup: setup ?? null,
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
  const reviewAnswer = useCallback(
    (text: string, setup?: SetupSummary | null, retryQuestionId?: number) => {
      setError(null)
      setPending({ text: text.trim(), setup: setup ?? null, retryQuestionId })
    },
    []
  )

  /** Send the (possibly edited) transcript through to scoring. */
  const confirmPending = useCallback(
    async (text: string, edited = false) => {
      const setup = pending?.setup ?? null
      const retryQuestionId = pending?.retryQuestionId
      setPending(null)
      if (retryQuestionId !== undefined) {
        await retryAnswer(text.trim(), setup, retryQuestionId, edited)
      } else {
        await submitAnswer(text.trim(), setup, edited)
      }
    },
    [pending, submitAnswer, retryAnswer]
  )

  const discardPending = useCallback(() => setPending(null), [])

  /** Begin retrying a question already answered this session. */
  const startRetry = useCallback((question: Question, index: number) => {
    setError(null)
    setPending(null)
    setRetryTarget({ question, index })
  }, [])

  const cancelRetry = useCallback(() => setRetryTarget(null), [])

  const reset = useCallback(async () => {
    setState(EMPTY)
    setError(null)
    setPending(null)
    setRetryTarget(null)
    setRetryResults({})
    await fetch("/api/interview/reset", { method: "POST" }).catch(() => {})
  }, [])

  return {
    ...state,
    personas,
    persona,
    activePersona,
    analyzing,
    scoring,
    error,
    pending,
    retryTarget,
    retryResults,
    retrying,
    choosePersona,
    loadResume,
    applyJd,
    submitAnswer,
    retryAnswer,
    reviewAnswer,
    confirmPending,
    discardPending,
    startRetry,
    cancelRetry,
    reset,
  }
}
