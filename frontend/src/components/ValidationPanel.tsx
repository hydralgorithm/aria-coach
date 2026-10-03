import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  MinusCircle,
  X,
} from "lucide-react"

type ConvergentRow = {
  dimension: string
  feature: string
  feature_label?: string
  expected: string
  label: string
  rho: number | null
  n: number
  verdict: string
}

type AgreementBlock = {
  key: string
  max: number
  kappa: number | null
  alpha: number | null
  mae: number | null
  mean_level_delta?: number | null
  interpretation: string
}

type Discrimination = {
  n_strong: number
  n_weak: number
  mean_strong: number | null
  mean_weak: number | null
  auc: number | null
  interpretation: string
  complete_separation: boolean
  weak_at_or_above_best_strong: number
  per_dimension?: { key: string; max: number; auc: number | null; interpretation: string }[]
}

type Report = {
  available: boolean
  ready?: boolean
  generated_at?: string
  eval_set?: { answers: number }
  aria?: { engine?: string | null; runs_total?: number }
  discrimination?: Discrimination
  reliability?: {
    answers_with_repeated_runs: number
    mean_sd: number | null
    mean_range: number | null
  }
  convergent?: ConvergentRow[]
  independent_judge?: { model: string; answers: number; overall: AgreementBlock } | null
  caveats?: string[]
}

const fmt = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "n/a" : v.toFixed(digits)

const verdictTone = (verdict: string) => {
  if (verdict === "supported") return "text-mint-400"
  if (verdict === "weakly supported") return "text-amber-300"
  if (verdict === "contradicted") return "text-red-300"
  return "text-white/40"
}

/**
 * Published validation numbers, read-only.
 *
 * Generated offline by `scripts/errorbars.py`. Deliberately not a form: the
 * candidate practising with Aria is never asked to rate it. This exists so a
 * judge can see how well the scores hold up, not so the user can adjust them.
 */
