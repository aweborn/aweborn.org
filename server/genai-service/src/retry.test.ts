import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetryable, retryDelay, resumeTaskAfter, MAX_ATTEMPTS } from "./retry.js";

test("provider hiccups are retried", () => {
  for (const msg of [
    "meshy create failed: 429 Too many requests",
    "meshy create failed: 502",
    "meshy failed: Internal server error",
    "meshy failed:",
    "meshy timed out",
    "fetch failed",
    "download failed: 403",
    "elevenlabs 503 overloaded",
    "meshy rigging 500: oops",
  ]) assert.ok(isRetryable(msg), msg);
});

test("failures that would repeat are not", () => {
  for (const msg of [
    "meshy create failed: 400 prompt is required",
    "meshy refine failed: 402 Insufficient credits",
    "elevenlabs 401 bad key",
    "meshy rigging 422: Pose estimation failed",
    "image failed: 404 0 endpoints ... guardrail restrictions ... ZDR violation",
    "meshy failed: prompt violates our content policy",
    "bad animate params",
    "audio too large",
  ]) assert.equal(isRetryable(msg), false, msg);
});

test("backoff grows, then gives up", () => {
  assert.equal(retryDelay("meshy timed out", 1), 15_000);
  assert.equal(retryDelay("meshy timed out", 2), 60_000);
  assert.equal(retryDelay("meshy timed out", 3), 180_000);
  assert.equal(retryDelay("meshy timed out", MAX_ATTEMPTS), null);
  assert.equal(retryDelay("meshy create failed: 400 nope", 1), null);
});

test("resume point: failed task restarts, everything else keeps polling", () => {
  assert.equal(resumeTaskAfter(new Error("meshy failed: boom"), "abc"), null);
  assert.equal(resumeTaskAfter(new Error("meshy animations failed: boom"), "anim:abc"), null);
  assert.equal(resumeTaskAfter(new Error("meshy timed out"), "abc"), "abc");
  // The haze tree (prod, 2026-11-01): refine outran the clock, then finished at Meshy; keep polling it
  assert.ok(isRetryable("meshy refine timed out"));
  assert.equal(resumeTaskAfter(new Error("meshy refine timed out"), "refine:r:p"), "refine:r:p");
  assert.equal(resumeTaskAfter(new Error("download failed: 403"), "refine:r:p"), "refine:r:p");
  assert.equal(resumeTaskAfter(new Error("meshy refine failed: 503"), "prev"), "prev");
  assert.equal(resumeTaskAfter(new Error("meshy rigging 500: x"), "remesh:abc"), "remesh:abc");
  // The provider's own hint wins (a failed texture pass resumes from its preview)
  assert.equal(resumeTaskAfter(Object.assign(new Error("meshy failed: x"), { resumeTask: "prev" }), "refine:r:prev"), "prev");
});
