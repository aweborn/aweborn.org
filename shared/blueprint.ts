/**
 * Blueprint (Phase 07): the world planner's structured plan for a creation.
 *
 * The planner (an LLM) writes the creative parts; the server adds identity
 * (id, version, worldId) and the estimate from the cost table. Planner output
 * is never trusted: `parsePlannerTurn` validates and clamps it, and anything
 * it can't repair is reported as an error so the turn can be retried.
 *
 * Hand-written instead of Zod so the client can import it with no extra deps.
 */

export const ASSET_KINDS = ["model", "terrain-piece", "texture", "music", "ambience", "voice", "sfx"] as const;
export const FEATURE_TYPES = ["plateau", "hill", "pond", "path", "cliff", "floating-island"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export type FeatureType = (typeof FEATURE_TYPES)[number];
export type Vec3 = [number, number, number];

export interface BlueprintBlock { id: string; name: string; color: string; surface?: "blocks" | "smooth" }
export interface BlueprintFeature { type: FeatureType; at: Vec3; radius: number; height?: number; block: string }
export interface BlueprintAsset {
  key: string;
  kind: AssetKind;
  prompt: string;
  quality: "quick" | "full";
  at?: Vec3;
  size?: Vec3;
  rotationY?: number;
}

/** Light and sky: what a world looks like from inside. Fog fades to the horizon color. */
export interface BlueprintSky {
  zenith: string;
  horizon: string;
  /** Meters at which the distance has fully faded into the horizon (clamped to what the device draws). */
  fog: number;
  sun: { color: string; intensity: number; dir: Vec3 };
  ambient: { color: string; intensity: number };
}

/** Gentle daylight; used when a blueprint doesn't say (every blueprint from before sky existed). */
export const DEFAULT_SKY: BlueprintSky = {
  zenith: "#4a6fb0",
  horizon: "#d5deef",
  fog: 200,
  sun: { color: "#fff1d6", intensity: 1.3, dir: [0.4, 0.8, 0.3] },
  ambient: { color: "#a9b6d9", intensity: 0.6 },
};

/** What the planner writes. */
export interface BlueprintDraft {
  name: string;
  style: { artDirection: string; palette: string[]; lighting: string; timeOfDay?: string };
  sky?: BlueprintSky;
  terrain: { kind: "voxel"; size: Vec3; seed: number; blocks: BlueprintBlock[]; features: BlueprintFeature[] };
  assets: BlueprintAsset[];
  lore?: { name: string; text: string };
  physics?: Partial<{ gravity: number; friction: number; waterLevel: number }>;
}

export interface Estimate { items: { key: string; mana: number }[]; planner: number; total: number }

export interface Blueprint extends BlueprintDraft {
  id: string;        // stable across versions
  version: number;   // every planner turn or direct edit bumps it
  worldId: string;
  estimate: Estimate;
}

/** One planner answer: a short reply, 2–3 chips, and the next draft. */
export interface PlannerTurn { reply: string; chips: string[]; blueprint: BlueprintDraft }

// ── Cost table (mana; K = 100 mana per USD, Phase 05) ─────────────────
/** Placeholder prices until each provider is wired; model = Meshy preview + texture refine ($0.60). */
export const ASSET_MANA: Record<AssetKind, { quick: number; full: number }> = {
  model: { quick: 60, full: 60 },
  "terrain-piece": { quick: 60, full: 60 },
  texture: { quick: 10, full: 20 },
  music: { quick: 30, full: 30 },
  ambience: { quick: 20, full: 20 },
  voice: { quick: 10, full: 10 },
  sfx: { quick: 5, full: 5 },
};

export function estimate(d: BlueprintDraft, plannerMana: number): Estimate {
  const items = d.assets.map((a) => ({ key: a.key, mana: ASSET_MANA[a.kind][a.quality] }));
  return { items, planner: plannerMana, total: plannerMana + items.reduce((s, i) => s + i.mana, 0) };
}

// ── Validation ─────────────────────────────────────────────────────────
/** `grid` caps heights/altitudes (cells); `world` caps the x/z footprint (default 320: ~100x the old 32x32 area). */
export const LIMITS = { assets: 24, features: 32, blocks: 12, palette: 8, chips: 3, grid: 40, world: 320, prompt: 400 } as const;
/** Default world: footprint x height x footprint, in cells (1 cell = 1 m). */
export const DEFAULT_WORLD_SIZE: Vec3 = [LIMITS.world, 16, LIMITS.world];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
const HEX = /^#[0-9a-fA-F]{6}$/;
const color = (v: unknown, dflt: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : dflt);
const slug = (v: unknown) => str(v, 40).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
function vec(v: unknown, lo: number, hi: number): Vec3 | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined;
  return [num(v[0], lo, hi, 0), num(v[1], lo, hi, 0), num(v[2], lo, hi, 0)];
}
/** Per-axis clamp: x/z get the world footprint range, y the height range. */
function vecXYZ(v: unknown, lo: Vec3, hi: Vec3): Vec3 | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined;
  return [num(v[0], lo[0], hi[0], lo[0]), num(v[1], lo[1], hi[1], lo[1]), num(v[2], lo[2], hi[2], lo[2])];
}
const oneOf = <T extends string>(v: unknown, opts: readonly T[]): T | undefined =>
  opts.includes(v as T) ? (v as T) : undefined;

