/**
 * Origin card art — the Aweborn Portal as it sits in the game: a solid
 * sun-gold core, a glowing aura, and a tall lighthouse-like beam of light.
 *
 * Pure vector (gradients + masks only, no filters or raster images), so it
 * prints crisply and keeps the card SVG self-contained.
 *
 * Colors come from the game:
 *   core / shells  #e8b94a          (src/components/DonationPortal.tsx)
 *   beam           rgb(1, .82, .3)  (src/components/PortalBeacon.tsx)
 *   purple accent  #6b3fa0          (portal's outer torus / nebula purple)
 *
 * Coordinate space: 55 × 45 (mm), the front art window.
 */

const W = 55, H = 45, CX = 27.5, CY = 22.5;

/** Deterministic PRNG so the starfield is identical on every build. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function stars(n, seed) {
  const r = rng(seed);
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = r() * W, y = r() * H;
    const big = r() > 0.92;
    const rad = big ? 0.14 + r() * 0.08 : 0.04 + r() * 0.07;
    const op = big ? 0.85 : 0.25 + r() * 0.5;
    out += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${rad.toFixed(3)}" fill="#f4f1ff" opacity="${op.toFixed(2)}"/>`;
  }
  return out;
}

/** @param {string} [p] id prefix, keeps gradient ids unique inside the card */
export function originArt(p = "origin") {
  const id = (s) => `${p}-${s}`;
  return `
  <defs>
    <!-- deep space -->
    <radialGradient id="${id("space")}" cx="50%" cy="50%" r="75%">
      <stop offset="0%" stop-color="#0d0b24"/>
      <stop offset="100%" stop-color="#040410"/>
    </radialGradient>
    <radialGradient id="${id("nebula")}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#6b3fa0" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#6b3fa0" stop-opacity="0"/>
    </radialGradient>

    <!-- beam: horizontal profile (fill) × vertical falloff (mask) -->
    <linearGradient id="${id("beam-x")}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffd14d" stop-opacity="0"/>
      <stop offset="50%" stop-color="#ffd14d" stop-opacity="1"/>
      <stop offset="100%" stop-color="#ffd14d" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${id("beam-core-x")}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#fff4cc" stop-opacity="0"/>
      <stop offset="50%" stop-color="#fffaf0" stop-opacity="1"/>
      <stop offset="100%" stop-color="#fff4cc" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${id("beam-y")}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff" stop-opacity="0.25"/>
      <stop offset="50%" stop-color="#fff" stop-opacity="1"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0.25"/>
    </linearGradient>
    <mask id="${id("beam-mask")}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="url(#${id("beam-y")})"/>
    </mask>

    <!-- aura + core -->
    <radialGradient id="${id("aura-wide")}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#e8b94a" stop-opacity="0.5"/>
      <stop offset="45%" stop-color="#e8b94a" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#e8b94a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id("aura")}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffe08a" stop-opacity="0.95"/>
      <stop offset="35%" stop-color="#ffd36a" stop-opacity="0.55"/>
      <stop offset="70%" stop-color="#e8b94a" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#e8b94a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id("core")}" cx="42%" cy="40%" r="62%">
      <stop offset="0%" stop-color="#fffbe8"/>
      <stop offset="35%" stop-color="#ffe9a3"/>
      <stop offset="80%" stop-color="#ffd25e"/>
      <stop offset="100%" stop-color="#e8b94a"/>
    </radialGradient>
  </defs>

  <!-- space, nebula haze, stars -->
  <rect width="${W}" height="${H}" fill="url(#${id("space")})"/>
  <ellipse cx="${CX}" cy="${CY}" rx="34" ry="22" fill="url(#${id("nebula")})"/>
  ${stars(110, 0xa3eb0)}

  <!-- the beam: wide soft glow, mid glow, bright filament (full height, both directions) -->
  <g mask="url(#${id("beam-mask")})">
    <rect x="${CX - 9}" y="0" width="18" height="${H}" fill="url(#${id("beam-x")})" opacity="0.28"/>
    <rect x="${CX - 3}" y="0" width="6" height="${H}" fill="url(#${id("beam-x")})" opacity="0.75"/>
    <rect x="${CX - 0.8}" y="0" width="1.6" height="${H}" fill="url(#${id("beam-core-x")})" opacity="1"/>
  </g>

  <!-- aura -->
  <circle cx="${CX}" cy="${CY}" r="24" fill="url(#${id("aura-wide")})"/>
  <circle cx="${CX}" cy="${CY}" r="11.5" fill="url(#${id("aura")})"/>

  <!-- solid sun core -->
  <circle cx="${CX}" cy="${CY}" r="3.4" fill="url(#${id("core")})"/>`;
}
