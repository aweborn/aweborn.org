/**
 * Deterministic math for the shared simulation (Phase 09, 9A).
 *
 * `Math.sin`, `Math.cos`, `Math.atan2`, `Math.acos`, `Math.pow`, `Math.exp`
 * are only "implementation-approximated" by the spec: V8, JavaScriptCore and
 * SpiderMonkey may differ in the last bit. A replayed input log must give
 * bit-identical states on the client, the server and other browsers, so the
 * sim uses these instead.
 *
 * Rules: only + - * / and Math.sqrt / Math.abs / Math.round / Math.min /
 * Math.max (IEEE-754 correctly rounded or exact in every engine; JS never
 * fuses a*b+c). Polynomials are fdlibm's (the same kernels most libms use),
 * without the extra-precision tail terms: we need determinism, not the last ulp.
 */

// ── sin / cos ─────────────────────────────────────────────────────────

/** π/2 split for Cody–Waite reduction (fdlibm pio2_1 / pio2_1t). */
const PIO2_HI = 1.57079632673412561417e+00
const PIO2_LO = 6.07710050650619224932e-11
const INV_PIO2 = 6.36619772367581382433e-01

const S1 = -1.66666666666666324348e-01
const S2 = 8.33333333332248946124e-03
const S3 = -1.98412698298579493134e-04
const S4 = 2.75573137070700676789e-06
const S5 = -2.50507602534068634195e-08
const S6 = 1.58969099521155010221e-10

const C1 = 4.16666666666666019037e-02
const C2 = -1.38888888888741095749e-03
const C3 = 2.48015872894767294178e-05
const C4 = -2.75573143513906633035e-07
const C5 = 2.08757232129817482790e-09
const C6 = -1.13596475577881948265e-11

/** sin on [-π/4, π/4]. */
function kSin(x: number): number {
  const z = x * x
  return x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))))
}

/** cos on [-π/4, π/4]. */
function kCos(x: number): number {
  const z = x * x
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
}

/** Reduce x to r in [-π/4, π/4] and quadrant n (0..3). Accurate for |x| < ~1e6. */
function reduce(x: number): [number, number] {
  const k = Math.round(x * INV_PIO2)
  const r = (x - k * PIO2_HI) - k * PIO2_LO
  return [r, ((k % 4) + 4) % 4]
}

export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN
  if (x === 0) return x // keeps -0, like Math.sin
  if (Math.abs(x) <= 0.7853981633974483) return kSin(x)
  const [r, n] = reduce(x)
  switch (n) {
    case 0: return kSin(r)
    case 1: return kCos(r)
    case 2: return -kSin(r)
    default: return -kCos(r)
  }
}

export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN
  if (Math.abs(x) <= 0.7853981633974483) return kCos(x)
  const [r, n] = reduce(x)
  switch (n) {
    case 0: return kCos(r)
    case 1: return -kSin(r)
    case 2: return -kCos(r)
    default: return kSin(r)
  }
}

// ── atan / atan2 / acos ──────────────────────────────────────────────

const ATAN_HI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00]
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17]
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01,
  -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02,
  6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02,
  -3.65315727442169155270e-02, 1.62858201153657823623e-02,
]

export const D_PI = 3.141592653589793
const D_PI_2 = 1.5707963267948966

export function datan(v: number): number {
  if (Number.isNaN(v)) return NaN
  const sign = v < 0 ? -1 : 1
  let x = Math.abs(v)
  if (x > 1e17) return sign * D_PI_2
  let id: number
  if (x < 0.4375) id = -1
  else if (x < 0.6875) { id = 0; x = (2 * x - 1) / (2 + x) }
  else if (x < 1.1875) { id = 1; x = (x - 1) / (x + 1) }
  else if (x < 2.4375) { id = 2; x = (x - 1.5) / (1 + 1.5 * x) }
  else { id = 3; x = -1 / x }
  const z = x * x
  const w = z * z
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))))
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))))
  if (id < 0) return sign * (x - x * (s1 + s2))
  return sign * (ATAN_HI[id] - ((x * (s1 + s2) - ATAN_LO[id]) - x))
}

export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN
  if (x > 0) return datan(y / x)
  if (x < 0) return y >= 0 ? D_PI + datan(y / x) : -D_PI + datan(y / x)
  if (y > 0) return D_PI_2
  if (y < 0) return -D_PI_2
  return 0
}

/** acos for d in [-1, 1] (clamped). */
export function dacos(d: number): number {
  const c = Math.max(-1, Math.min(1, d))
  return datan2(Math.sqrt((1 - c) * (1 + c)), c)
}

// ── Constants the sim needs at its fixed step ────────────────────────
// (Computed once with Math.pow / Math.exp and frozen as literals, so no
// engine evaluates them at runtime. dmath.test.ts checks them.)

/** Math.pow(1 - 0.15, 1/60): NEUTRAL space drag per 60 Hz step. */
export const NEUTRAL_DRAG_PER_STEP = 0.9972950162543811
/** 1 - Math.pow(0.05, 1/60): auto-orient slerp factor per 60 Hz step. */
export const AUTO_ORIENT_PER_STEP = 0.04870291331009746
/** Math.exp(-2.5 / 60): beginner-leash ease-back per 60 Hz step. */
export const LEASH_EASE_PER_STEP = 0.9591894571091382
