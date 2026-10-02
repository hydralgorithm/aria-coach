/**
 * Pure delivery-metric maths, kept out of the React hook so it can be unit
 * tested (see `scripts/face-metrics-test.mjs`).
 *
 * Everything here is deliberately pure: given the same blendshapes and head
 * pose it always returns the same numbers.
 */

/** Tuning constants. Values are documented with the reasoning. */
export const GAZE = {
  /**
   * Head rotation that still reads as "engaged". A laptop webcam typically sits
   * 15-20 deg ABOVE the screen you read from, and people glance down to read a
   * question and back up to answer. Both are normal and must not be punished.
   */
  neutralYaw: 22,
  neutralPitch: 20,

  /** Rotation past `neutral*` at which engagement reaches zero. */
  aversionYaw: 50,
  aversionPitch: 45,

  /**
   * Cost of off-axis eye movement. Vertical is heavily discounted on purpose:
   * looking down at the screen to read the question is exactly what the user
   * is supposed to be doing, so it must not register as a fault.
   */
  lateralEyeWeight: 0.35,
  verticalEyeWeight: 0.12,
}

export const BLINK = {
  /** Hysteresis on the mean eyeBlink blendshape. */
  onThreshold: 0.5,
  offThreshold: 0.25,
  /**
   * One human blink cannot complete in under ~250 ms. Without this a noisy
   * blendshape score hovering around the threshold produces several rising
   * edges for a single blink and inflates the count.
   */
  refractoryMs: 250,
  /**
   * A rate is meaningless from a very short window - 3 blinks in 2 s reads as
   * "90/min". Below this we report null instead of a wild number.
   */
  minWindowMs: 15000,
  /** Above this the reading is a detection artefact, not physiology. */
  maxRate: 90,
  /**
   * Reference rates from the literature (blink rate is strongly task
   * dependent): ~17/min at rest, ~26/min in conversation, ~4.5/min while
   * reading. Only meaningfully above the conversational range is a tell.
   */
  elevatedRate: 40,
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** A flat region followed by a linear falloff - no cliff edge to zero. */
function plateau(value: number, neutral: number, aversion: number): number {
  const over = Math.max(0, Math.abs(value) - neutral)
  const span = Math.max(1e-6, aversion - neutral)
  return clamp01(1 - over / span)
}

export type GazeInput = {
  /** Per-eye and vertical blendshapes, already looked up by name. */
  eyeLookOutLeft: number
  eyeLookInLeft: number
  eyeLookOutRight: number
  eyeLookInRight: number
  eyeLookUpLeft: number
  eyeLookUpRight: number
  eyeLookDownLeft: number
  eyeLookDownRight: number
}

export type GazeResult = {
  /** Signed horizontal gaze, -1 (person's right) .. +1 (person's left). */
  lateral: number
  /** 0..1 vertical gaze magnitude. */
  vertical: number
  /** Signed vergence; positive means the eyes converged (near focus). */
  vergence: number
  /** True when the eyes are converging - normal when reading a near screen. */
  converged: boolean
}

/**
 * Turn raw eye-look blendshapes into a gaze estimate.
 *
 * The previous implementation averaged the four horizontal values:
 *   (eyeLookOutLeft + eyeLookOutRight + eyeLookInLeft + eyeLookInRight) / 4
 * which is wrong twice over:
 *
 *  1. `In` and `Out` are OPPOSING directions for a given eye, so summing them
 *     destroys the sign - it cannot tell left gaze from right gaze.
 *  2. Focusing on something nearby makes BOTH eyes rotate inward. That
 *     vergence is normal, desirable near-focus behaviour, but this formula
 *     scored it as "looking away". Reading the question on a 50 cm screen
 *     therefore scored as gaze aversion.
 *
 * Here the two eyes are decomposed instead: their DIFFERENCE gives real
 * lateral gaze, while the part they agree on is vergence - which is reported
 * separately and never penalised.
 */
export function gazeFromBlendshapes(b: GazeInput): GazeResult {
  // + = that eye rotated outward (temporal).
  const hL = b.eyeLookOutLeft - b.eyeLookInLeft
  const hR = b.eyeLookOutRight - b.eyeLookInRight

  // Decompose the two eyes into a differential and a common mode:
  //
  //   looking to the person's LEFT  -> hL > 0, hR < 0  => DIFFERENTIAL
  //   converging on a near object  -> hL < 0, hR < 0  => COMMON MODE
  //   looking straight ahead        -> both ~0
  //
  // So lateral gaze is the difference between the eyes, while vergence is the
  // part they agree on. Converging is normal near-focus behaviour and is
  // reported separately so it is never charged as a fault.
  const lateral = (hL - hR) / 2
  const vergence = (hL + hR) / 2

  const up = (b.eyeLookUpLeft + b.eyeLookUpRight) / 2
  const down = (b.eyeLookDownLeft + b.eyeLookDownRight) / 2
  // Up and Down are also opposing; take the dominant direction, not the sum.
  const vertical = Math.max(up, down)

  return {
    lateral: clampSigned(lateral),
    vertical: clamp01(vertical),
    vergence: clampSigned(vergence),
    converged: vergence < -0.05,
  }
}

function clampSigned(x: number) {
  return x < -1 ? -1 : x > 1 ? 1 : x
}

export type EngagementInput = {
  yawDeg: number
  pitchDeg: number
  gaze: GazeResult
  /** Calibrated neutral pose; falls back to 0 when not yet calibrated. */
  baselineYaw: number
  baselinePitch: number
}

/**
 * Engagement for a video interview.
 *
 * This is deliberately NOT "how close are you to staring into the lens".
 * In a real video interview you are expected to look at the interviewer and
 * the questions on your screen; the camera is normally near the screen. What
 * actually reads as disengagement is turning your head away, or dropping your
 * gaze off to the side for a long time.
 *
 * Head pose is measured RELATIVE to a calibrated baseline because the camera
 * is rarely at eye level, and an uncalibrated absolute zero makes a normal
 * posture look like a fault.
 */
export function engagementFromPose(input: EngagementInput): number {
  const head = headFacing(
    input.yawDeg,
    input.pitchDeg,
    input.baselineYaw,
    input.baselinePitch
  )

  // Lateral gaze is a real signal (looking at something beside the camera).
  // Vertical is discounted because reading the question looks like this.
  const eyePenalty =
    GAZE.lateralEyeWeight * Math.abs(input.gaze.lateral) +
    GAZE.verticalEyeWeight * input.gaze.vertical

  return clamp01(head * (1 - eyePenalty))
}

/**
 * Head orientation toward the camera, from head pose alone.
 *
 * This is a framing / visibility check — "is your head pointed at the camera" —
 * not eye contact and not an emotion. It is the only facial signal the camera
 * setup rehearsal uses; the affect metrics below are retained as pure maths but
 * are deliberately not surfaced (see DELIVERY-METRICS.md).
 */
export function headFacing(
  yawDeg: number,
  pitchDeg: number,
  baselineYaw = 0,
  baselinePitch = 0
): number {
  return clamp01(
    plateau(yawDeg - baselineYaw, GAZE.neutralYaw, GAZE.aversionYaw) *
      plateau(pitchDeg - baselinePitch, GAZE.neutralPitch, GAZE.aversionPitch)
  )
}

/**
 * Blink event detector: hysteretic edge detection plus a refractory period.
 *
 * Returns true exactly once per blink, on the closing edge.
 */
export function stepBlink(
  score: number,
  state: { closed: boolean; lastAt: number },
  nowMs: number
): boolean {
  if (!state.closed && score > BLINK.onThreshold) {
    if (nowMs - state.lastAt < BLINK.refractoryMs) return false
    state.closed = true
    state.lastAt = nowMs
    return true
  }
  if (state.closed && score < BLINK.offThreshold) {
    state.closed = false
  }
  return false
}

/**
 * Blinks per minute over an observed window, or null when the window is too
 * short to be meaningful. Never returns an absurd number from a short sample.
 */
export function blinkRate(
  blinks: number,
  observedMs: number
): number | null {
  if (observedMs < BLINK.minWindowMs) return null
  const perMin = (blinks / observedMs) * 60000
  return Math.round(Math.min(BLINK.maxRate, perMin))
}

/** Head steadiness, calibrated so a still head is 1 and restless is 0. */
export function headSteadiness(
  yaws: number[],
  pitches: number[],
  baselineYaw = 0,
  baselinePitch = 0
): number {
  if (yaws.length < 2 || pitches.length < 2) return 1
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const std = (xs: number[]) => {
    const mu = mean(xs)
    return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)))
  }
  const movement =
    (std(yaws.map((y) => y - baselineYaw)) +
      std(pitches.map((p) => p - baselinePitch))) /
    2
  return clamp01(1 - movement / 15)
}

/**
 * Rolling pose baseline, so a camera mounted above the screen stops reading as
 * a permanent head-down posture. Ignores wild outliers.
 */
export function updateBaseline(
  current: { yaw: number; pitch: number; n: number },
  yawDeg: number,
  pitchDeg: number
): { yaw: number; pitch: number; n: number } {
  // Anything past 35 deg is not the user's neutral pose - do not fold it in.
  if (Math.abs(yawDeg) > 35 || Math.abs(pitchDeg) > 35) return current
  const n = Math.min(current.n + 1, 300)
  return {
    yaw: current.yaw + (yawDeg - current.yaw) / n,
    pitch: current.pitch + (pitchDeg - current.pitch) / n,
    n,
  }
}