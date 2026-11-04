import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { copyWorldSound, worldSoundDiffers } from "./universe.js";
import { judgeMapChange } from "../../../shared/world-policy.js";

const sha = (c: string) => c.repeat(64);

test("a world's music and ambient sound mirror into its universe entry, only well-formed", () => {
  const u = new Y.Doc(), w = new Y.Doc();
  const entry = u.getMap("worlds").set("w1", new Y.Map()) as Y.Map<unknown>;
  const meta = w.getMap("meta");
  assert.equal(worldSoundDiffers(entry, meta), false, "nothing on either side");

  meta.set("music", `${sha("a")}.mp3`);
  assert.equal(worldSoundDiffers(entry, meta), true);
  copyWorldSound(entry, meta);
  assert.equal(entry.get("music"), `${sha("a")}.mp3`);
  assert.equal(worldSoundDiffers(entry, meta), false);

  meta.set("ambientSound", `${sha("b")}.wav`);
  copyWorldSound(entry, meta);
  assert.equal(entry.get("ambientSound"), `${sha("b")}.wav`);

  // Junk never reaches the universe; clearing clears
  meta.set("music", "javascript:alert(1)");
  copyWorldSound(entry, meta);
  assert.equal(entry.has("music"), false);
  meta.delete("ambientSound");
  copyWorldSound(entry, meta);
  assert.equal(entry.has("ambientSound"), false);
});

test("only the world's makers may change its music (meta is owner-only)", () => {
  const f = `${sha("c")}.mp3`;
  assert.equal(judgeMapChange({ id: "p1", owner: true }, "meta", "music", undefined, f), "ok");
  assert.equal(judgeMapChange({ id: "p2", owner: false }, "meta", "music", undefined, f), "revert");
  assert.equal(judgeMapChange({ id: null, owner: false }, "meta", "music", f, undefined), "revert");
});
