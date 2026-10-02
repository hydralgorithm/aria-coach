import { useCallback, useEffect, useRef, useState } from "react"

import type { DeliverySummary } from "@/hooks/useFaceAnalysis"

export type PersonaInfo = {
  id: string
  label: string
  tagline: string
  icon: string
  accent: string
  audio_url?: string
}

export type Question = {
  id: number
  type: string
  question: string
  why: string
  competency?: string
}

export type ScoreRecord = {
  question: string
  type: string
  competency?: string
  persona?: string
  answer: string
  score: number
  raw_score?: number
  score_bias?: number
  breakdown?: Record<string, number>
  verdict: string
  strengths: string[]
  improvements: string[]
  red_flags?: string[]
  hr_tip?: string
  delivery?: DeliverySummary | null
  delivery_score?: number | null
  delivery_notes?: string[]
  better_answer: string
  spoken_feedback: string
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
  parse: { method?: string; pages?: number; warnings?: string[] }
  deliverySummary?: DeliverySummaryReport | null
}

export type DeliverySummaryReport = {
  available: boolean
  answers_analysed?: number
  avg_delivery_score?: number | null
  avg_engagement_pct?: number
  avg_smile_pct?: number
  avg_tension_pct?: number
  avg_blinks_per_min?: number | null
  avg_head_steadiness?: number
  face_visible_pct?: number
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
  deliverySummary: null,
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
    async (file: File) => {
      setError(null)
      setAnalyzing(true)
      try {
        const form = new FormData()
        form.append("file", file)
        form.append("persona", persona)
        const res = await fetch("/api/interview/resume", {
          method: "POST",
          body: form,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || `http ${res.status}`)
        setState({
          filename: data.filename ?? file.name,
          profile: data.profile ?? "",
          structured: data.structured ?? {},
          questions: data.questions ?? [],
          answers: [],
          currentQuestion: data.current_question ?? null,
          parse: data.parse ?? {},
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

  const submitAnswer = useCallback(
    async (answer: string, delivery?: DeliverySummary | null) => {
      setError(null)
      setScoring(true)
      try {
        const res = await fetch("/api/interview/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: answer, delivery: delivery ?? null }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || `http ${res.status}`)
        setState((prev) => ({
          ...prev,
          answers: [...prev.answers, data as ScoreRecord],
          currentQuestion: data.next_question ?? null,
          structured: data.state?.structured ?? prev.structured,
          profile: data.state?.profile ?? prev.profile,
          deliverySummary:
            data.state?.delivery_summary ?? prev.deliverySummary,
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

  const reset = useCallback(async () => {
    setState(EMPTY)
    setError(null)
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
    choosePersona,
    loadResume,
    submitAnswer,
    reset,
  }
}
