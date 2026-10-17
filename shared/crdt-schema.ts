/**
 * Aweborn — Shared CRDT Schema Types
 *
 * These types define the structure of Yjs documents used by both the
 * client and the sync-service. They mirror the ROADMAP.md spec exactly.
 *
 * Import path:
 *   - Client:  import type { WorldEntry, ... } from "@aweborn/shared/crdt-schema"
 *   - Server:  import type { WorldEntry, ... } from "../../shared/crdt-schema.js"
 */

// ── Spatial ──────────────────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Sector coordinate — derived from a position by dividing by SECTOR_SIZE
 * and flooring. Each axis is an integer.
 */
export interface SectorCoord {
  sx: number;
  sy: number;
  sz: number;
}

/** Sector grid resolution (units per axis). Matches LOD Medium→Far boundary. */
export const SECTOR_SIZE = 1000;

/** Minimum distance between resolved world positions (units). */
export const MIN_WORLD_DISTANCE = 50;

/** Convert a world position to a sector coordinate. */
export function positionToSector(pos: Vec3): SectorCoord {
  return {
    sx: Math.floor(pos.x / SECTOR_SIZE),
    sy: Math.floor(pos.y / SECTOR_SIZE),
    sz: Math.floor(pos.z / SECTOR_SIZE),
  };
}

/** Deterministic string key for a sector (used as room name / map key). */
export function sectorKey(s: SectorCoord): string {
  return `${s.sx}:${s.sy}:${s.sz}`;
}

/**
 * Get sector keys for a 3×3×3 cube centered on the given sector.
 * This is the set of sectors a client subscribes to.
 */
export function adjacentSectorKeys(center: SectorCoord): string[] {
  const keys: string[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        keys.push(sectorKey({ sx: center.sx + dx, sy: center.sy + dy, sz: center.sz + dz }));
      }
    }
  }
  return keys;
}

// ── Universe CRDT (Layer 1) ──────────────────────────────────────────

/**
 * A single world's metadata entry in the Universe CRDT.
 * Stored in Y.Map("worlds") keyed by world id.
 *
 * ~100 bytes serialized.
 */
export interface WorldEntry {
  id: string;
  name: string;
  creator: string;

  /** Position requested by the creator ("plant where you stand"). Immutable. */
  intendedPosition: Vec3;

  /** Position after server spatial resolution. Written ONLY by server. */
  resolvedPosition: Vec3;

  /** Unix timestamp (ms) of when the server last resolved this position. */
  resolvedAt: number;

  /** Display color (hex). */
  color: string;

  /** Sector key (derived from resolvedPosition). */
  sector: string;

  /** false = Ghost on the universe map (outside the Frontier, meter not yet full). Only a look: interiors are identical. */
  solidified: boolean;

  /** Unix timestamp (ms) of when the world was solidified. 0 if ghost. */
  solidifiedAt: number;

  /** Ephemeral presence count (updated by server). */
  playerCount: number;

  /** Unix timestamp (ms) of last activity. */
  lastActive: number;

  /** Unix timestamp (ms) of creation. */
  createdAt: number;
}

/**
 * Universe-level mana state (Phase 05, formula v3: the pool is the treasury).
 * Stored in Y.Map("mana") on the Universe CRDT. **Server-authoritative:** the
 * sync-service rebuilds it from the append-only ledger and is the only writer.
 * All amounts are in mana (1 mana = $0.01, `K = 100` per dollar).
 */
export interface ManaState {
  /** The treasury now: all money in − all draws out. */
  pool: number;
  /** What players can create with now (≤ pool). */
  creative: number;
  /** Estimates held for in-flight manifestations. */
  reserved: number;
  /** Σ money in + Σ awe reach. Never falls; sets the Frontier. */
  highWater: number;
  /** `c · ∛(highWater)`, `c = ∛10`. */
  frontierRadius: number;
  /** Lifetime mana in, all sources. */
  totalIn: number;
  /** Lifetime draws by Form 990 function (shooting-star color). */
  drawnBy: Record<ManaFunction, number>;
  /** Lifetime draws by in-game purpose (shooting-star motion). */
  drawnByPurpose: Record<ManaPurpose, number>;
  /** Lifetime mana the creative share gave up to cover bills (disclosed shrink). */
  shortfall: number;
  params: { K: number; alpha: number; tauDays: number; c: number };
  /** Unix ms of the last gift (0 = none yet). */
  lastDonationAt: number;
}

export type ManaFunction = "program" | "management" | "fundraising";
export type ManaPurpose = "creations" | "research" | "cards" | "servers" | "compensation" | "other";

