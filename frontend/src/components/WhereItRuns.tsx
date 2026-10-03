import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Cloud, Cpu, ShieldCheck, X } from "lucide-react"

type Engines = {
  llm_primary?: string
  llm_fallback?: string | null
  llm_last?: string | null
  stt?: string
  tts_local?: boolean
  vision_local?: boolean
}

type Row = {
  task: string
  where: "local" | "cloud" | "in-browser"
  engine: string
  note: string
}

/**
 * "Where this runs" — an honest account of the on-device/cloud split.
 *
 * This is deliberately not a marketing badge: it names the exact engine behind
 * each task and says why, including where we still depend on the cloud.
 */
export default function WhereItRuns() {
  const [open, setOpen] = useState(false)
  const [engines, setEngines] = useState<Engines | null>(null)

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
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { engines?: Engines }) => {
        if (!cancelled) setEngines(d.engines ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  const rows: Row[] = [
    {
      task: "Speech-to-text",
      where: "cloud",
      engine: engines?.stt ?? "groq:whisper-large-v3-turbo",
      note: "The most accurate option we have. The transcript gate exists precisely because any ASR can mishear an accent.",
    },
    {
      task: "Résumé text extraction",
      where: "local",
      engine: "PyMuPDF + Tesseract OCR",
      note: "The raw resume text never leaves your machine — only extracted fields do.",
    },
    {
      task: "Field extraction & scoring",
      where: "cloud",
      engine: engines?.llm_primary ?? "groq",
      note: engines?.llm_fallback
        ? `Offline fallback ready: ${engines.llm_fallback}`
        : "No local fallback running — start Ollama for offline mode.",
    },
    {
      task: "Text-to-speech",
      where: "local",
      engine: engines?.tts_local ? "Kokoro ONNX" : "browser / fallback",
      note: "Speech is synthesised on your CPU.",
    },
    {
      task: "Camera setup check",
      where: "in-browser",
      engine: "MediaPipe Face Landmarker",
      note: "No video frame leaves the browser.",
    },
    {
      task: "Parse audit & evidence checks",
      where: "local",
      engine: "deterministic (no model)",
      note: "Layout geometry and string matching — reproducible, not sampled.",
    },
  ]

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
            className="fixed right-3 sm:right-6 top-14 sm:top-16 z-50 flex flex-col w-[22rem] sm:w-[24rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/15 bg-ink-950/95 shadow-2xl shadow-black/60 backdrop-blur-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            style={{ maxHeight: "calc(100vh - 4.5rem)" }}
          >
            {/* ── Header ── */}
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-3 bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-mint-500/15 text-mint-400 border border-mint-500/20">
                  <ShieldCheck className="size-4" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold tracking-wider text-white uppercase">
                    Where This Runs
                  </h3>
                  <p className="text-[10px] text-white/40">On-device & cloud architecture</p>
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
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 space-y-3.5 text-xs text-white/70">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                <p className="text-[11px] leading-relaxed text-white/60">
                  We use local processing where it is just as good, and tell you exactly where cloud models are used.
                </p>
              </div>

              <div className="space-y-2">
                {rows.map((r) => (
                  <div
                    key={r.task}
                    className="flex gap-2.5 rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5 transition hover:bg-white/[0.04]"
                  >
                    <span className={`mt-0.5 shrink-0 ${whereTone(r.where)}`}>
                      {r.where === "cloud" ? (
                        <Cloud className="size-4" />
                      ) : (
                        <Cpu className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="text-xs font-medium text-white/90">
                          {r.task}
                        </span>
                        <span
                          className={`rounded-full border px-1.5 py-px text-[9px] uppercase tracking-wider ${wherePill(
                            r.where
                          )}`}
                        >
                          {r.where}
                        </span>
                      </div>
                      <span className="mt-1 block font-mono text-[10px] text-white/50">
                        {r.engine}
                      </span>
                      <p className="mt-1 text-[10px] leading-relaxed text-white/45">
                        {r.note}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
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
        title="Where this runs"
        aria-label="Where this runs"
        className={`flex size-8 items-center justify-center rounded-xl transition ${
          open
            ? "bg-mint-500/20 text-mint-300 border border-mint-500/30"
            : "text-white/40 hover:bg-white/10 hover:text-white/80"
        }`}
      >
        <Cpu className="size-4" />
      </button>
      {panel}
    </>
  )
}

function whereTone(where: Row["where"]) {
  return where === "cloud"
    ? "text-sky-300"
    : where === "in-browser"
      ? "text-iris-300"
      : "text-mint-400"
}

function wherePill(where: Row["where"]) {
  return where === "cloud"
    ? "border-sky-400/30 bg-sky-400/10 text-sky-200"
    : where === "in-browser"
      ? "border-iris-400/30 bg-iris-500/10 text-iris-200"
      : "border-mint-400/30 bg-mint-400/10 text-mint-200"
}
