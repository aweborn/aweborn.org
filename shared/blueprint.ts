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

/** What the planner writes. */
export interface BlueprintDraft {
  name: string;
  style: { artDirection: string; palette: string[]; lighting: string; timeOfDay?: string };
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
/** Placeholder prices until each provider is wired; model = Meshy preview / preview+refine. */
export const ASSET_MANA: Record<AssetKind, { quick: number; full: number }> = {
  model: { quick: 40, full: 60 },
  "terrain-piece": { quick: 40, full: 60 },
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
export const LIMITS = { assets: 24, features: 32, blocks: 12, palette: 8, chips: 3, grid: 40, prompt: 400 } as const;

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
  const G = LIMITS.grid;
  const size = vec(tr.size, 4, G) ?? [32, 16, 32];
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
      at: vec(f.at, 0, G) ?? [size[0] / 2, 0, size[2] / 2],
      radius: num(f.radius, 1, G / 2, 4),
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
      at: vec(a.at, -G, G), size: vec(a.size, 0.1, 20),
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
  if (isObj(raw.physics)) {
    const p = raw.physics;
    draft.physics = {};
    if (p.gravity !== undefined) draft.physics.gravity = num(p.gravity, 0, 40, 20);
    if (p.friction !== undefined) draft.physics.friction = num(p.friction, 0, 1, 0.5);
    if (p.waterLevel !== undefined) draft.physics.waterLevel = num(p.waterLevel, 0, G, 0);
  }
  return { ok: true, value: draft, warnings };
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
