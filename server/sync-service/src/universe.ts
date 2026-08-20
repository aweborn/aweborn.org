/**
 * Aweborn — Universe CRDT Manager
 *
 * Manages the Universe Y.Doc — the "star map" that holds metadata for
 * every world in the game. This is Layer 1 of the two-layer CRDT
 * architecture described in ROADMAP.md.
 *
 * The Universe doc is always in memory while the server is running.
 */

import * as Y from "yjs";
import type {
  WorldEntry,
  Vec3,
  ManaState,
} from "../../../shared/crdt-schema.js";
import {
  positionToSector,
  sectorKey,
} from "../../../shared/crdt-schema.js";
import { loadDoc, saveDoc } from "./persistence.js";

const UNIVERSE_DOC_ID = "__universe__";

/**
 * Initialize (or restore) the Universe Y.Doc.
 * Loads from SQLite if a saved state exists.
 */
export function initUniverseDoc(): Y.Doc {
  const doc = new Y.Doc();
  const saved = loadDoc(UNIVERSE_DOC_ID);
  if (saved) {
    Y.applyUpdate(doc, saved);
    console.log("[universe] restored universe doc from database");
  } else {
    // Initialize default mana state
    const mana = doc.getMap("mana");
    doc.transact(() => {
      mana.set("pool", 1_000_000);
      mana.set("frontierRadius", 5000);
      mana.set("totalEverGenerated", 1_000_000);
      mana.set("totalEverSpent", 0);
      mana.set("regenRate", 100);
      mana.set("donationMultiplier", 1.0);
      mana.set("lastDonationAt", 0);
    });
    console.log("[universe] created new universe doc with default mana state");
  }

  return doc;
}

/**
 * Save the Universe doc to SQLite.
 */
export function flushUniverseDoc(doc: Y.Doc): void {
  const state = Y.encodeStateAsUpdate(doc);
  saveDoc(UNIVERSE_DOC_ID, state, "universe");
}

/**
 * Add a new world entry to the Universe CRDT.
 * Called when a player creates a world.
 */
export function addWorldToUniverse(doc: Y.Doc, entry: WorldEntry): void {
  const worlds = doc.getMap("worlds");
  doc.transact(() => {
    const worldMap = new Y.Map();
    // Set all fields on the nested map
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value === "object" && value !== null) {
        // Vec3 fields — flatten into the map
        const obj = value as Record<string, number>;
        for (const [subKey, subValue] of Object.entries(obj)) {
          worldMap.set(`${key}.${subKey}`, subValue);
        }
      } else {
        worldMap.set(key, value);
      }
    }
    worlds.set(entry.id, worldMap);
  });
  console.log(`[universe] added world "${entry.name}" (${entry.id}) to sector ${entry.sector}`);
}

/**
 * Read a world entry from the Universe CRDT.
 */
export function getWorldEntry(doc: Y.Doc, worldId: string): WorldEntry | null {
  const worlds = doc.getMap("worlds");
  const worldMap = worlds.get(worldId) as Y.Map<unknown> | undefined;
  if (!worldMap) return null;
  return ymapToWorldEntry(worldMap);
}

/**
 * Get all world entries from the Universe CRDT.
 */
export function getAllWorldEntries(doc: Y.Doc): WorldEntry[] {
  const worlds = doc.getMap("worlds");
  const entries: WorldEntry[] = [];
  worlds.forEach((value) => {
    const worldMap = value as Y.Map<unknown>;
    entries.push(ymapToWorldEntry(worldMap));
  });
  return entries;
}

/**
 * Get worlds in a specific sector.
 */
export function getWorldsBySector(doc: Y.Doc, sector: string): WorldEntry[] {
  return getAllWorldEntries(doc).filter((w) => w.sector === sector);
}

/**
 * Update the resolved position for a world (server-authoritative).
 */
export function updateResolvedPosition(
  doc: Y.Doc,
  worldId: string,
  resolvedPosition: Vec3
): void {
  const worlds = doc.getMap("worlds");
  const worldMap = worlds.get(worldId) as Y.Map<unknown> | undefined;
  if (!worldMap) return;

  const newSector = sectorKey(positionToSector(resolvedPosition));

  doc.transact(() => {
    worldMap.set("resolvedPosition.x", resolvedPosition.x);
    worldMap.set("resolvedPosition.y", resolvedPosition.y);
    worldMap.set("resolvedPosition.z", resolvedPosition.z);
    worldMap.set("resolvedAt", Date.now());
    worldMap.set("sector", newSector);
  });
}

/**
 * Update the ephemeral player count for a world.
 */
export function updatePlayerCount(doc: Y.Doc, worldId: string, count: number): void {
  const worlds = doc.getMap("worlds");
  const worldMap = worlds.get(worldId) as Y.Map<unknown> | undefined;
  if (!worldMap) return;

  doc.transact(() => {
    worldMap.set("playerCount", count);
    worldMap.set("lastActive", Date.now());
  });
}

/**
 * Read the mana state from the Universe CRDT.
 */
export function getManaState(doc: Y.Doc): ManaState {
  const mana = doc.getMap("mana");
  return {
    pool: (mana.get("pool") as number) ?? 0,
    frontierRadius: (mana.get("frontierRadius") as number) ?? 0,
    totalEverGenerated: (mana.get("totalEverGenerated") as number) ?? 0,
    totalEverSpent: (mana.get("totalEverSpent") as number) ?? 0,
    regenRate: (mana.get("regenRate") as number) ?? 100,
    donationMultiplier: (mana.get("donationMultiplier") as number) ?? 1.0,
    lastDonationAt: (mana.get("lastDonationAt") as number) ?? 0,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Convert a Y.Map (flat key structure with dotted Vec3 keys) back to a WorldEntry.
 */
function ymapToWorldEntry(m: Y.Map<unknown>): WorldEntry {
  return {
    id: m.get("id") as string,
    name: m.get("name") as string,
    creator: m.get("creator") as string,
    intendedPosition: {
      x: m.get("intendedPosition.x") as number,
      y: m.get("intendedPosition.y") as number,
      z: m.get("intendedPosition.z") as number,
    },
    resolvedPosition: {
      x: m.get("resolvedPosition.x") as number,
      y: m.get("resolvedPosition.y") as number,
      z: m.get("resolvedPosition.z") as number,
    },
    resolvedAt: m.get("resolvedAt") as number,
    color: m.get("color") as string,
    sector: m.get("sector") as string,
    solidified: m.get("solidified") as boolean,
    solidifiedAt: m.get("solidifiedAt") as number,
    playerCount: m.get("playerCount") as number,
    lastActive: m.get("lastActive") as number,
    createdAt: m.get("createdAt") as number,
  };
}
