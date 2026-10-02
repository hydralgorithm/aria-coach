import { useCallback, useEffect, useRef, useState } from "react"
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision"

import {
  BLINK,
  blinkRate,
  engagementFromPose,
  gazeFromBlendshapes,
  headSteadiness,
  stepBlink,
  updateBaseline,
  type GazeInput,
} from "@/lib/faceMetrics"

/**
 * Local facial-expression + head-pose analysis for interview delivery coaching.
 *
 * Everything runs on-device (MediaPipe WASM/GPU). No video frame ever leaves
 * the browser — only the numeric summary below is sent to the coach.
 *
 * The metric maths lives in `@/lib/faceMetrics` so it can be unit tested —
 * run `node scripts/face-metrics-test.mjs`.
 */

export type FaceMetrics = {
  running: boolean
  faceCount: number
  /** 0..1 — engagement (head toward the interviewer, eyes on-task) */
  engagement: number
  /** 0..1 — mouth-smile intensity */
  smile: number
  /** 0..1 — brow furrow / lip press (visible tension) */
  tension: number
  yawDeg: number
  pitchDeg: number
  /** null until there is a long enough window to be meaningful */
  blinksPerMin: number | null
  /** true once the neutral-pose baseline has been learned */
  calibrated: boolean
  fps: number
  error: string | null
}

export type DeliverySummary = {
  frames: number
  seconds: number
  noFacePct: number
  multiFacePct: number
  /** % of observed time spent engaged */
  engagementPct: number
  meanEngagement: number
  longestGazeAversionMs: number
  smilePct: number
  smileAvg: number
  tensionAvg: number
  tensionPct: number
  blinksPerMin: number | null
  headSteadiness: number
  calibrated: boolean
  notes: string[]
}

const DETECT_INTERVAL_MS = 40 // ~25 fps; a blink only lasts 100-400 ms
const UI_FLUSH_MS = 200 // don't re-render the panel 25x a second
/** A gap larger than this means the tab was backgrounded, not that time passed. */
const MAX_GAP_MS = 250
/** A pose must be inside the baseline window to count as the neutral pose. */
const BASELINE_FRAMES = 24
const ENGAGED_THRESHOLD = 0.6
/** Consecutive off-axis frames before it counts as gaze aversion. */
const AVERSION_FRAMES = 6

const EMPTY_METRICS: FaceMetrics = {
  running: false,
  faceCount: 0,
  engagement: 0,
  smile: 0,
  tension: 0,
  yawDeg: 0,
  pitchDeg: 0,
  blinksPerMin: null,
  calibrated: false,
  fps: 0,
  error: null,
}

type Accum = {
  frames: number
  noFace: number
  multiFace: number
  /** Time actually spent observing frames (excludes hidden-tab gaps). */
  observedMs: number
  engagementSum: number
  engagedFrames: number
  smileSum: number
  smileFrames: number
  tensionSum: number
  tensionFrames: number
  yaws: number[]
  pitches: number[]
  aversionRunMs: number
  longestAwayMs: number
  blinks: number
}

function newAccum(): Accum {
  return {
    frames: 0,
    noFace: 0,
    multiFace: 0,
    observedMs: 0,
    engagementSum: 0,
    engagedFrames: 0,
    smileSum: 0,
    smileFrames: 0,
    tensionSum: 0,
    tensionFrames: 0,
    yaws: [],
    pitches: [],
    aversionRunMs: 0,
    longestAwayMs: 0,
    blinks: 0,
  }
}

