/**
 * One growing plan per world (Alex, 2026-11-08). Every planner conversation in a
 * world reads and extends the same world plan, and the planner sees everything the
 * world already holds, anonymously.
 *
 * A world plan has two layers:
 *   - made (locked): assets already placed in the world (an object carries its
 *     `planKey` = `${planId}:${key}`) and terrain features already written into
 *     the world's ground. The planner sees them as the world; nothing removes them.
 *   - planned (editable): assets and features not made yet. Each turn rewrites
 *     only this layer.
 *
 * Plans only add. Taking something out is an undo (History → Restore), and even an
 * undo never removes what someone else added in the meantime.
 *
 * Pure (no I/O) so the server, client and tests share it.
 */
import {
  ensureWorldMusic,
  type BlueprintAsset, type BlueprintBlock, type BlueprintDraft, type BlueprintFeature,
} from "./blueprint.js";

export const WORLD_PLAN_LIMITS = {
  /** Assets one world plan holds, made + planned (each turn still writes at most LIMITS.assets). */
  assets: 240,
  /** Terrain features a world's ground keeps. */
  features: 96,
  /** Materials a world's ground keeps. */
  blocks: 24,
  /** Things in the world listed for the planner (the rest are counted). */
  contextObjects: 80,
  /** Lines of earlier conversations shown to the planner (newest kept). */
  historyLines: 40,
  /** Characters per conversation line. */
  historyChars: 280,
} as const;

type Terrain = BlueprintDraft["terrain"];

/** What the world holds right now (read from its doc). */
export interface WorldNow {
  /** The ground written into the world, or null if none yet. */
  terrain: Terrain | null;
  /** `planKey`s of objects placed in the world. */
  placedKeys: ReadonlySet<string>;
}

export const featureKey = (f: BlueprintFeature): string =>
  JSON.stringify([f.type, f.at, f.radius, f.height ?? null, f.block]);

const isMade = (planId: string, world: WorldNow) => (a: BlueprintAsset) => world.placedKeys.has(`${planId}:${a.key}`);

/**
 * The planner's editable view: everything planned but not made yet. Made assets
 * and features already in the ground are left out (they're shown as the world).
 */
export function editableLayer(
  plan: BlueprintDraft, planId: string, world: WorldNow,
  owner?: { asset: (key: string) => Owner; feature: (featureKey: string) => Owner },
): BlueprintDraft {
  const made = isMade(planId, world);
  const applied = new Set((world.terrain?.features ?? []).map(featureKey));
  return {
    ...plan,
    terrain: { ...plan.terrain, features: plan.terrain.features.filter((f) => !applied.has(featureKey(f)) && owner?.feature(featureKey(f)) !== "other") },
    // The world's music is everyone's: always editable
    assets: plan.assets.filter((a) => !made(a) && (a.kind === "music" || owner?.asset(a.key) !== "other")),
  };
}

/** Planned (not made) items someone else added: shown to the planner read-only. */
export function othersPlanned(
  plan: BlueprintDraft, planId: string, world: WorldNow,
  owner: { asset: (key: string) => Owner; feature: (featureKey: string) => Owner },
): { assets: BlueprintAsset[]; features: BlueprintFeature[] } {
  const made = isMade(planId, world);
  const applied = new Set((world.terrain?.features ?? []).map(featureKey));
  return {
    assets: plan.assets.filter((a) => !made(a) && a.kind !== "music" && owner.asset(a.key) === "other"),
    features: plan.terrain.features.filter((f) => !applied.has(featureKey(f)) && owner.feature(featureKey(f)) === "other"),
  };
}

/** Assets of the plan that are already placed in the world. */
export function madeAssets(plan: BlueprintDraft | null, planId: string, world: WorldNow): BlueprintAsset[] {
  return plan ? plan.assets.filter(isMade(planId, world)) : [];
}

function uniqueFeatures(lists: BlueprintFeature[][], blocks: readonly BlueprintBlock[]): BlueprintFeature[] {
  const ids = new Set(blocks.map((b) => b.id));
  const seen = new Set<string>();
  const out: BlueprintFeature[] = [];
  for (const list of lists) {
    for (const f of list) {
      const k = featureKey(f);
      if (seen.has(k) || !ids.has(f.block)) continue;
      seen.add(k);
      out.push(f);
    }
  }
  return out.slice(0, WORLD_PLAN_LIMITS.features);
}

