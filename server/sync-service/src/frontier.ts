/**
 * Aweborn — Living Frontier (Phase 05)
 *
 * The Frontier is a sphere around Origin whose radius follows the high-water
 * line (`frontierRadiusFor` in shared/crdt-schema.ts). Inside it worlds are
 * solid; outside they are Ghosts on the universe map (only a look: Ghost
 * worlds are fully playable). The Frontier is the only way a Ghost becomes
 * solid. It never contracts, and a world never goes
 * back to Ghost (ROADMAP → The Ever-Expanding Universe).
 *
 * The server is the only writer of `solidified` / `solidifiedAt`. Clients
 * play the golden wave and hold freshly solidified worlds as Ghosts until
 * the wave front reaches them (src/components/SolidificationWave.tsx).
 */

import * as Y from "yjs";
import type { Vec3 } from "../../../shared/crdt-schema.js";
import { ORIGIN_WORLD_ID } from "../../../shared/crdt-schema.js";

/** Distance from Origin (the portal sits at 0,0,0). */
export function distanceFromOrigin(p: Vec3): number {
  return Math.hypot(p.x, p.y, p.z);
}

/** Is this position inside a Frontier of the given radius? */
export function insideFrontier(p: Vec3, radius: number): boolean {
  return radius > 0 && distanceFromOrigin(p) <= radius;
}

/**
 * Solidify every Ghost world inside the Frontier. Idempotent; never
 * un-solidifies. Returns the ids it changed, so the caller can update the
 * worlds' own docs too.
 */
export function solidifyWithinFrontier(doc: Y.Doc, radius: number, at: number = Date.now()): string[] {
  if (!(radius > 0)) return [];
  const worlds = doc.getMap("worlds");
  const changed: string[] = [];
  doc.transact(() => {
    worlds.forEach((value, id) => {
      if (id === ORIGIN_WORLD_ID) return;
      const m = value as Y.Map<unknown>;
      if (m.get("solidified") === true) return;
      const p = {
        x: (m.get("resolvedPosition.x") as number) ?? 0,
        y: (m.get("resolvedPosition.y") as number) ?? 0,
        z: (m.get("resolvedPosition.z") as number) ?? 0,
      };
      if (!insideFrontier(p, radius)) return;
      m.set("solidified", true);
      m.set("solidifiedAt", at);
      changed.push(id);
    });
  }, "frontier");
  return changed;
}
