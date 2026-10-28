/**
 * Pool level (Phase 05 "Mana Is Visible, Audible, and Tangible"; Rough Draft
 * M2/M4, 2026-10-27).
 *
 * ROADMAP: "percent of what is open: the creative share relative to 30 days
 * of typical draw". The server publishes `level` (0…1) in the Universe `mana`
 * map; audio (M2) and visuals (M4) read the band.
 *
 * A floor on the 30-day draw keeps a quiet universe (little spending yet)
 * from reading as "full" off a tiny creative share: 3,000 mana = $30 at
 * K = 100, about a dollar a day.
 */

export const LEVEL_WINDOW_DAYS = 30;
export const LEVEL_DRAW_FLOOR = 3000;

export type PoolBand = "critical" | "low" | "medium" | "high";

/** creative ÷ max(floor, last 30 days of creation spend), clamped to 0…1. */
export function poolLevel(creative: number, spend30d: number): number {
  if (!(creative > 0)) return 0;
  const denom = Math.max(LEVEL_DRAW_FLOOR, Number.isFinite(spend30d) ? spend30d : 0);
  return Math.min(1, creative / denom);
}

/** ROADMAP bands: critical < 5 %, low < 30 %, medium < 80 %, high ≥ 80 %. */
export function poolBand(level: number): PoolBand {
  if (level < 0.05) return "critical";
  if (level < 0.3) return "low";
  if (level < 0.8) return "medium";
  return "high";
}
