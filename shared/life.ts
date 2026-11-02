/**
 * Life & minds (Phase 07, 2026-11-01): making placed creations come alive.
 *
 * Three tiers of life for a generated model (research: phases/07 → Life & minds):
 *
 *   still     the default: stands where it was placed.
 *   alive     free, any mesh, no network: procedural breathing, sway, a slow turn
 *             toward whoever is near, and (optionally) roaming around its home.
 *   animated  the mesh is rigged (Meshy remesh → rig → animation library) into one
 *             GLB with a skeleton and named clips (`idle`, `walk`, `talk`, `emote`);
 *             the client plays them with crossfades. Humanoid/biped only (Meshy);
 *             anything else falls back to `alive`.
 *
 * On top of any tier, a creation can get a **mind** (an NPC): a persona the
 * server keeps, a voice, and replies in world chat when players talk near it.
 *
 * Movement is deterministic from the wall clock (like kicks): every client
 * computes the same roaming path from the object's id, home and pace, so
 * nothing is sent over the network while a creature wanders.
 */

// ── Tiers ────────────────────────────────────────────────────────────

export const LIFE_MODES = ["still", "alive", "animated"] as const;
export type LifeMode = (typeof LIFE_MODES)[number];

/** Clip roles baked into an animated GLB (animation names after the rig job renames them). */
export const ANIM_ROLES = ["idle", "walk", "talk", "emote"] as const;
export type AnimRole = (typeof ANIM_ROLES)[number];

/**
 * Gaits: which Meshy animation-library actions fill each role, in role order.
 * Chosen from the live library (GET /openapi/v1/animations/library, 2026-11-01).
 * `heavy` is the colossus: a long breath, a slow orc walk, an angry talk, a stomp.
 */
export const GAITS = {
  heavy: { label: "Heavy", actions: [336, 669, 311, 255], pace: 0.6 },
  calm: { label: "Calm", actions: [0, 613, 313, 28], pace: 1 },
  lively: { label: "Lively", actions: [11, 632, 308, 290], pace: 1.15 },
  sneaky: { label: "Sneaky", actions: [243, 671, 309, 317], pace: 0.9 },
} as const satisfies Record<string, { label: string; actions: readonly [number, number, number, number]; pace: number }>;
export type Gait = keyof typeof GAITS;
export const isGait = (g: unknown): g is Gait => typeof g === "string" && Object.prototype.hasOwnProperty.call(GAITS, g);

/** Stored on a PlacedObject (`life`). Plain JSON, edited by the placer / world owners like any field. */
export interface ObjectLife {
  mode: LifeMode;
  /** Animation + roaming speed multiplier (0.3 slow colossus … 1.6 quick). */
  pace: number;
  /** Wander radius around the placed spot in metres (0 = stays put, turning only). */
  roam: number;
  /** Animated models: which clip set the rig job asked for. */
  gait?: Gait;
}

export const LIFE_LIMITS = { pace: [0.3, 1.6], roam: [0, 24] } as const;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Clean untrusted life settings (client edits, planner output). Null = not alive / invalid. */
export function cleanLife(raw: unknown): ObjectLife | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const mode = (LIFE_MODES as readonly string[]).includes(r.mode as string) ? (r.mode as LifeMode) : null;
  if (!mode) return null;
  const out: ObjectLife = {
    mode,
    pace: Math.round(clamp(num(r.pace, 1), ...LIFE_LIMITS.pace) * 100) / 100,
    roam: Math.round(clamp(num(r.roam, 0), ...LIFE_LIMITS.roam) * 10) / 10,
  };
  if (isGait(r.gait)) out.gait = r.gait;
  return out;
}

// ── Making it animated (costs) ───────────────────────────────────────

/**
 * Meshy credits for one rig job (2026-11-01, measured on the Lost colossus):
 * remesh 5 (to 30k triangles; rigging refuses > 380k) + rig 5 + 4 actions × 3 = 22
 * credits ≈ $0.44 at $0.02 a credit. Failed tasks are refunded by Meshy.
 */
export const ANIMATE_CREDITS = 22;
export const ANIMATE_USD = ANIMATE_CREDITS * 0.02;
/** Mana held while a rig job runs (settled to the real cost). */
export const ANIMATE_ESTIMATE = 50;
/** Triangles the remesh step aims for: light enough to skin on a phone, enough for a creature. */
export const RIG_POLYCOUNT = 30_000;

// ── Deterministic roaming ────────────────────────────────────────────

