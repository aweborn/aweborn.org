/**
 * Aweborn — World Y.Doc Factory
 *
 * Creates new World Y.Docs with the schema defined in ROADMAP.md.
 * Each world is its own Y.Doc containing meta, physics, objects,
 * terrain, and chat sub-maps.
 */

import * as Y from "yjs";
import type { WorldEntry } from "../../../shared/crdt-schema.js";
import { DEFAULT_PHYSICS } from "../../../shared/crdt-schema.js";

/**
 * Create a new World Y.Doc initialized with default structure.
 */
export function createWorldDoc(entry: WorldEntry): Y.Doc {
  const doc = new Y.Doc();

  doc.transact(() => {
    // ── Meta ──
    const meta = doc.getMap("meta");
    meta.set("name", entry.name);
    meta.set("creator", entry.creator);
    meta.set("createdAt", entry.createdAt);
    meta.set("color", entry.color);
    meta.set("solidified", entry.solidified);

    // ── Physics (Earth-like defaults) ──
    const physics = doc.getMap("physics");
    for (const [key, value] of Object.entries(DEFAULT_PHYSICS)) {
      physics.set(key, value);
    }

    // ── Objects (empty, ready for placement) ──
    doc.getMap("objects");

    // ── Terrain ──
    const terrain = doc.getMap("terrain");
    terrain.set("seed", Math.floor(Math.random() * 2_147_483_647));
    // modifications will be added as a nested Y.Map

    // ── Chat ──
    doc.getArray("chat");
  });

  return doc;
}
