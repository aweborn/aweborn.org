/**
 * Streaming downloads (2026-11-01). Meshy hands back GLBs of 300 MB+ (a lilac
 * tree measured 313 MB); reading one whole into memory (`arrayBuffer()`) blew
 * the 2 GB box's memory, the kernel killed genai mid-job, the job resumed on
 * restart and did it again, and the VPS froze. Now:
 *
 *   1. HEAD first: refuse anything over the hard cap before a byte moves.
 *   2. Stream the body to a temp file on disk, hashing as it goes (memory stays
 *      at one chunk), and stop the moment it passes the cap (no Content-Length
 *      or a lying one).
 *   3. Rename to its content address (`<sha256>.<ext>`), or drop it if we
 *      already have that file.
 */
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

/** Nothing we keep is bigger than this (disk is 60 GB; a Meshy original is 20–350 MB). */
export const DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024;

export class TooLarge extends Error {
  constructor(readonly bytes: number) {
    super(`asset too large (${Math.round(bytes / 1048576)} MB)`);
  }
}

/** Content-Length from a HEAD, or null when the server doesn't say (or refuses HEAD). */
export async function headSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
    const n = Number(res.headers.get("content-length"));
    return res.ok && Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Download `url` into `dir` as `<sha256>.<ext>` without holding it in memory.
 * Returns the file name and its size. Throws TooLarge past `maxBytes`.
 */
export async function streamToFile(url: string, dir: string, ext: string, maxBytes = DOWNLOAD_MAX_BYTES): Promise<{ file: string; bytes: number }> {
  const announced = await headSize(url);
  if (announced !== null && announced > maxBytes) throw new TooLarge(announced);
  const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length;
      if (bytes > maxBytes) return done(new TooLarge(bytes));
      hash.update(chunk);
      done(null, chunk);
    },
  });
  const tmp = join(dir, `.download-${randomBytes(6).toString("hex")}`);
  try {
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), meter, createWriteStream(tmp));
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  const file = `${hash.digest("hex")}.${ext}`;
  const path = join(dir, file);
  if (existsSync(path)) rmSync(tmp, { force: true });
  else renameSync(tmp, path);
  return { file, bytes };
}