/** FNV-1a 32-bit (stable across engines). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Two values in [0, 1) from (seed, leg). */
function rand2(seed: number, leg: number): [number, number] {
  let x = (seed ^ Math.imul(leg + 0x9e37, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  const y = Math.imul(x ^ 0x5bd1e995, 0x27d4eb2d) >>> 0;
  return [x / 4294967296, ((y ^ (y >>> 15)) >>> 0) / 4294967296];
}

/** A waypoint inside the roam disc (uniform by area), as an offset from home. */
function waypoint(seed: number, leg: number, radius: number): [number, number] {
  if (leg < 0 || radius <= 0) return [0, 0];
  const [a, b] = rand2(seed, leg);
  const r = Math.sqrt(a) * radius;
  const t = b * Math.PI * 2;
  return [Math.cos(t) * r, Math.sin(t) * r];
}

export interface RoamPose {
  /** Offset from home (metres). */
  dx: number;
  dz: number;
  /** Facing (radians, three.js rotation about +Y; 0 faces +Z). */
  heading: number;
  moving: boolean;
}

/**
 * Where a roaming creature is at wall-clock time `tMs`. Each leg lasts a fixed
 * time: rest at waypoint k, then walk to waypoint k+1 at `speed` m/s. The leg
 * length is long enough to cross the whole disc, so the result is O(1) from the
 * clock alone (no state, no messages, same answer on every client).
 */
export function roamPose(id: string, radius: number, speed: number, tMs: number, restHeading = 0): RoamPose {
  if (radius <= 0 || speed <= 0) return { dx: 0, dz: 0, heading: restHeading, moving: false };
  const seed = hash32(id);
  const walkMax = (2 * radius) / speed; // longest possible walk
  const legS = Math.max(12, walkMax / 0.55);
  const t = tMs / 1000 + (seed % 997); // de-sync creatures placed at the same moment
  const leg = Math.floor(t / legS);
  const into = t - leg * legS;
  const [ax, az] = waypoint(seed, leg, radius);
  const [bx, bz] = waypoint(seed, leg + 1, radius);
  const dist = Math.hypot(bx - ax, bz - az);
  const walkS = dist / speed;
  const restS = legS - walkS;
  if (into < restS || dist < 1e-3) {
    // Resting: keep facing the way it last walked
    const [px, pz] = waypoint(seed, leg - 1, radius);
    const h = Math.hypot(ax - px, az - pz) > 1e-3 ? Math.atan2(ax - px, az - pz) : restHeading;
    return { dx: ax, dz: az, heading: h, moving: false };
  }
  const k = Math.min(1, (into - restS) / walkS);
  return { dx: ax + (bx - ax) * k, dz: az + (bz - az) * k, heading: Math.atan2(bx - ax, bz - az), moving: true };
}

/** Walking speed (m/s) for a creature of this height: stride grows with size, pace scales it. */
export function walkSpeed(heightM: number, pace: number): number {
  return clamp(0.45 * Math.sqrt(Math.max(0.3, heightM)) * pace, 0.15, 4);
}

// ── Voices ───────────────────────────────────────────────────────────

/**
 * Premade ElevenLabs voices reachable through OpenRouter's TTS endpoint
 * (`POST /api/v1/audio/speech`, model elevenlabs/eleven-v4-turbo), verified
 * 2026-11-01 under the account's zero-data-retention rule. Designed (custom)
 * voices need a direct ElevenLabs key; until then these are the palette, and a
 * giant gets its size from the client (lower playback rate + rumble).
 */
export const VOICES = {
  brian: "deep, resonant man; calm authority",
  bill: "old man, weathered and gravelly; a wise elder",
  callum: "intense, husky man; gravelly menace",
  george: "warm British storyteller",
  daniel: "steady British man; formal, announcer",
  adam: "deep American man; firm narrator",
  eric: "smooth middle-aged man; friendly",
  roger: "easy-going, confident man",
  harry: "fierce young man; a warrior",
  liam: "bright young man; articulate",
  will: "friendly young man; relaxed",
  chris: "casual, down-to-earth man",
  charlie: "natural, upbeat Australian man",
  river: "relaxed, neutral voice; calm and even",
  matilda: "knowledgeable woman; warm and clear",
  alice: "confident British woman",
  lily: "velvety British woman; gentle",
  sarah: "soft young woman; reassuring",
  laura: "quirky, enthusiastic young woman",
  jessica: "playful, bright young woman",
  bella: "warm, friendly woman",
} as const;
export type VoiceId = keyof typeof VOICES;
export const VOICE_IDS = Object.keys(VOICES) as VoiceId[];
export const isVoiceId = (v: unknown): v is VoiceId => typeof v === "string" && Object.prototype.hasOwnProperty.call(VOICES, v);
export const DEFAULT_VOICE: VoiceId = "george";

/** How a mind's voice is played back: size changes pitch (lower rate) and adds rumble. */
export const VOICE_SIZES = ["small", "human", "large", "giant"] as const;
export type VoiceSize = (typeof VOICE_SIZES)[number];
export const VOICE_RATE: Record<VoiceSize, number> = { small: 1.12, human: 1, large: 0.9, giant: 0.8 };

// ── Minds (NPC personas) ─────────────────────────────────────────────

/** The full persona: kept by the server (npc table), compiled from the creator's words by an LLM. */
export interface Persona {
  name: string;
  /** "the Ancient Lava Warden" */
  epithet: string;
  /** Look + backstory, a few sentences. */
  description: string;
  personality: string[];
  /** How it talks: "rarely, in slow riddles". */
  speech: string;
  /** terse | normal | chatty */
  verbosity: "terse" | "normal" | "chatty";
  goals: string[];
  /** What it knows about its world. */
  knowledge: string[];
  /** The creator's extra limits (the platform's are fixed and added by the server). */
  boundaries: string[];
  greeting: string;
  voice: VoiceId;
  size: VoiceSize;
  /** Speak replies aloud (voice lines cost a little more), or text only. */
  spoken: boolean;
}

/** The public part of a mind, written into the object by the server only (`mind` key). */
export interface ObjectMind {
  name: string;
  epithet?: string;
  voice: VoiceId;
  size: VoiceSize;
  spoken: boolean;
}

export const PERSONA_LIMITS = {
  name: 40, epithet: 60, description: 500, trait: 32, traits: 6, speech: 200,
  goal: 140, goals: 3, fact: 220, facts: 8, boundary: 140, boundaries: 5, greeting: 200,
} as const;

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
const strs = (v: unknown, each: number, count: number): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, count) : [];

/** Clean an LLM-compiled persona. Null if it has no usable name or description. */
export function cleanPersona(raw: unknown): Persona | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const L = PERSONA_LIMITS;
  const name = str(r.name, L.name);
  const description = str(r.description, L.description);
  if (!name || !description) return null;
  const verbosity = r.verbosity === "terse" || r.verbosity === "chatty" ? r.verbosity : "normal";
  return {
    name,
    epithet: str(r.epithet, L.epithet),
    description,
    personality: strs(r.personality, L.trait, L.traits),
    speech: str(r.speech, L.speech),
    verbosity,
    goals: strs(r.goals, L.goal, L.goals),
    knowledge: strs(r.knowledge, L.fact, L.facts),
    boundaries: strs(r.boundaries, L.boundary, L.boundaries),
    // Spoken aloud and shown as text: no *stage directions* (a voice would read them out)
    greeting: str(typeof r.greeting === "string" ? r.greeting.replace(/\*[^*]{0,60}\*/g, " ") : "", L.greeting),
    voice: isVoiceId(r.voice) ? r.voice : DEFAULT_VOICE,
    size: (VOICE_SIZES as readonly string[]).includes(r.size as string) ? (r.size as VoiceSize) : "human",
    spoken: r.spoken !== false,
  };
}

