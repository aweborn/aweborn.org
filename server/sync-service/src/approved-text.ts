/**
 * Texts the server has checked and may appear on a placed object (2026-11-10).
 *
 * A sign's `text` is written into the world doc by the client, so before this
 * a client could put any words there, skipping the lore check. Now the lore
 * endpoint records every text that passed its output check, and the world
 * authority reverts a new or changed `text` it never approved. Texts already
 * in a world when it loads are grandfathered (in memory), so old signs can
 * still be moved and duplicated.
 *
 * Keyed by sha256 of the exact text. Kept in SQLite so a sign placed offline
 * and synced later still matches; works in memory only when there's no DB (tests).
 */
import { createHash } from "node:crypto";
import { getDb } from "./persistence.js";

const mem = new Set<string>();
let tableReady = false;

const key = (text: string) => createHash("sha256").update(text).digest("hex");

function db() {
  try {
    const d = getDb();
    if (!tableReady) {
      d.exec("CREATE TABLE IF NOT EXISTS approved_text (sha TEXT PRIMARY KEY, at INTEGER NOT NULL)");
      tableReady = true;
    }
    return d;
  } catch {
    return null; // no database (unit tests): memory only
  }
}

/** Record a text that passed the safety check. `persist: false` = grandfathered, memory only. */
export function approveText(text: string, opts: { persist?: boolean } = {}): void {
  const k = key(text);
  mem.add(k);
  if (opts.persist === false) return;
  db()?.prepare("INSERT OR IGNORE INTO approved_text (sha, at) VALUES (?, ?)").run(k, Date.now());
}

export function isApprovedText(text: string): boolean {
  const k = key(text);
  if (mem.has(k)) return true;
  const row = db()?.prepare("SELECT 1 FROM approved_text WHERE sha = ?").get(k);
  if (row) mem.add(k);
  return !!row;
}

/** Tests only. */
export function resetApprovedTextForTests(): void {
  mem.clear();
}
