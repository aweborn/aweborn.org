import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHORDS, HOME_THEME, LEAD_VOICES, LYDIAN, UNIVERSE_SEED, WORLD_ROOTS,
  bassNote, driftMood, hash32, hz, leadPhrase, nextChord, rng, seedFromId, shimmerNotes, voiceChord,
} from "./music.ts";

const pc = (n: number) => ((n % 12) + 12) % 12;

test("a world's seed is the same every time and stays in the family of keys", () => {
  const id = "5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7";
  assert.deepEqual(seedFromId(id), seedFromId(id));
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const s = seedFromId(`world-${i}`);
    assert.ok((WORLD_ROOTS as readonly number[]).includes(s.root));
    assert.ok((LEAD_VOICES as readonly string[]).includes(s.lead));
    assert.ok(s.swell >= 10 && s.swell <= 30);
    assert.ok(s.chordSeconds >= 8 && s.chordSeconds <= 16);
    assert.ok(s.mood >= 0.15 && s.mood <= 0.55);
    seen.add(`${s.root}:${s.lead}`);
  }
  assert.ok(seen.size > 15, "worlds should sound different from each other");
  assert.equal(UNIVERSE_SEED.root, 2);
});

test("hash + rng are deterministic and in range", () => {
  assert.equal(hash32("aweborn"), hash32("aweborn"));
  assert.notEqual(hash32("a"), hash32("b"));
  const r1 = rng(42), r2 = rng(42);
  for (let i = 0; i < 100; i++) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
});

test("every chord's tones are what it says, and the Lydian scale has the raised 4th", () => {
  assert.deepEqual([...LYDIAN], [0, 2, 4, 6, 7, 9, 11]);
  for (const c of Object.values(CHORDS)) {
    assert.ok(c.tones.includes(c.root), `${c.id} contains its root`);
    assert.ok(c.bitter >= 0 && c.bitter <= 1);
  }
});

test("chords never repeat, follow the mood, and stay open when unresolved", () => {
  const r = rng(7);
  let prev = "I";
  let brightSum = 0, bitterSum = 0;
  for (let i = 0; i < 400; i++) {
    const c = nextChord(prev, { mood: 0.05 }, r);
    assert.notEqual(c.id, prev);
    brightSum += c.bitter;
    prev = c.id;
  }
  prev = "I";
  for (let i = 0; i < 400; i++) {
    const c = nextChord(prev, { mood: 0.85 }, r);
    bitterSum += c.bitter;
    prev = c.id;
  }
  assert.ok(bitterSum > brightSum * 1.5, "a bittersweet mood picks more bittersweet chords");

  prev = "I";
  let open = 0;
  for (let i = 0; i < 300; i++) {
    const c = nextChord(prev, { mood: 0.3, unresolved: 1 }, r);
    if (c.open) open++;
    prev = c.id;
  }
  assert.ok(open / 300 > 0.85, `unresolved music stays on open chords (${open}/300)`);
});

test("the mood drifts but stays in [0, 1] and returns toward rest", () => {
  const r = rng(3);
  let m = 1;
  for (let i = 0; i < 200; i++) {
    m = driftMood(m, 0.3, r);
    assert.ok(m >= 0 && m <= 1);
  }
  assert.ok(Math.abs(m - 0.3) < 0.4);
});

test("pads: chord tones only, in range, essentials covered, smooth movement", () => {
  const key = 2;
  const abs = (id: string) => CHORDS[id].tones.map((t) => pc(key + t));
  let prev: number[] | null = null;
  const r = rng(11);
  let chord = "I";
  for (let i = 0; i < 100; i++) {
    const tones = abs(chord);
    const v = voiceChord(tones, prev, 4);
    assert.equal(v.length, 4);
    for (const n of v) {
      assert.ok(n >= 50 && n <= 76, `in range: ${n}`);
      assert.ok(tones.includes(pc(n)), `chord tone: ${n}`);
    }
    for (let j = 1; j < v.length; j++) assert.ok(v[j] > v[j - 1], "sorted, no unisons");
    const covered = tones.slice(0, 3).filter((t) => v.some((n) => pc(n) === t)).length;
    assert.ok(covered >= 2, `${chord}: essentials mostly covered (${covered}/3)`);
    if (prev) {
      const moved = v.reduce((s, n, k) => s + Math.abs(n - prev![k]), 0);
      assert.ok(moved <= 30, `smooth leading (${moved} semitones)`);
    }
    prev = v;
    chord = nextChord(chord, { mood: 0.4 }, r).id;
  }
  assert.equal(voiceChord(abs("I"), null, 1).length, 1);
});

test("bass sits on the chord root, low", () => {
  const n = bassNote(2, CHORDS.II);
  assert.equal(pc(n), 4);
  assert.ok(n >= 33 && n < 45);
});

test("lead phrases: in range, end on a chord tone, then breathe", () => {
  const r = rng(5);
  for (let i = 0; i < 50; i++) {
    const chord = Object.values(CHORDS)[i % Object.keys(CHORDS).length];
    const ph = leadPhrase(2, chord, r);
    assert.ok(ph.length >= 4 && ph.length <= 8);
    assert.equal(ph[ph.length - 1].midi, null, "ends with a rest");
    const last = ph[ph.length - 2].midi!;
    assert.ok(chord.tones.map((t) => pc(2 + t)).includes(pc(last)), "lands on a chord tone");
    for (const n of ph) {
      if (n.midi !== null) assert.ok(n.midi >= 62 && n.midi <= 81);
      assert.ok(n.dur > 0);
    }
  }
  assert.ok(shimmerNotes(2, CHORDS.I, r, 3).every((n) => n >= 74 && n <= 93));
});

test("home theme leans on the Lydian 4th and A4 is 440", () => {
  assert.ok(HOME_THEME.some((n) => n.midi === 6));
  assert.equal(hz(69), 440);
});

