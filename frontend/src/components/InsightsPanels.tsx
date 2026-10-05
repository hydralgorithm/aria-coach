import { useState } from "react"
import { motion } from "motion/react"
import {
  TrendingUp,
  GraduationCap,
  ShieldCheck,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  Mic,
  ExternalLink,
  Quote,
  Clock,
  Target,
  Repeat,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react"

import { Card } from "@/components/ui/card"
import type {
  Readiness,
  LearningItem,
  LearningPlan,
  Question,
  ScoreRecord,
  SowReport,
  SowItem,
  SpeechMetrics,
  ResumeClaim,
  RetryTarget,
} from "@/hooks/useInterview"

/**
 * The evidence panels: readiness profile, learning plan, strengths /
 * weaknesses / opportunities, claim probes and delivery coaching.
 *
 * Design rule inherited from the rest of Aria: every number shows where it
 * came from, every quote is verbatim, and nothing is presented as a hiring
 * prediction or an official ATS score.
 */

const PRIORITY_STYLES: Record<string, string> = {
  critical: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  important: "border-amber-300/30 bg-amber-300/10 text-amber-200",
  optional: "border-white/10 bg-white/5 text-white/50",
}

/**
 * Where a plan item came from. Every item must name one of these — an item
 * with no traceable origin is a guess, and Aria does not ship guesses.
 */
const ORIGIN_LABELS: Record<string, string> = {
  jd_gap: "from the job description",
  weak_competency: "measured from your attempts",
  unsupported_claim: "from an unproven resume claim",
  general: "no specific gap found",
}

function SectionTitle({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof TrendingUp
  title: string
  hint?: string
}) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-iris-300">
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-white/80">
          {title}
        </h4>
        {hint && <p className="text-[10px] leading-snug text-white/55">{hint}</p>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- readiness

export function ReadinessPanel({
  readiness,
  heading = "Interview readiness",
}: {
  readiness: Readiness
  heading?: string
}) {
  const [open, setOpen] = useState(false)
  if (!readiness) return null
  return (
    <Card className="p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left"
      >
        <SectionTitle
          icon={Target}
          title={heading}
          hint="Practice readiness from your own evidence — not a hiring prediction"
        />
        <div className="flex items-end gap-3">
          <span className="text-4xl font-semibold tabular-nums text-white">
            {readiness.overall}
            <span className="text-lg text-white/55">/100</span>
          </span>
          {readiness.missing_components &&
            readiness.missing_components.length > 0 && (
              <span className="pb-1 text-[10px] leading-tight text-amber-200/70">
                not yet measured: {readiness.missing_components.join(", ")}
              </span>
            )}
        </div>
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-3 space-y-2 overflow-hidden"
        >
          {readiness.components.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <span className="w-44 shrink-0 truncate text-[11px] text-white/60">
                {c.label}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                {c.value !== null && (
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-iris-500 to-mint-400"
                    style={{ width: `${Math.min(100, c.value)}%` }}
                  />
                )}
              </div>
              <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-white/50">
                {c.value !== null ? `${c.value}` : "—"}
              </span>
            </div>
          ))}
          <p className="pt-1 text-[10px] leading-snug text-white/50">
            {readiness.scale_note}
          </p>
        </motion.div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------- learning plan

/**
 * The personalized plan. Every row must be traceable: what to learn, how
 * urgent, WHY (with the evidence that produced it and where that evidence
 * came from), what to do, a drill, a real resource from the curated catalog
 * and how to prove it worked. Nothing here is generated when there is no
 * evidence - the "general" origin is rendered as an honest fallback that says
 * exactly what was checked and found clean.
 */
export function LearningPlanPanel({
  plan,
  retestFor,
  onRetest,
  retestHint,
}: {
  plan: LearningPlan
  /**
   * Pure resolver: plan item -> the already-answered question we can honestly
   * re-test right now. Returning null hides the button instead of faking a
   * mapping between a topic and a question that never tested it.
   */
  retestFor?: (item: LearningItem) => RetryTarget | null
  /** invoked with the resolved target when the candidate clicks the button */
  onRetest?: (target: RetryTarget) => void
  retestHint?: string
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(0)
  if (!plan || !plan.items || plan.items.length === 0) {
    return (
      <Card className="p-4">
        <SectionTitle
          icon={GraduationCap}
          title="Your learning plan"
          hint="Nothing to study yet"
        />
        <p className="text-[11px] leading-relaxed text-white/60">
          No gaps found: every requirement in the job description had resume
          evidence behind it, no competency scored below the bar, and no
          quantified claim was left unsupported. Paste a job description or
          answer a full session and this rebuilds around what it actually finds.
        </p>
      </Card>
    )
  }
  return (
    <Card
      className="p-4"
      data-testid="learning-plan"
      data-plan-items={plan.items.length}
    >
      <SectionTitle
        icon={GraduationCap}
        title="Your learning plan"
        hint="Built from your gaps: JD requirements without evidence, weak competencies, unsupported claims"
      />
      <div className="space-y-2">
        {plan.items.map((item, i) => (
          <div
            key={item.topic + i}
            className="rounded-xl border border-white/[0.07] bg-white/[0.02]"
          >
            <button
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              aria-expanded={openIdx === i}
              className="flex w-full items-start gap-2 p-3 text-left"
            >
              <span
                className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider ${
                  PRIORITY_STYLES[item.priority] ?? PRIORITY_STYLES.optional
                }`}
              >
                {item.priority}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-white/90">
                  {item.topic}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-white/55">
                  Recommended because: {item.why}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-white/50">
                {item.estimated_effort}
              </span>
            </button>
            {openIdx === i && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-2.5 border-t border-white/[0.06] px-3 py-3"
              >
                <p className="text-[10px] uppercase tracking-wider text-white/45">
                  Origin: {ORIGIN_LABELS[item.origin] ?? item.origin}
                </p>
                <p className="text-[11px] text-white/50">
                  <Quote className="mr-1 inline size-3 text-white/50" />
                  <span className="text-white/45">Evidence: </span>
                  {item.evidence
                    ? item.evidence
                    : "none on file — that absence is the reason this is here"}
                </p>
                <p className="text-[11px] leading-relaxed text-white/70">
                  <strong className="text-white/90">Do this:</strong>{" "}
                  {item.practice_task}
                </p>
                <p className="text-[11px] leading-relaxed text-white/70">
                  <strong className="text-white/90">Mini drill:</strong>{" "}
                  {item.mini_drill}
                </p>
                {item.resource && (
                  <div className="rounded-lg border border-iris-400/20 bg-iris-500/[0.07] p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium text-iris-200">
                          {item.resource.title}
                        </p>
                        <p className="text-[10px] text-white/55">
                          {item.resource.provider}
                          {item.resource.estimated_time
                            ? ` · ${item.resource.estimated_time}`
                            : ""}
                          {item.resource.difficulty
                            ? ` · ${item.resource.difficulty}`
                            : ""}
                        </p>
                      </div>
                      {item.resource.url ? (
                        <a
                          href={item.resource.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-iris-400/30 px-2 py-1 text-[10px] text-iris-200 hover:bg-iris-500/20"
                        >
                          Open <ExternalLink className="size-2.5" />
                        </a>
                      ) : (
                        <span className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[10px] text-white/55">
                          built-in
                        </span>
                      )}
                    </div>
                    {item.resource.offline_alternative && (
                      <p className="mt-1.5 text-[10px] text-white/50">
                        Offline: {item.resource.offline_alternative}
                      </p>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-mint-300/70">
                  <CheckCircle2 className="mr-1 inline size-3" />
                  <span className="text-white/60">Re-test: </span>
                  {item.retest}
                </p>
                {(() => {
                  const target = retestFor?.(item) ?? null
                  return target && onRetest ? (
                    <button
                      onClick={() => onRetest(target)}
                      className="flex items-center gap-1.5 rounded-lg border border-mint-400/30 bg-mint-400/10 px-2 py-1 text-[10px] text-mint-300 hover:bg-mint-400/20"
                    >
                      <Repeat className="size-3" /> Re-test this now
                    </button>
                  ) : (
                    retestHint && (
                      <p className="text-[10px] leading-snug text-white/45">
                        {retestHint}
                      </p>
                    )
                  )
                })()}
              </motion.div>
            )}
          </div>
        ))}
      </div>
      {plan.method_note && (
        <p className="mt-3 text-[10px] leading-snug text-white/50">
          {plan.method_note}
        </p>
      )}
    </Card>
  )
}

// ------------------------------------------------------------ top weaknesses

/**
 * The three measured weaknesses, ranked, each with the evidence that produced
 * it. Separate from the full SOW panel so the completed-session flow reads
 * summary -> readiness -> weaknesses -> plan without scrolling back up.
 */
export function TopWeaknesses({
  report,
  limit = 3,
}: {
  report?: SowReport
  limit?: number
}) {
  const items = (report?.weaknesses ?? []).slice(0, limit)
  if (items.length === 0) {
    return (
      <Card className="p-4">
        <SectionTitle
          icon={AlertTriangle}
          title="Top weaknesses"
          hint="Nothing scored below the bar yet"
        />
        <p className="text-[11px] leading-relaxed text-white/60">
          No weakness was measurable from this session. Aria only lists a
          weakness when an answer or a resume line supports it - it will not
          invent one to fill the section.
        </p>
      </Card>
    )
  }
  return (
    <Card className="p-4">
      <SectionTitle
        icon={AlertTriangle}
        title="Top weaknesses"
        hint="Ranked from your answers and resume - each one cites its evidence"
      />
      <ol className="space-y-2">
        {items.map((item, i) => (
          <li
            key={i}
            className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/10 text-[9px] text-amber-200">
                {i + 1}
              </span>
              <p className="text-[11px] leading-snug text-white/80">
                {item.point}
              </p>
            </div>
            {item.quote && (
              <p className="mt-1.5 border-l-2 border-white/15 pl-2 text-[10px] italic leading-snug text-white/55">
                &ldquo;{item.quote}&rdquo;
              </p>
            )}
            <span className="mt-1.5 inline-block rounded-full border border-white/10 px-1.5 py-px text-[8px] uppercase tracking-wider text-white/50">
              {item.source === "verified_resume"
                ? "from your resume"
                : item.source === "measured"
                  ? "measured from attempts"
                  : "general"}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

// ------------------------------------------------------------- re-test loop

/**
 * Real before/after, straight from the stored attempts. Nothing is smoothed:
 * a re-test that scored lower shows a negative delta.
 */
export function RetestPanel({
  answers,
  questions,
  retryResults,
  onRetry,
}: {
  answers: ScoreRecord[]
  questions: Question[]
  retryResults: Record<number, ScoreRecord>
  onRetry: (question: Question, index: number) => void
}) {
  const rows = answers
    .map((record, index) => ({
      record,
      index,
      question: questions[index],
      retry: retryResults[record.question_id ?? -1],
    }))
    .filter((r) => r.question)
    .sort((a, b) => a.record.score - b.record.score)

  const retested = rows.filter((r) => r.retry?.diff)
  const deltas = retested.map((r) => r.retry!.diff!.score_delta)
  const avgDelta = deltas.length
    ? Math.round((deltas.reduce((s, d) => s + d, 0) / deltas.length) * 10) / 10
    : null

  return (<Card
          className="p-4"
          data-testid="retest-panel"
          data-retested={retested.length}
          data-avg-delta={avgDelta ?? ""}
        >
          <SectionTitle
            icon={Repeat}
            title="Re-test: previous vs target"
        hint="Same question, same rubric. The before/after comes from your stored attempts."
      />
      <p className="text-[11px] text-white/60">
        {retested.length === 0
          ? "No re-test yet. Retry any question below and the real before/after lands here - a worse score shows as a worse score."
          : `${retested.length} of ${rows.length} answered questions re-tested · average change ${avgDelta! > 0 ? "+" : ""}${avgDelta}`}
      </p>
      <ul className="mt-2 space-y-1.5">
        {rows.map(({ record, index, question, retry }) => {
          const diff = retry?.diff
          const delta = diff?.score_delta
          const DeltaIcon = delta == null ? Minus : delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus
          const tone =
            delta == null || delta === 0
              ? "text-white/45"
              : delta > 0
                ? "text-mint-300"
                : "text-rose-300"
          return (
            <li
              key={record.question_id ?? index}
              data-testid="retest-row"
              data-question-id={record.question_id ?? index}
              data-before={record.score}
              data-after={diff ? diff.score_after : ""}
              data-delta={delta ?? ""}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-[11px] leading-snug text-white/70">
                  <span className="text-white/45">
                    {question?.competency || question?.type} ·{" "}
                  </span>
                  {question?.question}
                </p>
                <button
                  onClick={() => onRetry(question, index)}
                  aria-label={`Re-test: ${question?.question ?? "question"}`}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-white/12 bg-white/[0.04] px-2 py-1 text-[10px] text-white/70 hover:bg-white/10"
                >
                  <Repeat className="size-2.5" />
                  {retry ? "retry again" : "re-test"}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-white/55">
                previous {record.score}
                {diff ? (
                  <>
                    {" → "}
                    <span className="text-white/85">now {diff.score_after}</span>{" "}
                    <span className={tone}>
                      ({delta! > 0 ? "+" : ""}
                      {delta})
                    </span>
                    <DeltaIcon className="ml-0.5 inline size-2.5" />
                    {diff.attempt > 2 ? ` · attempt ${diff.attempt}` : ""}
                  </>
                ) : (
                  " · not re-tested yet"
                )}
              </p>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

// ------------------------------------------------- strengths / weak / opps

const SOW_SECTIONS: (keyof SowReport)[] = [
  "strengths",
  "weaknesses",
  "opportunities",
]

const SOW_META: Record<string, { icon: typeof ShieldCheck; label: string; tone: string }> = {
  strengths: { icon: ShieldCheck, label: "Strengths", tone: "text-mint-400" },
  weaknesses: { icon: AlertTriangle, label: "Weaknesses", tone: "text-amber-300" },
  opportunities: { icon: Lightbulb, label: "Opportunities", tone: "text-iris-300" },
}

export function SowPanel({ report }: { report: SowReport }) {
  if (!report) return null
  return (
    <Card className="p-4">
      <SectionTitle
        icon={TrendingUp}
        title="Strengths · Weaknesses · Opportunities"
        hint="Every item cites its evidence — nothing is invented"
      />
      <div className="grid gap-3 md:grid-cols-3">
        {SOW_SECTIONS.map((key) => {
          const meta = SOW_META[key]
          const items = (report[key] ?? []) as SowItem[]
          const Icon = meta.icon
          return (
            <div key={key}>
              <p
                className={`mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${meta.tone}`}
              >
                <Icon className="size-3" /> {meta.label}
              </p>
              <ul className="space-y-1.5">
                {items.map((item, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2"
                  >
                    <p className="text-[11px] leading-snug text-white/75">
                      {item.point}
                    </p>
                    {item.quote && (
                      <p className="mt-1 border-l-2 border-white/15 pl-2 text-[10px] italic leading-snug text-white/55">
                        “{item.quote}”
                      </p>
                    )}
                    {item.rewrite && (
                      <p className="mt-1 text-[10px] leading-snug text-mint-300/80">
                        → {item.rewrite}
                      </p>
                    )}
                    <span className="mt-1 inline-block rounded-full border border-white/10 px-1.5 py-px text-[8px] uppercase tracking-wider text-white/50">
                      {item.source === "verified_resume"
                        ? "from your resume"
                        : item.source === "measured"
                          ? "measured from attempts"
                          : "general"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
      {report.claims && report.claims.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
            Claims an interviewer will interrogate
          </p>
          <div className="space-y-1.5">
            {report.claims.map((c, i) => (
              <ClaimProbe key={i} claim={c} defaultOpen={i === 0} />
            ))}
          </div>
        </div>
      )}
      {report.provenance_note && (
        <p className="mt-3 text-[10px] leading-snug text-white/50">
          {report.provenance_note}
        </p>
      )}
    </Card>
  )
}

function ClaimProbe({
  claim,
  defaultOpen = false,
}: {
  claim: ResumeClaim
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <Quote className="size-3 shrink-0 text-white/50" />
        <span className="flex-1 truncate text-[11px] text-white/75">
          {claim.claim}
        </span>
        <span className="shrink-0 text-[9px] uppercase tracking-wider text-iris-300/70">
          {open ? "hide probes" : `${claim.probes.length} probes`}
        </span>
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 pl-5">
          {claim.probes.map((p, i) => (
            <li key={i} className="text-[11px] leading-snug text-iris-200/80">
              → {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ------------------------------------------------------- delivery coaching

export function SpeechCoachPanel({ metrics }: { metrics?: SpeechMetrics }) {
  if (!metrics || (!metrics.filler_count && !metrics.wpm && !metrics.notes.length))
    return null
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/60">
        <Mic className="size-3" /> Delivery (observable — never scored)
      </p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {metrics.wpm != null && (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60">
            <Clock className="mr-1 inline size-2.5" />
            {metrics.wpm} wpm
          </span>
        )}
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60">
          {metrics.filler_count} filler{metrics.filler_count === 1 ? "" : "s"}
          {metrics.duration_s
            ? ` in ${Math.round(metrics.duration_s)}s`
            : ` / 100 words: ${metrics.fillers_per_100_words}`}
        </span>
        {metrics.restarts > 0 && (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60">
            {metrics.restarts} restart{metrics.restarts === 1 ? "" : "s"}
          </span>
        )}
        {metrics.top_fillers.slice(0, 2).map((f) => (
          <span
            key={f.word}
            className="rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2 py-0.5 text-[10px] text-amber-200/80"
          >
            “{f.word}” ×{f.count}
          </span>
        ))}
      </div>
      {metrics.notes.map((n, i) => (
        <p key={i} className="mb-1 text-[11px] leading-snug text-white/55">
          {n}
        </p>
      ))}
      <p className="mt-1 text-[9px] leading-snug text-white/50">
        Counted from the transcript and recording length. Aria does not read
        emotion, and this never changes your score.
      </p>
    </div>
  )
}
