/**
 * Built-in Library (Phase 07): blocks and basic shapes anyone can place in any
 * world, free and offline. Nothing here touches the server: placing one just
 * writes an object into the World CRDT, like placing any other model.
 *
 * Blocks echo terrain blocks (each world also offers its own, from its
 * blueprint); shapes are the small colorable primitives (cube, ring, cone …).
 */

export interface LibraryBlock { id: string; name: string; color: string }

/** Starter blocks every world has, whatever its terrain. */
export const STANDARD_BLOCKS: readonly LibraryBlock[] = [
  { id: "stone", name: "Stone", color: "#8a8f98" },
  { id: "dirt", name: "Dirt", color: "#7a5230" },
  { id: "grass", name: "Grass", color: "#4f9d3a" },
  { id: "sand", name: "Sand", color: "#e3cf8f" },
  { id: "wood", name: "Wood", color: "#a9743f" },
  { id: "brick", name: "Brick", color: "#b04a3a" },
  { id: "snow", name: "Snow", color: "#f2f6fa" },
  { id: "glass", name: "Glass", color: "#9fd8e8" },
  { id: "obsidian", name: "Obsidian", color: "#2a2433" },
  { id: "gold", name: "Gold", color: "#e6b422" },
];

/** Placeable shapes. `id` is the object `type` stored in the CRDT (and the renderer's geometry key). */
export const SHAPES: readonly { id: string; name: string }[] = [
  { id: "cube", name: "Cube" },
  { id: "sphere", name: "Sphere" },
  { id: "cylinder", name: "Cylinder" },
  { id: "cone", name: "Cone" },
  { id: "pyramid", name: "Pyramid" },
  { id: "torus", name: "Ring" },
];

/** Quick color picks beside the full color picker. */
export const SHAPE_COLORS: readonly string[] = [
  "#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#38d9a9", "#4dabf7", "#9775fa", "#f783ac", "#f1f3f5", "#495057",
];

export const SHAPE_SIZE = { min: 0.5, max: 8, step: 0.5, start: 1.5 } as const;

/** `#rgb` / `#rrggbb` only (the color goes into a shared document, so never trust it blindly). */
export function cleanColor(c: unknown, fallback = "#cccccc"): string {
  return typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c.toLowerCase() : fallback;
}

/**
 * Snap a world coordinate to the center of the terrain's unit cell, so blocks
 * sit exactly where terrain blocks would. Cell centers are at i - size/2 + 0.5:
 * on the half-meter for even world sizes, on the whole meter for odd ones.
 */
export function snapToCell(v: number, worldSize: number): number {
  return worldSize % 2 === 0 ? Math.floor(v) + 0.5 : Math.round(v);
}

/** Lowest free center height at/above `y` in the column (x, z), stacking on blocks already placed there. */
export function stackedY(
  y: number,
  x: number,
  z: number,
  placed: Iterable<{ type: string; x: number; y: number; z: number }>,
): number {
  const blocks = [...placed].filter((o) => o.type === "block" && Math.abs(o.x - x) < 0.5 && Math.abs(o.z - z) < 0.5);
  let cy = y;
  for (let i = 0; i < 64 && blocks.some((o) => Math.abs(o.y - cy) < 0.9); i++) cy += 1;
  return cy;
}
