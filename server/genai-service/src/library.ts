/**
 * Asset library + archive storage (Phase 07).
 *
 * Every generated file is kept forever, content-addressed, so any world can
 * reuse any creation (Alex, 2026-10-17: "a huge library of assets that others
 * can use"). Local disk is a cache; S3 is the source of truth when configured:
 *
 *   s3://$ASSETS_BUCKET/models/<sha256>.glb        public via $ASSETS_CDN_URL
 *   s3://$ASSETS_BUCKET/archive/calls/Y/M/D/<id>.json   private, research replay
 *
 * Without ASSETS_BUCKET (local dev) everything stays on disk and still works.
 */
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const BUCKET = process.env.ASSETS_BUCKET ?? "";
export const CDN_URL = (process.env.ASSETS_CDN_URL ?? "").replace(/\/$/, "");
const s3 = BUCKET && process.env.ASSETS_AWS_ACCESS_KEY_ID
  ? new S3Client({
      region: process.env.AWS_REGION ?? "us-east-1",
      credentials: { accessKeyId: process.env.ASSETS_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.ASSETS_AWS_SECRET_ACCESS_KEY ?? "" },
    })
  : null;
export const s3Enabled = () => !!s3;

export interface LibraryAsset {
  sha: string; file: string; kind: string; prompt: string; provider: string;
  bytes: number; s3: number; created_at: number;
}

export function initLibrary(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS library (
    sha TEXT PRIMARY KEY,          -- content hash = identity; the same file is one entry
    file TEXT NOT NULL,            -- <sha>.glb
    kind TEXT NOT NULL,            -- model | texture | music | …
    prompt TEXT NOT NULL,          -- what it was made from (search)
    provider TEXT NOT NULL,
    job_id TEXT, ref TEXT,
    bytes INTEGER NOT NULL,
    s3 INTEGER NOT NULL DEFAULT 0, -- uploaded to the bucket
    created_at INTEGER NOT NULL)`);
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3!.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Upload a model file (idempotent: content-addressed). */
export async function uploadModel(path: string, file: string): Promise<boolean> {
  if (!s3) return false;
  const key = `models/${file}`;
  if (await exists(key)) return true;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: readFileSync(path),
    ContentType: "model/gltf-binary", CacheControl: "public, max-age=31536000, immutable",
  }));
  return true;
}

/** Record a finished asset in the library and push it to S3. */
export async function addToLibrary(
  db: DatabaseSync, assetDir: string,
  a: { file: string; kind: string; prompt: string; provider: string; jobId: string; ref: string },
): Promise<void> {
  const path = join(assetDir, a.file);
  const bytes = existsSync(path) ? readFileSync(path).length : 0;
  db.prepare(`INSERT OR IGNORE INTO library (sha, file, kind, prompt, provider, job_id, ref, bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(a.file.replace(/\.\w+$/, ""), a.file, a.kind, a.prompt, a.provider, a.jobId, a.ref, bytes, Date.now());
  try {
    if (await uploadModel(path, a.file)) db.prepare("UPDATE library SET s3 = 1 WHERE file = ?").run(a.file);
  } catch (err) {
    console.error(`[library] upload ${a.file} failed (will retry on restart):`, (err as Error).message);
  }
}

/** One archive entry → its own private object (never lost if the box is). */
export function archiveToS3(entry: Record<string, unknown>): void {
  if (!s3) return;
  const d = new Date();
  const key = `archive/calls/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getTime()}-${randomUUID()}.json`;
  s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(entry), ContentType: "application/json" }))
    .catch((err) => console.error("[archive] s3 put failed:", (err as Error).message));
}

/**
 * Startup backfill: catalogue files made before the library existed, upload
 * anything not yet in S3, and ship the local archive file once.
 */
export async function backfill(db: DatabaseSync, assetDir: string, dataDir: string): Promise<void> {
  // Catalogue completed jobs whose file isn't in the library yet
  const jobs = db.prepare("SELECT id, ref, prompt, provider, asset FROM jobs WHERE status = 'complete' AND asset IS NOT NULL").all() as
    { id: string; ref: string; prompt: string; provider: string; asset: string }[];
  for (const j of jobs) {
    db.prepare(`INSERT OR IGNORE INTO library (sha, file, kind, prompt, provider, job_id, ref, bytes, created_at)
      VALUES (?, ?, 'model', ?, ?, ?, ?, ?, ?)`).run(j.asset.replace(/\.\w+$/, ""), j.asset, j.prompt, j.provider, j.id, j.ref,
      existsSync(join(assetDir, j.asset)) ? readFileSync(join(assetDir, j.asset)).length : 0, Date.now());
  }
  if (!s3) return;
  const pending = db.prepare("SELECT file FROM library WHERE s3 = 0").all() as { file: string }[];
  for (const { file } of pending) {
    const path = join(assetDir, file);
    if (!existsSync(path)) continue;
    try {
      if (await uploadModel(path, file)) db.prepare("UPDATE library SET s3 = 1 WHERE file = ?").run(file);
    } catch (err) {
      console.error(`[library] backfill ${file} failed:`, (err as Error).message);
    }
  }
  // Ship the local archive once (idempotent by name)
  const local = join(dataDir, "archive.jsonl");
  if (existsSync(local)) {
    const body = readFileSync(local);
    const key = `archive/legacy/archive-${body.length}.jsonl`;
    if (!(await exists(key))) await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: "application/x-ndjson" }));
  }
  if (pending.length) console.log(`[library] backfilled ${pending.length} files to s3`);
}

export function listLibrary(db: DatabaseSync, q: string, limit: number): LibraryAsset[] {
  const like = `%${q.replace(/[%_]/g, "")}%`;
  return db.prepare(`SELECT sha, file, kind, prompt, provider, bytes, s3, created_at FROM library
    WHERE prompt LIKE ? ORDER BY created_at DESC LIMIT ?`).all(like, limit) as unknown as LibraryAsset[];
}

export function assetFiles(assetDir: string): string[] {
  return existsSync(assetDir) ? readdirSync(assetDir).filter((f) => /^[a-f0-9]{64}\.glb$/.test(f)) : [];
}