export type Parsed<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[] };

export function parseDraft(raw: unknown): Parsed<BlueprintDraft> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["blueprint must be an object"] };

  const st = isObj(raw.style) ? raw.style : {};
  const artDirection = str(st.artDirection, 300);
  if (!artDirection) errors.push("style.artDirection is required");
  const palette = (Array.isArray(st.palette) ? st.palette : []).map((c) => color(c, "")).filter(Boolean).slice(0, LIMITS.palette);

  const tr = isObj(raw.terrain) ? raw.terrain : {};
  const G = LIMITS.grid, W = LIMITS.world;
  const size = vecXYZ(tr.size, [4, 4, 4], [W, G, W]) ?? DEFAULT_WORLD_SIZE;
  const blocks: BlueprintBlock[] = [];
  for (const b of Array.isArray(tr.blocks) ? tr.blocks.slice(0, LIMITS.blocks) : []) {
    if (!isObj(b)) continue;
    const id = slug(b.id);
    if (!id || blocks.some((x) => x.id === id)) continue;
    blocks.push({ id, name: str(b.name, 40) || id, color: color(b.color, "#888888"), surface: oneOf(b.surface, ["blocks", "smooth"] as const) });
  }
  if (!blocks.length) errors.push("terrain.blocks needs at least one block");
  const features: BlueprintFeature[] = [];
  for (const f of Array.isArray(tr.features) ? tr.features.slice(0, LIMITS.features) : []) {
    if (!isObj(f)) continue;
    const type = oneOf(f.type, FEATURE_TYPES);
    const block = slug(f.block);
    if (!type) { warnings.push(`dropped feature with unknown type ${String(f.type)}`); continue; }
    if (!blocks.some((b) => b.id === block)) { warnings.push(`dropped ${type}: unknown block ${block}`); continue; }
    features.push({
      type, block,
      at: vecXYZ(f.at, [0, 0, 0], [W, G, W]) ?? [size[0] / 2, 0, size[2] / 2],
      radius: num(f.radius, 1, W / 8, 4),
      height: f.height === undefined ? undefined : num(f.height, 0, G, 4),
    });
  }

  const assets: BlueprintAsset[] = [];
  for (const a of Array.isArray(raw.assets) ? raw.assets : []) {
    if (assets.length >= LIMITS.assets) { warnings.push(`kept the first ${LIMITS.assets} assets`); break; }
    if (!isObj(a)) continue;
    const kind = oneOf(a.kind, ASSET_KINDS);
    const prompt = str(a.prompt, LIMITS.prompt);
    let key = slug(a.key) || slug(prompt).slice(0, 24) || `item-${assets.length + 1}`;
    while (assets.some((x) => x.key === key)) key += "-2";
    if (!kind || !prompt) { warnings.push(`dropped asset ${key}: needs kind and prompt`); continue; }
    assets.push({
      key, kind, prompt,
      quality: oneOf(a.quality, ["quick", "full"] as const) ?? "quick",
      at: vecXYZ(a.at, [0, -G, 0], [W, G, W]), size: vec(a.size, 0.1, 20),
      rotationY: a.rotationY === undefined ? undefined : num(a.rotationY, -Math.PI * 2, Math.PI * 2, 0),
    });
  }

  if (errors.length) return { ok: false, errors };
  const draft: BlueprintDraft = {
    name: str(raw.name, 60) || "Untitled",
    style: { artDirection, palette, lighting: str(st.lighting, 120), timeOfDay: str(st.timeOfDay, 40) || undefined },
    terrain: { kind: "voxel", size, seed: Math.trunc(num(tr.seed, 0, 2 ** 31 - 1, 1)), blocks, features },
    assets,
  };
  if (isObj(raw.lore) && str(raw.lore.text, 1)) draft.lore = { name: str(raw.lore.name, 60), text: str(raw.lore.text, 800) };
  if (isObj(raw.sky)) {
    const k = raw.sky, sun = isObj(k.sun) ? k.sun : {}, amb = isObj(k.ambient) ? k.ambient : {};
    const D = DEFAULT_SKY;
    draft.sky = {
      zenith: color(k.zenith, D.zenith),
      horizon: color(k.horizon, D.horizon),
      fog: num(k.fog, 40, 400, D.fog),
      sun: {
        color: color(sun.color, D.sun.color),
        intensity: num(sun.intensity, 0, 3, D.sun.intensity),
        // Direction the light comes FROM; keep it above the horizon so the ground is always lit
        dir: vecXYZ(sun.dir, [-1, 0.15, -1], [1, 1, 1]) ?? D.sun.dir,
      },
      ambient: { color: color(amb.color, D.ambient.color), intensity: num(amb.intensity, 0, 1.5, D.ambient.intensity) },
    };
  }
  if (isObj(raw.physics)) {
    const p = raw.physics;
    draft.physics = {};
    if (p.gravity !== undefined) draft.physics.gravity = num(p.gravity, 0, 40, 20);
    if (p.friction !== undefined) draft.physics.friction = num(p.friction, 0, 1, 0.5);
    if (p.waterLevel !== undefined) draft.physics.waterLevel = num(p.waterLevel, 0, G, 0);
  }
  return { ok: true, value: draft, warnings };
}

