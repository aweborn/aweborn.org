/**
 * Delete my player, client side (server: sync-service `erase-player.ts`,
 * `POST /api/player/delete`). "My player" is the whole account: every character on it.
 * The server asks for two things: the typed word, and a sign-in on this device in the
 * last 5 minutes (the same "Confirm it's you" as changing how you sign in).
 */
import { AUTH_URL, dropDeadSession } from "./player";

/** What the server types back as the word to enter (kept here for the first paint). */
export const DELETE_WORD = "DELETE";

export interface DeleteStanding {
  /** A saved player (guests have no sign-in to delete). */
  saved: boolean;
  /** Confirmed it's them in the last 5 minutes. */
  fresh: boolean;
  /** Characters on the account. */
  characters: number;
  /** Worlds those characters created (they stay, with no creator). */
  worlds: number;
  word: string;
}

export type DeleteResult =
  | { ok: true }
  | { ok: false; needsConfirm?: boolean; message: string };

const OFFLINE = "Couldn't reach Aweborn. Nothing was deleted. Check your connection and try again.";

/** Ask what deleting would cover, and whether this device has just confirmed it's them. Null if it can't be read. */
export async function loadDeleteStanding(): Promise<DeleteStanding | null> {
  const res = await fetch(`${AUTH_URL}/api/player/delete`, { credentials: "include" }).catch(() => null);
  if (!res?.ok) return null;
  const b = (await res.json().catch(() => null)) as Partial<DeleteStanding> | null;
  if (!b) return null;
  return {
    saved: Boolean(b.saved), fresh: Boolean(b.fresh),
    characters: Number(b.characters) || 1, worlds: Number(b.worlds) || 0,
    word: typeof b.word === "string" && b.word ? b.word : DELETE_WORD,
  };
}

/**
 * The server closes every connection of a deleted player with this code. On the device
 * that asked, the "Your player is deleted" screen takes it from there; any other device
 * signed in to that player starts over as a guest at once (`useCRDT.ts`).
 */
export const PLAYER_DELETED_CLOSE = 4401;
let askedHere = false;
/** Did this device just ask to delete its player? */
export const deletingOnThisDevice = (): boolean => askedHere;

/** Delete the player. Nothing is deleted unless this resolves `{ ok: true }`. */
export async function deleteMyPlayer(word: string): Promise<DeleteResult> {
  askedHere = true;
  const r = await askToDelete(word);
  if (!r.ok) askedHere = false;
  return r;
}

async function askToDelete(word: string): Promise<DeleteResult> {
  const res = await fetch(`${AUTH_URL}/api/player/delete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: word }),
  }).catch(() => null);
  if (!res) return { ok: false, message: OFFLINE };
  const body = (await res.json().catch(() => ({}))) as { deleted?: boolean; code?: string; message?: string };
  if (res.ok && body.deleted) return { ok: true };
  if (body.code === "SESSION_NOT_FRESH") return { ok: false, needsConfirm: true, message: "Confirm it's you first. Nothing was deleted." };
  return { ok: false, message: body.message ?? "Something went wrong and your player was not deleted. Please try again." };
}

/**
 * The player is gone on the server: forget them on this device too (settings, the note
 * that a saved player signed in here before, offline copies of worlds). Best effort; the
 * offline copies finish going when the page reloads and lets go of them.
 */
export async function wipeDevice(): Promise<void> {
  try { localStorage.clear(); } catch { /* private mode */ }
  try { sessionStorage.clear(); } catch { /* private mode */ }
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
  } catch { /* not supported: the copies hold no sign-in */ }
}

const DELETED_KEY = "aweborn-player-deleted";
/**
 * The player is deleted: start this page over as a fresh guest (nothing of the old
 * player keeps running here: no presence, no open world), and say so once it is back.
 */
export async function startOverAfterDelete(): Promise<void> {
  await dropDeadSession();
  await wipeDevice();
  try { sessionStorage.setItem(DELETED_KEY, "1"); } catch { /* the reload still happens */ }
  window.location.reload();
}
/** True once, on the page that came back after a delete: show "Your player is deleted". */
export function takeDeletedNotice(): boolean {
  try {
    const was = sessionStorage.getItem(DELETED_KEY) === "1";
    sessionStorage.removeItem(DELETED_KEY);
    return was;
  } catch {
    return false;
  }
}
