import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPlayerName, wandererTag } from "./names.js";

const ok = (raw: string) => {
  const r = cleanPlayerName(raw);
  assert.ok(r.ok, `${raw}: ${!r.ok ? r.message : ""}`);
  return r.ok ? r.name : "";
};
const bad = (raw: unknown) => assert.equal(cleanPlayerName(raw).ok, false, String(raw));

test("plain names pass, trimmed and squashed", () => {
  assert.equal(ok("  Stardust   Alex "), "Stardust Alex");
  ok("Zoë");
  ok("渡り鳥");
  ok("o'neil.k-9_x");
  ok("Model"); // starts with a reserved word, but isn't one
  ok("Systema");
});

test("length limits (2–20 characters)", () => {
  bad("a");
  bad("");
  bad("x".repeat(21));
  ok("x".repeat(20));
});

test("symbols, markup and leading punctuation are refused", () => {
  bad("<b>hi</b>");
  bad("hello!");
  bad("-dash");
  bad("🙂smile");
  bad(42);
  bad(null);
});

test("reserved words and their numbered variants are refused", () => {
  bad("admin");
  bad("Admin2");
  bad("A.W.E.B.O.R.N");
  bad("moderator");
  bad("system");
});

test("wandererTag is stable and four characters", () => {
  assert.equal(wandererTag("abc"), wandererTag("abc"));
  assert.match(wandererTag("player-123"), /^Wanderer [0-9A-Z]{4}$/);
});
