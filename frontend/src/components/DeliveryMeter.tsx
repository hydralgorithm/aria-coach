import { Camera, CameraOff, Loader2, Eye, Smile, TriangleAlert } from "lucide-react"
import type { RefObject } from "react"

import { Button } from "@/components/ui/button"
import type { FaceMetrics } from "@/hooks/useFaceAnalysis"

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>
  metrics: FaceMetrics
  enabled: boolean
  loading: boolean
  onToggle: () => void
}

export default function DeliveryMeter({
  videoRef,
  metrics,
  enabled,
  loading,
  onToggle,
}: Props) {
  if (!enabled) {
    return (
      <div className="fixed bottom-4 left-4 z-40">
        <Button
          variant="outline"
          onClick={onToggle}
          disabled={loading}
          title="Analyse your facial expressions and delivery locally (nothing leaves your machine)"
        >
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Camera />
          )}
          {loading ? "Starting camera…" : "Delivery analysis (camera)"}
        </Button>
        {metrics.error && (
          <p className="mt-1 max-w-56 text-[10px] text-red-300">
            {metrics.error}
          </p>
        )}
      </div>
    )
  }

  return (
    <aside className="fixed bottom-4 left-4 z-40 w-64 overflow-hidden rounded-2xl border border-white/15 bg-ink-900/95 shadow-2xl backdrop-blur-xl">
      <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-white/80">
          <Camera className="size-3.5" /> DELIVERY ANALYSIS
        </span>
        <button
          onClick={onToggle}
          className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
          title="Stop camera"
          aria-label="Stop delivery analysis"
        >
          <CameraOff className="size-3.5" />
        </button>
      </header>

      <div className="relative aspect-4/3 w-full overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="size-full scale-x-[-1] object-cover"
          muted
          playsInline
        />
        {metrics.faceCount === 0 && enabled && (
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-amber-400/85 py-0.5 text-[10px] font-medium text-black">
            <TriangleAlert className="size-3" /> no face detected
          </span>
        )}
        {metrics.faceCount > 1 && (
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-red-500/90 py-0.5 text-[10px] font-medium text-white">
            <TriangleAlert className="size-3" /> {metrics.faceCount} faces in
            frame
          </span>
        )}
      </div>

      <div className="space-y-2 px-3 py-2.5">
        <Gauge
          icon={<Eye className="size-3" />}
          label="eye contact"
          value={metrics.eyeContact}
          good={0.6}
        />
        <Gauge
          icon={<Smile className="size-3" />}
          label="warmth"
          value={metrics.smile}
          good={0.25}
        />
        <Gauge
          icon={<TriangleAlert className="size-3" />}
          label="tension"
          value={metrics.tension}
          good={0.35}
          invert
        />
        <div className="flex justify-between pt-0.5 text-[10px] text-white/40">
          <span>
            yaw {metrics.yawDeg.toFixed(0)}° / pitch{" "}
            {metrics.pitchDeg.toFixed(0)}°
          </span>
          <span>
            {metrics.blinksPerMin}/min · {metrics.fps} fps
          </span>
        </div>
        <p className="text-[9px] leading-snug text-white/30">
          Runs entirely on your device — no video leaves your machine.
        </p>
      </div>
    </aside>
  )
}

function Gauge({
  icon,
  label,
  value,
  good,
  invert = false,
}: {
  icon: React.ReactNode
  label: string
  value: number
  good: number
  invert?: boolean
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  const healthy = invert ? value <= good : value >= good
  return (
    <div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="flex items-center gap-1 text-white/50">
          {icon}
          {label}
        </span>
        <span className={healthy ? "text-mint-400" : "text-amber-300"}>
          {pct}%
        </span>
      </div>
      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/10">
        <span
          className={`block h-full rounded-full transition-[width] duration-150 ${
            healthy ? "bg-mint-400" : "bg-amber-300"
          }`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </span>
    </div>
  )
}