function unionBlocks(...lists: (readonly BlueprintBlock[] | undefined)[]): BlueprintBlock[] {
  const out: BlueprintBlock[] = [];
  for (const list of lists) for (const b of list ?? []) if (!out.some((x) => x.id === b.id)) out.push(b);
  return out.slice(0, WORLD_PLAN_LIMITS.blocks);
}

export interface MergeInput {
  /** The world plan as it is now (null: the world has none yet). */
  now: BlueprintDraft | null;
  /** What this player (or their planner) was looking at when they made this change. */
  seen: BlueprintDraft | null;
  /** The proposed plan: a planner turn's editable layer, a hand edit, or a restored version. */
  next: BlueprintDraft;
  planId: string;
  world: WorldNow;
  /** Who added it: you, someone else, or nobody yet (new). Only your own additions can be reworked, dropped or undone. */
  owner: { asset: (key: string) => Owner; feature: (featureKey: string) => Owner };
  /** A restore (undo): may also take your own features back out of the ground. */
  undo?: boolean;
}

export type Owner = "me" | "other" | null;

export interface MergeResult {
  plan: BlueprintDraft;
  /** What this change added (to record as this player's). */
  added: { assets: string[]; features: string[] };
}

/**
 * The next world plan. Made assets stay as they are. Someone else's planned items
 * stay as they are (only they can rework, drop or undo them). Your own planned items
 * follow `next` if you saw them. The ground's size and seed are fixed once it's in
 * the world, materials only grow, and features in the ground stay unless it's your
 * own undo.
 */
export function mergeWorldPlan({ now, seen, next, planId, world, owner, undo = false }: MergeInput): MergeResult {
  const made = madeAssets(now, planId, world);
  const madeByKey = new Map(made.map((a) => [a.key, a]));
  const seenKeys = new Set((seen?.assets ?? []).map((a) => a.key));
  const nextByKey = new Map(next.assets.map((a) => [a.key, a]));
  const pending = (now?.assets ?? []).filter((a) => !madeByKey.has(a.key));
  // The world's music is everyone's to rework; other planned items only their adder's
  const yours = (a: BlueprintAsset) => (a.kind === "music" || owner.asset(a.key) !== "other") && seenKeys.has(a.key);
  // Planned items that aren't yours to change: kept exactly
  const kept = pending.filter((a) => !yours(a));
  // Yours: follow next (reworded, or dropped if next leaves them out)
  const reworked = pending.filter(yours).flatMap((a) => (nextByKey.has(a.key) ? [nextByKey.get(a.key)!] : []));
  const existing = new Set(pending.map((a) => a.key));
  const taken = new Set([...madeByKey.keys(), ...existing]);
  const added: string[] = [];
  const fresh: BlueprintAsset[] = [];
  for (const a of next.assets) {
    const current = pending.find((p) => p.key === a.key);
    if (current && yours(current)) continue; // reworked above
    if (current && current.prompt === a.prompt) continue; // an echo of someone else's planned item
    const twin = madeByKey.get(a.key);
    if (twin && twin.prompt === a.prompt) continue; // an echo of something already made
    if (undo && !current && owner.asset(a.key) === "other") continue; // an undo never brings back others' items
    let key = a.key;
    while (taken.has(key)) key = `${key}-2`;
    taken.add(key);
    added.push(key);
    fresh.push(key === a.key ? a : { ...a, key });
  }
  const assets = [...made, ...kept, ...reworked, ...fresh].slice(0, WORLD_PLAN_LIMITS.assets);

  const ground = world.terrain;
  // The ground's size and seed are fixed once it's in the world; until then the plan may still change them
  const base = ground ?? next.terrain;
  const blocks = unionBlocks(ground?.blocks, now?.terrain.blocks, next.terrain.blocks);
  const inGround = new Set((ground?.features ?? []).map(featureKey));
  const seenF = new Set((seen?.terrain.features ?? []).map(featureKey));
  const nextF = new Set(next.terrain.features.map(featureKey));
  const yourF = (f: BlueprintFeature) => {
    const k = featureKey(f);
    // Yours to take out: you added it, you saw it, and either it's only planned or this is your undo
    return owner.feature(k) !== "other" && (seenF.has(k) || inGround.has(k)) && (undo || !inGround.has(k));
  };
  const before = uniqueFeatures([ground?.features ?? [], now?.terrain.features ?? []], blocks);
  const stay = before.filter((f) => !yourF(f) || nextF.has(featureKey(f)));
  const beforeKeys = new Set(before.map(featureKey));
  const newF = next.terrain.features.filter((f) => !beforeKeys.has(featureKey(f)) && !(undo && owner.feature(featureKey(f)) === "other"));
  const features = uniqueFeatures([stay, newF], blocks);
  const kept2 = new Set(features.map(featureKey));

  return {
    plan: ensureWorldMusic({ ...next, terrain: { kind: "voxel", size: base.size, seed: base.seed, blocks, features }, assets }),
    added: { assets: added, features: newF.map(featureKey).filter((k) => kept2.has(k)) },
  };
}

