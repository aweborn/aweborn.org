/**
 * The 18+ door, client side (server: sync-service `age-door.ts`, `adult-worlds.ts`).
 *
 * A toggle and nothing else: a saved player turns on *Show 18+*, which is their own
 * statement that they are 18 or older. No date of birth, no form (Alex, 2026-11-24).
 * Being behind the door also makes the player a research candidate (Phase 10 Q10b):
 * the UI says so right at the switch.
 *
 * The door decides what the player sees of 18+ worlds. Without it they are veiled (no
 * name, no colour of their own) and can't be entered. With it, this module also holds
 * their real names, which the shared universe never carries.
 */
import { AUTH_URL, getPlayerSnapshot, subscribePlayer } from "./player";

export type DoorResult =
  | { ok: true; show: boolean }
  | { ok: false; code: "sign_in_required" | "offline" | "error"; message: string };

export interface DoorSnapshot {
  /** Has the server been asked yet? */
  loaded: boolean;
  /** *Show 18+* is on. */
  show: boolean;
  /** 18+ worlds' real names by world id (empty unless `show`). */
  names: Readonly<Record<string, string>>;
}

let snapshot: DoorSnapshot = { loaded: false, show: false, names: {} };
const listeners = new Set<() => void>();
const publish = (next: DoorSnapshot) => {
  snapshot = next;
  for (const fn of listeners) fn();
};

export const getDoorSnapshot = (): DoorSnapshot => snapshot;
export function subscribeDoor(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
/** Is *Show 18+* on, as far as this device knows? */
export const doorOpen = (): boolean => snapshot.show;

async function fetchNames(): Promise<Record<string, string>> {
  const res = await fetch(`${AUTH_URL}/api/player/adult-worlds`, { credentials: "include" }).catch(() => null);
  if (!res?.ok) return {};
  const body = (await res.json().catch(() => null)) as { names?: Record<string, string> } | null;
  return body?.names && typeof body.names === "object" ? body.names : {};
}

/** Ask the server how the door stands (shut if it can't be read), and for 18+ worlds' names if it is open. */
export async function loadDoor(): Promise<boolean> {
  const res = await fetch(`${AUTH_URL}/api/player/me`, { credentials: "include" }).catch(() => null);
  const me = res?.ok ? ((await res.json().catch(() => null)) as { door?: { show?: boolean } } | null) : null;
  const show = Boolean(me?.door?.show);
  publish({ loaded: true, show, names: show ? await fetchNames() : {} });
  return show;
}

/** The names again (a new 18+ world was just made, or one came into view). */
export async function refreshAdultNames(): Promise<void> {
  if (snapshot.show) publish({ ...snapshot, names: await fetchNames() });
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
  if (!res.ok) return { ok: false, code: body.error === "sign_in_required" ? "sign_in_required" : "error", message: body.message ?? "Something went wrong. Please try again." };
  const now = Boolean(body.show);
  publish({ loaded: true, show: now, names: now ? await fetchNames() : {} });
  return { ok: true, show: now };
}

// The door follows the player: a different player, or a guest becoming saved, asks again.
let seenPlayer: string | null = null;
function followPlayer() {
  const p = getPlayerSnapshot();
  const key = p && !p.isGuest ? `${p.playerId}:${p.isAnonymous ? "a" : "s"}` : null;
  if (key === seenPlayer) return;
  seenPlayer = key;
  if (!key || p?.isAnonymous) publish({ loaded: Boolean(key), show: false, names: {} });
  else void loadDoor();
}
subscribePlayer(followPlayer);
followPlayer();
