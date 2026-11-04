/**
 * Music theory for the universe's generative music (2026-11-03 grill; ROADMAP
 * "Audio — the universe breathes, and it sings"). Pure and deterministic so it
 * can be tested and so every player hears the same world sing the same way.
 *
 *   - Color: wonder that drifts. Mostly bright and hopeful (Lydian, open
 *     fifths), slowly passing through bittersweet minor chords and back.
 *   - Every world has its own version, seeded from its ID: its own key (near
 *     the universe's D, so crossfades don't clash), lead voice, swell tempo,
 *     chord pace and mood.
 *
 * The browser side (src/audio/music/) turns this into sound.
 */

// ── Seeds ────────────────────────────────────────────────────────────

/** The lead's timbre: CS-80 brass, a glass bell, a breathy flute or a wordless choir. */
export const LEAD_VOICES = ["brass", "glass", "flute", "choir"] as const;
export type LeadVoice = (typeof LEAD_VOICES)[number];

export interface MusicSeed {
  /** Key root, a pitch class (0 = C … 11 = B). */
  root: number;
  lead: LeadVoice;
  /** Seconds per slow swell of the pads (filter breathing). */
  swell: number;
  /** Average seconds a chord lasts. */
  chordSeconds: number;
  /** Resting mood, 0 = bright … 1 = bittersweet. The music drifts around it. */
  mood: number;
}

/** The universe's own music: D Lydian, a brass lead, slow. */
export const UNIVERSE_SEED: Readonly<MusicSeed> = Object.freeze({ root: 2, lead: "brass", swell: 19, chordSeconds: 13, mood: 0.3 });

/** Keys a world may sing in: D and its circle-of-fifths neighbours, so passing from space into a world never clashes hard. */
export const WORLD_ROOTS = [2, 9, 7, 4, 0, 11, 5] as const; // D A G E C B F

/** FNV-1a, 32-bit. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: small, fast, good enough for music. Returns floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A world's own version of the universe music, the same for everyone. */
export function seedFromId(id: string): MusicSeed {
  const r = rng(hash32(id));
  return {
    root: WORLD_ROOTS[Math.floor(r() * WORLD_ROOTS.length)],
    lead: LEAD_VOICES[Math.floor(r() * LEAD_VOICES.length)],
    swell: Math.round(10 + r() * 20),
    chordSeconds: Math.round(8 + r() * 8),
    mood: Math.round((0.15 + r() * 0.4) * 100) / 100,
  };
}

// ── Scale + chords ───────────────────────────────────────────────────

/** Lydian, in semitones above the root (the raised 4th is the colour of wonder). */
export const LYDIAN = [0, 2, 4, 6, 7, 9, 11] as const;

export interface ChordDef {
  id: string;
  /** Chord root, semitones above the key root. */
  root: number;
  /** Pitch classes relative to the key root; the first three are the essential ones. */
  tones: readonly number[];
  /** 0 = bright … 1 = bittersweet. */
  bitter: number;
  /** Open / suspended: never sounds like home. Used when the music should stay unresolved. */
  open?: boolean;
}

export const CHORDS: Readonly<Record<string, ChordDef>> = Object.freeze({
  I: { id: "I", root: 0, tones: [0, 4, 7, 2, 11], bitter: 0 },
  II: { id: "II", root: 2, tones: [2, 6, 9, 4], bitter: 0.08 }, // the Lydian signature
  V: { id: "V", root: 7, tones: [7, 11, 2, 9], bitter: 0.15 },
  Isus: { id: "Isus", root: 0, tones: [0, 7, 2, 9], bitter: 0.22, open: true },
  IIsus: { id: "IIsus", root: 2, tones: [2, 9, 4, 11], bitter: 0.3, open: true },
  Vsus: { id: "Vsus", root: 7, tones: [7, 2, 0, 9], bitter: 0.38, open: true },
  bVII: { id: "bVII", root: 10, tones: [10, 2, 5, 0], bitter: 0.5 },
  iii: { id: "iii", root: 4, tones: [4, 7, 11, 6], bitter: 0.55 },
  vi: { id: "vi", root: 9, tones: [9, 0, 4, 11, 7], bitter: 0.62 },
  vii: { id: "vii", root: 11, tones: [11, 2, 6, 9], bitter: 0.7 },
  bVI: { id: "bVI", root: 8, tones: [8, 0, 3, 10], bitter: 0.76 },
  iv: { id: "iv", root: 5, tones: [5, 8, 0, 7], bitter: 0.88 },
});