export default function ValidationPanel() {
  const [open, setOpen] = useState(false)
  const [report, setReport] = useState<Report | null>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch("/api/eval/error-bars")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Report | null) => {
        if (!cancelled && d) setReport(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  const rel = report?.reliability
  const disc = report?.discrimination
  const judge = report?.independent_judge

  const panel = open
    ? createPortal(
        <div className="fixed inset-0 z-50">
          {/* Backdrop to capture outside clicks */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity"
            onClick={() => setOpen(false)}
          />

          {/* Panel popover anchored right beneath the navbar */}
          <div
            className="fixed right-3 sm:right-6 top-14 sm:top-16 z-50 flex flex-col w-[24rem] sm:w-[26rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/15 bg-ink-950/95 shadow-2xl shadow-black/60 backdrop-blur-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            style={{ maxHeight: "calc(100vh - 4.5rem)" }}
          >
            {/* ── Header ── */}
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-3 bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-mint-500/15 text-mint-400 border border-mint-500/20">
                  <FlaskConical className="size-4" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold tracking-wider text-white uppercase">
                    Published Validation
                  </h3>
                  <p className="text-[10px] text-white/40">Empirical score reliability</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex size-7 items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white transition"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* ── Scrollable Body ── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 space-y-4 text-xs text-white/70">
              {!report || !report.available ? (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
                  <p className="text-[11px] leading-relaxed text-white/60">
                    Not generated yet. Aria&apos;s score validation runs offline — no
                    human rating is needed or requested.
                  </p>
                  <p className="text-[10px] leading-relaxed text-white/40">
                    Run <code className="rounded bg-white/10 px-1 py-0.5 text-white/80 font-mono text-[9px]">python scripts/errorbars.py score</code> then{" "}
                    <code className="rounded bg-white/10 px-1 py-0.5 text-white/80 font-mono text-[9px]">analyze</code> to publish the numbers.
                  </p>
                </div>
            ) : (
              <>
                {disc && (
                  <section>
                    <p className="text-[10px] uppercase tracking-wider text-white/35">
                      Can Aria tell a weak answer from a strong one?
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-white/70">
                      On a benchmark of {disc.n_weak} deliberately weak and{" "}
                      {disc.n_strong} strong answers, AUC ={" "}
                      <span className="text-white/90">{fmt(disc.auc, 2)}</span> (
                      {disc.interpretation}). Weak answers averaged{" "}
                      {fmt(disc.mean_weak, 1)}, strong{" "}
                      {fmt(disc.mean_strong, 1)} —{" "}
                      {disc.complete_separation
                        ? "the two groups do not overlap at all."
                        : `${disc.weak_at_or_above_best_strong} weak answer(s) reached the best strong score.`}
                    </p>
                  </section>
                )}

                {rel && (
                    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                        Aria against itself
                      </p>
                      <p className="text-[11px] leading-relaxed text-white/70">
                        Scored {rel.answers_with_repeated_runs} benchmark answers
                        repeatedly: the same answer moves by about{" "}
                        <span className="font-semibold text-white/90">
                          ±{fmt(rel.mean_sd, 1)}
                        </span>{" "}
                        points (mean range {fmt(rel.mean_range, 1)}). We publish
                        that spread instead of pretending the score is exact.
                      </p>
                    </section>
                  )}

                  {(report.convergent?.length ?? 0) > 0 && (
                    <section className="space-y-2">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                        Does the score track reality?
                      </p>
                      <div className="space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                        {report.convergent?.map((row, i) => (
                          <div key={i} className="flex items-start gap-2 text-[11px] py-1">
                            <span className={`mt-0.5 shrink-0 ${verdictTone(row.verdict)}`}>
                              {row.verdict === "supported" ? (
                                <CheckCircle2 className="size-3.5" />
                              ) : row.verdict === "contradicted" ? (
                                <AlertTriangle className="size-3.5" />
                              ) : (
                                <MinusCircle className="size-3.5" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <span className="text-white/85 font-medium">{row.label}</span>
                              <span className="mt-0.5 block text-[10px] text-white/45">
                                {row.feature_label} vs {row.dimension} · rho{" "}
                                {fmt(row.rho)} ({row.verdict})
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {judge && (
                    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                        Independent judge
                      </p>
                      <p className="text-[11px] leading-relaxed text-white/70">
                        A separate on-device model ({judge.model}) scored the same{" "}
                        {judge.answers} answers: weighted kappa{" "}
                        <span className="font-semibold text-white/90">{fmt(judge.overall.kappa)}</span>{" "}
                        ({judge.overall.interpretation}), mean gap{" "}
                      {fmt(judge.overall.mae, 1)} points
                      {judge.overall.mean_level_delta != null && (
                        <>
                          {" "}
                          — it scores about{" "}
                          {Math.abs(Math.round(judge.overall.mean_level_delta))}{" "}
                          points {judge.overall.mean_level_delta < 0 ? "harsher" : "softer"}
                        </>
                      )}
                      . That systematic severity gap is why kappa is modest even
                      where the ordering agrees.
                    </p>
                    </section>
                  )}

                  {(report.caveats?.length ?? 0) > 0 && (
                    <section className="space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                        What this does not claim
                      </p>
                      <ul className="space-y-1">
                        {report.caveats?.map((c, i) => (
                          <li key={i} className="text-[10px] leading-relaxed text-white/50 list-disc list-inside">
                            {c}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {report.generated_at && (
                    <p className="text-[9px] text-white/30 text-right">
                      Generated {report.generated_at}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )
    : null

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Published validation"
        aria-label="Published validation"
        className={`flex size-8 items-center justify-center rounded-xl transition ${
          open
            ? "bg-mint-500/20 text-mint-300 border border-mint-500/30"
            : "text-white/40 hover:bg-white/10 hover:text-white/80"
        }`}
      >
        <FlaskConical className="size-4" />
      </button>
      {panel}
    </>
  )
}
