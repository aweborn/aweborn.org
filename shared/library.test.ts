import { test } from "node:test";
import assert from "node:assert/strict";
import { STANDARD_BLOCKS, SHAPES, cleanColor, snapToCell, stackedY } from "./library.js";

test("standard blocks and shapes are well formed and unique", () => {
  assert.equal(new Set(STANDARD_BLOCKS.map((b) => b.id)).size, STANDARD_BLOCKS.length);
  for (const b of STANDARD_BLOCKS) assert.equal(cleanColor(b.color, "bad"), b.color);
  assert.equal(new Set(SHAPES.map((s) => s.id)).size, SHAPES.length);
  assert.ok(SHAPES.some((s) => s.id === "cube") && SHAPES.some((s) => s.id === "cone") && SHAPES.some((s) => s.id === "torus"));
});

test("cleanColor only lets real hex colors into the shared document", () => {
  assert.equal(cleanColor("#FFAA00"), "#ffaa00");
  assert.equal(cleanColor("#fa0"), "#fa0");
  assert.equal(cleanColor("red"), "#cccccc");
  assert.equal(cleanColor("url(javascript:1)", "#111111"), "#111111");
  assert.equal(cleanColor(42), "#cccccc");
});

test("snapToCell lands on terrain cell centers", () => {
  assert.equal(snapToCell(3.2, 320), 3.5);
  assert.equal(snapToCell(-3.2, 320), -3.5); // cell [-4, -3) has its center at -3.5
  assert.equal(snapToCell(3.2, 31), 3);
  assert.equal(snapToCell(snapToCell(7.9, 320), 320), 7.5); // idempotent
});

test("stackedY puts a new block on top of the ones already in the column", () => {
  const at = (y: number, x = 2.5, z = 2.5, type = "block") => ({ type, x, y, z });
  assert.equal(stackedY(1.5, 2.5, 2.5, []), 1.5);
  assert.equal(stackedY(1.5, 2.5, 2.5, [at(1.5)]), 2.5);
  assert.equal(stackedY(1.5, 2.5, 2.5, [at(1.5), at(2.5), at(3.5)]), 4.5);
  assert.equal(stackedY(1.5, 2.5, 2.5, [at(1.5, 9.5)]), 1.5, "another column does not count");
  assert.equal(stackedY(1.5, 2.5, 2.5, [at(1.5, 2.5, 2.5, "model")]), 1.5, "only blocks stack");
});