/** Which chords may follow which, with a base weight (before mood shapes it). */
const NEXT: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  I: { II: 4, V: 2, vi: 2, Isus: 1.5, iii: 1, bVII: 1, IIsus: 1 },
  II: { I: 4, V: 1.5, vi: 1.5, IIsus: 1, iii: 1, vii: 0.8 },
  V: { I: 2, II: 2, vi: 2, Vsus: 1, iii: 1 },
  Isus: { I: 2, II: 2, IIsus: 1.5, Vsus: 1, vi: 1 },
  IIsus: { II: 2, I: 1.5, Isus: 1.5, Vsus: 1, iii: 1 },
  Vsus: { V: 2, Isus: 1.5, I: 1.5, IIsus: 1, vi: 1 },
  bVII: { I: 3, Isus: 1.5, bVI: 1, IIsus: 1 },
  iii: { vi: 2.5, II: 2, IIsus: 1, iv: 1, I: 1 },
  vi: { II: 2.5, iii: 1.5, bVI: 1.5, iv: 1, V: 1, Isus: 1, I: 1 },
  vii: { iii: 2, vi: 2, II: 1.5, IIsus: 1 },
  bVI: { bVII: 2.5, iv: 1.5, I: 1.5, Isus: 1 },
  iv: { I: 2.5, bVI: 1.5, Isus: 1.5, II: 1 },
};

export interface ChordChoice {
  /** 0 = bright … 1 = bittersweet. */
  mood: number;
  /** 0 … 1: the Frontier edge / Ghost worlds. Above ~0.5 only open chords. */
  unresolved?: number;
}

/** The next chord: a weighted step from `prev`, pulled toward the mood. Never repeats. */
export function nextChord(prev: string, choice: ChordChoice, rand: () => number): ChordDef {
  const moves = NEXT[prev] ?? NEXT.I;
  const unresolved = choice.unresolved ?? 0;
  const entries: [ChordDef, number][] = [];
  for (const [id, base] of Object.entries(moves)) {
    const c = CHORDS[id];
    if (!c || id === prev) continue;
    const d = c.bitter - choice.mood;
    let w = base * Math.exp(-(d * d) / (2 * 0.22 * 0.22));
    if (unresolved > 0.5 && !c.open) w *= 0.04;
    else if (unresolved > 0 && c.open) w *= 1 + unresolved * 3;
    entries.push([c, w]);
  }
  if (unresolved > 0.5 && !entries.some(([c]) => c.open)) {
    // Nothing open follows this chord: step to the nearest suspended one
    for (const id of ["Isus", "IIsus", "Vsus"]) if (id !== prev) entries.push([CHORDS[id], 1]);
  }
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let pick = rand() * total;
  for (const [c, w] of entries) {
    pick -= w;
    if (pick <= 0) return c;
  }
  return entries[entries.length - 1][0];
}

/** The mood takes a small step each chord, drawn back toward where it rests. */
export function driftMood(mood: number, rest: number, rand: () => number): number {
  const m = mood + (rest - mood) * 0.18 + (rand() - 0.5) * 0.22;
  return Math.min(1, Math.max(0, m));
}

// ── Voicing ──────────────────────────────────────────────────────────

const pc = (n: number) => ((n % 12) + 12) % 12;

/** Every MIDI note in [low, high] whose pitch class is in `pcs`. */
function notesIn(pcs: readonly number[], low: number, high: number): number[] {
  const out: number[] = [];
  for (let n = low; n <= high; n++) if (pcs.includes(pc(n))) out.push(n);
  return out;
}

/**
 * Voice a chord for the pads: `voices` notes in [low, high], each a chord tone,
 * the essential tones covered first, moving as little as possible from `prev`
 * (smooth voice leading is what makes slow pads sound lush instead of blocky).
 *
 * `tones` are absolute pitch classes (key root already added).
 */
export function voiceChord(tones: readonly number[], prev: readonly number[] | null, voices: number, low = 50, high = 76): number[] {
  const n = Math.max(1, Math.min(6, Math.floor(voices)));
  const pcs = tones.map(pc);
  const pool = notesIn(pcs, low, high);
  if (!pool.length) return [];
  const essential = pcs.slice(0, Math.min(3, pcs.length));

  if (!prev || !prev.length) {
    // Open voicing from the bottom: root, then the rest spread at least a 4th apart
    const out: number[] = [];
    const order = [pcs[0], ...pcs.slice(1)];
    let floor = low;
    for (let i = 0; out.length < n; i++) {
      const want = order[i % order.length];
      const note = pool.find((x) => x >= floor && pc(x) === want) ?? pool.find((x) => x >= floor);
      if (note === undefined) break;
      out.push(note);
      floor = note + (out.length === 1 ? 7 : 4);
    }
    while (out.length < n) out.push(pool[Math.min(pool.length - 1, out.length)]);
    return out.sort((a, b) => a - b);
  }

  // Each old voice moves to its nearest chord tone…
  const from = [...prev].sort((a, b) => a - b).slice(0, n);
  while (from.length < n) from.push(from[from.length - 1] + 5);
  const out = from.map((p) => nearest(pool, p));
  // …then doubled notes give way to essential tones still missing.
  for (const want of essential) {
    if (out.some((x) => pc(x) === want)) continue;
    const counts = new Map<number, number>();
    for (const x of out) counts.set(pc(x), (counts.get(pc(x)) ?? 0) + 1);
    let idx = out.findIndex((x) => (counts.get(pc(x)) ?? 0) > 1 && !essential.slice(0, 1).includes(pc(x)));
    if (idx < 0) idx = out.findIndex((x) => (counts.get(pc(x)) ?? 0) > 1);
    if (idx < 0) break;
    const cands = pool.filter((x) => pc(x) === want);
    out[idx] = nearest(cands, out[idx]);
  }
  // No unisons: nudge an exact duplicate up an octave (or down, at the top)
  out.sort((a, b) => a - b);
  for (let i = 1; i < out.length; i++) {
    if (out[i] === out[i - 1]) out[i] = out[i] + 12 <= high ? out[i] + 12 : out[i] - 12;
  }
  return out.sort((a, b) => a - b);
}

