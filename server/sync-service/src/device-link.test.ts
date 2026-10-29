/** QR device linking (M9): codes are single use, short-lived and capped. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LinkCodes, LINK_CODE_TTL_MS, normalizeCode } from "./device-link.js";

test("a code works once, for the same account and character", () => {
  const codes = new LinkCodes();
  const made = codes.create("u1", "p1")!;
  assert.match(made.code, /^[A-HJKMNP-Z2-9]{8}$/);
  const typed = made.code.toLowerCase().replace(/(.{4})/, "$1-");
  assert.deepEqual(codes.take(typed), { userId: "u1", playerId: "p1", expiresAt: made.expiresAt });
  assert.equal(codes.take(made.code), null);
});

test("codes expire after 5 minutes and are capped per account", () => {
  let now = 0;
  const codes = new LinkCodes(() => now);
  const a = codes.create("u1", null)!;
  codes.create("u1", null);
  codes.create("u1", null);
  assert.equal(codes.create("u1", null), null);
  assert.ok(codes.create("u2", null));
  now += LINK_CODE_TTL_MS + 1;
  assert.equal(codes.take(a.code), null);
  assert.ok(codes.create("u1", null)); // expired ones no longer count
  assert.equal(normalizeCode(" ab cd-ef "), "ABCDEF");
});