/** Public mana constants (Phase 05, decided 2026-10-14). */
export const MANA_PARAMS = {
  /** Mana per dollar: 1 mana = $0.01. */
  K: 100,
  /** Creative fraction of each unrestricted inflow. */
  alpha: 0.5,
  /** Drain horizon of the creative share, days. */
  tauDays: 30,
  /** Frontier scale: r = c · ∛(highWater) = 100 u · ∛($ ever in / 1,000). */
  c: Math.cbrt(10),
} as const;

/** Living Frontier radius for a given high-water line (mana). */
export function frontierRadiusFor(highWater: number): number {
  return highWater > 0 ? MANA_PARAMS.c * Math.cbrt(highWater) : 0;
}

/**
 * Personal caps, mana per rolling 24 h (approved by Alex 2026-10-16; see
 * MANA_COSTS.md). Solar ±10% applies on top.
 */
export const MANA_CAPS = {
  /** Rolling window for personal caps and the global flow, ms. */
  windowMs: 24 * 60 * 60 * 1000,
  /** Players active within this long share the global flow. */
  activeMs: 30 * 60 * 1000,
  /** Chapters 1–4 (move … build): nothing generative yet. */
  beforeMaker: 0,
  /** Chapter 5 (Maker tutorials). */
  maker: 150,
  /** Chapters 6–7 and the start of post-warp play. */
  explorer: 250,
  /** Added per level after warp… */
  perLevel: 25,
  /** …up to this. */
  max: 1000,
  /** The global flow never drops below this: a lone player can always make a whole world. */
  pSolo: 400,
} as const;

/** Where a player is on the ladder (chapters 1–7; warp unlocks at the end of 7). */
export interface PlayerProgress {
  chapter: number;
  warpUnlocked: boolean;
  /** Levels earned since warp unlocked. */
  levelsSinceWarp: number;
}

/** `base(level)`: a player's personal cap per 24 h, before solar. */
export function baseCap(p: PlayerProgress): number {
  if (p.warpUnlocked) {
    return Math.min(MANA_CAPS.max, MANA_CAPS.explorer + MANA_CAPS.perLevel * Math.max(0, Math.floor(p.levelsSinceWarp)));
  }
  if (p.chapter >= 6) return MANA_CAPS.explorer;
  if (p.chapter === 5) return MANA_CAPS.maker;
  return MANA_CAPS.beforeMaker;
}

// ── World CRDT (Layer 2) ─────────────────────────────────────────────

/**
 * World metadata — Y.Map("meta") inside a World Y.Doc.
 */
export interface WorldMeta {
  name: string;
  creator: string;
  createdAt: number;
  color: string;
  solidified: boolean;
}

/**
 * Per-world physics parameters — Y.Map("physics").
 * Each world can have different physics rules.
 */
export interface PhysicsParams {
  gravityX: number;
  gravityY: number;
  gravityZ: number;
  friction: number;
  airResistance: number;
  bounceCoefficient: number;
  waterLevel: number;
}

/** Default Earth-like physics. */
export const DEFAULT_PHYSICS: PhysicsParams = {
  gravityX: 0,
  gravityY: -9.8,
  gravityZ: 0,
  friction: 0.3,
  airResistance: 0.01,
  bounceCoefficient: 0.5,
  waterLevel: -10,
};

/**
 * A placed object inside a world — stored in Y.Map("objects")
 * keyed by object id.
 */
export interface PlacedObject {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  material: string;
  placedBy: string;
  placedAt: number;
}

/**
 * Terrain data — Y.Map("terrain").
 * Procedural generation seed + per-chunk modifications overlay.
 */
export interface TerrainData {
  seed: number;
  // modifications stored as nested Y.Map keyed by chunk coordinates
}

/**
 * Chat message — stored in Y.Array("chat").
 */
export interface ChatMessage {
  sender: string;
  text: string;
  t: number;
}

// ── Player Presence (Awareness Protocol) ─────────────────────────────

/**
 * Ephemeral player state broadcast via Yjs awareness (~40 bytes per player).
 * Not persisted.
 */
export interface PlayerPresence {
  id: string;
  position: Vec3;
  velocity: Vec3;
  /** null = flying in universe, string = inside a world */
  inWorld: string | null;
  color: string;
  /**
   * Inside a world: facing unit vector in XZ (Phase 07). While `inWorld` is
   * set, `position` is in that world's interior coordinates, not universe ones.
   */
  facing?: { x: number; z: number };
}

// ── World Index (per account; Phase 08B) ─────────────────────────────

/**
 * - `sighted`: came close enough to see it (flying, or arriving by link/card
 *   next to it). Face-down card; can warp there.
 * - `visited`: went inside. Full art.
 * A world only ever moves sighted → visited.
 */
export type WorldIndexState = "sighted" | "visited";

/**
 * How a world was first found: flying up to it, or arriving by link (a
 * physical card is a link). Warping adds nothing: you can only warp to
 * worlds already in your index.
 */
