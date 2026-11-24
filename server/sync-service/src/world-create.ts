/**
 * Create World (2026-10-21, Alex): the last piece of the old dev panel, now a
 * real feature. "Plant where you stand": the world appears just ahead of you.
 *
 * Rules (decided in the mobile UI grill):
 * - Signed-in players only (guests see the mana seal). A world is permanent
 *   (worlds are never hard-deleted), so anonymous spam would litter the map.
 * - Free for now, but at most WORLDS_PER_DAY per player per rolling 24 h.
 *   Counted from the Universe doc itself, so it survives restarts.
 *   Pricing is revisited with Phase 05.
 *
 * - A world is for everyone or 18+ from the moment it is made, and stays that
 *   way. Only a player behind the 18+ door can make an 18+ one (index.ts).
 *
 * The client used to send `create-world` over the socket; that path is now
 * refused (it bypassed both rules). Creation is POST /api/player/world.
 */
import type { Vec3, WorldEntry } from "../../../shared/crdt-schema.js";
import { isWorldId, ORIGIN_WORLD_ID } from "../../../shared/crdt-schema.js";
import { prepareChat } from "../../../shared/chat.js";

export const WORLDS_PER_DAY = 3;
export const WORLD_NAME_MAX = 40;
const DAY_MS = 24 * 3600_000;
/** Far beyond anything reachable; only stops absurd numbers reaching the resolver. */
const MAX_COORD = 1e7;
/** Interior world coordinates are within [-160, 160] on XZ; allow small margin. */
const MAX_INTERIOR_COORD = 200;

export type WorldRequest = { name: string; color: string; position: Vec3; parentWorldId?: string; adult?: boolean };

/**
 * A public name (a world's, a Library game's): the same cleaning + word filter as chat
 * (it is public, like a chat line). Null when nothing usable is left or it is too long.
 */
export function cleanWorldName(raw: unknown): string | null {
  const name = typeof raw === "string" ? prepareChat(raw.slice(0, WORLD_NAME_MAX * 2)) : null;
  return name && name.length <= WORLD_NAME_MAX ? name : null;
}

/** Validate and clean a create-world body. Returns the clean request or an error code. */
export function parseWorldRequest(body: unknown): WorldRequest | { error: string } {
  const b = (body ?? {}) as { name?: unknown; color?: unknown; position?: unknown; parentWorldId?: unknown; adult?: unknown };
  const name = cleanWorldName(b.name);
  if (!name) return { error: "bad_name" };
  const color = typeof b.color === "string" ? b.color.toLowerCase() : "";
  if (!/^#[0-9a-f]{6}$/.test(color)) return { error: "bad_color" };
  let parentWorldId: string | undefined;
  if (b.parentWorldId !== undefined && b.parentWorldId !== null && b.parentWorldId !== "") {
    if (typeof b.parentWorldId !== "string") return { error: "bad_parent" };
    const pid = b.parentWorldId.toLowerCase();
    if (!isWorldId(pid) || pid === ORIGIN_WORLD_ID) return { error: "bad_parent" };
    parentWorldId = pid;
  }
  const maxC = parentWorldId ? MAX_INTERIOR_COORD : MAX_COORD;
  const p = (b.position ?? {}) as { x?: unknown; y?: unknown; z?: unknown };
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= maxC;
  if (!ok(p.x) || !ok(p.y) || !ok(p.z)) return { error: "bad_position" };
  // `adult: true` = an 18+ world. Chosen here, once: nothing changes a world's tier afterwards (Alex, 2026-11-24)
  return { name, color, position: { x: p.x, y: p.y, z: p.z }, ...(parentWorldId ? { parentWorldId } : {}), ...(b.adult === true ? { adult: true } : {}) };
}

/** How many more worlds this player may plant right now (rolling 24 h). */
export function worldsLeftToday(worlds: Iterable<WorldEntry>, playerId: string, now = Date.now()): number {
  let made = 0;
  for (const w of worlds) if (w.creator === playerId && now - w.createdAt < DAY_MS) made++;
  return Math.max(0, WORLDS_PER_DAY - made);
}
