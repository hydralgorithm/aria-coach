import { useEffect, useState } from "react"
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

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Where this runs"
        aria-label="Where this runs"
        className={`flex size-8 items-center justify-center rounded-xl transition hover:bg-white/10 ${
          open ? "text-mint-400" : "text-white/40 hover:text-white/70"
        }`}
      >
        <Cpu className="size-4" />
      </button>

      {open && (
        <div className="fixed right-4 top-16 z-50 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/15 bg-ink-900/95 shadow-2xl backdrop-blur-xl">
          <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-white/80">
              <ShieldCheck className="size-3.5" /> WHERE THIS RUNS
            </span>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X className="size-3.5" />
            </button>
          </header>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto px-3 py-3">
            <p className="text-[11px] leading-relaxed text-white/60">
              We use local where local is just as good, and we tell you exactly
              where it isn't.
            </p>
            <ul className="space-y-2.5">
              {rows.map((r) => (
                <li key={r.task} className="flex gap-2.5">
                  <span className={`mt-0.5 shrink-0 ${whereTone(r.where)}`}>
                    {r.where === "cloud" ? (
                      <Cloud className="size-3.5" />
                    ) : (
                      <Cpu className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium text-white/85">
                        {r.task}
                      </span>
                      <span
                        className={`rounded-full border px-1.5 py-px text-[9px] uppercase tracking-wider ${wherePill(
                          r.where
                        )}`}
                      >
                        {r.where}
                      </span>
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-white/45">
                      {r.engine}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-white/45">
                      {r.note}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
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
