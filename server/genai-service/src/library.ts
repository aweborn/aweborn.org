/**
 * Asset library + archive storage (Phase 07).
 *
 * Every generated file is kept forever, content-addressed, so any world can
 * reuse any creation (Alex, 2026-10-17: "a huge library of assets that others
 * can use"). Local disk is a cache; S3 is the source of truth when configured:
 *
 *   s3://$ASSETS_BUCKET/models/<sha256>.glb        public via $ASSETS_CDN_URL
 *   s3://$ASSETS_BUCKET/media/<sha256>.webp|mp3|wav  pictures + sounds (Rough Draft M5)
 *   s3://$ASSETS_BUCKET/archive/calls/Y/M/D/<id>.json   private, research replay
 *
 * Without ASSETS_BUCKET (local dev) everything stays on disk and still works.
 */
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream, readdirSync, existsSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { ensureOptimizedIsolated, optPath } from "./optimize.js";
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
  bytes: number; s3: number; thumb: number; creator: string | null; created_at: number;
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
  // Added after launch: preview image uploaded; pseudonymous creator (hash of the player id)
  // removed_*: the trash. A removed asset is hidden from the library but never deleted until purged.
  for (const col of ["thumb INTEGER NOT NULL DEFAULT 0", "creator TEXT", "opt INTEGER NOT NULL DEFAULT 0",
    "removed_at INTEGER", "removed_by TEXT"]) {
    try { db.exec(`ALTER TABLE library ADD COLUMN ${col}`); } catch { /* already there */ }
  }
}

export interface TrashAsset extends LibraryAsset { removed_at: number; removed_by: string | null; }

/**
 * Move an asset to the trash. `onlyCreator` (the pseudonymous creator hash) restricts it to
 * that maker's own work; omit it for admins. Returns false if there's nothing to remove.
 */
export function removeAsset(db: DatabaseSync, sha: string, by: string, onlyCreator?: string): boolean {
  const r = db.prepare(`UPDATE library SET removed_at = ?, removed_by = ?
    WHERE sha = ? AND removed_at IS NULL ${onlyCreator ? "AND creator = ?" : ""}`)
    .run(Date.now(), by.slice(0, 40), sha, ...(onlyCreator ? [onlyCreator] : []));
  return Number(r.changes) > 0;
}

export function restoreAsset(db: DatabaseSync, sha: string): boolean {
  const r = db.prepare("UPDATE library SET removed_at = NULL, removed_by = NULL WHERE sha = ? AND removed_at IS NOT NULL").run(sha);
  return Number(r.changes) > 0;
}

export function listTrash(db: DatabaseSync): TrashAsset[] {
  return db.prepare(`SELECT sha, file, kind, prompt, provider, bytes, s3, thumb, creator, created_at, removed_at, removed_by
    FROM library WHERE removed_at IS NOT NULL ORDER BY removed_at DESC LIMIT 500`).all() as unknown as TrashAsset[];
}

/** Delete forever: only for items already in the trash. Removes the row, local copies and the bucket objects. */
export async function purgeAsset(db: DatabaseSync, assetDir: string, sha: string): Promise<boolean> {
  const row = db.prepare("SELECT file FROM library WHERE sha = ? AND removed_at IS NOT NULL").get(sha) as { file: string } | undefined;
  if (!row) return false;
  const isModel = row.file.endsWith(".glb");
  const png = row.file.replace(/\.glb$/, ".png");
  if (s3) {
    const keys = isModel ? [`models/${row.file}`, `models/opt/${row.file}`, `models/${png}`] : [`media/${row.file}`];
    for (const key of keys) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    }
  }
  const paths = isModel ? [join(assetDir, row.file), join(assetDir, png), optPath(assetDir, row.file)] : [join(assetDir, row.file)];
  for (const p of paths) rmSync(p, { force: true });
  // The startup backfill re-catalogues completed jobs; detach this one so it stays gone
  db.prepare("UPDATE jobs SET asset = NULL WHERE asset = ?").run(row.file);
  db.prepare("DELETE FROM library WHERE sha = ?").run(sha);
  return true;
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
    Bucket: BUCKET, Key: key, Body: createReadStream(path), ContentLength: statSync(path).size,
    ContentType: "model/gltf-binary", CacheControl: "public, max-age=31536000, immutable",
  }));
  return true;
}

