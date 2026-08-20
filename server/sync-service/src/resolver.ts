/**
 * Aweborn — Deterministic Spatial Resolver
 *
 * Ensures worlds don't overlap by nudging conflicting positions outward.
 * The server runs this whenever a new world is created.
 *
 * Algorithm (from ROADMAP.md):
 * 1. Sort worlds by creation timestamp (stable ordering)
 * 2. For each world, check distance to all previously placed worlds
 * 3. If too close (< MIN_WORLD_DISTANCE), nudge outward
 * 4. Write resolvedPosition back to Universe CRDT
 */

import type { Vec3, WorldEntry } from "../../../shared/crdt-schema.js";
import { MIN_WORLD_DISTANCE } from "../../../shared/crdt-schema.js";

/**
 * Resolve positions for a set of world entries, ensuring no two worlds
 * are closer than MIN_WORLD_DISTANCE.
 *
 * Returns an array of { id, resolvedPosition } for worlds that were nudged.
 * Worlds already at valid positions are unchanged.
 */
export function resolvePositions(
  worlds: WorldEntry[]
): Array<{ id: string; resolvedPosition: Vec3 }> {
  // Sort by creation time (stable — earlier worlds keep their position)
  const sorted = [...worlds].sort((a, b) => a.createdAt - b.createdAt);

  // Track resolved positions (already-placed worlds)
  const placed: Array<{ id: string; pos: Vec3 }> = [];
  const updates: Array<{ id: string; resolvedPosition: Vec3 }> = [];

  for (const world of sorted) {
    // Start from the intended position (or current resolved if already resolved)
    let pos: Vec3 = {
      x: world.resolvedPosition.x || world.intendedPosition.x,
      y: world.resolvedPosition.y || world.intendedPosition.y,
      z: world.resolvedPosition.z || world.intendedPosition.z,
    };

    // Check against all previously placed worlds
    let nudged = false;
    let iterations = 0;
    const maxIterations = 50; // Safety valve

    while (iterations < maxIterations) {
      let conflict = false;

      for (const other of placed) {
        const dist = distance(pos, other.pos);

        if (dist < MIN_WORLD_DISTANCE) {
          // Nudge outward along the vector from the conflicting world
          const dir = normalize(subtract(pos, other.pos));

          // If positions are identical, use a deterministic fallback direction
          // based on the world id hash to avoid zero-vector
          if (dir.x === 0 && dir.y === 0 && dir.z === 0) {
            const hash = simpleHash(world.id);
            dir.x = Math.cos(hash);
            dir.y = 0;
            dir.z = Math.sin(hash);
          }

          const nudgeDistance = MIN_WORLD_DISTANCE - dist + 1; // +1 for margin
          pos = add(pos, scale(dir, nudgeDistance));
          conflict = true;
          nudged = true;
          break; // Re-check all after nudging
        }
      }

      if (!conflict) break;
      iterations++;
    }

    if (nudged) {
      updates.push({ id: world.id, resolvedPosition: pos });
    } else if (
      pos.x !== world.resolvedPosition.x ||
      pos.y !== world.resolvedPosition.y ||
      pos.z !== world.resolvedPosition.z
    ) {
      // First resolution (intended → resolved)
      updates.push({ id: world.id, resolvedPosition: pos });
    }

    placed.push({ id: world.id, pos });
  }

  return updates;
}

/**
 * Resolve a single new world against existing worlds.
 * More efficient than re-resolving everything — used for incremental adds.
 */
export function resolveNewWorld(
  existingWorlds: WorldEntry[],
  newWorld: WorldEntry
): Vec3 {
  let pos: Vec3 = { ...newWorld.intendedPosition };
  let iterations = 0;
  const maxIterations = 50;

  while (iterations < maxIterations) {
    let conflict = false;

    for (const other of existingWorlds) {
      const otherPos = other.resolvedPosition.x !== 0 || other.resolvedPosition.y !== 0 || other.resolvedPosition.z !== 0
        ? other.resolvedPosition
        : other.intendedPosition;

      const dist = distance(pos, otherPos);

      if (dist < MIN_WORLD_DISTANCE) {
        let dir = normalize(subtract(pos, otherPos));

        if (dir.x === 0 && dir.y === 0 && dir.z === 0) {
          const hash = simpleHash(newWorld.id);
          dir = { x: Math.cos(hash), y: 0, z: Math.sin(hash) };
        }

        const nudgeDistance = MIN_WORLD_DISTANCE - dist + 1;
        pos = add(pos, scale(dir, nudgeDistance));
        conflict = true;
        break;
      }
    }

    if (!conflict) break;
    iterations++;
  }

  return pos;
}

// ── Vector math helpers ──────────────────────────────────────────────

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Simple deterministic hash for a string → number in [0, 2π).
 * Used as fallback direction when two worlds have identical positions.
 */
function simpleHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}