function nearest(pool: readonly number[], target: number): number {
  let best = pool[0];
  for (const x of pool) if (Math.abs(x - target) < Math.abs(best - target)) best = x;
  return best;
}

/** The bass note for a chord: its root in [low, low + 11]. */
export function bassNote(keyRoot: number, chord: ChordDef, low = 33): number {
  const want = pc(keyRoot + chord.root);
  for (let n = low; n < low + 12; n++) if (pc(n) === want) return n;
  return low;
}

// ── Melody ───────────────────────────────────────────────────────────

export interface Note {
  /** MIDI note, or null for a rest. */
  midi: number | null;
  /** Seconds. */
  dur: number;
}

/**
 * A lead phrase over one chord: 3–7 long notes, chord tones on the strong
 * beats, steps through the Lydian scale between them, a rest to breathe.
 */
export function leadPhrase(keyRoot: number, chord: ChordDef, rand: () => number, opts: { low?: number; high?: number; from?: number | null; pace?: number } = {}): Note[] {
  const low = opts.low ?? 62;
  const high = opts.high ?? 81;
  const pace = opts.pace ?? 1;
  const chordPcs = chord.tones.map((t) => pc(keyRoot + t));
  const scale = notesIn(LYDIAN.map((t) => pc(keyRoot + t)), low, high);
  const tones = scale.filter((n) => chordPcs.includes(pc(n)));
  let cur = opts.from != null ? nearest(tones, opts.from) : tones[Math.floor(tones.length * (0.3 + rand() * 0.4))];
  const count = 3 + Math.floor(rand() * 5);
  const out: Note[] = [];
  for (let i = 0; i < count; i++) {
    const strong = i % 2 === 0;
    if (i > 0) {
      const idx = scale.indexOf(cur);
      if (strong) {
        // Leap to a chord tone (mostly nearby)
        const near = tones.filter((n) => Math.abs(n - cur) <= 7 && n !== cur);
        cur = near.length ? near[Math.floor(rand() * near.length)] : cur;
      } else {
        const step = rand() < 0.5 ? -1 : 1;
        cur = scale[Math.max(0, Math.min(scale.length - 1, idx + step))];
      }
    }
    const dur = (strong ? 1.4 + rand() * 2.2 : 0.7 + rand() * 1.1) * pace;
    out.push({ midi: cur, dur: Math.round(dur * 100) / 100 });
  }
  // End on a chord tone, held
  const last = out[out.length - 1];
  if (last.midi !== null && !chordPcs.includes(pc(last.midi))) last.midi = nearest(tones, last.midi);
  last.dur = Math.round((last.dur + 1.5) * 100) / 100;
  out.push({ midi: null, dur: Math.round((1 + rand() * 2) * 100) / 100 });
  return out;
}

/** High, sparse chord tones for the shimmer (bells through the echo). */
export function shimmerNotes(keyRoot: number, chord: ChordDef, rand: () => number, count: number, low = 74, high = 93): number[] {
  const pool = notesIn(chord.tones.map((t) => pc(keyRoot + t)), low, high);
  const out: number[] = [];
  for (let i = 0; i < count && pool.length; i++) out.push(pool[Math.floor(rand() * pool.length)]);
  return out;
}

/**
 * The home theme, heard near Origin (and inside it): a short call and answer
 * in D Lydian that leans on the raised 4th (G♯). Semitones above the root, from D4.
 */
export const HOME_THEME: readonly Note[] = Object.freeze([
  { midi: 7, dur: 1.6 }, // A
  { midi: 14, dur: 1.0 }, // E
  { midi: 12, dur: 0.8 }, // D
  { midi: 11, dur: 0.8 }, // C♯
  { midi: 12, dur: 3.0 }, // D
  { midi: null, dur: 1.2 },
  { midi: 7, dur: 1.4 }, // A
  { midi: 9, dur: 1.0 }, // B
  { midi: 6, dur: 2.0 }, // G♯ (the Lydian 4th)
  { midi: 4, dur: 3.4 }, // F♯
  { midi: null, dur: 2.0 },
]);

/** MIDI → Hz. */
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

