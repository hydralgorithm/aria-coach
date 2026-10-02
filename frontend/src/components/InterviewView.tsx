import { useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  FileText,
  Upload,
  Mic,
  AudioLines,
  Loader2,
  Sparkles,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  RotateCcw,
  Briefcase,
  Shield,
  VenetianMask,
  Heart,
  Zap,
  Flag,
  GraduationCap,
  Award,
  Search,
  Eye,
  Smile,
  Video,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { ChatStage } from "@/hooks/useVoice"
import type {
  DeliverySummaryReport,
  PersonaInfo,
  Question,
  ScoreRecord,
  StructuredResume,
} from "@/hooks/useInterview"

const ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  shield: Shield,
  mask: VenetianMask,
  heart: Heart,
  zap: Zap,
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
  onUpload: (file: File) => void
  onPersona: (id: string) => void
  onReset: () => void
  stage: ChatStage
  levels: number[]
  speaking: boolean
  start: () => void
  stop: () => void
  deliverySummary?: DeliverySummaryReport | null
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
  onPersona,
  onReset,
  stage,
  levels,
  speaking,
  start,
  stop,
  deliverySummary,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const listening = stage === "listening"

  if (questions.length === 0) {
    return (
      <div className="mx-auto mt-[8vh] max-w-2xl px-6 text-center">
        <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-3xl bg-gradient-to-br from-iris-500 to-iris-600 shadow-2xl shadow-iris-600/50">
          <FileText className="size-8" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Practical interview practice
        </h2>
        <p className="mt-2 text-sm text-white/55">
          Pick who you want to face. Aria reads your resume, writes questions
          from your real experience, and scores each answer like an HR
          scorecard.
        </p>

        {/* interviewer personality */}
        <div className="mt-7 text-left">
          <p className="mb-2 text-xs uppercase tracking-wider text-white/40">
            Who is interviewing you?
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {personas.map((p) => {
              const Icon = ICONS[p.icon] ?? Briefcase
              const accent = ACCENTS[p.accent] ?? ACCENTS.iris
              const active = activePersona?.id === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => onPersona(p.id)}
                  className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition ${
                    active
                      ? `${accent.ring} ${accent.bg}`
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
                  }`}
                >
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${accent.bg} ${accent.text}`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span>
                    <span
                      className={`block text-sm font-medium ${active ? accent.text : "text-white/85"}`}
                    >
                      {p.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-white/45">
                      {p.tagline}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

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
            if (file) onUpload(file)
          }}
          onClick={() => fileRef.current?.click()}
          className={`mt-4 cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 transition ${
            dragging
              ? "border-iris-400 bg-iris-500/10"
              : "border-white/15 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.06]"
          }`}
        >
          {analyzing ? (
            <div className="flex flex-col items-center gap-3 text-white/70">
              <Loader2 className="size-6 animate-spin text-iris-300" />
              <p className="text-sm">
                Parsing your resume and writing tailored questions…
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-white/60">
              <Upload className="size-6" />
              <p className="text-sm">
                Drop your resume here, or{" "}
                <span className="text-iris-300">browse</span>
              </p>
              <p className="text-xs text-white/35">
                PDF or TXT · scanned PDFs are OCR'd automatically
              </p>
            </div>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(file)
            e.target.value = ""
          }}
        />

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
      </Card>

      {/* switch interviewer mid-session */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] uppercase tracking-wider text-white/35">
          interviewer
        </span>
        {personas.map((p) => {
          const Icon = ICONS[p.icon] ?? Briefcase
          const accent = ACCENTS[p.accent] ?? ACCENTS.iris
          const active = activePersona?.id === p.id
          return (
            <button
              key={p.id}
              onClick={() => onPersona(p.id)}
              title={p.tagline}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] transition ${
                active
                  ? `${accent.ring} ${accent.bg} ${accent.text}`
                  : "border-white/10 bg-white/5 text-white/45 hover:text-white/80"
              }`}
            >
              <Icon className="size-3" />
              {p.label}
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
              className={`flex h-7 min-w-7 items-center justify-center rounded-lg border px-2 text-xs ${
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

      {/* current question + mic */}
      <AnimatePresence mode="wait">
        {!done ? (
          <motion.div
            key={`q-${currentQuestion.id}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <Card className="border-iris-400/25 bg-iris-500/[0.07] p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-white/60">
                  {currentQuestion.type}
                </span>
                {currentQuestion.competency && (
                  <span className="rounded-full border border-iris-400/30 bg-iris-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-iris-300">
                    {currentQuestion.competency}
                  </span>
                )}
              </div>
              <p className="mt-3 text-base leading-relaxed text-white">
                {currentQuestion.question}
              </p>
              {currentQuestion.why && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-white/45">
                  <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
                  {currentQuestion.why}
                </p>
              )}

              <div className="mt-4 flex items-center gap-3">
                <Button
                  onClick={listening ? stop : start}
                  disabled={scoring || speaking}
                  className={`relative size-12 shrink-0 rounded-2xl ${
                    listening ? "bg-red-500 hover:bg-red-400" : ""
                  }`}
                >
                  {listening && (
                    <span className="absolute inset-0 animate-pulse-ring rounded-2xl bg-red-500/60" />
                  )}
                  {listening ? (
                    <AudioLines className="size-5" />
                  ) : (
                    <Mic className="size-5" />
                  )}
                </Button>
                <div className="flex h-7 flex-1 items-end gap-1">
                  {listening ? (
                    levels.map((l, i) => (
                      <span
                        key={i}
                        className="w-1.5 rounded-full bg-red-400/80"
                        style={{ height: `${Math.round(4 + l * 24)}px` }}
                      />
                    ))
                  ) : (
                    <span className="text-xs text-white/45">
                      {scoring
                        ? "Scoring your answer against the HR scorecard…"
                        : speaking
                          ? `${activePersona?.label ?? "The interviewer"} is speaking…`
                          : "Tap the mic and answer out loud (pause when done)"}
                    </span>
                  )}
                </div>
              </div>
            </Card>
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

              {deliverySummary?.available && (
                <div className="mt-4 border-t border-white/10 pt-3">
                  <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-iris-300">
                    <Video className="size-3" /> delivery across the whole session
                    {deliverySummary.avg_delivery_score != null && (
                      <span className="ml-auto text-white/60">
                        {deliverySummary.avg_delivery_score}/100 avg
                      </span>
                    )}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat
                      label="engagement"
                      value={`${deliverySummary.avg_engagement_pct ?? 0}%`}
                    />
                    <Stat
                      label="warmth"
                      value={`${deliverySummary.avg_smile_pct ?? 0}%`}
                    />
                    <Stat
                      label="tension"
                      value={`${deliverySummary.avg_tension_pct ?? 0}%`}
                    />
                    <Stat
                      label="face visible"
                      value={`${deliverySummary.face_visible_pct ?? 0}%`}
                    />
                  </div>
                  {(deliverySummary.notes?.length ?? 0) > 0 && (
                    <ul className="mt-3 space-y-1">
                      {deliverySummary.notes?.map((n, i) => (
                        <li key={i} className="flex gap-2 text-xs text-white/70">
                          <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-mint-400" />
                          {n}
                        </li>
                      ))}
                    </ul>
                  )}
                  {(deliverySummary.multi_face_flags ?? 0) > 0 && (
                    <p className="mt-2 text-[10px] text-amber-300">
                      {deliverySummary.multi_face_flags} answer(s) had another
                      person visible in frame — real interviews treat that
                      seriously.
                    </p>
                  )}
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
      {[...answers].reverse().map((a, i) => (
        <ScoreCard key={answers.length - i} record={a} />
      ))}
    </div>
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

function ScoreCard({ record }: { record: ScoreRecord }) {
  const [showBreakdown, setShowBreakdown] = useState(false)
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
          {typeof record.score_bias === "number" && record.score_bias !== 0 && (
            <p className="mt-1 text-[10px] text-white/35">
              {record.raw_score}
              {record.score_bias > 0 ? "+" : ""}
              {record.score_bias} mode
            </p>
          )}
        </div>
      </div>

      {record.verdict && (
        <p className="mt-3 text-sm text-white/70">{record.verdict}</p>
      )}

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

      <p className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-white/50">
        <span className="text-white/40">you said: </span>
        {record.answer}
      </p>

      {record.strengths.length > 0 && (
        <ul className="mt-3 space-y-1">
          {record.strengths.map((s, i) => (
            <li key={i} className="flex gap-2 text-xs text-white/70">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-mint-400" />
              {s}
            </li>
          ))}
        </ul>
      )}
      {record.improvements.length > 0 && (
        <ul className="mt-2 space-y-1">
          {record.improvements.map((s, i) => (
            <li key={i} className="flex gap-2 text-xs text-white/70">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
              {s}
            </li>
          ))}
        </ul>
      )}

      {(record.delivery_score != null || (record.delivery_notes?.length ?? 0) > 0) && (
        <div className="mt-3 rounded-xl border border-iris-400/20 bg-iris-500/[0.06] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-iris-300">
            <Video className="size-3" /> delivery & body language
            {record.delivery_score != null && (
              <span className="ml-auto text-white/60">
                {record.delivery_score}/100
              </span>
            )}
          </p>
          {record.delivery && (
            <div className="mt-1.5 flex flex-wrap gap-3 text-[10px] text-white/50">
              <span className="flex items-center gap-1">
                <Eye className="size-3" /> engagement {record.delivery.engagementPct}%
              </span>
              <span className="flex items-center gap-1">
                <Smile className="size-3" /> warmth {record.delivery.smilePct}%
              </span>
              <span>tension {record.delivery.tensionPct}%</span>
              <span>
                  {record.delivery.blinksPerMin == null
                    ? "blinks n/a"
                    : `${record.delivery.blinksPerMin} blinks/min`}
                </span>
            </div>
          )}
          <ul className="mt-1.5 space-y-0.5">
            {record.delivery_notes?.map((n, i) => (
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
          <ul className="mt-1 space-y-0.5">
            {record.red_flags?.map((f, i) => (
              <li key={i} className="text-xs text-red-200/80">
                {f}
              </li>
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

      {record.better_answer && (
        <details className="mt-3 group">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-iris-300 hover:text-iris-200">
            <Sparkles className="size-3.5" /> Show a stronger answer
          </summary>
          <p className="mt-2 rounded-xl border border-iris-400/20 bg-iris-500/[0.07] px-3 py-2 text-xs leading-relaxed text-white/75">
            {record.better_answer}
          </p>
        </details>
      )}
    </Card>
  )
}
