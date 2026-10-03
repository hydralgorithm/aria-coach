import { useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  FileText,
  Upload,
  Mic,
  AudioLines,
  Sparkles,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  RotateCcw,
  Flag,
  GraduationCap,
  Award,
  Search,
  ScanFace,
  FileSearch,
  Loader2,
  Target,
  XCircle,
  Circle,
  Video,
  Repeat,
  X,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { AvatarOrb, type AvatarColor, type AvatarShape } from "@/components/ui/avatar-orb"
import { ThinkingOrb } from "@/components/ui/thinking-orbs"
import { BorderBeam } from "@/components/ui/border-beam"
import type { ChatStage } from "@/hooks/useVoice"
import type {
  SetupSummaryReport,
  ParseAudit,
  RetryTarget,
  RetryDiff,
  BehaviourStats,
  EvidenceItem,
  Coverage,
  PersonaInfo,
  Question,
  ScoreRecord,
  StructuredResume,
} from "@/hooks/useInterview"

const PERSONA_ORBS: Record<string, { color: AvatarColor; shape: AvatarShape }> = {
  standard: { color: "indigo", shape: "circle" },
  strict: { color: "orange", shape: "circle" },
  crook: { color: "red", shape: "circle" },
  kind: { color: "green", shape: "circle" },
  rapid: { color: "cyan", shape: "circle" },
}

const ACCENTS: Record<
  string,
  { ring: string; text: string; bg: string; solid: string }
> = {
  iris: {
    ring: "border-iris-400/70",
    text: "text-iris-300",
    bg: "bg-iris-500/10",
    solid: "bg-iris-600",
  },
  amber: {
    ring: "border-amber-300/70",
    text: "text-amber-300",
    bg: "bg-amber-300/10",
    solid: "bg-amber-500",
  },
  rose: {
    ring: "border-rose-400/70",
    text: "text-rose-300",
    bg: "bg-rose-400/10",
    solid: "bg-rose-500",
  },
  mint: {
    ring: "border-mint-400/70",
    text: "text-mint-400",
    bg: "bg-mint-400/10",
    solid: "bg-mint-500",
  },
  sky: {
    ring: "border-sky-400/70",
    text: "text-sky-300",
    bg: "bg-sky-400/10",
    solid: "bg-sky-500",
  },
}

const DIMS: [string, string, number][] = [
  ["relevance_structure", "Structure (STAR)", 25],
  ["specificity_evidence", "Evidence & numbers", 25],
  ["impact_ownership", "Impact & ownership", 20],
  ["communication", "Clarity", 15],
  ["self_awareness", "Self-awareness", 15],
]

const DIM_LABELS: Record<string, string> = Object.fromEntries(
  DIMS.map(([key, label]) => [key, label])
)

type Props = {
  filename: string
  profile: string
  structured: StructuredResume
  questions: Question[]
  answers: ScoreRecord[]
  currentQuestion: Question | null
  personas: PersonaInfo[]
  activePersona: PersonaInfo | null
  analyzing: boolean
  scoring: boolean
  error: string | null
  onUpload: (file: File, jd: string) => void
  onApplyJd: (jd: string) => void
  jd?: string
  coverage?: Coverage
  onPersona: (id: string) => void
  onReset: () => void
  stage: ChatStage
  levels: number[]
  speaking: boolean
  start: () => void
  stop: () => void
  onRescore?: (questionId: number, text: string) => void
  retrying: boolean
  retryTarget: RetryTarget | null
  retryResults: Record<number, ScoreRecord>
  onRetry: (question: Question, index: number) => void
  onRetryAnswer: (text: string) => void
  onCancelRetry: () => void
  behaviour?: BehaviourStats
  setupSummary?: SetupSummaryReport | null
  parse?: {
    method?: string
    pages?: number
    warnings?: string[]
    text?: string
    audit?: ParseAudit
  }
}

export default function InterviewView({
  filename,
  profile,
  structured,
  questions,
  answers,
  currentQuestion,
  personas,
  activePersona,
  analyzing,
  scoring,
  error,
  onUpload,
  onApplyJd,
  jd,
  coverage,
  onPersona,
  onReset,
  stage,
  levels,
  speaking,
  start,
  stop,
  onRescore,
  retrying,
  retryTarget,
  retryResults,
  onRetry,
  onRetryAnswer,
  onCancelRetry,
  behaviour,
  setupSummary,
  parse,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [jdDraft, setJdDraft] = useState("")
  const listening = stage === "listening"

  if (questions.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 sm:py-8 text-center">
        {/* Hero icon */}
        <div className="relative mx-auto mb-5 w-fit">
          <div className="absolute -inset-3 rounded-[28px] bg-gradient-to-br from-iris-500/35 to-iris-600/20 blur-2xl" />
          <div className="relative flex size-16 items-center justify-center rounded-3xl bg-gradient-to-br from-iris-500 to-iris-600 shadow-2xl shadow-iris-600/40">
            <FileText className="size-8" />
          </div>
        </div>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Practical interview practice
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/50 max-w-lg mx-auto">
          Pick who you want to face. Aria reads your resume, writes questions
          from your real experience, and scores each answer like an HR
          scorecard.
        </p>

        {/* Interviewer personality */}
        <div className="mt-8 text-left">
          <p className="mb-3 text-[10px] uppercase tracking-widest text-white/35">
            Who is interviewing you?
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {personas.map((p) => {
              const accent = ACCENTS[p.accent] ?? ACCENTS.iris
              const orb = PERSONA_ORBS[p.id] ?? { color: "violet", shape: "squircle" }
              const active = activePersona?.id === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => onPersona(p.id)}
                  className={`group relative flex items-start gap-3.5 rounded-2xl border p-4 text-left transition-all duration-200 ${
                    active
                      ? `${accent.ring} ${accent.bg} shadow-lg shadow-black/40`
                      : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/15"
                  }`}
                >
                  {/* Persona Avatar Orb */}
                  <div className="shrink-0 pt-0.5">
                    <AvatarOrb color={orb.color} shape={orb.shape} size="sm" blinking={active} />
                  </div>
                  <span className="min-w-0">
                    <span
                      className={`flex items-center gap-1.5 text-sm font-semibold leading-snug ${
                        active ? accent.text : "text-white/90"
                      }`}
                    >
                      {p.label}
                      {p.advanced && (
                        <span className="rounded-full border border-white/15 bg-white/5 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-white/45">
                          advanced
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-white/45">
                      {p.tagline}
                    </span>
                  </span>
                  {active && (
                    <span className={`absolute right-3 top-3 flex size-5 items-center justify-center rounded-full ${accent.solid}`}>
                      <CheckCircle2 className="size-3 text-white" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Drop zone */}
        <div className="mt-6">
          <DropZoneBeamWrapper active={dragging}>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const file = e.dataTransfer.files?.[0]
                if (file) onUpload(file, jdDraft)
              }}
              onClick={() => fileRef.current?.click()}
              className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 transition-all duration-200 ${
                dragging
                  ? "border-iris-400 bg-iris-500/10"
                  : "border-white/12 bg-white/[0.02] hover:border-iris-400/40 hover:bg-iris-500/[0.05]"
              }`}
            >
              {analyzing ? (
                <div className="flex flex-col items-center gap-3 text-white/80 py-2">
                  <ThinkingOrb state="searching" size={64} theme="dark" />
                  <p className="text-sm font-medium">
                    Analyzing your resume & tailoring questions…
                  </p>
                  <p className="text-xs text-white/40">
                    Extracting skills, career highlights, and scoring criteria
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2.5 text-white/55">
                  <Upload className="size-6 text-iris-300" />
                  <p className="text-sm">
                    Drop your resume here, or{" "}
                    <span className="text-iris-300 font-medium">browse</span>
                  </p>
                  <p className="text-xs text-white/30">
                    PDF or TXT · scanned PDFs are OCR'd automatically
                  </p>
                </div>
              )}
            </div>
          </DropZoneBeamWrapper>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(file, jdDraft)
            e.target.value = ""
          }}
        />

        {/* Optional job description, captured before the first upload */}
        <div className="mt-4 text-left">
          <p className="mb-1.5 text-[10px] uppercase tracking-widest text-white/35">
            Job description (optional) — grounds the questions in the role
          </p>
          <textarea
            value={jdDraft}
            onChange={(e) => setJdDraft(e.target.value)}
            rows={4}
            placeholder="Paste the job description here, then choose your resume. Questions will be generated from the gaps it finds."
            className="w-full resize-y rounded-2xl border border-white/12 bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-white/85 outline-none focus:border-iris-400/40"
          />
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
    )
  }

  const done = currentQuestion === null
  const average = answers.length
    ? Math.round(answers.reduce((s, a) => s + a.score, 0) / answers.length)
    : 0

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 pb-4">
      {/* interviewer + resume summary */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <FileText className="mt-0.5 size-4 shrink-0 text-iris-300" />
            <div>
              <p className="text-xs uppercase tracking-wider text-white/40">
                {filename}
                {structured.years_experience
                  ? ` · ${structured.years_experience} yrs`
                  : ""}{" "}
                · {questions.length} questions
                {activePersona ? ` · ${activePersona.label}` : ""}
              </p>
              <p className="mt-1 text-sm text-white/75">{profile}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onReset} title="New resume">
            <RotateCcw />
          </Button>
        </div>

        {/* parsed facts */}
        {structured.skills && structured.skills.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {structured.skills.slice(0, 10).map((s) => (
              <span
                key={s}
                className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/60"
              >
                {s}
              </span>
            ))}
          </div>
        )}

        {(structured.top_achievements?.length ?? 0) > 0 && (
          <ul className="mt-3 space-y-1">
            {structured.top_achievements?.slice(0, 3).map((a, i) => (
              <li key={i} className="flex gap-2 text-xs text-white/65">
                <Award className="mt-0.5 size-3.5 shrink-0 text-mint-400" />
                {a}
              </li>
            ))}
          </ul>
        )}

        {(structured.probe_areas?.length ?? 0) > 0 && (
          <details className="mt-3 group">
            <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-amber-300/90 hover:text-amber-200">
              <Search className="size-3.5" /> What the interviewer will probe
            </summary>
            <ul className="mt-2 space-y-1">
              {structured.probe_areas?.map((p, i) => (
                <li key={i} className="flex gap-2 text-xs text-white/60">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300/70" />
                  {p}
                </li>
              ))}
            </ul>
          </details>
        )}

        {(structured.education?.length ?? 0) > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-white/45">
            <GraduationCap className="size-3.5" />
            {structured.education
              ?.map((e) => [e.degree, e.institution, e.year].filter(Boolean).join(", "))
              .join(" · ")}
          </p>
        )}

        {parse?.audit && <ParseAuditPanel parse={parse} />}
      </Card>

      {/* Job description grounding: requirement x evidence x confidence */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs text-white/70">
            <Target className="size-3.5 text-iris-300" /> Job description
            grounding
          </p>
          {(coverage?.requirements?.length ?? 0) > 0 && (
            <span className="text-[10px] text-white/45">
              {coverage?.matched ?? 0} matched · {coverage?.gaps ?? 0} gaps
            </span>
          )}
        </div>

        {answers.length === 0 ? (
          <JdEditor initial={jd ?? ""} busy={analyzing} onApply={onApplyJd} />
        ) : (
          <p className="mt-1 text-[11px] text-white/40">
            Questions are locked once you start answering.
          </p>
        )}

        {(coverage?.requirements?.length ?? 0) > 0 && (
          <CoverageList coverage={coverage!} />
        )}
      </Card>

      {/* Switch interviewer mid-session */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] uppercase tracking-widest text-white/30">
          Interviewer
        </span>
        {personas.map((p) => {
          const accent = ACCENTS[p.accent] ?? ACCENTS.iris
          const orb = PERSONA_ORBS[p.id] ?? { color: "violet", shape: "squircle" }
          const active = activePersona?.id === p.id
          return (
            <button
              key={p.id}
              onClick={() => onPersona(p.id)}
              title={p.tagline}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all duration-200 ${
                active
                  ? `${accent.ring} ${accent.bg} ${accent.text} shadow-sm`
                  : "border-white/[0.08] bg-white/[0.04] text-white/45 hover:bg-white/[0.08] hover:text-white/75"
              }`}
            >
              <div className="shrink-0 scale-75 -my-1">
                <AvatarOrb color={orb.color} shape={orb.shape} size="sm" blinking={false} />
              </div>
              {p.label}
              {p.advanced && (
                <span className="text-[8px] uppercase tracking-wider text-white/35">
                  advanced
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* progress chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {questions.map((q, i) => {
          const record = answers[i]
          const isCurrent = !done && i === answers.length
          return (
            <span
              key={q.id}
              title={q.question}
              className={`flex h-7 min-w-7 items-center justify-center rounded-lg border px-2 text-xs font-medium ${
                record
                  ? "border-mint-400/40 bg-mint-400/10 text-mint-400"
                  : isCurrent
                    ? "border-iris-400/60 bg-iris-500/15 text-white"
                    : "border-white/10 bg-white/5 text-white/40"
              }`}
            >
              {record ? record.score : i + 1}
            </span>
          )
        })}
        {answers.length > 0 && (
          <span className="ml-2 text-xs text-white/45">
            average {average}/100
          </span>
        )}
      </div>

      {/* retry the same question, out-of-band from the question sequence */}
      {retryTarget && (
        <RetryCard
          target={retryTarget}
          stage={stage}
          levels={levels}
          speaking={speaking}
          retrying={retrying}
          start={start}
          stop={stop}
          onRetryAnswer={onRetryAnswer}
          onCancel={onCancelRetry}
        />
      )}

      {/* current question + mic */}
      <AnimatePresence mode="wait">
        {!done ? (
          <motion.div
            key={`q-${currentQuestion.id}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <QuestionBeamWrapper active={speaking}>
              <Card className="border-iris-400/25 bg-iris-500/[0.07] p-5 relative overflow-hidden">
                {/* Active interviewer header banner */}
                <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-white/[0.07]">
                  <div className="flex items-center gap-3">
                    <AvatarOrb
                      color={
                        (activePersona && PERSONA_ORBS[activePersona.id]?.color) ||
                        "indigo"
                      }
                      shape={
                        (activePersona && PERSONA_ORBS[activePersona.id]?.shape) ||
                        "circle"
                      }
                      size="sm"
                      blinking={speaking}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white/95">
                          {activePersona?.label ?? "Interviewer"}
                        </span>
                        {speaking && (
                          <span className="flex items-center gap-1 text-[10px] text-iris-300 font-medium">
                            <span className="size-1.5 rounded-full bg-iris-400 animate-pulse" />
                            Speaking
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/45 line-clamp-1">
                        {activePersona?.tagline}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-white/60">
                      {currentQuestion.type}
                    </span>
                    {currentQuestion.competency && (
                      <span className="rounded-full border border-iris-400/30 bg-iris-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-iris-300">
                        {currentQuestion.competency}
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-base sm:text-lg leading-relaxed text-white font-medium">
                  {currentQuestion.question}
                </p>
                {currentQuestion.why && (
                  <p className="mt-2.5 flex items-start gap-1.5 text-xs text-white/45">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-300/80" />
                    {currentQuestion.why}
                  </p>
                )}

                <div className="mt-5 flex items-center gap-3">
                  <button
                    onClick={listening ? stop : start}
                    disabled={scoring || speaking}
                    className={`relative flex size-12 shrink-0 items-center justify-center rounded-2xl transition-all duration-200 disabled:pointer-events-none disabled:opacity-40 ${
                      listening
                        ? "bg-gradient-to-br from-rose-500 to-red-500 shadow-lg shadow-red-500/40"
                        : "bg-gradient-to-br from-iris-600 to-iris-500 shadow-lg shadow-iris-600/35 hover:scale-105"
                    }`}
                  >
                    {listening && (
                      <span className="absolute inset-0 animate-pulse-ring rounded-2xl bg-red-500/50" />
                    )}
                    {listening ? (
                      <AudioLines className="size-5 text-white" />
                    ) : (
                      <Mic className="size-5 text-white" />
                    )}
                  </button>
                  <div className="flex h-7 flex-1 items-center gap-2">
                    {listening ? (
                      <div className="flex h-7 items-end gap-0.5">
                        {levels.map((l, i) => (
                          <span
                            key={i}
                            className="w-1 rounded-full bg-rose-400/90 transition-[height] duration-75"
                            style={{ height: `${Math.round(3 + l * 24)}px` }}
                          />
                        ))}
                      </div>
                    ) : scoring ? (
                      <div className="flex items-center gap-2 text-xs text-iris-200">
                        <ThinkingOrb state="solving" size={20} theme="dark" />
                        <span>Scoring your answer against the HR scorecard…</span>
                      </div>
                    ) : (
                      <span className="text-xs text-white/40">
                        {speaking
                          ? `${activePersona?.label ?? "The interviewer"} is speaking… (tap mic or Space to jump in)`
                          : "Tap the mic and answer out loud (pause when done)"}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            </QuestionBeamWrapper>
          </motion.div>
        ) : (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="border-mint-400/25 bg-mint-400/[0.06] p-5">
              <div className="flex items-center gap-3">
                <TrendingUp className="size-5 text-mint-400" />
                <div>
                  <p className="text-sm font-medium">
                    Session complete — average {average}/100
                  </p>
                  <p className="text-xs text-white/50">
                    {average >= 80
                      ? "Strong, interview-ready answers."
                      : average >= 60
                        ? "Solid base — tighten the weak spots below."
                        : "Good start — the fixes below will move you fast."}
                  </p>
                </div>
              </div>

              {behaviour && behaviour.answered > 0 && (
                <div className="mt-4 border-t border-white/10 pt-3">
                  <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-iris-300">
                    <Activity className="size-3" /> confidence, measured as
                    behaviour
                  </p>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    <Stat label="answered" value={`${behaviour.answered}`} />
                    <Stat label="corrected" value={`${behaviour.corrected}`} />
                    <Stat label="retried" value={`${behaviour.retried}`} />
                    <Stat label="improved" value={`${behaviour.improved}`} />
                  </div>
                  <p className="mt-2 text-[10px] text-white/35">
                    Choices you made across your local practice history — never
                    read from your face.
                  </p>
                </div>
              )}

              {setupSummary?.available && (
                <div className="mt-4 border-t border-white/10 pt-3">
                  <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-iris-300">
                    <Video className="size-3" /> camera setup across the session
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Stat
                      label="face visible"
                      value={`${setupSummary.face_visible_pct ?? 0}%`}
                    />
                    <Stat
                      label="facing camera"
                      value={`${setupSummary.avg_facing_pct ?? 0}%`}
                    />
                    <Stat
                      label="answers checked"
                      value={`${setupSummary.answers_analysed ?? 0}`}
                    />
                  </div>
                  {(setupSummary.notes?.length ?? 0) > 0 && (
                    <ul className="mt-3 space-y-1">
                      {setupSummary.notes?.map((n, i) => (
                        <li key={i} className="flex gap-2 text-xs text-white/70">
                          <ScanFace className="mt-0.5 size-3.5 shrink-0 text-mint-400" />
                          {n}
                        </li>
                      ))}
                    </ul>
                  )}
                  {(setupSummary.multi_face_flags ?? 0) > 0 && (
                    <p className="mt-2 text-[10px] text-amber-300">
                      {setupSummary.multi_face_flags} answer(s) had another
                      person visible in frame.
                    </p>
                  )}
                  <p className="mt-2 text-[10px] text-white/35">
                    Framing and visibility only — never emotion, never scored.
                  </p>
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {/* scored answers */}
      {answers
        .map((record, index) => ({ record, index }))
        .reverse()
        .map(({ record, index }) => (
          <ScoreCard
            key={index}
            record={record}
            question={questions[index]}
            index={index}
            retry={retryResults[record.question_id ?? -1]}
            retrying={retrying}
            retryTarget={retryTarget}
            onRetry={onRetry}
            onRescore={onRescore}
            rescoring={scoring}
          />
        ))}
    </div>
  )
}

/**
 * Retry an already-answered question out-of-band.
 *
 * Same question, same rubric, same score maths as the first attempt (persona
 * bias was deleted in step 1), so the two scores are genuinely comparable. The
 * result is shown as a side-by-side diff on the original scorecard.
 */
function RetryCard({
  target,
  stage,
  levels,
  speaking,
  retrying,
  start,
  stop,
  onRetryAnswer,
  onCancel,
}: {
  target: RetryTarget
  stage: ChatStage
  levels: number[]
  speaking: boolean
  retrying: boolean
  start: () => void
  stop: () => void
  onRetryAnswer: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState("")
  const listening = stage === "listening"

  return (
    <Card className="border-iris-400/30 bg-iris-500/[0.08] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium text-white/90">
          <Repeat className="size-4 text-iris-300" /> Retry this question
        </p>
        <Button variant="ghost" size="icon" onClick={onCancel} title="Cancel retry">
          <X />
        </Button>
      </div>
      <p className="mt-2 text-sm text-white/80">{target.question.question}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-white/45">
        Same question, same rubric. Aria will show you exactly what changed —
        including any numbers you added.
      </p>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={listening ? stop : start}
          disabled={retrying || speaking}
          aria-label={listening ? "Stop" : "Answer retry out loud"}
          className={`relative flex size-10 shrink-0 items-center justify-center rounded-2xl transition-all duration-200 disabled:pointer-events-none disabled:opacity-40 ${
            listening
              ? "bg-gradient-to-br from-rose-500 to-red-500 shadow-lg shadow-red-500/40"
              : "bg-gradient-to-br from-iris-600 to-iris-500 shadow-lg shadow-iris-600/35 hover:scale-105"
          }`}
        >
          {listening && (
            <span className="absolute inset-0 animate-pulse-ring rounded-2xl bg-red-500/50" />
          )}
          {listening ? (
            <AudioLines className="size-5 text-white" />
          ) : (
            <Mic className="size-5 text-white" />
          )}
        </button>
        <div className="flex h-7 flex-1 items-end gap-0.5">
          {listening ? (
            levels.map((l, i) => (
              <span
                key={i}
                className="w-1 rounded-full bg-rose-400/90 transition-[height] duration-75"
                style={{ height: `${Math.round(3 + l * 24)}px` }}
              />
            ))
          ) : (
            <span className="text-xs text-white/40">
              {speaking
                ? "Aria is speaking… (tap mic or Space to jump in)"
                : "Tap the mic and answer again, or type below"}
            </span>
          )}
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Or type your improved answer…"
        className="mt-3 w-full resize-y rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-sm leading-relaxed text-white/90 outline-none focus:border-iris-400/40"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          onClick={() => onRetryAnswer(text)}
          disabled={!text.trim() || retrying}
        >
          {retrying ? <Loader2 className="animate-spin" /> : <Repeat />}
          {retrying ? "Scoring retry…" : "Score this retry"}
        </Button>
        <span className="text-[10px] text-white/40">
          The first attempt is kept — nothing is overwritten.
        </span>
      </div>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.05] px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-white/40">
        {label}
      </p>
      <p className="text-sm text-white/85">{value}</p>
    </div>
  )
}

function JdEditor({
  initial,
  busy,
  onApply,
}: {
  initial: string
  busy: boolean
  onApply: (jd: string) => void
}) {
  const [text, setText] = useState(initial)
  return (
    <div className="mt-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={text ? 5 : 3}
        placeholder="Paste a job description to ground the questions in the role's real requirements and gaps…"
        className="w-full resize-y rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-xs leading-relaxed text-white/90 outline-none focus:border-iris-400/40"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={() => onApply(text)} disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Target />}
          {busy ? "Reading the JD…" : "Ground questions in this JD"}
        </Button>
        <span className="text-[10px] text-white/40">
          Questions are regenerated from the gaps it finds.
        </span>
      </div>
    </div>
  )
}

function confidenceTone(confidence: string) {
  if (confidence === "strong")
    return {
      text: "text-mint-400",
      pill: "border-mint-400/30 bg-mint-400/10 text-mint-200",
      icon: <CheckCircle2 className="size-3.5" />,
    }
  if (confidence === "partial")
    return {
      text: "text-amber-300",
      pill: "border-amber-300/30 bg-amber-300/10 text-amber-200",
      icon: <AlertTriangle className="size-3.5" />,
    }
  if (confidence === "gap")
    return {
      text: "text-red-300",
      pill: "border-red-400/30 bg-red-400/10 text-red-200",
      icon: <XCircle className="size-3.5" />,
    }
  return {
    text: "text-white/50",
    pill: "border-white/15 bg-white/5 text-white/50",
    icon: <Circle className="size-3.5" />,
  }
}

function CoverageList({ coverage }: { coverage: Coverage }) {
  const requirements = coverage.requirements ?? []
  if (requirements.length === 0) return null
  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      {coverage.summary && (
        <p className="mb-2 text-[11px] leading-relaxed text-white/55">
          {coverage.summary}
        </p>
      )}
      <ul className="space-y-2">
        {requirements.map((r, i) => {
          const tone = confidenceTone(r.confidence)
          return (
            <li key={i} className="flex gap-2 text-xs">
              <span className={`mt-0.5 shrink-0 ${tone.text}`}>{tone.icon}</span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-white/80">{r.requirement}</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-px text-[9px] uppercase tracking-wider text-white/45">
                    {r.importance}
                  </span>
                  <span
                    className={`rounded-full border px-1.5 py-px text-[9px] uppercase tracking-wider ${tone.pill}`}
                  >
                    {r.confidence}
                  </span>
                </span>
                {r.evidence ? (
                  <span className="mt-0.5 block border-l-2 border-white/20 pl-2 italic text-white/50">
                    “{r.evidence}”
                  </span>
                ) : (
                  <span className="mt-0.5 block text-[10px] text-white/40">
                    no resume evidence yet
                    {r.why ? ` — ${r.why}` : ""}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function EvidenceRow({
  item,
  tone,
  icon,
}: {
  item: EvidenceItem
  tone: "mint" | "amber" | "red"
  icon: React.ReactNode
}) {
  const toneText =
    tone === "mint"
      ? "text-mint-400"
      : tone === "amber"
        ? "text-amber-300"
        : "text-red-300"
  const sourceLabel =
    item.source === "answer"
      ? "from your words"
      : item.source === "resume"
        ? "from your résumé"
        : "general suggestion"
  return (
    <li className="flex gap-2 text-xs text-white/70">
      <span className={`mt-0.5 shrink-0 ${toneText}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block">{item.point}</span>
        {item.quote && (
          <span className="mt-1 block border-l-2 border-white/20 pl-2 italic text-white/50">
            “{item.quote}”
          </span>
        )}
        <span
          className={`mt-1 inline-block rounded-full border border-white/10 bg-white/5 px-1.5 py-px text-[9px] uppercase tracking-wider ${
            item.source === "general" ? "text-white/40" : "text-white/55"
          }`}
        >
          {sourceLabel}
        </span>
      </span>
    </li>
  )
}

function severityColor(severity: string) {
  return severity === "high"
    ? "bg-red-400"
    : severity === "medium"
      ? "bg-amber-300"
      : "bg-white/40"
}

/**
 * Deterministic ATS parse audit: what the machine extracted from the resume,
 * next to the flags that explain where its reading diverges from yours.
 */
function ParseAuditPanel({
  parse,
}: {
  parse: {
    method?: string
    pages?: number
    text?: string
    audit?: ParseAudit
  }
}) {
  const audit = parse.audit
  if (!audit) return null
  const flags = audit.flags ?? []
  const chips = [
    `read via ${parse.method ?? "?"}`,
    `${parse.pages ?? 1} page${(parse.pages ?? 1) === 1 ? "" : "s"}`,
    `${audit.words ?? 0} words`,
    audit.columns === 2 ? "2 columns" : "1 column",
  ]

  return (
    <details className="mt-3 group">
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200">
        <FileSearch className="size-3.5" /> ATS parse audit
        {flags.length > 0 && (
          <span className="rounded-full border border-white/15 bg-white/5 px-1.5 py-px text-[9px] text-white/50">
            {flags.length} flag{flags.length === 1 ? "" : "s"}
          </span>
        )}
      </summary>

      <div className="mt-2 space-y-2.5 text-left">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50"
            >
              {c}
            </span>
          ))}
        </div>

        {flags.length > 0 && (
          <ul className="space-y-2">
            {flags.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span
                  className={`mt-1 size-1.5 shrink-0 rounded-full ${severityColor(
                    f.severity
                  )}`}
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-white/80">
                    {f.title}
                  </span>
                  <span className="block text-[11px] leading-relaxed text-white/55">
                    {f.detail}
                  </span>
                  {f.evidence && (
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-white/30">
                      e.g. {f.evidence}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/35">
            What the parser read
          </p>
          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-[10px] leading-relaxed text-white/60">
            {parse.text || "(no text extracted)"}
          </pre>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(audit.missing_sections?.length ?? 0) === 0 ? (
            <span className="text-[10px] text-mint-400">
              all standard sections found
            </span>
          ) : (
            audit.missing_sections?.map((s) => (
              <span
                key={s}
                className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[10px] text-amber-200"
              >
                missing: {s}
              </span>
            ))
          )}
        </div>

        <p className="text-[10px] leading-relaxed text-white/35">
          ATS-friendly fixes: single-column layout, no tables, real text instead
          of images, conventional headings, and an email in the body.
        </p>
      </div>
    </details>
  )
}

/**
 * What the mic heard — still correctable after the fact.
 *
 * Aria scores the answer the moment it lands, so the interview never stalls on
 * a confirm step. If a word was misheard, fix it here and re-score: the same
 * attempt is updated in place (never duplicated) and Aria shows the movement,
 * because "here is what the machine actually received" is the whole point.
 */
function AnswerTranscript({
  record,
  onRescore,
  rescoring,
}: {
  record: ScoreRecord
  onRescore?: (questionId: number, text: string) => void
  rescoring?: boolean
}) {
  const [open, setOpen] = useState(false)
  // remounted by ScoreCard whenever the scored answer changes, so the draft is
  // always the transcript Aria actually scored
  const [draft, setDraft] = useState(record.answer)

  const questionId = record.question_id
  const correctable =
    record.source === "voice" && questionId !== undefined && !!onRescore
  const dirty = draft.trim() !== record.answer.trim()
  const delta = record.score_delta ?? 0

  return (
    <div className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2">
      <p className="text-xs text-white/50">
        <span className="text-white/40">
          {record.source === "voice" ? "mic heard: " : "you typed: "}
        </span>
        {record.answer}
      </p>

      {correctable && (
        <>
          {record.edited && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-white/45">
              <RotateCcw className="size-3 text-amber-300" />
              re-scored after your correction
              {typeof record.score_before === "number" && (
                <span className="text-white/60">
                  {record.score_before} → {record.score}
                  {delta !== 0 && (
                    <span
                      className={
                        delta > 0 ? " text-mint-400" : " text-red-300"
                      }
                    >
                      {" "}
                      ({delta > 0 ? "+" : ""}
                      {delta})
                    </span>
                  )}
                </span>
              )}
            </p>
          )}

          {!open ? (
            <button
              onClick={() => setOpen(true)}
              className="mt-1.5 text-[11px] text-iris-300 hover:text-iris-200"
            >
              Mic misheard something? Fix it
            </button>
          ) : (
            <div className="mt-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                aria-label="What the mic heard — edit to re-score"
                className="w-full resize-y rounded-lg border border-white/12 bg-black/30 px-2.5 py-1.5 text-xs leading-relaxed text-white/90 outline-none focus:border-iris-400/40"
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => onRescore?.(questionId, draft.trim())}
                  disabled={rescoring || !draft.trim() || !dirty}
                  className="h-8 px-3 text-xs"
                >
                  {rescoring ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RotateCcw />
                  )}
                  {rescoring ? "Re-scoring…" : "Re-score this answer"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(record.answer)
                    setOpen(false)
                  }}
                  className="h-8 px-2 text-xs"
                >
                  Cancel
                </Button>
                {!dirty && !rescoring && (
                  <span className="text-[10px] text-white/40">
                    edit a word to enable re-scoring
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ScoreCard({
  record,
  question,
  index,
  retry,
  retrying,
  retryTarget,
  onRetry,
  onRescore,
  rescoring,
}: {
  record: ScoreRecord
  question?: Question
  index?: number
  retry?: ScoreRecord
  retrying?: boolean
  retryTarget?: RetryTarget | null
  onRetry?: (question: Question, index: number) => void
  onRescore?: (questionId: number, text: string) => void
  rescoring?: boolean
}) {
  const [showBreakdown, setShowBreakdown] = useState(false)
  const canRetry =
    !!question && index !== undefined && !!onRetry && !retrying && !retryTarget
  const tone =
    record.score >= 80
      ? "text-mint-400 border-mint-400/40"
      : record.score >= 60
        ? "text-amber-300 border-amber-300/40"
        : "text-red-300 border-red-300/40"

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-white/40">
            {record.type}
            {record.competency ? ` · ${record.competency}` : ""}
          </p>
          <p className="mt-1 text-sm text-white/85">{record.question}</p>
        </div>
        <div className="text-right">
          <div
            className={`flex size-12 items-center justify-center rounded-xl border text-sm font-semibold ${tone}`}
          >
            {record.score}
          </div>
        </div>
      </div>

      {record.verdict && (
        <p className="mt-3 text-sm text-white/70">{record.verdict}</p>
      )}

      {retry?.diff && <RetryDiffBlock diff={retry.diff} />}

      {record.breakdown && (
        <div className="mt-3">
          <button
            onClick={() => setShowBreakdown((v) => !v)}
            className="text-xs text-iris-300 hover:text-iris-200"
          >
            {showBreakdown ? "Hide" : "Show"} HR scorecard breakdown
          </button>
          {showBreakdown && (
            <ul className="mt-2 space-y-1.5">
              {DIMS.map(([key, label, max]) => {
                const value = record.breakdown?.[key] ?? 0
                const pct = Math.round((value / max) * 100)
                return (
                  <li key={key} className="flex items-center gap-2 text-xs">
                    <span className="w-32 shrink-0 text-white/45">{label}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <span
                        className={`block h-full rounded-full ${
                          pct >= 70
                            ? "bg-mint-400"
                            : pct >= 40
                              ? "bg-amber-300"
                              : "bg-red-400"
                        }`}
                        style={{ width: `${Math.max(3, pct)}%` }}
                      />
                    </span>
                    <span className="w-12 shrink-0 text-right text-white/55">
                      {value}/{max}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <AnswerTranscript
        key={`${record.question_id ?? index ?? 0}-${record.answer}`}
        record={record}
        onRescore={onRescore}
        rescoring={rescoring}
      />

      {record.strengths.length > 0 && (
        <ul className="mt-3 space-y-2">
          {record.strengths.map((s, i) => (
            <EvidenceRow
              key={i}
              item={s}
              tone="mint"
              icon={<CheckCircle2 className="size-3.5" />}
            />
          ))}
        </ul>
      )}
      {record.improvements.length > 0 && (
        <ul className="mt-2 space-y-2">
          {record.improvements.map((s, i) => (
            <EvidenceRow
              key={i}
              item={s}
              tone="amber"
              icon={<AlertTriangle className="size-3.5" />}
            />
          ))}
        </ul>
      )}

      {(record.setup?.notes?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-xl border border-iris-400/20 bg-iris-500/[0.06] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-iris-300">
            <Video className="size-3" /> camera setup
            {record.setup && (
              <span className="ml-auto text-white/50">
                {record.setup.faceVisiblePct}% visible · {record.setup.facingPct}
                % facing
              </span>
            )}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {record.setup?.notes?.map((n, i) => (
              <li key={i} className="text-xs text-white/70">
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(record.red_flags?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-xl border border-red-400/25 bg-red-500/[0.07] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-red-300">
            <Flag className="size-3" /> HR red flags in this answer
          </p>
          <ul className="mt-1 space-y-2">
            {record.red_flags?.map((f, i) => (
              <EvidenceRow
                key={i}
                item={f}
                tone="red"
                icon={<Flag className="size-3.5" />}
              />
            ))}
          </ul>
        </div>
      )}

      {record.hr_tip && (
        <p className="mt-3 flex gap-2 rounded-xl border border-sky-400/20 bg-sky-400/[0.07] px-3 py-2 text-xs text-sky-100/80">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-sky-300" />
          <span>
            <span className="text-sky-300">HR insight: </span>
            {record.hr_tip}
          </span>
        </p>
      )}

      {record.answer_revision && (
        <details className="mt-3 group">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-iris-300 hover:text-iris-200">
            <Sparkles className="size-3.5" /> Show an evidence-preserving revision
          </summary>
          <p className="mt-2 rounded-xl border border-iris-400/20 bg-iris-500/[0.07] px-3 py-2 text-xs leading-relaxed text-white/75">
            {record.answer_revision}
          </p>
          <p className="mt-1.5 text-[10px] text-white/40">
            Your own words, tightened. Placeholders like [add metric] mark facts
            only you can supply — Aria never invents a number for you.
          </p>
        </details>
      )}

      {canRetry && (
        <div className="mt-3 border-t border-white/[0.07] pt-3">
          <Button
            variant="outline"
            onClick={() => onRetry?.(question as Question, index as number)}
          >
            <Repeat /> Retry this question
          </Button>
          <span className="ml-2 text-[10px] text-white/40">
            Same rubric — Aria shows what changed.
          </span>
        </div>
      )}
    </Card>
  )
}

/** Deterministic side-by-side of a retry against the first attempt. */
function RetryDiffBlock({ diff }: { diff: RetryDiff }) {
  const improved = diff.score_delta >= 0
  return (
    <div className="mt-3 rounded-xl border border-iris-400/25 bg-iris-500/[0.07] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-iris-300">
          <Repeat className="size-3" /> what changed — attempt {diff.attempt}
        </p>
        <span
          className={`flex items-center gap-1 text-sm font-semibold ${
            improved ? "text-mint-400" : "text-red-300"
          }`}
        >
          {diff.score_before}
          <span className="text-white/40">→</span>
          {diff.score_after}
          {improved ? (
            <ArrowUpRight className="size-3.5" />
          ) : (
            <ArrowDownRight className="size-3.5" />
          )}
          <span className="text-xs">
            {diff.score_delta >= 0 ? "+" : ""}
            {diff.score_delta}
          </span>
        </span>
      </div>

      <ul className="mt-2 space-y-1">
        {diff.dimensions
          .filter((d) => d.delta !== 0)
          .map((d) => (
            <li key={d.key} className="flex items-center gap-2 text-[11px]">
              <span className="w-32 shrink-0 text-white/45">
                {DIM_LABELS[d.key] ?? d.key}
              </span>
              <span className="text-white/55">{d.before}</span>
              <span className="text-white/25">→</span>
              <span className={d.delta > 0 ? "text-mint-400" : "text-red-300"}>
                {d.after}/{d.max}
              </span>
              <span
                className={`text-[10px] ${
                  d.delta > 0 ? "text-mint-400/80" : "text-red-300/80"
                }`}
              >
                ({d.delta > 0 ? "+" : ""}
                {d.delta})
              </span>
            </li>
          ))}
      </ul>

      <p className="mt-2 text-[11px] leading-relaxed text-white/60">
        {diff.summary}
      </p>

      {(diff.numbers_added.length > 0 ||
        diff.added_words.length > 0 ||
        diff.removed_words.length > 0) && (
        <div className="mt-2 space-y-1.5">
          {diff.numbers_added.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-mint-400">
                numbers added
              </span>
              {diff.numbers_added.map((n) => (
                <span
                  key={n}
                  className="rounded-full border border-mint-400/30 bg-mint-400/10 px-1.5 py-px text-[10px] text-mint-200"
                >
                  {n}
                </span>
              ))}
            </div>
          )}
          {diff.added_words.length > 0 && (
            <p className="text-[10px] leading-relaxed text-white/45">
              <span className="text-mint-400/80">added: </span>
              {diff.added_words.join(", ")}
            </p>
          )}
          {diff.removed_words.length > 0 && (
            <p className="text-[10px] leading-relaxed text-white/45">
              <span className="text-red-300/80">dropped: </span>
              {diff.removed_words.join(", ")}
            </p>
          )}
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-white/35">
        A word-level comparison of the two transcripts, not a model's opinion —
        every word is checkable.
      </p>
    </div>
  )
}

function DropZoneBeamWrapper({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (active) {
    return (
      <BorderBeam size="md" colorVariant="ocean" className="rounded-2xl">
        {children}
      </BorderBeam>
    )
  }
  return <>{children}</>
}

function QuestionBeamWrapper({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (active) {
    return (
      <BorderBeam
        size="md"
        colorVariant="ocean"
        strength={0.85}
        brightness={1.0}
        glowSize={0.5}
        borderRadius={16}
        className="rounded-2xl"
      >
        {children}
      </BorderBeam>
    )
  }
  return <>{children}</>
}

