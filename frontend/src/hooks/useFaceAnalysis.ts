import { useCallback, useEffect, useRef, useState } from "react"
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision"

/**
 * Local facial-expression + head-pose analysis for interview delivery coaching.
 *
 * Everything runs on-device (MediaPipe WASM/GPU). No video frame ever leaves
 * the browser — only the numeric summary below is sent to the coach.
 */

export type FaceMetrics = {
  running: boolean
  faceCount: number
  /** 0..1 — looking roughly at the camera */
  eyeContact: number
  /** 0..1 — mouth-smile intensity */
  smile: number
  /** 0..1 — brow furrow / lip press (visible tension) */
  tension: number
  yawDeg: number
  pitchDeg: number
  blinksPerMin: number
  fps: number
  error: string | null
}

export type DeliverySummary = {
  frames: number
  seconds: number
  noFacePct: number
  multiFacePct: number
  eyeContactPct: number
  longestGazeAversionMs: number
  smilePct: number
  smileAvg: number
  tensionAvg: number
  tensionPct: number
  blinksPerMin: number
  headSteadiness: number
  notes: string[]
}

const DETECT_INTERVAL_MS = 66 // ~15 fps is plenty for delivery analysis
const BLINK_ON = 0.5
const BLINK_OFF = 0.25
const YAW_TOLERANCE = 14 // degrees before it counts as looking away
const PITCH_TOLERANCE = 12

const EMPTY_METRICS: FaceMetrics = {
  running: false,
  faceCount: 0,
  eyeContact: 0,
  smile: 0,
  tension: 0,
  yawDeg: 0,
  pitchDeg: 0,
  blinksPerMin: 0,
  fps: 0,
  error: null,
}

type Accum = {
  frames: number
  noFace: number
  multiFace: number
  eyeContactSum: number
  eyeContactGood: number
  smileSum: number
  smileFrames: number
  tensionSum: number
  tensionFrames: number
  yaws: number[]
  pitches: number[]
  gazeAwayRunMs: number
  longestAwayMs: number
  start: number
  blinks: number
}

