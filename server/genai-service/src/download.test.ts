import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamToFile, headSize, TooLarge } from "./download.js";

/** A server that sends `size` bytes, with or without Content-Length (chunked), in small pieces. */
async function serve(size: number, announce: boolean) {
  const body = Buffer.alloc(size, 7);
  const srv = createServer((req, res) => {
    if (announce) res.setHeader("Content-Length", String(size));
    if (req.method === "HEAD") return res.end();
    let i = 0;
    const push = () => {
      while (i < size) {
        const ok = res.write(body.subarray(i, Math.min(size, i + 65536)));
        i += 65536;
        if (!ok) return res.once("drain", push);
      }
      res.end();
    };
    push();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/model.glb`, body, close: () => srv.close() };
}

test("streams to disk under its content hash, and HEAD reports the size", async () => {
  const s = await serve(3 * 1024 * 1024, true);
  const dir = mkdtempSync(join(tmpdir(), "dl-"));
  try {
    assert.equal(await headSize(s.url), 3 * 1024 * 1024);
    const got = await streamToFile(s.url, dir, "glb");
    assert.equal(got.bytes, s.body.length);
    assert.equal(got.file, createHash("sha256").update(s.body).digest("hex") + ".glb");
    assert.deepEqual(readFileSync(join(dir, got.file)), s.body);
    assert.deepEqual(readdirSync(dir), [got.file], "no temp file left behind");
  } finally {
    s.close();
  }
});

test("refuses before downloading when HEAD says it's too big", async () => {
  const s = await serve(2 * 1024 * 1024, true);
  const dir = mkdtempSync(join(tmpdir(), "dl-"));
  try {
    await assert.rejects(streamToFile(s.url, dir, "glb", 1024 * 1024), TooLarge);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    s.close();
  }
});

test("stops mid-stream when there's no Content-Length and it passes the cap", async () => {
  const s = await serve(2 * 1024 * 1024, false);
  const dir = mkdtempSync(join(tmpdir(), "dl-"));
  try {
    await assert.rejects(streamToFile(s.url, dir, "glb", 1024 * 1024), /too large/);
    assert.deepEqual(readdirSync(dir), [], "the partial file is removed");
  } finally {
    s.close();
  }
});