export type DiscoveryMethod = "flight" | "link";

export interface WorldIndexEntry {
  worldId: string;
  state: WorldIndexState;
  method: DiscoveryMethod;
  /** The character that found it first. */
  characterId: string | null;
  /** First found (sighted or visited). */
  discoveredAt: number;
  /** First visit, or null while only sighted. */
  visitedAt: number | null;
  /** Times entered; re-entering within 30 s counts once. */
  visitCount: number;
  lastVisitedAt: number | null;
  /** The world as it is now (for the card); null = it has faded. */
  world?: WorldIndexWorld | null;
  /** Client only: found while offline, not yet confirmed by the server. */
  pending?: boolean;
}

/** What a World Index card shows about its world. */
export interface WorldIndexWorld {
  name: string;
  color: string;
  creator: string;
  position: Vec3;
  sector: string;
  /** Ghost or solid (card art). Absent on entries cached before 2026-10-13. Planned: `edition` ('dreamt' | 'solid'), fixed at first discovery (Phase 08). */
  solidified?: boolean;
}

// ── WebSocket Protocol ───────────────────────────────────────────────

/**
 * Room types used in WebSocket URL routing.
 *
 * - `/universe?sectors=0:0:0,1:0:0,...` — subscribe to sector rooms
 * - `/world/{worldId}` — join a specific world
 */
export type RoomType = "universe" | "world";

/**
 * World IDs are lowercase UUIDv4 (`crypto.randomUUID()`), e.g.
 * `3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c`. They are permanent: printed NFC
 * cards encode `https://aweborn.org/w/<worldId>` and can never be patched.
 */
export const WORLD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Whether a string is a valid world ID (lowercase UUIDv4). */
export function isWorldId(id: string): boolean {
  return WORLD_ID_PATTERN.test(id);
}

// ── Origin (the Aweborn Portal) ──────────────────────────────────────

/**
 * Permanent world ID of **Origin**, the Aweborn Portal at (0, 0, 0).
 * Printed on the Origin NFC card (`/w/<ORIGIN_WORLD_ID>`). NEVER change it.
 */
export const ORIGIN_WORLD_ID = "5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7";

/** Origin's fixed position: the center of the universe. */
export const ORIGIN_POSITION: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 });

/**
 * Origin's WorldEntry. The server seeds it into the Universe CRDT so
 * `/worlds/:id` and `/w/<id>` resolve it like any world, and the spatial
 * resolver keeps other worlds clear of the portal. Clients render and
 * simulate the portal specially (it has no interior).
 */
export const ORIGIN_WORLD_ENTRY: Readonly<WorldEntry> = Object.freeze({
  id: ORIGIN_WORLD_ID,
  name: "Origin",
  creator: "system",
  intendedPosition: { ...ORIGIN_POSITION },
  resolvedPosition: { ...ORIGIN_POSITION },
  resolvedAt: 0,
  color: "#e8b94a",
  sector: "0:0:0",
  solidified: true,
  solidifiedAt: 0,
  playerCount: 0,
  lastActive: 0,
  createdAt: 0,
});

// ── Teleport links (/w/<worldId>) ────────────────────────────────────

/**
 * Parse a teleport link path: `/w/<worldId>`.
 * This is a permanent public format (printed on NFC cards).
 *
 * Every link lands the player **inside** its world, like opening a game pack
 * (Alex, 2026-10-13). The only exception is Origin, which has no interior, so
 * its link arrives at the portal. Older links may carry `?a=in`; any query
 * string is ignored.
 *
 * - `null`: not a teleport link (any other path).
 * - `{ worldId: null }`: looks like a link but the ID is malformed.
 */
export function parseTeleportLink(pathname: string): { worldId: string | null } | null {
  const m = pathname.match(/^\/w\/([^/]*)\/?$/);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]).toLowerCase();
  } catch {
    id = ""; // malformed %-encoding
  }
  return { worldId: isWorldId(id) ? id : null };
}

/**
 * Parse a WebSocket URL path into room routing info.
 */
export function parseRoomPath(url: string): { type: RoomType; id: string; sectors?: string[] } | null {
  // /universe?sectors=0:0:0,1:0:0
  if (url.startsWith("/universe")) {
    const params = new URL(url, "http://localhost").searchParams;
    const sectorsParam = params.get("sectors");
    const sectors = sectorsParam ? sectorsParam.split(",") : [];
    return { type: "universe", id: "universe", sectors };
  }

  // /world/{worldId}
  const worldMatch = url.match(/^\/world\/([a-zA-Z0-9_-]+)/);
  if (worldMatch) {
    return { type: "world", id: worldMatch[1] };
  }

  return null;
}
