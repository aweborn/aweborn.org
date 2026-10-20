import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanChatText, maskProfanity, prepareChat, ChatLimiter, CHAT_MAX_CHARS, CHAT_BURST } from "./chat.js";

test("normal text in any language and emoji survives untouched", () => {
  for (const s of ["hello there!", "こんにちは世界", "Привет, мир", "مرحبا", "héllo wörld", "👋 hi 🌍", "👨‍👩‍👧 family", "a < b && c > d"]) {
    assert.equal(cleanChatText(s), s);
  }
});

test("markup and SQL are inert text: kept as typed, never interpreted", () => {
  // They are only ever rendered as React text nodes and stored in a binary CRDT, never joined into HTML or SQL.
  const xss = '<img src=x onerror=alert(1)><script>alert("x")</script>';
  assert.equal(cleanChatText(xss), xss);
  const sql = "'; DROP TABLE documents; --";
  assert.equal(cleanChatText(sql), sql);
});

test("control, invisible and direction-flipping characters are removed", () => {
  assert.equal(cleanChatText("a\u0000b\u0007c"), "abc");
  assert.equal(cleanChatText("pay\u202Egnp.exe"), "paygnp.exe");
  assert.equal(cleanChatText("zero\u200Bwidth\uFEFF"), "zerowidth");
  assert.equal(cleanChatText("line1\nline2\r\nline3"), "line1 line2 line3");
  assert.equal(cleanChatText("  lots   of   space  "), "lots of space");
});

test("lone surrogates, private-use and zalgo towers are stripped", () => {
  assert.equal(cleanChatText("x\uD800y"), "xy");
  assert.equal(cleanChatText("a\uE000b"), "ab");
  const zalgo = "a" + "\u0300".repeat(40);
  assert.equal(cleanChatText(zalgo), "\u00e0\u0300\u0300\u0300"); // NFC folds the first mark into à
});

test("non-strings and empties become empty; length is capped in characters", () => {
  for (const v of [null, undefined, 5, {}, [], "", "   ", "\u200B\u200B"]) assert.equal(cleanChatText(v), "");
  assert.equal(Array.from(cleanChatText("😀".repeat(500))).length, CHAT_MAX_CHARS);
  assert.ok(cleanChatText("x".repeat(100_000)).length <= CHAT_MAX_CHARS);
});

test("profanity is masked as whole words, including simple disguises, not inside innocent words", () => {
  assert.equal(maskProfanity("what the fuck"), "what the ****");
  assert.equal(maskProfanity("SHIT!"), "****!");
  assert.equal(maskProfanity("sh1t and f*ck"), "**** and ****");
  assert.equal(maskProfanity("fuuuck"), "******");
  assert.equal(maskProfanity("Scunthorpe, class, assassin, cocktail, Dickens"), "Scunthorpe, class, assassin, cocktail, Dickens");
  assert.equal(prepareChat("  hello   world "), "hello world");
});

test("rate limiter: minimum gap, then a burst cap per window", () => {
  const l = new ChatLimiter();
  assert.equal(l.check("a", 0), null);
  assert.equal(l.check("a", 100), "too_fast");
  assert.equal(l.check("b", 100), null); // others unaffected
  let t = 1000;
  for (let i = 1; i < CHAT_BURST; i++) {
    assert.equal(l.check("a", t), null);
    t += 1000;
  }
  assert.equal(l.check("a", t), "too_many");
  assert.equal(l.check("a", t + 31_000), null); // window passed
});
