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

  /** false = Ghost (outside Living Frontier or awaiting solidification). */
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
 * Universe-level mana pool state.
 * Stored in Y.Map("mana") on the Universe CRDT.
 */
export interface ManaState {
  pool: number;
  frontierRadius: number;
  totalEverGenerated: number;
  totalEverSpent: number;
  regenRate: number;
  donationMultiplier: number;
  lastDonationAt: number;
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
