// WCAG 2.x contrast audit for Aria's application-defined color pairings.
//
// Deterministic regression check: converts the OKLCH theme tokens to sRGB,
// computes WCAG relative luminance and contrast ratios for every text/background
// pairing actually used in src/, and fails (exit 1) on AA violations.
//
//   node scripts/contrast-audit.mjs
//
// Thresholds: 4.5:1 normal text, 3:1 large text (>=24px, or >=18.66px bold),
// 3:1 UI components/borders. Decorative-only elements are annotated and skipped.

import { readFileSync } from "node:fs"

// ---- OKLCH -> sRGB ---------------------------------------------------------

function oklchToLinearSrgb(L, C, h) {
  const hr = (h * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function gamma(c) {
  if (c <= 0.0031308) return 12.92 * c
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function oklchToRgb(L, C, h) {
  return oklchToLinearSrgb(L, C, h).map((c) =>
    Math.min(255, Math.max(0, Math.round(gamma(Math.max(0, c)) * 255)))
  )
}

function relLuminance([r, g, b]) {
  const lin = [r, g, b].map((v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

// Blend an rgba overlay (white or a color at alpha) over a base color.
function blend(fg, alpha, bg) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)))
}

function ratio(l1, l2) {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

// ---- theme tokens (must match src/index.css @theme) ------------------------

const T = {
  ink950: oklchToRgb(0.12, 0.025, 265),
  ink900: oklchToRgb(0.16, 0.03, 265),
  iris600: oklchToRgb(0.54, 0.22, 290),
  iris500: oklchToRgb(0.62, 0.21, 292),
  iris400: oklchToRgb(0.72, 0.16, 295),
  iris300: oklchToRgb(0.82, 0.1, 300),
  mint400: oklchToRgb(0.85, 0.13, 175),
  mint500: oklchToRgb(0.78, 0.15, 172),
  amber300: oklchToRgb(0.88, 0.14, 85),
  sky300: oklchToRgb(0.83, 0.12, 225),
  rose400: oklchToRgb(0.727, 0.149, 22.5), // tailwind default rose-400
  red300: oklchToRgb(0.808, 0.114, 19.57), // tailwind default red-300
  white: [255, 255, 255],
}

// Tailwind white opacity steps over the ink-950 app background.
const W = {}
for (const step of [25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 88, 90]) {
  const a = step / 100
  W[step] = relLuminance(blend(T.white, a, T.ink950))
}

const L = {
  ink950: relLuminance(T.ink950),
  ink900: relLuminance(T.ink900),
  iris600: relLuminance(T.iris600),
  iris500: relLuminance(T.iris500),
  iris300: relLuminance(T.iris300),
  mint400: relLuminance(T.mint400),
  amber300: relLuminance(T.amber300),
  rose400: relLuminance(T.rose400),
}

// Glass cards: bg-white/[0.02..0.05] over ink-950, roughly ink-900-ish.
const cardBg = relLuminance(blend(T.white, 0.03, T.ink950))

// wc(fg, bg, label, kind) — kind: text | large | ui
const results = []
const check = (label, fgL, bgL, min, kind) => {
  const r = ratio(fgL, bgL)
  results.push({ label, kind, ratio: r, min, pass: r >= min })
}

// Primary/secondary text over the app background (the dominant pairings).
// NOTE: opacity steps below 50 FAIL AA on ink-950 (white/45 = 4.47:1) and were
// removed from the UI; this audit now gates the shipped values so they cannot
// quietly regress. Re-add a row here before using a new step in src/.
for (const step of [50, 55, 60, 70, 80, 88]) {
  check(`white/${step} text on ink-950`, W[step], L.ink950, 4.5, "text")
}
// Same steps over the glass-card composite background.
for (const step of [45, 50, 60, 75]) {
  check(
    `white/${step} text on glass card`,
    relLuminance(blend(T.white, step / 100, blend(T.white, 0.03, T.ink950))),
    cardBg,
    4.5,
    "text"
  )
}
// Accent text on background.
check("iris-300 on ink-950", L.iris300, L.ink950, 4.5, "text")
check("mint-400 on ink-950", L.mint400, L.ink950, 4.5, "text")
check("amber-300 on ink-950", L.amber300, L.ink950, 4.5, "text")
check("rose-400 on ink-950", L.rose400, L.ink950, 4.5, "text")
check("iris-300 on glass card", L.iris300, cardBg, 4.5, "text")
check("mint-400 on glass card", L.mint400, cardBg, 4.5, "text")

// User chat bubble: white text on the iris-700→iris-600 gradient.
check(
  "white on iris-700 (bubble)",
  relLuminance(oklchToRgb(0.46, 0.2, 288)),
  relLuminance(T.white),
  4.5,
  "text"
)
check("white on iris-600 (bubble)", L.iris600, relLuminance(T.white), 4.5, "text")
// Mic button: white ICON on the iris-600→iris-500 gradient → UI 3:1.
check("white on iris-500 (mic icon)", L.iris500, relLuminance(T.white), 3, "ui")

// Primary action button: white icon on iris-600 (UI component → 3:1).
check("white on iris-600 (button)", L.iris600, relLuminance(T.white), 3, "ui")
// Active mode pill: white text on white/12 over ink-950.
check(
  "white on white/12 pill",
  relLuminance(T.white),
  relLuminance(blend(T.white, 0.12, T.ink950)),
  4.5,
  "text"
)

// Focus indicator (the :focus-visible ring) against both surfaces → 3:1.
check("focus ring iris-400 on ink-950", relLuminance(T.iris400), L.ink950, 3, "ui")
check("focus ring iris-400 on glass card", relLuminance(T.iris400), cardBg, 3, "ui")

// Composer input surface (#1e1e22) with its visible border — the boundary is
// the only indicator of the primary input, so it must clear 3:1 (WCAG 1.4.11).
const composerBg = relLuminance([0x1e, 0x1e, 0x22])
check(
  "composer border white/40 on #1e1e22",
  relLuminance(blend(T.white, 0.4, [0x1e, 0x1e, 0x22])),
  composerBg,
  3,
  "ui"
)

// Mic button: white icon on iris-600/iris-500 gradient → 3:1 (it is the
// only pointer to push-to-talk, so it must clear the UI threshold).

// ---- report ----------------------------------------------------------------

let failed = 0
console.log(
  "pairing".padEnd(34),
  "kind".padEnd(6),
  "ratio".padEnd(7),
  "min",
  "  pass"
)
for (const r of results) {
  const mark = r.pass ? "PASS" : "FAIL"
  if (!r.pass) failed++
  console.log(
    r.label.padEnd(34),
    r.kind.padEnd(6),
    r.ratio.toFixed(2).padEnd(7),
    r.min,
    "  " + mark
  )
}
console.log(`\n${results.length - failed}/${results.length} pass, ${failed} fail`)
process.exit(failed > 0 ? 1 : 0)
