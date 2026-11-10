import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "aw-gate-")), "t.db");
const { initDb } = await import("./persistence.js");
const { setClassifierForTests, setImageClassifierForTests } = await import("./safety.js");
const { rateOutput, sweepUnrated, setGateFetchForTests, setGatePostForTests } = await import("./output-gate.js");

before(() => initDb());
afterEach(() => {
  setClassifierForTests(null);
  setImageClassifierForTests(null);
  setGateFetchForTests(null);
  setGatePostForTests(null);
});

const SHA = "a".repeat(64);
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const png = new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), { status: 200 });

/** genai stub: which files exist, and the ratings it was told (only ever raised, like the real one). */
function genai(files: Record<string, boolean>) {
  const ratings: Record<string, string> = {};
  setGateFetchForTests(async (url) => {
    const f = url.split("/assets/")[1];
    if (f) return files[f] ? png.clone() : new Response("", { status: 404 });
    return null;
  });
  setGatePostForTests(async (url, body) => {
    const sha = url.split("/library/")[1].split("/")[0];
    const r = (body as { rating: string }).rating;
    if (ratings[sha] !== "blocked") ratings[sha] = r;
    return ok({ rating: ratings[sha] });
  });
  return ratings;
}

test("a picture is judged by the image itself; a hit is blocked", async () => {
  const ratings = genai({ [`${SHA}.webp`]: true });
  setImageClassifierForTests(async () => ({ verdict: { allowed: false, category: "sexual", suggestion: "" }, costUsd: 0 }));
  assert.equal(await rateOutput({ sha: SHA, file: `${SHA}.webp`, kind: "image", prompt: "a sea at dusk" }, "p1"), "blocked");
  assert.equal(ratings[SHA], "blocked");
});

test("a model is judged by its preview render; without one, by its words", async () => {
  let ratings = genai({ [`${SHA}.png`]: true });
  let images = 0;
  setImageClassifierForTests(async () => (images++, { verdict: { allowed: true }, costUsd: 0 }));
  assert.equal(await rateOutput({ sha: SHA, file: `${SHA}.glb`, kind: "model", prompt: "a stone giant" }, null), "everyone");
  assert.equal(images, 1);
  assert.equal(ratings[SHA], "everyone");

  ratings = genai({});
  let words = 0;
  setClassifierForTests(async () => (words++, { verdict: { allowed: true }, costUsd: 0 }));
  assert.equal(await rateOutput({ sha: SHA, file: `${SHA}.glb`, kind: "model", prompt: "a mossy bridge" }, null), "everyone");
  assert.equal(words, 1);
});

test("when the check can't run, nothing is rated (it stays off the shelves and is tried again)", async () => {
  const ratings = genai({ [`${SHA}.png`]: true });
  setImageClassifierForTests(async () => ({ verdict: null, costUsd: 0 }));
  assert.equal(await rateOutput({ sha: SHA, file: `${SHA}.glb`, kind: "model", prompt: "a lamp" }, null), "unavailable");
  assert.equal(ratings[SHA], undefined);
});

test("a blocked file stays blocked even if a later check passes", async () => {
  const ratings = genai({});
  ratings[SHA] = "blocked";
  setClassifierForTests(async () => ({ verdict: { allowed: true }, costUsd: 0 }));
  assert.equal(await rateOutput({ sha: SHA, file: `${SHA}.mp3`, kind: "sound", prompt: "waves" }, null), "blocked");
});

test("the sweep rates a batch of unrated files", async () => {
  const B = "b".repeat(64);
  const ratings: Record<string, string> = {};
  setGateFetchForTests(async (url) =>
    url.includes("/library/unrated")
      ? ok({ assets: [{ sha: SHA, file: `${SHA}.mp3`, kind: "music", prompt: "harp", thumb: 1 }, { sha: B, file: `${B}.mp3`, kind: "sound", prompt: "bad words", thumb: 1 }] })
      : null);
  setGatePostForTests(async (url, body) => {
    const sha = url.split("/library/")[1].split("/")[0];
    ratings[sha] = (body as { rating: string }).rating;
    return ok({ rating: ratings[sha] });
  });
  setClassifierForTests(async (_ref, texts) => ({
    verdict: texts[0] === "bad words" ? { allowed: false, category: "hate", suggestion: "" } : { allowed: true }, costUsd: 0,
  }));
  assert.deepEqual(await sweepUnrated(), { rated: 1, blocked: 1, waiting: 0 });
  assert.deepEqual(ratings, { [SHA]: "everyone", [B]: "blocked" });
});
