/**
 * The living sky (Phase 05, Rough Draft M4, 2026-10-27): the solar cycle and
 * the shooting-star categories, shared by the server (caps, ledger, flow)
 * and the client (visuals).
 *
 * Solar cycle (ROADMAP "Solar cycle"): each player's daily mana cap swings
 * gently with their local daylight, 0.9× at local midnight to 1.1× at local
 * noon. The client reports its UTC offset; the server clamps the factor to
 * [0.9, 1.1], so choosing a different timezone gains at most 10 %.
 *
 * Shooting stars (Phase 05 "Every Draw Is Visible"): colour = the IRS Form
 * 990 Part IX function column, tap = the "nature" line. The line numbers below
 * follow the current Form 990 Part IX; the CPA confirms the mapping before any
 * filing (this is a game display, not the books).
 */

import type { ManaFunction, ManaPurpose } from "./crdt-schema.js";

// ── Solar cycle ─────────────────────────────────────────────────

export const SOLAR_MIN = 0.9;
export const SOLAR_MAX = 1.1;

/** UTC offsets that exist on Earth, in minutes east of UTC (−12:00 … +14:00). */
export function clampTzOffset(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.max(-720, Math.min(840, Math.round(minutes)));
}

/** Local time of day in hours (0…24) for a UTC offset in minutes east of UTC. */
export function localHour(tzOffsetMin: number, now = Date.now()): number {
  const utcMin = Math.floor(now / 60_000) % 1440;
  return ((((utcMin + clampTzOffset(tzOffsetMin)) % 1440) + 1440) % 1440) / 60;
}

/** The sun's height, −1 at local midnight … +1 at local noon (a smooth day). */
export function sunHeight(hour: number): number {
  return Math.sin((2 * Math.PI * (hour - 6)) / 24);
}

/** Personal-cap modifier for a player's local time, always within [0.9, 1.1]. */
export function solarFactor(tzOffsetMin: number, now = Date.now()): number {
  const f = 1 + 0.1 * sunHeight(localHour(tzOffsetMin, now));
  return Math.max(SOLAR_MIN, Math.min(SOLAR_MAX, f));
}

// ── Shooting stars: Form 990 categories ─────────────────────────

/** Colour of a star = its function (Form 990 Part IX columns B, C, D). */
export const FUNCTION_COLORS: Record<ManaFunction, string> = {
  program: "#f4c65a", // gold
  management: "#6fa8ff", // blue
  fundraising: "#d9dee8", // silver
};

export const FUNCTION_LABELS: Record<ManaFunction, string> = {
  program: "Program services",
  management: "Management & general",
  fundraising: "Fundraising",
};

export const PURPOSE_LABELS: Record<ManaPurpose, string> = {
  creations: "Creations",
  research: "Research",
  cards: "Cards",
  servers: "Servers",
  compensation: "Compensation",
  refunds: "Refunds",
  other: "Other",
};

/** Form 990 Part IX "nature" lines a draw can carry. */
export const NATURES = {
  compensation: "Compensation (lines 5–10: salaries, benefits, payroll taxes)",
  legal: "Fees for services: legal (line 11b)",
  accounting: "Fees for services: accounting (line 11c)",
  fundraising_fees: "Fees for services: professional fundraising (line 11e)",
  other_fees: "Fees for services: other (line 11g)",
  advertising: "Advertising and promotion (line 12)",
  office: "Office expenses (line 13)",
  it: "Information technology (line 14)",
  occupancy: "Occupancy (line 16)",
  travel: "Travel (line 17)",
  conferences: "Conferences, conventions and meetings (line 19)",
  insurance: "Insurance (line 23)",
  other: "Other expenses (line 24)",
  refund: "Gift refunded (returned to the giver; not a Part IX expense)",
} as const;
export type Nature = keyof typeof NATURES;

export function isNature(v: unknown): v is Nature {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(NATURES, v);
}

/** The usual nature for each purpose when an entry doesn't say. */
export const DEFAULT_NATURE: Record<ManaPurpose, Nature> = {
  creations: "it",
  research: "other_fees",
  cards: "other",
  servers: "it",
  compensation: "compensation",
  refunds: "refund",
  other: "other",
};

/** Star size for an amount of mana: log scale, ~1 for a cent, ~4 for $100. */
export function starSize(mana: number): number {
  if (!(mana > 0)) return 0.6;
  return Math.max(0.6, Math.min(5, 0.8 + Math.log10(1 + mana) * 0.8));
}

/** One line of today's outflow (GET /mana/flow). */
export interface FlowLine {
  fn: ManaFunction;
  purpose: ManaPurpose;
  nature: Nature;
  /** Mana released in the window (smoothed over each entry's period). */
  amount: number;
  /** Ledger rows behind it. */
  count: number;
}

export interface ManaFlow {
  at: number;
  windowMs: number;
  lines: FlowLine[];
  /** Mana the creative share gave up to cover bills in the window. */
  shortfall: number;
}