/** Optimizing decodes a model many times over in memory; skip files the box can't safely handle. */
const OPT_MAX_BYTES = 30 * 1024 * 1024;

/**
 * Make sure a web-ready copy (models/opt/<file>) exists and is flagged. A copy
 * already in the bucket (e.g. made on a bigger machine for the giants) is just
 * adopted. The original stays untouched forever.
 */
export async function syncOptimized(db: DatabaseSync, assetDir: string, file: string): Promise<void> {
  const flag = () => db.prepare("UPDATE library SET opt = 1 WHERE file = ?").run(file);
  if (s3 && (await exists(`models/opt/${file}`))) return void flag();
  const src = join(assetDir, file);
  if (!existsSync(src) || statSync(src).size > OPT_MAX_BYTES) return;
  const out = await ensureOptimizedIsolated(assetDir, file);
  if (!out) return;
  if (s3) {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: `models/opt/${file}`, Body: createReadStream(out), ContentLength: statSync(out).size,
      ContentType: "model/gltf-binary", CacheControl: "public, max-age=31536000, immutable",
    }));
  }
  flag();
}

export { optPath };

/** Upload <sha>.png beside the model if we have one. */
export async function uploadThumb(db: DatabaseSync, assetDir: string, file: string): Promise<void> {
  const png = file.replace(/\.glb$/, ".png");
  const path = join(assetDir, png);
  if (!existsSync(path)) return;
  if (s3 && !(await exists(`models/${png}`))) {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: `models/${png}`, Body: createReadStream(path), ContentLength: statSync(path).size,
      ContentType: "image/png", CacheControl: "public, max-age=31536000, immutable",
    }));
  }
  db.prepare("UPDATE library SET thumb = 1 WHERE file = ?").run(file);
}