function newAccum(): Accum {
  return {
    frames: 0,
    noFace: 0,
    multiFace: 0,
    eyeContactSum: 0,
    eyeContactGood: 0,
    smileSum: 0,
    smileFrames: 0,
    tensionSum: 0,
    tensionFrames: 0,
    yaws: [],
    pitches: [],
    gazeAwayRunMs: 0,
    longestAwayMs: 0,
    start: 0,
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
  const blinkStateRef = useRef(false)
  const blinkTimesRef = useRef<number[]>([])
  const accumRef = useRef<Accum>(newAccum())
  const enabledRef = useRef(false)

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

    const faces = result.faceLandmarks?.length ?? 0
    const acc = accumRef.current
    acc.frames++
    if (acc.start === 0) acc.start = now

    // fps
    const f = fpsRef.current
    f.frames++
    if (now - f.since > 1000) {
      f.fps = Math.round((f.frames * 1000) / (now - f.since))
      f.frames = 0
      f.since = now
    }

    if (faces === 0) {
      acc.noFace++
      setMetrics((m) => ({
        ...m,
        running: true,
        faceCount: 0,
        eyeContact: 0,
        smile: 0,
        tension: 0,
        fps: f.fps,
      }))
      return
    }
    if (faces > 1) acc.multiFace++

    // ---- blendshapes
    const cats = result.faceBlendshapes?.[0]?.categories ?? []
    const bs: Record<string, number> = {}
    for (const c of cats) bs[c.categoryName] = c.score

    const smile = ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2
    const browFurrow = ((bs.browDownLeft ?? 0) + (bs.browDownRight ?? 0)) / 2
    const lipPress =
      ((bs.mouthPressLeft ?? 0) + (bs.mouthPressRight ?? 0)) / 2
    const tension = Math.min(1, browFurrow * 0.6 + lipPress * 0.4)

    // ---- head pose from the facial transformation matrix (column-major)
    const m = result.facialTransformationMatrixes?.[0]?.data
    let yawDeg = 0
    let pitchDeg = 0
    if (m && m.length >= 16) {
      const at = (row: number, col: number) => m[col * 4 + row]
      pitchDeg =
        (Math.atan2(at(2, 1), at(2, 2)) * 180) / Math.PI
      yawDeg =
        (Math.atan2(-at(2, 0), Math.hypot(at(2, 1), at(2, 2))) * 180) / Math.PI
    }

    // eye deviation adds to "not looking at the camera"
    const gazeDev =
      ((bs.eyeLookOutLeft ?? 0) +
        (bs.eyeLookOutRight ?? 0) +
        (bs.eyeLookInLeft ?? 0) +
        (bs.eyeLookInRight ?? 0)) /
      4

    const yawFactor = Math.max(0, 1 - Math.max(0, Math.abs(yawDeg) - 6) / 16)
    const pitchFactor = Math.max(
      0,
      1 - Math.max(0, Math.abs(pitchDeg) - 6) / 14
    )
    const eyeContact = Math.max(
      0,
      Math.min(1, yawFactor * pitchFactor * (1 - gazeDev * 0.5))
    )

    const lookingAway =
      Math.abs(yawDeg) > YAW_TOLERANCE || Math.abs(pitchDeg) > PITCH_TOLERANCE

    // ---- accumulate for the current answer
    acc.eyeContactSum += eyeContact
    if (eyeContact > 0.6) acc.eyeContactGood++
    acc.smileSum += smile
    if (smile > 0.25) acc.smileFrames++
    acc.tensionSum += tension
    if (tension > 0.35) acc.tensionFrames++
    acc.yaws.push(yawDeg)
    acc.pitches.push(pitchDeg)

    if (lookingAway) {
      acc.gazeAwayRunMs += DETECT_INTERVAL_MS
      acc.longestAwayMs = Math.max(acc.longestAwayMs, acc.gazeAwayRunMs)
    } else {
      acc.gazeAwayRunMs = 0
    }

    // ---- blink detection with hysteresis
    const blinkScore =
      ((bs.eyeBlinkLeft ?? 0) + (bs.eyeBlinkRight ?? 0)) / 2
    if (!blinkStateRef.current && blinkScore > BLINK_ON) {
      blinkStateRef.current = true
      blinkTimesRef.current.push(now)
    } else if (blinkStateRef.current && blinkScore < BLINK_OFF) {
      blinkStateRef.current = false
    }
    const oneMinuteAgo = now - 60000
    blinkTimesRef.current = blinkTimesRef.current.filter(
      (t) => t > oneMinuteAgo
    )

    setMetrics({
      running: true,
      faceCount: faces,
      eyeContact,
      smile,
      tension,
      yawDeg,
      pitchDeg,
      blinksPerMin: blinkTimesRef.current.length,
      fps: f.fps,
      error: null,
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
      fpsRef.current = { frames: 0, since: performance.now(), fps: 0 }
      blinkTimesRef.current = []
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
    accumRef.current.start = performance.now()
    blinkTimesRef.current = []
  }, [])

  /** Aggregate the answer's delivery into a compact summary. */
  const endTurn = useCallback((): DeliverySummary | null => {
    const acc = accumRef.current
    if (!enabledRef.current || acc.frames === 0) return null
    const seconds = Math.max(
      0.5,
      (performance.now() - (acc.start || performance.now())) / 1000
    )
    const frames = acc.frames
    const noFacePct = Math.round((acc.noFace / frames) * 100)
    const multiFacePct = Math.round((acc.multiFace / frames) * 100)
    const seen = Math.max(1, frames - acc.noFace)
    const eyeContactPct = Math.round((acc.eyeContactGood / seen) * 100)
    const smilePct = Math.round((acc.smileFrames / seen) * 100)
    const tensionPct = Math.round((acc.tensionFrames / seen) * 100)

    const mean = (xs: number[]) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
    const std = (xs: number[]) => {
      if (xs.length < 2) return 0
      const mu = mean(xs)
      return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)))
    }
    const movement = (std(acc.yaws) + std(acc.pitches)) / 2
    const headSteadiness = Math.max(0, Math.min(1, 1 - movement / 12))

    const notes: string[] = []
    if (noFacePct > 15)
      notes.push(
        `face left the frame for ${noFacePct}% of the answer — keep the camera in view`
      )
    if (multiFacePct > 10)
      notes.push(
        `another person was visible (${multiFacePct}% of frames) — interview coaches flag this`
      )
    if (eyeContactPct < 55)
      notes.push(
        `eye contact was low (${eyeContactPct}%) — look into the lens as if it were the interviewer`
      )
    if (acc.longestAwayMs > 2500)
      notes.push(
        `you looked away for ${(acc.longestAwayMs / 1000).toFixed(1)}s at one point — often reads as uncertainty`
      )
    if (smilePct < 10)
      notes.push(
        "almost no warmth signals — a small smile when talking about people or wins builds rapport"
      )
    if (tensionPct > 30)
      notes.push(
        `visible tension in ${tensionPct}% of frames (brow furrow / lip press) — relax your jaw and brows`
      )
    if (blinkTimesRef.current.length > 0) {
      const bpm = Math.round((blinkTimesRef.current.length / seconds) * 60)
      if (bpm > 35)
        notes.push(
          `high blink rate (~${bpm}/min) — a classic nervousness tell, breathe and slow down`
        )
    }
    if (headSteadiness < 0.5)
      notes.push(
        "a lot of head movement — steadier posture reads as more confident"
      )

    return {
      frames,
      seconds: Math.round(seconds * 10) / 10,
      noFacePct,
      multiFacePct,
      eyeContactPct,
      longestGazeAversionMs: Math.round(acc.longestAwayMs),
      smilePct,
      smileAvg: Math.round((acc.smileSum / seen) * 100) / 100,
      tensionAvg: Math.round((acc.tensionSum / seen) * 100) / 100,
      tensionPct,
      blinksPerMin: Math.round(
        (blinkTimesRef.current.length / seconds) * 60
      ),
      headSteadiness: Math.round(headSteadiness * 100) / 100,
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