// ── What the planner is told about the world (anonymous) ─────────────

/** One thing in the world, as the planner sees it (no ids, no names of who placed it). */
export interface ContextObject {
  /** model | picture | sound | sign | block | … */
  type: string;
  /** The words that made it (prompt) or a sign's text. */
  words?: string;
  at: [number, number];
}

export interface ContextLine {
  who: "player" | "planner";
  text: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const xz = (at: readonly number[]) => `(${Math.round(at[0])}, ${Math.round(at[at.length === 3 ? 2 : 1])})`;

/**
 * The world as it is and what was said about it, for the planner's system prompt.
 * Never includes player ids or names: contributions are anonymous here (research
 * traces keep their research IDs in the planner log).
 */
export function worldContextText(input: {
  ground: Terrain | null;
  objects: ContextObject[];
  /** Earlier conversations in this world (other than the one in progress), oldest first. */
  history: ContextLine[];
  /** Planned by others, not made yet (read-only for this player). */
  othersPlanned?: { assets: BlueprintAsset[]; features: BlueprintFeature[] };
}): string {
  const out: string[] = ["THE WORLD AS IT IS (built by many hands; read-only: build on it, never remove or move it)"];
  const g = input.ground;
  if (g) {
    out.push(`- Ground: ${g.size.join("×")} cells, seed ${g.seed}. Materials: ${g.blocks.map((b) => `${b.id}${b.surface ? ` (${b.surface})` : ""}`).join(", ")}.`);
    out.push(g.features.length
      ? `- Terrain features already in the ground (${g.features.length}): ${g.features.map((f) => `${f.type} of ${f.block} at ${xz(f.at)} r${f.radius}${f.height !== undefined ? ` h${f.height}` : ""}`).join("; ")}.`
      : "- No terrain features yet: open ground.");
  } else {
    out.push("- No ground yet: this plan will lay it.");
  }
  const described = input.objects.filter((o) => o.words);
  const plain = input.objects.filter((o) => !o.words);
  if (described.length) {
    const shown = described.slice(0, WORLD_PLAN_LIMITS.contextObjects);
    out.push(`- Things in the world (${described.length}):`);
    for (const o of shown) out.push(`  - ${o.type} at ${xz(o.at)}: ${clip(o.words!, 160)}`);
    if (described.length > shown.length) out.push(`  - …and ${described.length - shown.length} more.`);
  }
  if (plain.length) {
    const byType = new Map<string, number>();
    for (const o of plain) byType.set(o.type, (byType.get(o.type) ?? 0) + 1);
    out.push(`- Also placed by hand: ${[...byType].map(([t, n]) => `${n} ${t}${n === 1 ? "" : "s"}`).join(", ")}.`);
  }
  if (!input.objects.length) out.push("- Nothing placed yet.");
  const op = input.othersPlanned;
  if (op && (op.assets.length || op.features.length)) {
    out.push("- Planned by others, not made yet (theirs to change; don't repeat them):");
    for (const a of op.assets) out.push(`  - ${a.kind} ${a.key}${a.at ? ` at ${xz(a.at)}` : ""}: ${clip(a.prompt, 160)}`);
    for (const f of op.features) out.push(`  - ${f.type} of ${f.block} at ${xz(f.at)} r${f.radius}`);
  }

  if (input.history.length) {
    const lines = input.history.slice(-WORLD_PLAN_LIMITS.historyLines);
    const earlier = input.history.length - lines.length;
    out.push("", `EARLIER CONVERSATIONS ABOUT THIS WORLD (anonymous, oldest first${earlier ? `; ${earlier} older lines not shown` : ""})`);
    for (const l of lines) out.push(`${l.who}: ${clip(l.text.replace(/\s+/g, " ").trim(), WORLD_PLAN_LIMITS.historyChars)}`);
  }
  return out.join("\n");
}

/** Planned (not made) items per kind, and how many are made: the card's summary. */
export function planCounts(plan: BlueprintDraft, planId: string, world: WorldNow): { made: number; planned: number } {
  const made = madeAssets(plan, planId, world).length;
  return { made, planned: plan.assets.length - made };
}