/** Record a finished asset in the library and push it to S3. */
export async function addToLibrary(
  db: DatabaseSync, assetDir: string,
  a: { file: string; kind: string; prompt: string; provider: string; jobId: string; ref: string; creator?: string | null },
): Promise<void> {
  const path = join(assetDir, a.file);
  const bytes = existsSync(path) ? statSync(path).size : 0;
  const creator = a.creator ? createHash("sha256").update(a.creator).digest("hex").slice(0, 6) : null;
  db.prepare(`INSERT OR IGNORE INTO library (sha, file, kind, prompt, provider, job_id, ref, bytes, creator, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(a.file.replace(/\.\w+$/, ""), a.file, a.kind, a.prompt, a.provider, a.jobId, a.ref, bytes, creator, Date.now());
  try {
    if (await uploadModel(path, a.file)) db.prepare("UPDATE library SET s3 = 1 WHERE file = ?").run(a.file);
    await uploadThumb(db, assetDir, a.file);
    await syncOptimized(db, assetDir, a.file);
  } catch (err) {
    console.error(`[library] upload ${a.file} failed (will retry on restart):`, (err as Error).message);
  }
}

const MEDIA_TYPES: Record<string, string> = { webp: "image/webp", mp3: "audio/mpeg", wav: "audio/wav" };

/** Upload a picture/sound to media/<file> (idempotent: content-addressed). */
export async function uploadMedia(path: string, file: string): Promise<boolean> {
  if (!s3) return false;
  const key = `media/${file}`;
  if (await exists(key)) return true;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: createReadStream(path), ContentLength: statSync(path).size,
    ContentType: MEDIA_TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream",
    CacheControl: "public, max-age=31536000, immutable",
  }));
  return true;
}

/** Record a finished picture/sound (no optimize or thumbnail step: the file is already web-sized). */
export async function addMedia(
  db: DatabaseSync, assetDir: string,
  a: { file: string; kind: string; prompt: string; provider: string; jobId: string; ref: string; creator?: string | null },
): Promise<void> {
  const path = join(assetDir, a.file);
  const bytes = existsSync(path) ? statSync(path).size : 0;
  const creator = a.creator ? createHash("sha256").update(a.creator).digest("hex").slice(0, 6) : null;
  // opt = 1, thumb = 1: nothing to optimize; a picture is its own preview
  db.prepare(`INSERT OR IGNORE INTO library (sha, file, kind, prompt, provider, job_id, ref, bytes, creator, opt, thumb, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`).run(a.file.replace(/\.\w+$/, ""), a.file, a.kind, a.prompt, a.provider, a.jobId, a.ref, bytes, creator, Date.now());
  try {
    if (await uploadMedia(path, a.file)) db.prepare("UPDATE library SET s3 = 1 WHERE file = ?").run(a.file);
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
  const jobs = db.prepare("SELECT id, ref, kind, prompt, provider, asset FROM jobs WHERE status = 'complete' AND asset IS NOT NULL").all() as
    { id: string; ref: string; kind: string; prompt: string; provider: string; asset: string }[];
  for (const j of jobs) {
    const model = j.kind === "model";
    // Pictures/sounds have nothing to optimize and are their own preview (opt = thumb = 1)
    db.prepare(`INSERT OR IGNORE INTO library (sha, file, kind, prompt, provider, job_id, ref, bytes, opt, thumb, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(j.asset.replace(/\.\w+$/, ""), j.asset, j.kind, j.prompt, j.provider, j.id, j.ref,
      existsSync(join(assetDir, j.asset)) ? statSync(join(assetDir, j.asset)).size : 0, model ? 0 : 1, model ? 0 : 1, Date.now());
  }
  for (const { file } of db.prepare("SELECT file FROM library WHERE opt = 0 AND kind = 'model'").all() as { file: string }[]) {
    try { await syncOptimized(db, assetDir, file); } catch (err) { console.error(`[library] optimize ${file} failed:`, (err as Error).message); }
  }
  if (!s3) return;
  const pendingThumbs = db.prepare("SELECT file FROM library WHERE thumb = 0 AND kind = 'model'").all() as { file: string }[];
  for (const { file } of pendingThumbs) {
    try { await uploadThumb(db, assetDir, file); } catch (err) { console.error(`[library] thumb ${file} failed:`, (err as Error).message); }
  }
  const pending = db.prepare("SELECT file, kind FROM library WHERE s3 = 0").all() as { file: string; kind: string }[];
  for (const { file, kind } of pending) {
    const path = join(assetDir, file);
    if (!existsSync(path)) continue;
    try {
      const up = kind === "model" ? uploadModel : uploadMedia;
      if (await up(path, file)) db.prepare("UPDATE library SET s3 = 1 WHERE file = ?").run(file);
    } catch (err) {
      console.error(`[library] backfill ${file} failed:`, (err as Error).message);
    }
  }
  // Ship the local archive once (idempotent by name)
  const local = join(dataDir, "archive.jsonl");
  if (existsSync(local)) {
    const size = statSync(local).size;
    const key = `archive/legacy/archive-${size}.jsonl`;
    if (!(await exists(key))) await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: createReadStream(local), ContentLength: size, ContentType: "application/x-ndjson" }));
  }
  if (pending.length) console.log(`[library] backfilled ${pending.length} files to s3`);
}

/** `kind` defaults to models so existing callers (the model library) never see pictures/sounds. */
export function listLibrary(db: DatabaseSync, q: string, limit: number, kind = "model"): LibraryAsset[] {
  const like = `%${q.replace(/[%_]/g, "")}%`;
  return db.prepare(`SELECT sha, file, kind, prompt, provider, bytes, s3, thumb, creator, created_at FROM library
    WHERE prompt LIKE ? AND kind = ? AND removed_at IS NULL ORDER BY created_at DESC LIMIT ?`).all(like, kind, limit) as unknown as LibraryAsset[];
}

export function assetFiles(assetDir: string): string[] {
  return existsSync(assetDir) ? readdirSync(assetDir).filter((f) => /^[a-f0-9]{64}\.glb$/.test(f)) : [];
}
