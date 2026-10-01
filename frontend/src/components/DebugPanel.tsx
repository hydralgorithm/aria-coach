import { Bug, X } from "lucide-react"

import type { ChatStage, VoiceDebug } from "@/hooks/useVoice"

type Props = {
  debug: VoiceDebug
  stage: ChatStage
  error: string | null
  onClose: () => void
}

export default function DebugPanel({ debug, stage, error, onClose }: Props) {
  // levels are waveform RMS (0..~0.4 for loud speech)
  const levelPct = Math.min(100, Math.round(debug.level * 400))
  const thresholdPct = Math.min(100, Math.round(debug.threshold * 400))

  return (
    <aside className="fixed right-4 bottom-4 z-50 w-80 overflow-hidden rounded-2xl border border-white/15 bg-ink-900/95 text-[11px] shadow-2xl backdrop-blur-xl">
      <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="flex items-center gap-1.5 font-semibold tracking-wide text-white/80">
          <Bug className="size-3.5" /> MIC DIAGNOSTICS
        </span>
        <button
          onClick={onClose}
          className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
          aria-label="Close debug panel"
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div className="space-y-2 px-3 py-3 font-mono">
        <Row label="stage" value={stage} />
        <Row label="session" value={String(debug.session)} />
        <Row label="recorder" value={debug.recorderState} />
        <Row
          label="permission"
          value={debug.permission}
          accent={
            debug.permission === "granted"
              ? "text-mint-400"
              : debug.permission === "denied"
                ? "text-red-400"
                : undefined
          }
        />
        <Row
          label="analyser"
          value={debug.analyserFlat ? "FLAT — fixed window" : "live"}
          accent={debug.analyserFlat ? "text-amber-300" : "text-mint-400"}
        />
        <Row
          label="spoken"
          value={debug.spoken ? "yes" : "no"}
          accent={debug.spoken ? "text-mint-400" : "text-white/50"}
        />
        <Row
          label="silence"
          value={
            debug.sinceSpeechMs === null ? "—" : `${debug.sinceSpeechMs}ms`
          }
        />

        {/* live level vs threshold meter */}
        <div className="space-y-1 pt-1">
          <div className="flex justify-between text-white/45">
            <span>level {debug.level.toFixed(3)}</span>
            <span>threshold {debug.threshold.toFixed(3)}</span>
          </div>
          <div className="relative h-2.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-iris-500 to-mint-400 transition-[width] duration-75"
              style={{ width: `${levelPct}%` }}
            />
            {/* threshold marker */}
            <div
              className="absolute top-0 h-full w-0.5 bg-red-400"
              style={{ left: `${thresholdPct}%` }}
              title="speech threshold"
            />
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-red-300">
            {error}
          </p>
        )}

        <div className="pt-1">
          <p className="mb-1 text-white/45">event log</p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto overscroll-contain pr-1">
            {[...debug.events].reverse().map((e, i) => (
              <li key={`${e.at}-${i}`} className="text-white/70">
                <span className="text-white/35">
                  {new Date(e.at).toLocaleTimeString([], {
                    hour12: false,
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>{" "}
                {e.msg}
              </li>
            ))}
            {debug.events.length === 0 && (
              <li className="text-white/35">(nothing yet — tap the mic)</li>
            )}
          </ul>
        </div>
      </div>
    </aside>
  )
}

function Row({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/45">{label}</span>
      <span className={accent ?? "text-white/85"}>{value}</span>
    </div>
  )
}
