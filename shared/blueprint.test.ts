import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdit, parseEdit, parseDraft, DEFAULT_ASSET_SIZE, type BlueprintDraft } from "./blueprint.ts";

const draft = (): BlueprintDraft => {
  const p = parseDraft({
    name: "Tea garden",
    style: { artDirection: "soft watercolor", palette: ["#aabbcc"] },
    terrain: { size: [64, 16, 64], blocks: [{ id: "grass", color: "#33aa33" }] },
    assets: [
      { key: "lantern", kind: "model", prompt: "a paper lantern", size: [1, 2, 1] },
      { key: "teahouse", kind: "model", prompt: "a small teahouse" },
    ],
  });
  assert.ok(p.ok);
  return p.value;
};

test("parseEdit validates and clamps", () => {
  assert.deepEqual(parseEdit({ op: "remove", key: "Lantern" }), { ok: true, value: { op: "remove", key: "lantern" }, warnings: [] });
  const s = parseEdit({ op: "size", key: "lantern", factor: 100 });
  assert.ok(s.ok && s.value.op === "size" && s.value.factor === 4);
  assert.equal(parseEdit({ op: "size", key: "lantern", factor: -1 }).ok, false);
  assert.equal(parseEdit({ op: "size", key: "lantern", factor: Number.NaN }).ok, false);
  assert.equal(parseEdit({ op: "prompt", key: "lantern", prompt: "   " }).ok, false);
  const long = parseEdit({ op: "prompt", key: "lantern", prompt: "x".repeat(1000) });
  assert.ok(long.ok && long.value.op === "prompt" && long.value.prompt.length === 400);
  assert.equal(parseEdit({ op: "explode" }).ok, false);
  assert.equal(parseEdit(null).ok, false);
});

test("applyEdit never mutates and keeps other assets", () => {
  const d = draft();
  const before = JSON.stringify(d);
  const r = applyEdit(d, { op: "remove", key: "lantern" });
  assert.ok(r.ok);
  assert.deepEqual(r.value.assets.map((a) => a.key), ["teahouse"]);
  assert.equal(JSON.stringify(d), before);
});

test("applyEdit size scales from the given or default size, within 0.1–20 m", () => {
  const d = draft();
  const a = applyEdit(d, { op: "size", key: "lantern", factor: 2 });
  assert.ok(a.ok);
  assert.deepEqual(a.value.assets[0].size, [2, 4, 2]);
  const b = applyEdit(d, { op: "size", key: "teahouse", factor: 2 });
  assert.ok(b.ok);
  assert.deepEqual(b.value.assets[1].size, DEFAULT_ASSET_SIZE.map((v) => v * 2));
  let big: BlueprintDraft = d;
  for (let i = 0; i < 6; i++) {
    const r = applyEdit(big, { op: "size", key: "lantern", factor: 4 });
    assert.ok(r.ok);
    big = r.value;
  }
  assert.deepEqual(big.assets[0].size, [20, 20, 20]);
  const again = applyEdit(big, { op: "size", key: "lantern", factor: 4 });
  assert.ok(again.ok && again.warnings.length === 1);
});

test("applyEdit prompt, rename, unknown key", () => {
  const d = draft();
  const p = applyEdit(d, { op: "prompt", key: "teahouse", prompt: "a tiny moss-roofed teahouse" });
  assert.ok(p.ok && p.value.assets[1].prompt === "a tiny moss-roofed teahouse");
  const n = applyEdit(d, { op: "rename", name: "Moss garden" });
  assert.ok(n.ok && n.value.name === "Moss garden" && n.value.assets.length === 2);
  assert.equal(applyEdit(d, { op: "remove", key: "nope" }).ok, false);
});

test("every planned world has exactly one music asset, and it can't be removed", async () => {
  const { ensureWorldMusic, WORLD_MUSIC_KEY, WORLD_MUSIC_SECONDS, ASSET_MANA } = await import("./blueprint.ts");
  const { makeEstimate } = await import("./make-costs.ts");
  const d = draft();
  const before = JSON.stringify(d);
  const m = ensureWorldMusic(d);
  assert.equal(JSON.stringify(d), before, "never mutates");
  const music = m.assets.filter((a) => a.kind === "music");
  assert.equal(music.length, 1);
  assert.equal(music[0].key, WORLD_MUSIC_KEY);
  assert.match(music[0].prompt, /Tea garden/);
  assert.equal(ensureWorldMusic(m), m, "already has one: unchanged");
  const two = ensureWorldMusic({ ...m, assets: [...m.assets, { key: "song-2", kind: "music", prompt: "another", quality: "quick" }] });
  assert.equal(two.assets.filter((a) => a.kind === "music").length, 1);
  assert.equal(two.assets.find((a) => a.kind === "music")!.key, WORLD_MUSIC_KEY, "keeps the first");
  const r = applyEdit(m, { op: "remove", key: WORLD_MUSIC_KEY });
  assert.equal(r.ok, false);
  const reword = applyEdit(m, { op: "prompt", key: WORLD_MUSIC_KEY, prompt: "soft harp and rain" });
  assert.ok(reword.ok);
  assert.equal(ASSET_MANA.music.quick, makeEstimate("music", { seconds: WORLD_MUSIC_SECONDS }));
});