// ── Direct edits (no planner call) ─────────────────────────────────────
/** One hand edit to a draft. Text ops (prompt, rename) are safety-checked by the server before they're kept. */
export type BlueprintEdit =
  | { op: "remove"; key: string }
  | { op: "prompt"; key: string; prompt: string }
  | { op: "size"; key: string; factor: number }
  | { op: "rename"; name: string };

/** Size an asset gets when the planner didn't give one (meters; matches where the client places it). */
export const DEFAULT_ASSET_SIZE: Vec3 = [1.5, 1.5, 1.5];

/** Validate an untrusted edit op. */
export function parseEdit(raw: unknown): Parsed<BlueprintEdit> {
  if (!isObj(raw)) return { ok: false, errors: ["edit must be an object"] };
  const key = slug(raw.key);
  switch (raw.op) {
    case "remove":
      return key ? { ok: true, value: { op: "remove", key }, warnings: [] } : { ok: false, errors: ["key is required"] };
    case "prompt": {
      const prompt = str(raw.prompt, LIMITS.prompt);
      if (!key || !prompt) return { ok: false, errors: ["key and prompt are required"] };
      return { ok: true, value: { op: "prompt", key, prompt }, warnings: [] };
    }
    case "size": {
      if (!key || typeof raw.factor !== "number" || !Number.isFinite(raw.factor) || raw.factor <= 0) return { ok: false, errors: ["key and a positive factor are required"] };
      return { ok: true, value: { op: "size", key, factor: Math.min(4, Math.max(0.25, raw.factor)) }, warnings: [] };
    }
    case "rename": {
      const name = str(raw.name, 60);
      return name ? { ok: true, value: { op: "rename", name }, warnings: [] } : { ok: false, errors: ["name is required"] };
    }
    default:
      return { ok: false, errors: [`unknown op ${String(raw.op)}`] };
  }
}

/** Apply one edit; returns a new draft (the input is never mutated). Unknown keys are errors, sizes stay within 0.1–20 m. */
export function applyEdit<T extends BlueprintDraft>(draft: T, edit: BlueprintEdit): Parsed<T> {
  if (edit.op === "rename") return { ok: true, value: { ...draft, name: edit.name }, warnings: [] };
  const i = draft.assets.findIndex((a) => a.key === edit.key);
  if (i < 0) return { ok: false, errors: [`no asset ${edit.key}`] };
  const assets = draft.assets.slice();
  const a = assets[i];
  const warnings: string[] = [];
  if (edit.op === "remove") assets.splice(i, 1);
  else if (edit.op === "prompt") assets[i] = { ...a, prompt: edit.prompt };
  else {
    const s = a.size ?? DEFAULT_ASSET_SIZE;
    const next = s.map((v) => Math.round(Math.min(20, Math.max(0.1, v * edit.factor)) * 100) / 100) as Vec3;
    if (next.every((v, j) => v === s[j])) warnings.push(`${a.key} is already as ${edit.factor > 1 ? "big" : "small"} as it gets`);
    assets[i] = { ...a, size: next };
  }
  return { ok: true, value: { ...draft, assets }, warnings };
}

export function parsePlannerTurn(raw: unknown): Parsed<PlannerTurn> {
  if (!isObj(raw)) return { ok: false, errors: ["answer must be a JSON object"] };
  const reply = str(raw.reply, 600);
  const bp = parseDraft(raw.blueprint);
  const errors = [...(reply ? [] : ["reply is required"]), ...(bp.ok ? [] : bp.errors)];
  if (!bp.ok || errors.length) return { ok: false, errors };
  const chips = (Array.isArray(raw.chips) ? raw.chips : []).map((c) => str(c, 40)).filter(Boolean).slice(0, LIMITS.chips);
  return { ok: true, value: { reply, chips, blueprint: bp.value }, warnings: bp.warnings };
}
