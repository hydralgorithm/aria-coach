import { useEffect, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  MinusCircle,
  ShieldCheck,
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
  interpretation: string
}

type Report = {
  available: boolean
  ready?: boolean
  generated_at?: string
  eval_set?: { answers: number }
  aria?: { engine?: string | null; runs_total?: number }
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
  const judge = report?.independent_judge

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Published validation"
        aria-label="Published validation"
        className={`flex size-8 items-center justify-center rounded-xl transition hover:bg-white/10 ${
          open ? "text-mint-400" : "text-white/40 hover:text-white/70"
        }`}
      >
        <FlaskConical className="size-4" />
      </button>

      {open && (
        <div className="fixed bottom-4 right-4 z-50 w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/15 bg-ink-900/95 shadow-2xl backdrop-blur-xl">
          <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-white/80">
              <ShieldCheck className="size-3.5" /> PUBLISHED VALIDATION
            </span>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X className="size-3.5" />
            </button>
          </header>

          <div className="max-h-[70vh] space-y-3 overflow-y-auto px-3 py-3 text-white/70">
            {!report || !report.available ? (
              <p className="text-[11px] leading-relaxed text-white/50">
                Not generated yet. Aria&apos;s score validation runs offline — no
                human rating is needed or requested. Run{" "}
                <code className="text-white/70">python scripts/errorbars.py score</code>
                {" "}then <code className="text-white/70">analyze</code> to publish
                the numbers.
              </p>
            ) : (
              <>
                {rel && (
                  <section>
                    <p className="text-[10px] uppercase tracking-wider text-white/35">
                      Aria against itself
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-white/70">
                      Scored {rel.answers_with_repeated_runs} benchmark answers
                      repeatedly: the same answer moves by about{" "}
                      <span className="text-white/90">
                        ±{fmt(rel.mean_sd, 1)}
                      </span>{" "}
                      points (mean range {fmt(rel.mean_range, 1)}). We publish
                      that spread instead of pretending the score is exact.
                    </p>
                  </section>
                )}

                {(report.convergent?.length ?? 0) > 0 && (
                  <section>
                    <p className="text-[10px] uppercase tracking-wider text-white/35">
                      Does the score track reality?
                    </p>
                    <ul className="mt-1 space-y-1.5">
                      {report.convergent?.map((row, i) => (
                        <li key={i} className="flex items-start gap-2 text-[11px]">
                          <span className={`mt-0.5 shrink-0 ${verdictTone(row.verdict)}`}>
                            {row.verdict === "supported" ? (
                              <CheckCircle2 className="size-3.5" />
                            ) : row.verdict === "contradicted" ? (
                              <AlertTriangle className="size-3.5" />
                            ) : (
                              <MinusCircle className="size-3.5" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="text-white/80">{row.label}</span>
                            <span className="mt-0.5 block text-[10px] text-white/45">
                              {row.feature_label} vs {row.dimension} · rho{" "}
                              {fmt(row.rho)} ({row.verdict})
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {judge && (
                  <section>
                    <p className="text-[10px] uppercase tracking-wider text-white/35">
                      Independent judge
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-white/70">
                      A separate on-device model ({judge.model}) scored the same{" "}
                      {judge.answers} answers: weighted kappa{" "}
                      <span className="text-white/90">{fmt(judge.overall.kappa)}</span>{" "}
                      ({judge.overall.interpretation}), mean gap{" "}
                      {fmt(judge.overall.mae, 1)} points.
                    </p>
                  </section>
                )}

                {(report.caveats?.length ?? 0) > 0 && (
                  <section className="border-t border-white/10 pt-2">
                    <p className="text-[10px] uppercase tracking-wider text-white/35">
                      What this does not claim
                    </p>
                    <ul className="mt-1 space-y-1">
                      {report.caveats?.map((c, i) => (
                        <li key={i} className="text-[10px] leading-relaxed text-white/45">
                          {c}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {report.generated_at && (
                  <p className="text-[10px] text-white/30">
                    Generated {report.generated_at}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