export const publicMind = (p: Persona): ObjectMind => ({
  name: p.name, ...(p.epithet ? { epithet: p.epithet } : {}), voice: p.voice, size: p.size, spoken: p.spoken,
});

/** Chat sender id for a mind's lines (`npc:<objectId>`); never a player id. */
export const NPC_SENDER_PREFIX = "npc:";
export const npcSender = (objectId: string) => `${NPC_SENDER_PREFIX}${objectId}`;
export const isNpcSender = (s: string) => s.startsWith(NPC_SENDER_PREFIX);

// ── A mind's reply (LLM output, validated) ───────────────────────────

/** What the server lets a mind do. Cosmetic only: never items, mana, permissions or world edits. */
export interface MindReply {
  say: string;
  /** A body clip to play while saying it (animated models), or none. */
  anim: AnimRole | null;
  /** Turn to face the player it's answering. */
  face: boolean;
  /** One short fact to remember about this player (per-player memory). */
  remember: string;
}

export const REPLY_MAX = 280;

export function cleanReply(raw: unknown): MindReply | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const say = str(r.say, REPLY_MAX);
  if (!say) return null;
  const anim = r.anim === "talk" || r.anim === "emote" ? r.anim : null;
  return { say, anim, face: r.face !== false, remember: str(r.remember, 140) };
}

/** Player words go to a mind as data, never as instructions: strip stage directions and role prefixes. */
export function quotePlayer(text: string): string {
  return text
    .replace(/[()[\]{}<>*_`|\\]/g, " ")
    .replace(/\b(system|assistant|developer|user)\s*:/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

