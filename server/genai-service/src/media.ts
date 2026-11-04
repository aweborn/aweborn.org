/**
 * Media providers (Rough Draft M5): pictures, sounds, music and voice.
 *
 * Same job shape as models (providers.ts): `generate(job)` stores a
 * content-addressed file in assetDir and returns its name + real cost.
 *
 *   image  → OpenRouter image model (IMAGE_MODEL, default Microsoft MAI Image
 *            2.6 Flash: the account enforces zero data retention, which rules
 *            out Gemini image endpoints today), re-encoded to WebP ≤ 1024 px → <sha>.webp
 *   sound  → ElevenLabs sound effects (loopable)                  → <sha>.mp3
 *   music  → ElevenLabs Music (instrumental unless asked)         → <sha>.mp3
 *   voice  → OpenRouter TTS: ElevenLabs v4 Turbo, premade voices  → <sha>.mp3
 *            (2026-11-01: works under zero data retention, so voice no longer waits on a key)
 *
 * Without a key each kind falls back to a stub that makes a real file
 * locally (a gradient card with the prompt; a synthesized WAV), so the whole
 * loop (mana, jobs, placing, positional playback) works in dev and before
 * Alex adds ELEVENLABS_API_KEY (sound + music). Stubs cost 0.
 */
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Provider, ProviderJob } from "./providers.js";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "microsoft/mai-image-2.6-flash";
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY ?? "";
const ELEVEN = "https://api.elevenlabs.io/v1";
/** Set explicitly: the API's own defaults lag (research 2026-11-01). */
const ELEVEN_SFX_MODEL = process.env.ELEVENLABS_SFX_MODEL || "eleven_text_to_sound_v2";
/** Empty = the API default (music_v1); set e.g. music_v2_5 once confirmed on the account. */
const ELEVEN_MUSIC_MODEL = process.env.ELEVENLABS_MUSIC_MODEL || "";
/** OpenRouter TTS model (premade ElevenLabs voices, audio tags). */
const VOICE_MODEL = process.env.VOICE_MODEL || "elevenlabs/eleven-v4-turbo";

/** List prices (MANA_COSTS.md, re-checked 2026-11-01) used when a provider doesn't report cost. */
export const MEDIA_USD = {
  /** MAI Image 2.6 Flash measured $0.0195 (2026-10-27); used only if OpenRouter reports no cost */
  image: 0.02,
  /** ElevenLabs sound effects: $0.12 / min of audio (API pricing, USD-billed plans) */
  soundPerSecond: 0.12 / 60,
  /** ElevenLabs Music ≈ $0.15 / min */
  musicPerSecond: 0.15 / 60,
  /** ElevenLabs v4 Turbo via OpenRouter: $0.04 / 1k chars (measured $0.00276 for 69 chars) */
  voicePerChar: 0.00004,
} as const;

export type MediaKind = "image" | "sound" | "music" | "voice";
export const MEDIA_KINDS: readonly MediaKind[] = ["image", "sound", "music", "voice"];
export const isMediaKind = (k: unknown): k is MediaKind => typeof k === "string" && (MEDIA_KINDS as readonly string[]).includes(k);

export interface MediaParams {
  /** Seconds (sound 0.5–22, music 10–180; 180 = a world's music). */
  seconds?: number;
  /** Sounds: make it loop seamlessly (ambience). */
  loop?: boolean;
  /** Voice: a premade voice name (shared/life.ts VOICES). */
  voice?: string;
  /** Music: never sing, whatever the prompt says (a world's music: instrumental only, 2026-11-03). */
  instrumental?: boolean;
}

export const MEDIA_EXT: Record<string, string> = { webp: "image/webp", mp3: "audio/mpeg", wav: "audio/wav", png: "image/png" };

function store(buf: Buffer, ext: string, assetDir: string): string {
  const name = createHash("sha256").update(buf).digest("hex") + "." + ext;
  const path = join(assetDir, name);
  if (!existsSync(path)) writeFileSync(path, buf);
  return name;
}

const clampSeconds = (kind: MediaKind, s: unknown): number => {
  const n = typeof s === "number" && Number.isFinite(s) ? s : kind === "music" ? 30 : 5;
  return kind === "music" ? Math.max(10, Math.min(180, Math.round(n))) : Math.max(0.5, Math.min(22, n));
};

