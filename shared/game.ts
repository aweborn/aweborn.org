/**
 * The game record (Phase 10, slice 1): what turns a world into a game, as plain data.
 *
 * One game per world, set up by the world's creator and co-creators (Q1c): a template
 * plus settings (Q3), a fixed **arena** with its zones (Q4), a **lobby** with its ring
 * and arrival point (Q5), and an NPC roster (slice 6, empty for now). Nothing here runs
 * a match (slice 2); this is the record a match will copy and name by `version`.
 *
 * `parseGame` validates, clamps and repairs untrusted input, like `parseDraft` in
 * blueprint.ts: the server stores only what it returns, and matches record its version.
 *
 * Coordinates are world coordinates (metres; x/z are 0 at the world's middle, y is up).
 * A box is named by the middle of its **floor** (`at`) and its `size`, so "stand where
 * it should go" gives `at` directly.
 */

export type Vec3 = [number, number, number];

export const GAME_TEMPLATES = ["race", "collect", "capture-the-flag", "king-of-the-hill", "survive", "build-together"] as const;
export type GameTemplate = (typeof GAME_TEMPLATES)[number];

export const EDGE_KINDS = ["soft", "wall", "instant"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const ZONE_KINDS = ["spawn", "keep-out", "goal"] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** Caps on a game's size (Q12: complexity caps, not an object budget). */
export const GAME_LIMITS = {
  /** Zones in one arena (spawns, keep-outs and goals together). */
  zones: 32,
  teams: 8,
  /** Players in one match. Well under the 100-bots-per-half-core bar (AGENTS.md) until instances are load-tested. */
  players: 32,
  rounds: 9,
  roundSeconds: [60, 1800],
  scoreToWin: 999,
  edgeSeconds: [3, 30],
  /** Farthest a box's middle may sit from the world's middle (worlds are up to 320 across). */
  maxXZ: 200,
  y: [-50, 400],
  /** Arena footprint and height. */
  arenaSize: [4, 320],
  arenaHeight: [3, 200],
  zoneSize: [1, 160],
  lobbySize: [3, 80],
  ringRadius: [1, 6],
  /** When ▸ If ▸ Do rules (Phase 07 budget: ≤ 64 rules, ≤ 256 actions per tick, cascade depth ≤ 4). */
  rules: 64,
  ruleActions: 4,
  ruleConditions: 3,
  ruleActionsPerTick: 256,
  ruleDepth: 4,
  /** NPCs the creators may put on a game's roster, and the levels an NPC plays at (1 gentle … 5 sharp). */
  npcs: 8,
  npcLevel: [1, 5],
} as const;

// ── NPC roster (slice 6, Q7) ───────────────────────────────────────────

/** How an NPC player behaves. `auto` picks what suits the template. Fixed and deterministic: never a language model. */
export const NPC_BEHAVIORS = ["auto", "chase", "guard", "fetch", "follow"] as const;
export type NpcBehavior = (typeof NPC_BEHAVIORS)[number];

/** NPC names come from a fixed list (they are shown to everyone, so nothing free-typed). */
export const NPC_NAMES = ["Bolt", "Comet", "Dot", "Ember", "Fern", "Glim", "Juno", "Koi", "Luma", "Moss", "Nova", "Pip", "Quill", "Rune", "Sol", "Tumble"] as const;

export interface NpcEntry {
  id: string;
  name: string;
  behavior: NpcBehavior;
  /** Levels players may pick for it. */
  levels: { min: number; max: number };
}

/** What the creators allow NPCs to do in this game. */
export interface NpcPolicy {
  /** Players may fill empty slots from the roster ("play now with NPCs"; a group must all agree). */
  fill: boolean;
  /** An NPC holds a dropped player's slot until they return. */
  hold: boolean;
  /** A host NPC announces the match in the lobby chat. */
  host: boolean;
}

// ── When ▸ If ▸ Do rules (slice 7, Q3) ─────────────────────────────────

export const RULE_EVENTS = ["match-start", "round-start", "every-seconds", "seconds-left", "enter-zone", "leave-zone", "score", "out-of-bounds", "pickup", "capture"] as const;
export type RuleEvent = (typeof RULE_EVENTS)[number];
export const RULE_VALUES = ["score", "other-score", "seconds-left", "round", "players", "var-a", "var-b", "var-c"] as const;
export type RuleValue = (typeof RULE_VALUES)[number];
export const RULE_OPS = ["<", "<=", "=", ">=", ">"] as const;
export type RuleOp = (typeof RULE_OPS)[number];
export const RULE_ACTIONS = ["add-score", "add-seconds", "return-to-spawn", "end-round", "set-var", "add-var", "announce"] as const;
export type RuleActionType = (typeof RULE_ACTIONS)[number];
/** Who an action is about: the team (or player) that caused the event, the other teams, or everyone. */
export const RULE_TARGETS = ["actor", "others", "all"] as const;
export type RuleTarget = (typeof RULE_TARGETS)[number];
/** Announcements are picked from a list (shown to everyone, so nothing free-typed). */
export const RULE_ANNOUNCEMENTS = ["Go!", "Halfway there!", "One minute left!", "Sudden death!", "Bonus point!", "Back to the start!", "So close!", "New round!"] as const;

export interface RuleCondition { left: RuleValue; op: RuleOp; right: number }
export interface RuleAction {
  type: RuleActionType;
  target?: RuleTarget;
  /** add-score / add-seconds / set-var / add-var amount; announce: index into RULE_ANNOUNCEMENTS. */
  value?: number;
  /** set-var / add-var: which variable. */
  name?: "var-a" | "var-b" | "var-c";
}
export interface GameRule {
  id: string;
  when: { event: RuleEvent; /** enter-zone / leave-zone: the zone's id (absent = any zone). */ zone?: string; /** every-seconds / seconds-left: the number of seconds. */ seconds?: number };
  if: RuleCondition[];
  do: RuleAction[];
}

/** A box standing on its floor: `at` is the middle of the floor, `size` is width (x), height (y), depth (z). */
export interface GameBox {
  at: Vec3;
  size: Vec3;
}

export interface GameZone extends GameBox {
  id: string;
  kind: ZoneKind;
  /** Whose it is, 1..teams. Spawn zones always have one; a goal may (a team's flag base), keep-outs never do. */
  team?: number;
  /** Keep-out zones only: how a player who walks in is sent back (Q4). */
  ret?: "soft" | "instant";
}

export interface GameLobby extends GameBox {
  /** Standing in the ring means "I'm available" (Q5). Always inside the lobby. */
  ring: { at: Vec3; radius: number };
  /** Where players arrive when they enter the world (Q5). Always inside the lobby. */
  arrival: Vec3;
}

export interface GameSettings {
  /** 1 = everyone on one side (co-operative, or every player for themselves). */
  teams: number;
  players: { min: number; max: number };
  rounds: number;
  roundSeconds: number;
  scoreToWin: number;
  traits: { speedMul: number; gravityMul: number; fly: boolean };
  /** What the arena's edge does (Q4): a countdown then back to spawn, a solid wall, or straight back. */
  edge: EdgeKind;
  edgeSeconds: number;
}

export interface Game {
  /** Goes up by one with every saved change (the server sets it). Matches record it. */
  version: number;
  template: GameTemplate;
  settings: GameSettings;
  /** The stage. Null until the creators mark it. */
  arena: GameBox | null;
  zones: GameZone[];
  lobby: GameLobby | null;
  /** NPCs the creators allow to play (slice 6). */
  npcRoster: NpcEntry[];
  npc: NpcPolicy;
  /** When ▸ If ▸ Do cards on top of the template (slice 7). */
  rules: GameRule[];
  /** Credit chain when the game came from the Library (slice 7): newest last. Server-written. */
  credits: GameCredit[];
}

/** One link of a game's credit chain: who made which version of which Library game. */
export interface GameCredit {
  libraryId: string;
  version: number;
  /** The character who saved that version, and (server-written when the game is brought) the name they showed then. */
  by: string;
  byName?: string;
  name: string;
}

/** What each template starts with. `scoreToWin` means: race 1 finish, collect N things, flags captured, hill seconds held, rounds survived, builds finished. */
export const TEMPLATE_DEFAULTS: Record<GameTemplate, { label: string; blurb: string; teams: number; scoreToWin: number; needsGoal: boolean }> = {
  "race": { label: "Race", blurb: "First to the goal wins.", teams: 2, scoreToWin: 1, needsGoal: true },
  "collect": { label: "Collect", blurb: "Gather the most before time runs out.", teams: 2, scoreToWin: 10, needsGoal: false },
  "capture-the-flag": { label: "Capture the flag", blurb: "Take the other team's flag back to your base.", teams: 2, scoreToWin: 3, needsGoal: true },
  "king-of-the-hill": { label: "King of the hill", blurb: "Hold the hill the longest.", teams: 2, scoreToWin: 120, needsGoal: true },
  "survive": { label: "Survive", blurb: "Stay in until the clock runs out.", teams: 1, scoreToWin: 1, needsGoal: false },
  "build-together": { label: "Build together", blurb: "One team, one build, against the clock.", teams: 1, scoreToWin: 1, needsGoal: false },
};

export function defaultSettings(template: GameTemplate): GameSettings {
  const t = TEMPLATE_DEFAULTS[template];
  return {
    teams: t.teams,
    players: { min: 2, max: 8 },
    rounds: 1,
    roundSeconds: 420,
    scoreToWin: t.scoreToWin,
    traits: { speedMul: 1, gravityMul: 1, fly: true },
    edge: "soft",
    edgeSeconds: 10,
  };
}

export const DEFAULT_NPC_POLICY: NpcPolicy = { fill: true, hold: true, host: true };

/** A new, empty game: a template and its settings, nothing marked yet. */
export function newGame(template: GameTemplate = "race"): Game {
  return { version: 0, template, settings: defaultSettings(template), arena: null, zones: [], lobby: null, npcRoster: [], npc: { ...DEFAULT_NPC_POLICY }, rules: [], credits: [] };
}

// ── Geometry ───────────────────────────────────────────────────────────

export interface Bounds {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export function boundsOf(b: GameBox): Bounds {
  const [x, y, z] = b.at;
  const [w, h, d] = b.size;
  return { minX: x - w / 2, maxX: x + w / 2, minY: y, maxY: y + h, minZ: z - d / 2, maxZ: z + d / 2 };
}

export function inBounds(b: Bounds, x: number, y: number, z: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
}

export const inBox = (box: GameBox, x: number, y: number, z: number): boolean => inBounds(boundsOf(box), x, y, z);

export function boxesOverlap(a: GameBox, b: GameBox): boolean {
  const p = boundsOf(a), q = boundsOf(b);
  return p.minX < q.maxX && q.minX < p.maxX && p.minY < q.maxY && q.minY < p.maxY && p.minZ < q.maxZ && q.minZ < p.maxZ;
}

/**
 * The stage (Q5b): the arena's spot in the live world, where only the creator and
 * co-creators place, edit or kick. Reads a stored game (world meta `game`) without
 * trusting it; null when the world has no arena.
 */
export function stageOf(game: unknown): Bounds | null {
  if (!isObj(game) || !isObj(game.arena)) return null;
  const at = game.arena.at, size = game.arena.size;
  if (!Array.isArray(at) || !Array.isArray(size) || at.length !== 3 || size.length !== 3) return null;
  if (![...at, ...size].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return boundsOf({ at: at as Vec3, size: size as Vec3 });
}

// ── Validation ─────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
const int = (v: unknown, lo: number, hi: number, dflt: number): number => Math.round(num(v, lo, hi, dflt));
const round2 = (v: number): number => Math.round(v * 100) / 100;
const oneOf = <T extends string>(v: unknown, opts: readonly T[]): T | undefined =>
  opts.includes(v as T) ? (v as T) : undefined;
const slug = (v: unknown): string =>
  (typeof v === "string" ? v.trim().slice(0, 32) : "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export type Parsed<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[] };

function vec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  if (!v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return [v[0] as number, v[1] as number, v[2] as number];
}

/** A box from untrusted input, clamped into the world; null when it has no usable `at`. */
function box(raw: unknown, xz: readonly [number, number], height: readonly [number, number], dflt: Vec3): GameBox | null {
  if (!isObj(raw)) return null;
  const at = vec3(raw.at);
  if (!at) return null;
  const s = Array.isArray(raw.size) ? raw.size : [];
  const L = GAME_LIMITS;
  return {
    at: [round2(clamp(at[0], -L.maxXZ, L.maxXZ)), round2(clamp(at[1], L.y[0], L.y[1])), round2(clamp(at[2], -L.maxXZ, L.maxXZ))],
    size: [round2(num(s[0], xz[0], xz[1], dflt[0])), round2(num(s[1], height[0], height[1], dflt[1])), round2(num(s[2], xz[0], xz[1], dflt[2]))],
  };
}

/** Shrink and move `inner` so it lies inside `outer`. */
function fitInside(inner: GameBox, outer: GameBox): GameBox {
  const o = boundsOf(outer);
  const w = Math.min(inner.size[0], outer.size[0]);
  const h = Math.min(inner.size[1], outer.size[1]);
  const d = Math.min(inner.size[2], outer.size[2]);
  return {
    at: [
      round2(clamp(inner.at[0], o.minX + w / 2, o.maxX - w / 2)),
      round2(clamp(inner.at[1], o.minY, o.maxY - h)),
      round2(clamp(inner.at[2], o.minZ + d / 2, o.maxZ - d / 2)),
    ],
    size: [w, h, d],
  };
}

function pointInside(p: Vec3 | null, outer: GameBox, margin: number): Vec3 {
  const o = boundsOf(outer);
  const m = Math.min(margin, outer.size[0] / 2, outer.size[2] / 2);
  const at = p ?? outer.at;
  return [round2(clamp(at[0], o.minX + m, o.maxX - m)), round2(clamp(at[1], o.minY, o.maxY)), round2(clamp(at[2], o.minZ + m, o.maxZ - m))];
}

export function parseSettings(raw: unknown, template: GameTemplate): GameSettings {
  const s = isObj(raw) ? raw : {};
  const D = defaultSettings(template);
  const L = GAME_LIMITS;
  const teams = int(s.teams, 1, L.teams, D.teams);
  const p = isObj(s.players) ? s.players : {};
  // Every team needs someone: a match can't hold fewer players than teams
  const max = int(p.max, Math.max(1, teams), L.players, Math.max(D.players.max, teams));
  const min = int(p.min, 1, max, Math.min(D.players.min, max));
  const t = isObj(s.traits) ? s.traits : {};
  return {
    teams,
    players: { min, max },
    rounds: int(s.rounds, 1, L.rounds, D.rounds),
    roundSeconds: int(s.roundSeconds, L.roundSeconds[0], L.roundSeconds[1], D.roundSeconds),
    scoreToWin: int(s.scoreToWin, 1, L.scoreToWin, D.scoreToWin),
    traits: {
      speedMul: round2(num(t.speedMul, 0.25, 3, D.traits.speedMul)),
      gravityMul: round2(num(t.gravityMul, 0.1, 3, D.traits.gravityMul)),
      fly: typeof t.fly === "boolean" ? t.fly : D.traits.fly,
    },
    edge: oneOf(s.edge, EDGE_KINDS) ?? D.edge,
    edgeSeconds: int(s.edgeSeconds, L.edgeSeconds[0], L.edgeSeconds[1], D.edgeSeconds),
  };
}

/**
 * Validate, clamp and repair a game from untrusted input. Fails only when there is
 * nothing to repair from (not an object, or no known template); everything else is
 * clamped or dropped with a warning. `version` passes through (the server sets it).
 */
export function parseGame(raw: unknown): Parsed<Game> {
  if (!isObj(raw)) return { ok: false, errors: ["game must be an object"] };
  const template = oneOf(raw.template, GAME_TEMPLATES);
  if (!template) return { ok: false, errors: [`unknown template ${String(raw.template).slice(0, 40)}`] };
  const warnings: string[] = [];
  const L = GAME_LIMITS;
  const settings = parseSettings(raw.settings, template);

  const arena = box(raw.arena, L.arenaSize, L.arenaHeight, [40, 20, 40]);
  if (raw.arena != null && !arena) warnings.push("dropped the arena: it needs a place");

  const zones: GameZone[] = [];
  const rawZones = Array.isArray(raw.zones) ? raw.zones : [];
  if (rawZones.length && !arena) warnings.push("dropped the zones: mark the arena first");
  const stage = arena;
  for (const z of stage ? rawZones : []) {
    if (!stage) break;
    if (zones.length >= L.zones) { warnings.push(`kept the first ${L.zones} zones`); break; }
    const kind = isObj(z) ? oneOf(z.kind, ZONE_KINDS) : undefined;
    const b = box(z, L.zoneSize, L.zoneSize, [4, 3, 4]);
    if (!isObj(z) || !kind || !b) { warnings.push("dropped a zone: it needs a kind and a place"); continue; }
    let id = slug(z.id) || `${kind}-${zones.length + 1}`;
    while (zones.some((x) => x.id === id)) id += "-2";
    const zone: GameZone = { id, kind, ...fitInside(b, stage) };
    if (kind === "spawn") {
      zone.team = int(z.team, 1, settings.teams, 1);
      if (zones.some((x) => x.kind === "spawn" && x.team === zone.team)) {
        warnings.push(`dropped a second spawn for team ${zone.team}`);
        continue;
      }
    } else if (kind === "goal") {
      if (typeof z.team === "number" && Number.isFinite(z.team) && z.team >= 1 && z.team <= settings.teams) zone.team = Math.round(z.team);
    } else {
      zone.ret = z.ret === "instant" ? "instant" : "soft";
    }
    zones.push(zone);
  }

  let lobby: GameLobby | null = null;
  const lb = box(raw.lobby, L.lobbySize, [3, L.lobbySize[1]], [12, 6, 12]);
  if (raw.lobby != null && !lb) warnings.push("dropped the lobby: it needs a place");
  if (lb && isObj(raw.lobby)) {
    const r = isObj(raw.lobby.ring) ? raw.lobby.ring : {};
    const radius = round2(Math.min(num(r.radius, L.ringRadius[0], L.ringRadius[1], 2), lb.size[0] / 2, lb.size[2] / 2));
    lobby = {
      ...lb,
      ring: { at: pointInside(vec3(r.at), lb, radius), radius },
      arrival: pointInside(vec3(raw.lobby.arrival), lb, 0.5),
    };
    if (arena && boxesOverlap(lb, arena)) warnings.push("the lobby overlaps the arena: move it beside or above the stage");
  }

  const npcRoster: NpcEntry[] = [];
  for (const n of Array.isArray(raw.npcRoster) ? raw.npcRoster.slice(0, L.npcs) : []) {
    if (!isObj(n)) continue;
    const name = oneOf(n.name, NPC_NAMES);
    if (!name) { warnings.push("dropped an NPC: pick its name from the list"); continue; }
    let id = slug(n.id) || `npc-${npcRoster.length + 1}`;
    while (npcRoster.some((x) => x.id === id)) id += "-2";
    const lv = isObj(n.levels) ? n.levels : {};
    const max = int(lv.max, L.npcLevel[0], L.npcLevel[1], L.npcLevel[1]);
    npcRoster.push({ id, name, behavior: oneOf(n.behavior, NPC_BEHAVIORS) ?? "auto", levels: { min: int(lv.min, L.npcLevel[0], max, L.npcLevel[0]), max } });
  }
  const np = isObj(raw.npc) ? raw.npc : {};
  const npc: NpcPolicy = {
    fill: typeof np.fill === "boolean" ? np.fill : DEFAULT_NPC_POLICY.fill,
    hold: typeof np.hold === "boolean" ? np.hold : DEFAULT_NPC_POLICY.hold,
    host: typeof np.host === "boolean" ? np.host : DEFAULT_NPC_POLICY.host,
  };

  const rules: GameRule[] = [];
  const rawRules = Array.isArray(raw.rules) ? raw.rules : [];
  if (rawRules.length > L.rules) warnings.push(`kept the first ${L.rules} rules`);
  for (const r of rawRules.slice(0, L.rules)) {
    const w = isObj(r) && isObj(r.when) ? r.when : null;
    const event = w ? oneOf(w.event, RULE_EVENTS) : undefined;
    if (!isObj(r) || !w || !event) { warnings.push("dropped a rule: it needs a When"); continue; }
    const when: GameRule["when"] = { event };
    if (event === "enter-zone" || event === "leave-zone") {
      const zid = slug(w.zone);
      if (zid && zones.some((z) => z.id === zid)) when.zone = zid;
    }
    if (event === "every-seconds" || event === "seconds-left") when.seconds = int(w.seconds, 1, L.roundSeconds[1], 30);
    const conds: RuleCondition[] = [];
    for (const c of Array.isArray(r.if) ? r.if.slice(0, L.ruleConditions) : []) {
      const left = isObj(c) ? oneOf(c.left, RULE_VALUES) : undefined;
      const op = isObj(c) ? oneOf(c.op, RULE_OPS) : undefined;
      if (isObj(c) && left && op) conds.push({ left, op, right: int(c.right, -9999, 9999, 0) });
    }
    const acts: RuleAction[] = [];
    for (const a of Array.isArray(r.do) ? r.do.slice(0, L.ruleActions) : []) {
      const type = isObj(a) ? oneOf(a.type, RULE_ACTIONS) : undefined;
      if (!isObj(a) || !type) continue;
      const act: RuleAction = { type };
      if (type !== "add-seconds" && type !== "announce") act.target = oneOf(a.target, RULE_TARGETS) ?? "actor";
      if (type === "announce") act.value = int(a.value, 0, RULE_ANNOUNCEMENTS.length - 1, 0);
      else if (type === "add-seconds") act.value = int(a.value, -600, 600, 30);
      else if (type !== "return-to-spawn" && type !== "end-round") act.value = int(a.value, -999, 999, 1);
      if (type === "set-var" || type === "add-var") act.name = oneOf(a.name, ["var-a", "var-b", "var-c"] as const) ?? "var-a";
      acts.push(act);
    }
    if (!acts.length) { warnings.push("dropped a rule: it needs a Do"); continue; }
    let id = slug(r.id) || `rule-${rules.length + 1}`;
    while (rules.some((x) => x.id === id)) id += "-2";
    rules.push({ id, when, if: conds, do: acts });
  }

  const credits: GameCredit[] = [];
  for (const c of Array.isArray(raw.credits) ? raw.credits.slice(-16) : []) {
    if (!isObj(c) || typeof c.libraryId !== "string" || typeof c.by !== "string") continue;
    credits.push({ libraryId: c.libraryId.slice(0, 64), version: int(c.version, 1, 1e9, 1), by: c.by.slice(0, 64), name: typeof c.name === "string" ? c.name.slice(0, 60) : "", ...(typeof c.byName === "string" && c.byName ? { byName: c.byName.slice(0, 40) } : {}) });
  }

  return {
    ok: true,
    value: { version: int(raw.version, 0, Number.MAX_SAFE_INTEGER, 0), template, settings, arena, zones, lobby, npcRoster, npc, rules, credits },
    warnings,
  };
}

/** Same game, whatever its version? (Saving an unchanged game doesn't make a new version.) */
export function sameGame(a: Game, b: Game): boolean {
  return JSON.stringify({ ...a, version: 0 }) === JSON.stringify({ ...b, version: 0 });
}

/**
 * What is still missing before a match could start (slice 2 reads this; the Game tab
 * shows it as a checklist). Empty = ready.
 */
export function gameMissing(g: Game): string[] {
  const out: string[] = [];
  if (!g.arena) out.push("Mark the arena.");
  if (!g.lobby) out.push("Mark the lobby.");
  if (g.arena && g.lobby && boxesOverlap(g.lobby, g.arena)) out.push("Move the lobby off the stage.");
  for (let t = 1; t <= g.settings.teams; t++) {
    if (!g.zones.some((z) => z.kind === "spawn" && z.team === t)) {
      out.push(g.settings.teams === 1 ? "Add a spawn zone." : `Add a spawn zone for team ${t}.`);
    }
  }
  if (TEMPLATE_DEFAULTS[g.template].needsGoal && !g.zones.some((z) => z.kind === "goal")) out.push("Add a goal zone.");
  return out;
}

/** Read a stored game (world meta `game`, server-written) as an optional field for WorldMeta. */
export function gameField(v: unknown): { game?: Game } {
  if (v === undefined || v === null) return {};
  const p = parseGame(v);
  return p.ok ? { game: p.value } : {};
}
