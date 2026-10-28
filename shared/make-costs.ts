/**
 * What each kind of making holds from your mana while it runs (Rough Draft M5).
 *
 * The hold is an estimate from MANA_COSTS.md (1 mana = $0.01 of real cost ×
 * K = 100 … i.e. mana = USD × 100); when the job finishes the server settles
 * the real cost the provider reported and gives back the rest. Shared so the
 * Make panel shows the same number the server reserves.
 */

export const MAKE_KINDS = ["model", "image", "sound", "music", "voice", "lore"] as const;
export type MakeKind = (typeof MAKE_KINDS)[number];
export const isMakeKind = (k: unknown): k is MakeKind => typeof k === "string" && (MAKE_KINDS as readonly string[]).includes(k);

/** Which progress skill each kind counts toward (shared/progress.ts). */
export const MAKE_SKILL = {
  model: "mesh",
  image: "picture",
  sound: "sound",
  music: "music",
  voice: "voice",
  lore: "lore",
} as const satisfies Record<MakeKind, string>;

export const SOUND_SECONDS = { min: 1, max: 22, default: 5 } as const;
export const MUSIC_SECONDS = { min: 10, max: 120, default: 30 } as const;
/** Voice lines and lore prompts are short on purpose (cost + safety review). */
export const VOICE_MAX_CHARS = 600;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function clampSeconds(kind: "sound" | "music", s: unknown): number {
  const r = kind === "music" ? MUSIC_SECONDS : SOUND_SECONDS;
  const n = typeof s === "number" && Number.isFinite(s) ? s : r.default;
  return kind === "music" ? Math.round(clamp(n, r.min, r.max)) : Math.round(clamp(n, r.min, r.max) * 10) / 10;
}

/**
 * Mana held for one making. Numbers (MANA_COSTS.md, 2026-10):
 *   model  Meshy preview + texture ≈ $0.60          → 60
 *   image  ≈ $0.02–0.07 a picture                   → 7
 *   sound  ElevenLabs SFX ≈ $0.01                   → 1
 *   music  ElevenLabs Music ≈ $0.15 / min           → 0.25 a second (+1)
 *   voice  ElevenLabs Flash TTS ≈ $0.05 / 1k chars  → 0.005 a character (+0.5)
 *   lore   one short LLM call + safety              → 2
 */
export function makeEstimate(kind: MakeKind, opts: { seconds?: number; chars?: number } = {}): number {
  switch (kind) {
    case "model": return 60;
    case "image": return 7;
    case "sound": return 1;
    case "music": return Math.ceil(clampSeconds("music", opts.seconds) * 0.25) + 1;
    case "voice": return Math.round((0.5 + clamp(opts.chars ?? VOICE_MAX_CHARS, 1, VOICE_MAX_CHARS) * 0.005) * 10) / 10;
    case "lore": return 2;
  }
}