// ── Image ────────────────────────────────────────────────────────────

async function toWebp(png: Buffer): Promise<Buffer> {
  return sharp(png).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
}

const openrouterImage: Provider = {
  name: "openrouter-image",
  async generate(job) {
    const body = {
      model: IMAGE_MODEL,
      // Gemini-style models answer with text + image; pure image models refuse a "text" modality
      modalities: IMAGE_MODEL.startsWith("google/") ? ["image", "text"] : ["image"],
      usage: { include: true },
      messages: [{
        role: "user",
        content: `Make one image: ${job.prompt}\nSquare, richly detailed, no text or lettering unless asked, no borders.`,
      }],
    };
    job.archive({ call: "image.create", request: body });
    job.onProgress(10);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json", "X-Title": "Aweborn" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { images?: { image_url?: { url?: string } }[]; content?: string } }[];
      usage?: { cost?: number };
      error?: { message?: string };
    };
    const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? "";
    job.archive({ call: "image.result", status: res.status, model: IMAGE_MODEL, usage: json.usage, text: json.choices?.[0]?.message?.content, error: json.error, imageBytes: url.length });
    if (!res.ok || !url.startsWith("data:image/")) throw new Error(`image failed: ${res.status} ${json.error?.message ?? "no image"}`.trim());
    job.onProgress(80);
    const raw = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const asset = store(await toWebp(raw), "webp", job.assetDir);
    return { asset, costUsd: typeof json.usage?.cost === "number" ? json.usage.cost : MEDIA_USD.image };
  },
};

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Stub: a gradient card with the prompt on it (hue from the prompt's hash). */
const stubImage: Provider = {
  name: "stub-image",
  async generate(job) {
    job.archive({ call: "stub.image", request: { prompt: job.prompt } });
    const h = createHash("sha256").update(job.prompt).digest();
    const hue = h[0] / 255 * 360;
    const words = job.prompt.split(/\s+/).slice(0, 18);
    const lines: string[] = [];
    for (let i = 0; i < words.length; i += 4) lines.push(words.slice(i, i + 4).join(" "));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768">
      <defs><radialGradient id="g" cx="35%" cy="30%" r="90%">
        <stop offset="0" stop-color="hsl(${hue},80%,72%)"/><stop offset="0.55" stop-color="hsl(${(hue + 50) % 360},60%,38%)"/>
        <stop offset="1" stop-color="hsl(${(hue + 120) % 360},55%,12%)"/></radialGradient></defs>
      <rect width="768" height="768" fill="url(#g)"/>
      <circle cx="560" cy="210" r="${60 + (h[1] % 80)}" fill="hsla(${(hue + 200) % 360},90%,85%,0.35)"/>
      ${lines.map((l, i) => `<text x="64" y="${520 + i * 48}" font-family="sans-serif" font-size="40" fill="white" fill-opacity="0.9">${esc(l)}</text>`).join("")}
      <text x="64" y="96" font-family="sans-serif" font-size="26" fill="white" fill-opacity="0.6">preview (no image key)</text>
    </svg>`;
    job.onProgress(50);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return { asset: store(await toWebp(png), "webp", job.assetDir), costUsd: 0 };
  },
};

// ── Audio (ElevenLabs) ───────────────────────────────────────────────

/** ElevenLabs error body → a short reason (2026 shape: { detail: { code, message } }; 422 = list). */
function elevenReason(status: number, text: string): string {
  try {
    const d = (JSON.parse(text) as { detail?: unknown }).detail;
    if (d && typeof d === "object" && !Array.isArray(d)) {
      const { code, type, message } = d as { code?: string; type?: string; message?: string };
      return `${code ?? type ?? status}: ${message ?? ""}`.trim();
    }
    if (Array.isArray(d)) return `validation: ${JSON.stringify(d).slice(0, 200)}`;
  } catch { /* not JSON */ }
  return text.slice(0, 200);
}

async function elevenPost(job: ProviderJob, call: string, path: string, body: Record<string, unknown>): Promise<Buffer> {
  job.archive({ call, request: { path, ...body } });
  job.onProgress(15);
  const res = await fetch(`${ELEVEN}${path}`, {
    method: "POST",
    headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 600);
    job.archive({ call, status: res.status, error: text, requestId: res.headers.get("request-id") });
    // 401 quota_exceeded (old) / 402 insufficient_credits (new) / 429 concurrent_limit_exceeded: nothing is billed
    throw new Error(`elevenlabs ${res.status} ${elevenReason(res.status, text)}`.trim());
  }
  const buf = Buffer.from(await res.arrayBuffer());
  job.archive({ call, status: res.status, bytes: buf.length, requestId: res.headers.get("request-id") });
  if (buf.length > 30 * 1024 * 1024) throw new Error("audio too large");
  return buf;
}

/** Music without words unless the prompt asks for them (ElevenLabs sings by default). */
const wantsVocals = (prompt: string) => /\b(vocals?|voice|sing(s|ing|er)?|lyrics?|choir|chant(s|ing)?|song with words)\b/i.test(prompt);

function elevenProvider(kind: "sound" | "music"): Provider {
  return {
    name: `elevenlabs-${kind}`,
    async generate(job) {
      const p = (job.params ?? {}) as MediaParams;
      const seconds = clampSeconds(kind, p.seconds);
      let buf: Buffer;
      let costUsd: number;
      if (kind === "sound") {
        buf = await elevenPost(job, "eleven.sfx", "/sound-generation?output_format=mp3_44100_128", {
          text: job.prompt, duration_seconds: seconds, loop: !!p.loop, prompt_influence: 0.4, model_id: ELEVEN_SFX_MODEL,
        });
        costUsd = MEDIA_USD.soundPerSecond * seconds;
      } else {
        buf = await elevenPost(job, "eleven.music", "/music?output_format=mp3_44100_128", {
          prompt: job.prompt, music_length_ms: seconds * 1000, force_instrumental: p.instrumental === true || !wantsVocals(job.prompt),
          ...(ELEVEN_MUSIC_MODEL ? { model_id: ELEVEN_MUSIC_MODEL } : {}),
        });
        costUsd = MEDIA_USD.musicPerSecond * seconds;
      }
      return { asset: store(buf, "mp3", job.assetDir), costUsd };
    },
  };
}

// ── Voice (text-to-speech) ───────────────────────────────────────────

/** OpenRouter voice names (premade ElevenLabs voices; shared/life.ts VOICES has the palette). */
const VOICE_NAME = /^[a-z]{2,16}$/;

export interface SpeechResult { buf: Buffer; costUsd: number; model: string }

/**
 * Text-to-speech through OpenRouter (`POST /api/v1/audio/speech`): ElevenLabs v4 Turbo with
 * the premade voices, which passes the account's zero-data-retention rule (checked
 * 2026-11-01; OpenRouter's Gemini/OpenAI audio models don't). Audio tags like [whispers]
 * or [slowly] work. Billed $0.04 per 1,000 characters.
 */
export async function openrouterSpeech(text: string, voice: string, archive: (e: Record<string, unknown>) => void): Promise<SpeechResult> {
  const v = VOICE_NAME.test(voice) ? voice : "george";
  const body = { model: VOICE_MODEL, input: text, voice: v, response_format: "mp3" };
  archive({ call: "tts.create", request: body });
  const res = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json", "X-Title": "Aweborn" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("audio/")) {
    const err = (await res.text().catch(() => "")).slice(0, 400);
    archive({ call: "tts.result", status: res.status, error: err });
    throw new Error(`tts failed: ${res.status} ${err}`.trim());
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const costUsd = Math.round(MEDIA_USD.voicePerChar * text.length * 1e6) / 1e6;
  archive({ call: "tts.result", status: res.status, bytes: buf.length, generation: res.headers.get("x-generation-id"), costUsd });
  if (buf.length > 10 * 1024 * 1024) throw new Error("audio too large");
  return { buf, costUsd, model: VOICE_MODEL };
}

/** Synchronous voice line for minds (NPC replies): stored content-addressed, returns the file name. */
export async function speakLine(text: string, voice: string, assetDir: string, archive: (e: Record<string, unknown>) => void): Promise<{ asset: string; costUsd: number }> {
  if (!OPENROUTER_KEY) {
    archive({ call: "stub.voice", request: { text, voice } });
    return { asset: store(wav(synthStub("voice", text, 4)), "wav", assetDir), costUsd: 0 };
  }
  const out = await openrouterSpeech(text, voice, archive);
  return { asset: store(out.buf, "mp3", assetDir), costUsd: out.costUsd };
}

const voiceProvider: Provider = {
  name: "openrouter-voice",
  async generate(job) {
    const p = (job.params ?? {}) as MediaParams;
    job.onProgress(15);
    const out = await openrouterSpeech(job.prompt, typeof p.voice === "string" ? p.voice : "george", job.archive);
    return { asset: store(out.buf, "mp3", job.assetDir), costUsd: out.costUsd };
  },
};

// ── Stub audio: a small synth that writes a real WAV ─────────────────

const RATE = 22050;

function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-1, Math.min(1, samples[i])) * 32767 | 0, i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Deterministic per prompt: a pentatonic arpeggio (music), a shimmer/noise texture (sound), syllable blips (voice). */
export function synthStub(kind: Exclude<MediaKind, "image">, prompt: string, seconds: number): Float32Array {
  const seed = createHash("sha256").update(prompt).digest();
  let r = seed.readUInt32LE(0) || 1;
  const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = Math.round(RATE * (kind === "voice" ? Math.min(8, 0.5 + prompt.length / 14) : seconds));
  const out = new Float32Array(n);
  const root = 196 * Math.pow(2, (seed[4] % 12) / 12);
  const scale = [0, 2, 4, 7, 9, 12, 14];
  if (kind === "music") {
    const beat = Math.round(RATE * (0.18 + (seed[5] % 8) * 0.02));
    for (let i = 0, note = 0; i < n; i += beat, note++) {
      const f = root * Math.pow(2, scale[Math.floor(rand() * scale.length)] / 12) * (note % 8 === 0 ? 0.5 : 1);
      for (let j = 0; j < beat * 3 && i + j < n; j++) {
        const t = j / RATE;
        out[i + j] += 0.18 * Math.exp(-t * 3) * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t));
      }
    }
    for (let i = 0; i < n; i++) out[i] += 0.06 * Math.sin(2 * Math.PI * root * 0.5 * (i / RATE)); // drone
  } else if (kind === "sound") {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      lp += (rand() * 2 - 1 - lp) * 0.04;
      out[i] = 0.35 * lp + 0.08 * Math.sin(2 * Math.PI * root * 2 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * t));
    }
  } else {
    const syl = Math.round(RATE * 0.11);
    for (let i = 0; i < n; i += syl) {
      const f = 160 + rand() * 120;
      for (let j = 0; j < syl * 0.8 && i + j < n; j++) {
        const t = j / RATE;
        out[i + j] = 0.3 * Math.sin(Math.PI * j / (syl * 0.8)) * Math.sin(2 * Math.PI * f * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 7 * t));
      }
    }
  }
  // Fade edges (loop-friendly)
  const fade = Math.min(n >> 3, RATE * 0.05);
  for (let i = 0; i < fade; i++) { out[i] *= i / fade; out[n - 1 - i] *= i / fade; }
  return out;
}

function stubAudio(kind: Exclude<MediaKind, "image">): Provider {
  return {
    name: `stub-${kind}`,
    async generate(job) {
      const p = (job.params ?? {}) as MediaParams;
      job.archive({ call: `stub.${kind}`, request: { prompt: job.prompt, ...p } });
      job.onProgress(40);
      const buf = wav(synthStub(kind, job.prompt, Math.min(clampSeconds(kind, p.seconds), 20)));
      return { asset: store(buf, "wav", job.assetDir), costUsd: 0 };
    },
  };
}

export function mediaProvider(kind: MediaKind): Provider {
  if (kind === "image") return OPENROUTER_KEY ? openrouterImage : stubImage;
  // Voice goes through OpenRouter (works today); sound + music need the ElevenLabs key
  if (kind === "voice") return OPENROUTER_KEY ? voiceProvider : stubAudio(kind);
  return ELEVEN_KEY ? elevenProvider(kind) : stubAudio(kind);
}
