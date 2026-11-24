/**
 * The 18+ door, client side (server: sync-service `age-door.ts`).
 *
 * A saved player enters a date of birth once (checked on the server, never stored)
 * and turns on *Show 18+*. Being behind the door also makes the player a research
 * candidate (Phase 10 Q10b): the UI says so where the choice is made.
 */
import { AUTH_URL } from "./player";

export interface DoorState {
  /** A birthdate of 18 or older was confirmed on this account. */
  confirmed: boolean;
  /** *Show 18+* is on. */
  show: boolean;
}

export type DoorResult =
  | ({ ok: true } & DoorState)
  | { ok: false; code: "under_age" | "bad_birthdate" | "birthdate_needed" | "sign_in_required" | "offline" | "error"; message: string; retryAt?: number };

const CLOSED: DoorState = { confirmed: false, show: false };

/** The door as the server has it (shut if it can't be read). */
export async function getDoor(): Promise<DoorState> {
  const res = await fetch(`${AUTH_URL}/api/player/me`, { credentials: "include" }).catch(() => null);
  if (!res?.ok) return CLOSED;
  const me = (await res.json().catch(() => null)) as { door?: Partial<DoorState> } | null;
  return { confirmed: Boolean(me?.door?.confirmed), show: Boolean(me?.door?.show) };
}

/** Turn *Show 18+* on or off. The first "on" needs `birthdate` as `YYYY-MM-DD`. */
export async function setDoor(show: boolean, birthdate?: string): Promise<DoorResult> {
  const res = await fetch(`${AUTH_URL}/api/player/door`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(birthdate ? { show, birthdate } : { show }),
  }).catch(() => null);
  if (!res) return { ok: false, code: "offline", message: "Couldn't reach Aweborn. Check your connection and try again." };
  const body = (await res.json().catch(() => ({}))) as { confirmed?: boolean; show?: boolean; error?: string; message?: string; retryAt?: number };
  if (res.ok) return { ok: true, confirmed: Boolean(body.confirmed), show: Boolean(body.show) };
  const known = ["under_age", "bad_birthdate", "birthdate_needed", "sign_in_required"] as const;
  const code = known.find((k) => k === body.error) ?? "error";
  return { ok: false, code, message: body.message ?? "Something went wrong. Please try again.", ...(typeof body.retryAt === "number" ? { retryAt: body.retryAt } : {}) };
}

/** `YYYY-MM-DD` from what was typed, or null if it can't be a date. The server decides the rest. */
export function birthdateOf(year: string, month: string, day: string): string | null {
  const y = Number(year), m = Number(month), d = Number(day);
  if (!/^\d{4}$/.test(year.trim()) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
