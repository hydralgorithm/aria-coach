import { useCallback, useEffect, useRef, useState } from "react"
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision"

import { headFacing, updateBaseline } from "@/lib/faceMetrics"

/**
 * On-device camera setup rehearsal.
 *
 * A 3D face tracker runs at ~25 fps entirely in the browser. It is used ONLY
 * to check logistics: are you in frame, is your head pointed at the camera,
 * is anyone else in frame, is the tracker calibrated. Video never leaves the
 * machine and no emotion is ever read from the face (EU AI Act Art. 5(1)(f)).
 *
 * The affect maths (gaze, blink, smile, tension) still lives in
 * `@/lib/faceMetrics` where it is unit tested, but it is deliberately not
 * surfaced here — run `node scripts/face-metrics-test.mjs`.
 */

export type FaceMetrics = {
  running: boolean
  faceCount: number
  /** 0..1 — head oriented toward the camera (framing check, not an emotion) */
  facing: number
  yawDeg: number
  pitchDeg: number
  /** true once the neutral-pose baseline has been learned */
  calibrated: boolean
  fps: number
  error: string | null
}

export type SetupSummary = {
  frames: number
  seconds: number
  noFacePct: number
  multiFacePct: number
  faceVisiblePct: number
  /** % of observed frames with the head oriented toward the camera */
  facingPct: number
  calibrated: boolean
  notes: string[]
}

const DETECT_INTERVAL_MS = 40 // ~25 fps
const UI_FLUSH_MS = 200 // don't re-render the panel 25x a second
/** A gap larger than this means the tab was backgrounded, not that time passed. */
const MAX_GAP_MS = 250
/** A pose must be inside the baseline window to count as the neutral pose. */
const BASELINE_FRAMES = 24
/** Head inside the neutral cone counts as facing the camera. */
const FACING_THRESHOLD = 0.6

const EMPTY_METRICS: FaceMetrics = {
  running: false,
  faceCount: 0,
  facing: 0,
  yawDeg: 0,
  pitchDeg: 0,
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
  facingSum: number
  facingFrames: number
  yaws: number[]
  pitches: number[]
}

function newAccum(): Accum {
  return {
    frames: 0,
    noFace: 0,
    multiFace: 0,
    observedMs: 0,
    facingSum: 0,
    facingFrames: 0,
    yaws: [],
    pitches: [],
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
  const baselineRef = useRef({ yaw: 0, pitch: 0, n: 0 })
  const accumRef = useRef<Accum>(newAccum())
  const enabledRef = useRef(false)
  const lastSeenRef = useRef(0)
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
      trackedFaceRef.current = null
      flush({ facing: 0 })
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

    // ---- framing only: is the head oriented toward the camera?
    const facing = headFacing(
      yawDeg,
      pitchDeg,
      baselineRef.current.yaw,
      baselineRef.current.pitch
    )

    acc.facingSum += facing
    if (facing > FACING_THRESHOLD) acc.facingFrames++
    acc.yaws.push(yawDeg)
    acc.pitches.push(pitchDeg)

    flush({
      facing,
      yawDeg,
      pitchDeg,
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
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: true,
          }
        )
      }

      accumRef.current = newAccum()
      lastDetectRef.current = 0
      lastSeenRef.current = 0
      lastFlushRef.current = 0
      baselineRef.current = { yaw: 0, pitch: 0, n: 0 }
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
    // keep the learned neutral pose; it describes the room, not the answer
  }, [])

  /** Aggregate the answer's camera setup into a compact summary. */
  const endTurn = useCallback((): SetupSummary | null => {
    const acc = accumRef.current
    if (!enabledRef.current || acc.frames === 0) return null

    // Time actually observed, not wall clock — a hidden tab must not dilute.
    const seconds = Math.max(0.5, acc.observedMs / 1000)
    const frames = acc.frames
    const noFacePct = Math.round((acc.noFace / frames) * 100)
    const multiFacePct = Math.round((acc.multiFace / frames) * 100)
    const seen = Math.max(1, frames - acc.noFace)
    const facingPct = Math.round((acc.facingFrames / seen) * 100)
    const calibrated = baselineRef.current.n >= BASELINE_FRAMES

    const notes: string[] = []
    if (noFacePct > 15)
      notes.push(
        `you moved out of frame for ${noFacePct}% of the answer — sit far enough back that your head and shoulders stay visible`
      )
    if (multiFacePct > 10)
      notes.push(
        `another person was visible for ${multiFacePct}% of the frames — in a real interview make sure you are alone and the shot is yours`
      )
    if (facingPct < 55)
      notes.push(
        `your head was turned away from the camera for much of the answer — put the screen and lens in front of you and glance, don't turn`
      )

    return {
      frames,
      seconds: Math.round(seconds * 10) / 10,
      noFacePct,
      multiFacePct,
      faceVisiblePct: 100 - noFacePct,
      facingPct,
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