export function useFaceAnalysis() {
  const [metrics, setMetrics] = useState<FaceMetrics>(EMPTY_METRICS)
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const rafRef = useRef<number>(0)
  const lastDetectRef = useRef(0)
  const fpsRef = useRef<{ frames: number; since: number; fps: number }>({
    frames: 0,
    since: 0,
    fps: 0,
  })
  const blinkStateRef = useRef({ closed: false, lastAt: -1e9 })
  const baselineRef = useRef({ yaw: 0, pitch: 0, n: 0 })
  const accumRef = useRef<Accum>(newAccum())
  const enabledRef = useRef(false)
  const lastSeenRef = useRef(0)
  const aversionRunRef = useRef(0)
  const lastFlushRef = useRef(0)
  /** Nose position of the face we are tracking, so a second face cannot steal it. */
  const trackedFaceRef = useRef<{ x: number; y: number } | null>(null)

  const stop = useCallback(() => {
    enabledRef.current = false
    setEnabled(false)
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setMetrics((m) => ({ ...m, running: false, faceCount: 0, fps: 0 }))
  }, [])

  const loop = useCallback(() => {
    if (!enabledRef.current) return
    const video = videoRef.current
    const landmarker = landmarkerRef.current
    rafRef.current = requestAnimationFrame(loop)
    if (!video || !landmarker || video.readyState < 2) return

    const now = performance.now()
    if (now - lastDetectRef.current < DETECT_INTERVAL_MS) return
    lastDetectRef.current = now

    let result
    try {
      result = landmarker.detectForVideo(video, now)
    } catch {
      return // transient WASM hiccup — skip this frame
    }

    const faceCount = result.faceLandmarks?.length ?? 0
    const acc = accumRef.current
    const gap = lastSeenRef.current ? now - lastSeenRef.current : 0
    lastSeenRef.current = now
    acc.frames++

    // Only count time we were genuinely observing. A backgrounded tab throttles
    // requestAnimationFrame to a stop, so wall-clock time would keep running
    // and inflate every time-based metric.
    if (gap > 0 && gap < MAX_GAP_MS) acc.observedMs += gap

    // fps
    const f = fpsRef.current
    f.frames++
    if (now - f.since > 1000) {
      f.fps = Math.round((f.frames * 1000) / (now - f.since))
      f.frames = 0
      f.since = now
    }

    // Flush to React at a human rate instead of every detected frame.
    const dueForFlush = now - lastFlushRef.current > UI_FLUSH_MS
    const flush = (next: Partial<FaceMetrics>) => {
      if (dueForFlush) {
        lastFlushRef.current = now
        setMetrics((m) => ({ ...m, running: true, faceCount, fps: f.fps, ...next }))
      }
    }

    if (faceCount === 0) {
      acc.noFace++
      aversionRunRef.current = 0
      trackedFaceRef.current = null
      flush({ engagement: 0, smile: 0, tension: 0 })
      return
    }
    if (faceCount > 1) acc.multiFace++

    // ---- keep tracking one face so a second person cannot hijack the metrics
    const landmarks = result.faceLandmarks ?? []
    let idx = 0
    const prev = trackedFaceRef.current
    if (prev && faceCount > 1) {
      let best = Infinity
      for (let i = 0; i < faceCount; i++) {
        // landmark 1 is the nose tip
        const p = landmarks[i]?.[1]
        if (!p) continue
        const d = (p.x - prev.x) ** 2 + (p.y - prev.y) ** 2
        if (d < best) {
          best = d
          idx = i
        }
      }
    }
    const nose = landmarks[idx]?.[1]
    if (nose) trackedFaceRef.current = { x: nose.x, y: nose.y }

    // ---- blendshapes
    const cats = result.faceBlendshapes?.[idx]?.categories ?? []
    const bs: Record<string, number> = {}
    for (const c of cats) bs[c.categoryName] = c.score

    const smile = ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2
    const browFurrow = ((bs.browDownLeft ?? 0) + (bs.browDownRight ?? 0)) / 2
    const lipPress =
      ((bs.mouthPressLeft ?? 0) + (bs.mouthPressRight ?? 0)) / 2
    const tension = Math.min(1, browFurrow * 0.6 + lipPress * 0.4)

    // ---- head pose from the facial transformation matrix (column-major)
    const m = result.facialTransformationMatrixes?.[idx]?.data
    let yawDeg = 0
    let pitchDeg = 0
    if (m && m.length >= 16) {
      const at = (row: number, col: number) => m[col * 4 + row]
      pitchDeg = (Math.atan2(at(2, 1), at(2, 2)) * 180) / Math.PI
      yawDeg =
        (Math.atan2(-at(2, 0), Math.hypot(at(2, 1), at(2, 2))) * 180) / Math.PI
    }

    // ---- learn the user's neutral pose before judging them against it.
    // A laptop webcam sits above the screen, so "looking at the interviewer"
    // is not a zero pitch, and an uncalibrated zero punishes everyone.
    if (baselineRef.current.n < BASELINE_FRAMES) {
      baselineRef.current = updateBaseline(baselineRef.current, yawDeg, pitchDeg)
    }

    // ---- gaze + engagement
    const gazeInput: GazeInput = {
      eyeLookOutLeft: bs.eyeLookOutLeft ?? 0,
      eyeLookInLeft: bs.eyeLookInLeft ?? 0,
      eyeLookOutRight: bs.eyeLookOutRight ?? 0,
      eyeLookInRight: bs.eyeLookInRight ?? 0,
      eyeLookUpLeft: bs.eyeLookUpLeft ?? 0,
      eyeLookUpRight: bs.eyeLookUpRight ?? 0,
      eyeLookDownLeft: bs.eyeLookDownLeft ?? 0,
      eyeLookDownRight: bs.eyeLookDownRight ?? 0,
    }
    const gaze = gazeFromBlendshapes(gazeInput)
    const engagement = engagementFromPose({
      yawDeg,
      pitchDeg,
      gaze,
      baselineYaw: baselineRef.current.yaw,
      baselinePitch: baselineRef.current.pitch,
    })

    // ---- accumulate for the current answer
    acc.engagementSum += engagement
    if (engagement > ENGAGED_THRESHOLD) acc.engagedFrames++
    acc.smileSum += smile
    if (smile > 0.25) acc.smileFrames++
    acc.tensionSum += tension
    if (tension > 0.35) acc.tensionFrames++
    acc.yaws.push(yawDeg)
    acc.pitches.push(pitchDeg)

    // Gaze aversion only counts once it persists, so a natural glance at notes
    // for one or two frames is not flagged.
    if (engagement < 0.35) {
      aversionRunRef.current += 1
      acc.aversionRunMs += gap > 0 && gap < MAX_GAP_MS ? gap : 0
      if (aversionRunRef.current >= AVERSION_FRAMES) {
        acc.longestAwayMs = Math.max(acc.longestAwayMs, acc.aversionRunMs)
      }
    } else {
      aversionRunRef.current = 0
      acc.aversionRunMs = 0
    }

    // ---- blink detection (hysteresis + refractory period)
    const blinkScore = ((bs.eyeBlinkLeft ?? 0) + (bs.eyeBlinkRight ?? 0)) / 2
    if (stepBlink(blinkScore, blinkStateRef.current, now)) acc.blinks++

    flush({
      engagement,
      smile,
      tension,
      yawDeg,
      pitchDeg,
      blinksPerMin: blinkRate(acc.blinks, acc.observedMs),
      calibrated: baselineRef.current.n >= BASELINE_FRAMES,
    })
  }, [])

  const start = useCallback(async () => {
    if (enabledRef.current) return
    setLoading(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }

      if (!landmarkerRef.current) {
        const fileset = await FilesetResolver.forVisionTasks("/wasm")
        landmarkerRef.current = await FaceLandmarker.createFromOptions(
          fileset,
          {
            baseOptions: {
              modelAssetPath: "/models/face_landmarker.task",
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            numFaces: 2, // 2nd face flags "someone else is in frame"
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
          }
        )
      }

      accumRef.current = newAccum()
      lastDetectRef.current = 0
      lastSeenRef.current = 0
      lastFlushRef.current = 0
      aversionRunRef.current = 0
      baselineRef.current = { yaw: 0, pitch: 0, n: 0 }
      blinkStateRef.current = { closed: false, lastAt: -1e9 }
      trackedFaceRef.current = null
      fpsRef.current = { frames: 0, since: performance.now(), fps: 0 }
      enabledRef.current = true
      setEnabled(true)
      setMetrics((m) => ({ ...m, running: true, error: null }))
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      const name = err instanceof Error ? err.message : String(err)
      setMetrics((m) => ({
        ...m,
        running: false,
        error: name.includes("NotAllowed")
          ? "camera permission denied"
          : "camera unavailable",
      }))
    } finally {
      setLoading(false)
    }
  }, [loop])

  /** Reset the per-answer accumulators (call when an answer starts). */
  const beginTurn = useCallback(() => {
    accumRef.current = newAccum()
    lastSeenRef.current = performance.now()
    aversionRunRef.current = 0
    blinkStateRef.current = { closed: false, lastAt: -1e9 }
    // keep the learned neutral pose; it describes the room, not the answer
  }, [])

  /** Aggregate the answer's delivery into a compact summary. */
  const endTurn = useCallback((): DeliverySummary | null => {
    const acc = accumRef.current
    if (!enabledRef.current || acc.frames === 0) return null

    // Time actually observed, not wall clock — a hidden tab must not dilute.
    const seconds = Math.max(0.5, acc.observedMs / 1000)
    const frames = acc.frames
    const noFacePct = Math.round((acc.noFace / frames) * 100)
    const multiFacePct = Math.round((acc.multiFace / frames) * 100)
    const seen = Math.max(1, frames - acc.noFace)
    const engagementPct = Math.round((acc.engagedFrames / seen) * 100)
    const smilePct = Math.round((acc.smileFrames / seen) * 100)
    const tensionPct = Math.round((acc.tensionFrames / seen) * 100)

    const steady = headSteadiness(
      acc.yaws,
      acc.pitches,
      baselineRef.current.yaw,
      baselineRef.current.pitch
    )
    const rate = blinkRate(acc.blinks, acc.observedMs)
    const calibrated = baselineRef.current.n >= BASELINE_FRAMES

    const notes: string[] = []
    if (noFacePct > 15)
      notes.push(
        `you moved out of frame for ${noFacePct}% of the answer — stay visible to the camera`
      )
    if (multiFacePct > 10)
      notes.push(
        `another person was visible (${multiFacePct}% of frames) — interview coaches flag this`
      )
    if (engagementPct < 55)
      notes.push(
        `you spent only ${engagementPct}% of the answer oriented toward the interviewer — face the screen/camera rather than looking off to the side`
      )
    if (acc.longestAwayMs > 2500)
      notes.push(
        `you looked away for ${(acc.longestAwayMs / 1000).toFixed(1)}s in one stretch — brief glances at notes are fine, long drifts read as uncertainty`
      )
    if (smilePct < 10)
      notes.push(
        "few warmth signals — a small smile when talking about people or wins builds rapport"
      )
    if (tensionPct > 30)
      notes.push(
        `visible tension in ${tensionPct}% of frames (brow furrow / lip press) — relax your jaw and brows`
      )
    if (rate != null && rate > BLINK.elevatedRate)
      notes.push(
        `high blink rate (~${rate}/min vs ~26/min in normal conversation) — often a calm-down signal, try slowing your breathing`
      )
    if (steady < 0.5)
      notes.push(
        "a lot of head movement — steadier posture reads as more confident"
      )

    return {
      frames,
      seconds: Math.round(seconds * 10) / 10,
      noFacePct,
      multiFacePct,
      engagementPct,
      meanEngagement: Math.round((acc.engagementSum / seen) * 100) / 100,
      longestGazeAversionMs: Math.round(acc.longestAwayMs),
      smilePct,
      smileAvg: Math.round((acc.smileSum / seen) * 100) / 100,
      tensionAvg: Math.round((acc.tensionSum / seen) * 100) / 100,
      tensionPct,
      blinksPerMin: rate,
      headSteadiness: Math.round(steady * 100) / 100,
      calibrated,
      notes,
    }
  }, [])

  // The <video> element only exists once the panel is rendered, so bind the
  // stream to it as soon as it mounts (otherwise no frames are ever pulled).
  useEffect(() => {
    const video = videoRef.current
    const stream = streamRef.current
    if (!enabled || !video || !stream) return
    if (video.srcObject !== stream) {
      video.srcObject = stream
    }
    if (video.readyState < 2) {
      void video.play().catch(() => {})
    }
  }, [enabled])

  useEffect(() => () => stop(), [stop])

  return {
    videoRef,
    metrics,
    enabled,
    loading,
    start,
    stop,
    beginTurn,
    endTurn,
  }
}