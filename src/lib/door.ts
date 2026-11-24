/**
 * The 18+ door, client side (server: sync-service `age-door.ts`).
 *
 * A toggle and nothing else: a saved player turns on *Show 18+*, which is their own
 * statement that they are 18 or older. No date of birth, no form (Alex, 2026-11-24).
 * Being behind the door also makes the player a research candidate (Phase 10 Q10b):
 * the UI says so right at the switch.
 */
import { AUTH_URL } from "./player";

export type DoorResult =
  | { ok: true; show: boolean }
  | { ok: false; code: "sign_in_required" | "offline" | "error"; message: string };

/** Whether *Show 18+* is on, as the server has it (off if it can't be read). */
export async function getDoor(): Promise<boolean> {
  const res = await fetch(`${AUTH_URL}/api/player/me`, { credentials: "include" }).catch(() => null);
  if (!res?.ok) return false;
  const me = (await res.json().catch(() => null)) as { door?: { show?: boolean } } | null;
  return Boolean(me?.door?.show);
}

/** Turn *Show 18+* on or off. */
export async function setDoor(show: boolean): Promise<DoorResult> {
  const res = await fetch(`${AUTH_URL}/api/player/door`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ show }),
  }).catch(() => null);
  if (!res) return { ok: false, code: "offline", message: "Couldn't reach Aweborn. Check your connection and try again." };
  const body = (await res.json().catch(() => ({}))) as { show?: boolean; error?: string; message?: string };
  if (res.ok) return { ok: true, show: Boolean(body.show) };
  return { ok: false, code: body.error === "sign_in_required" ? "sign_in_required" : "error", message: body.message ?? "Something went wrong. Please try again." };
}
