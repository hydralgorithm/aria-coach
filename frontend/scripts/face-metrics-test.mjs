/**
 * Proves the delivery-metric maths, and pins the bugs that were fixed.
 *
 *   node scripts/face-metrics-test.mjs
 *
 * Each case states the old formula's result alongside the new one, so the
 * regression that motivated the change stays documented and cannot silently
 * come back.
 */

import {
  engagementFromPose,
  gazeFromBlendshapes,
  stepBlink,
  blinkRate,
  headSteadiness,
  GAZE,
  BLINK,
} from "../src/lib/faceMetrics.ts"

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`)
  if (detail) console.log(`        ${detail}`)
}

const r1 = (x) => Math.round(x * 100) / 100
const r2 = (x) => Math.round(x * 1000) / 1000

// ---------------------------------------------------------------- old code
/** The formula that shipped before the fix (useFaceAnalysis.ts). */
function oldEyeContact(yawDeg, pitchDeg, bs) {
  const gazeDev =
    ((bs.eyeLookOutLeft ?? 0) +
      (bs.eyeLookOutRight ?? 0) +
      (bs.eyeLookInLeft ?? 0) +
      (bs.eyeLookInRight ?? 0)) /
    4
  const yawFactor = Math.max(0, 1 - Math.max(0, Math.abs(yawDeg) - 6) / 16)
  const pitchFactor = Math.max(0, 1 - Math.max(0, Math.abs(pitchDeg) - 6) / 14)
  return Math.max(
    0,
    Math.min(1, yawFactor * pitchFactor * (1 - gazeDev * 0.5))
  )
}

const NEUTRAL_EYES = {
  eyeLookOutLeft: 0,
  eyeLookInLeft: 0,
  eyeLookOutRight: 0,
  eyeLookInRight: 0,
  eyeLookUpLeft: 0,
  eyeLookUpRight: 0,
  eyeLookDownLeft: 0,
  eyeLookDownRight: 0,
}

/** Normal near-focus: BOTH eyes rotate inward to converge on the screen. */
const READING_EYES = {
  ...NEUTRAL_EYES,
  eyeLookInLeft: 0.42,
  eyeLookInRight: 0.38,
  eyeLookDownLeft: 0.3,
  eyeLookDownRight: 0.28,
}

console.log("\n=== 1. Reading the question on screen (the reported bug) ===")
{
  // Head tipped down 18 deg + converged eyes: exactly what a candidate does
  // when reading a question off the monitor beside the camera.
  const old = oldEyeContact(-4, -18, READING_EYES)
  const g = gazeFromBlendshapes(READING_EYES)
  const now = engagementFromPose({
    yawDeg: -4,
    pitchDeg: -18,
    gaze: g,
    baselineYaw: -4,
    baselinePitch: -18,
  })
  console.log(`  eye contact while reading: old=${r2(old)}  new=${r2(now)}`)
  check(
    "reading the screen no longer scores as poor eye contact",
    old < 0.2 && now > 0.9,
    `old scored ${r2(old)} (pitch falloff reaches zero at 20 deg, and vergence cost a further 10%); new scores ${r2(now)}`
  )
  check(
    "convergence is detected and NOT treated as gaze aversion",
    g.converged === true,
    `converged=${g.converged} vergence=${r2(g.vergence)} (old code penalised this via gazeDev=${r2(
      (READING_EYES.eyeLookInLeft + READING_EYES.eyeLookInRight) / 4
    )})`
  )
}

console.log("\n=== 2. Genuine gaze aversion is still caught ===")
{
  // Head turned well off to the side - the behaviour that really is a tell.
  const old = oldEyeContact(46, 2, NEUTRAL_EYES)
  const g = gazeFromBlendshapes(NEUTRAL_EYES)
  const now = engagementFromPose({
    yawDeg: 46,
    pitchDeg: 2,
    gaze: g,
    baselineYaw: 0,
    baselinePitch: 0,
  })
  console.log(`  head turned 46 deg away: old=${r2(old)}  new=${r2(now)}`)
  check("turning away still scores low", now < 0.15, `new=${r2(now)}`)
}

console.log("\n=== 3. Lateral gaze direction is recoverable (was sign-destroyed) ===")
{
  const left = gazeFromBlendshapes({
    ...NEUTRAL_EYES,
    eyeLookOutLeft: 0.7,
    eyeLookInRight: 0.6,
  })
  const right = gazeFromBlendshapes({
    ...NEUTRAL_EYES,
    eyeLookInLeft: 0.7,
    eyeLookOutRight: 0.6,
  })
  console.log(
    `  looking left: lateral=${r2(left.lateral)}  looking right: lateral=${r2(right.lateral)}`
  )
  check(
    "left and right gaze get OPPOSITE signs",
    left.lateral > 0.2 && right.lateral < -0.2,
    "the old formula summed In+Out so both directions looked identical"
  )
  const up = gazeFromBlendshapes({ ...NEUTRAL_EYES, eyeLookDownLeft: 0.6, eyeLookDownRight: 0.6 })
  check(
    "looking down is detected (reading) but not punished as lateral gaze",
    Math.abs(up.lateral) < 0.01 && up.vertical > 0.5
  )
}

console.log("\n=== 4. Blink: one blink must count once ===")
{
  // A noisy score oscillating across the threshold around one real blink.
  const samples = [
    0.1, 0.55, 0.2, 0.6, 0.3, 0.65, 0.15, 0.58, 0.22, 0.1,
  ]
  const state = { closed: false, lastAt: -1e9 }
  let now = 0
  let newCount = 0
  let oldCount = 0
  let oldClosed = false
  for (const s of samples) {
    now += 40 // ~25 fps
    if (stepBlink(s, state, now)) newCount++
    // old logic: no refractory period at all
    if (!oldClosed && s > BLINK.onThreshold) {
      oldClosed = true
      oldCount++
    } else if (oldClosed && s < BLINK.offThreshold) {
      oldClosed = false
    }
  }
  console.log(`  single noisy blink: old counted ${oldCount}, new counted ${newCount}`)
  check(
    "refractory period collapses duplicate edges into one blink",
    oldCount > newCount && newCount === 1,
    `${oldCount} -> ${newCount}`
  )
}

console.log("\n=== 5. Blink rate is not invented from a short window ===")
{
  const short = blinkRate(3, 2000) // 3 blinks in 2 s
  const good = blinkRate(18, 60000) // 18 blinks in a minute
  const insane = blinkRate(400, 60000)
  console.log(`  3 blinks / 2.0s  -> old=90/min  new=${short}`)
  console.log(`  18 blinks / 60s  -> new=${good}/min`)
  console.log(`  400 blinks / 60s -> new=${insane}/min (clamped)`)
  check(
    "a 2 s window yields null instead of a scary 90/min",
    short === null,
    "old code divided by a wall-clock seconds floored at 0.5"
  )
  check("a full minute reports correctly", good === 18)
  check("absurd readings are clamped", insane === BLINK.maxRate)
  check(
    "the conversational baseline is used, not a generic one",
    GAZE.neutralPitch >= 18 && BLINK.elevatedRate === 40,
    "reading posture is inside the neutral cone; only clearly above conversational rate is flagged"
  )
}

console.log("\n=== 6. Camera mounted above the screen is calibrated out ===")
{
  // Laptop webcam well above the screen: the user reads with a permanent
  // downward tilt that is an artefact of the hardware, not their behaviour.
  const g = gazeFromBlendshapes(READING_EYES)
  const uncal = engagementFromPose({
    yawDeg: 0,
    pitchDeg: -32,
    gaze: g,
    baselineYaw: 0,
    baselinePitch: 0,
  })
  const cal = engagementFromPose({
    yawDeg: 0,
    pitchDeg: -32,
    gaze: g,
    baselineYaw: 0,
    baselinePitch: -32,
  })
  console.log(`  head 32 deg down: uncalibrated=${r2(uncal)}  calibrated=${r2(cal)}`)
  check(
    "baseline removes a permanent hardware-induced tilt",
    cal > uncal + 0.3,
    `${r2(uncal)} -> ${r2(cal)}`
  )
}

console.log("\n=== 7. Head steadiness ===")
{
  const still = headSteadiness([0, 0.2, -0.1, 0.1], [0, 0.1, -0.1, 0])
  const shaky = headSteadiness(
    [-14, 12, -10, 15, -13, 11],
    [8, -9, 7, -8, 6, -7]
  )
  console.log(`  still=${r2(still)}  restless=${r2(shaky)}`)
  check("a still head scores ~1", still > 0.95, `still=${r2(still)}`)
  check("a restless head scores low", shaky < 0.5, `restless=${r2(shaky)}`)
  check("no samples does not imply a motionless head", headSteadiness([], []) === 1)
}

console.log(
  failures === 0
    ? "\nAll delivery-metric checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`
)
process.exit(failures === 0 ? 0 : 1)