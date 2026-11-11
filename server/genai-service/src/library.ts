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
 *   s3://$ASSETS_BUCKET/archive/backups/jobs.db.gz      private, hourly snapshot of jobs.db (versioned: 30 days)
 *
 * Without ASSETS_BUCKET (local dev) everything stays on disk and still works.
 */
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { createReadStream, readdirSync, existsSync, statSync, rmSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { ensureOptimizedIsolated, optPath, optSource } from "./optimize.js";
import type { DatabaseSync } from "node:sqlite";
import type { Readable } from "node:stream";
import { Upload } from "@aws-sdk/lib-storage";

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
  // rating (2026-11-10): what the output check decided. New rows start "unrated" and stay off the
  // public shelves until sync-service rates them (rateAsset). Rows from before this are rated by its sweep.
  for (const col of ["thumb INTEGER NOT NULL DEFAULT 0", "creator TEXT", "opt INTEGER NOT NULL DEFAULT 0",
    "removed_at INTEGER", "removed_by TEXT", "rating TEXT NOT NULL DEFAULT 'unrated'", "rated_at INTEGER",
    "quarantined INTEGER NOT NULL DEFAULT 0"]) {
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

/**
 * Stream a download straight into the bucket while it lands on disk (download.ts). The sha
 * is only known at the end, so it goes to incoming/<id> and is then copied to models/<sha>.
 * Multipart keeps memory at ~4 parts × 8 MB whatever the model's size.
 */
export function startStreamUpload(body: Readable): { finish(file: string): Promise<boolean> } | null {
  if (!s3) return null;
  const tmp = `incoming/${randomUUID()}`;
  const up = new Upload({
    client: s3, queueSize: 4, partSize: 8 * 1024 * 1024,
    params: { Bucket: BUCKET, Key: tmp, Body: body, ContentType: "model/gltf-binary" },
  });
  const done = up.done().then(() => true, (err) => {
    console.warn(`[library] streamed upload failed (uploadModel will retry): ${(err as Error).message}`);
    body.resume(); // never let a dead upload stall the download
    return false;
  });
  return {
    async finish(file) {
      if (!(await done)) return false;
      try {
        const key = `models/${file}`;
        if (!(await exists(key))) {
          await s3.send(new CopyObjectCommand({
            Bucket: BUCKET, CopySource: `${BUCKET}/${tmp}`, Key: key, MetadataDirective: "REPLACE",
            ContentType: "model/gltf-binary", CacheControl: "public, max-age=31536000, immutable",
          }));
        }
        return true;
      } catch (err) {
        console.warn(`[library] streamed upload copy failed: ${(err as Error).message}`);
        return false;
      } finally {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: tmp })).catch(() => {});
      }
    },
  };
}

/**
 * Optimizing decodes a model many times over in memory; skip files the box can't safely handle.
 * 30 MB fits the 2 GB box (genai limit 768 Mi). Raise OPT_MAX_MB after the 4 GB resize; until
 * then infra/opt-giants.sh builds the big ones' web copies elsewhere and the backfill adopts them.
 */
const OPT_MAX_BYTES = Number(process.env.OPT_MAX_MB ?? 30) * 1024 * 1024;

/**
 * Make sure a web-ready copy (models/opt/<file>) exists and is flagged. A copy
 * already in the bucket (e.g. made on a bigger machine for the giants) is just
 * adopted. The original stays untouched forever.
 */
export async function syncOptimized(db: DatabaseSync, assetDir: string, file: string): Promise<void> {
  const flag = () => db.prepare("UPDATE library SET opt = 1 WHERE file = ?").run(file);
  if (s3 && (await exists(`models/opt/${file}`))) return void flag();
  const src = optSource(assetDir, file); // a huge original's Meshy remesh, if any (providers.ts)
  if (!existsSync(src)) return;
  if (statSync(src).size > OPT_MAX_BYTES) {
    console.warn(`[library] ${file.slice(0, 8)} is ${(statSync(src).size / 1048576).toFixed(0)} MB, over OPT_MAX_MB: no web copy (phones get the original; see infra/opt-giants.sh)`);
    return;
  }
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

/**
 * `kind` defaults to models so existing callers (the model library) never see pictures/sounds.
 * Several kinds at once (the Library's Sounds shelf asks for sound + music + voice) come newest first together.
 */
export function listLibrary(db: DatabaseSync, q: string, limit: number, kind: string | readonly string[] = "model"): LibraryAsset[] {
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const kinds = typeof kind === "string" ? [kind] : kind.length ? [...kind] : ["model"];
  return db.prepare(`SELECT sha, file, kind, prompt, provider, bytes, s3, thumb, creator, created_at FROM library
    WHERE prompt LIKE ? AND kind IN (${kinds.map(() => "?").join(", ")}) AND removed_at IS NULL AND rating = 'everyone'
    ORDER BY created_at DESC LIMIT ?`)
    .all(like, ...kinds, limit) as unknown as LibraryAsset[];
}

export function assetFiles(assetDir: string): string[] {
  return existsSync(assetDir) ? readdirSync(assetDir).filter((f) => /^[a-f0-9]{64}\.glb$/.test(f)) : [];
}

// ── Ratings (2026-11-10, Phase 07 "Gaps before 18+") ──────────────────
/**
 * unrated < everyone < adult < blocked. A rating is only ever raised (the containment
 * rule: a tag is never lost), except by an admin. "adult" is reserved for 18+ worlds and
 * isn't set by anything yet; until 18+ ships, nothing but "everyone" is shown or served.
 */
export const RATINGS = ["unrated", "everyone", "adult", "blocked"] as const;
export type Rating = (typeof RATINGS)[number];
const rank = (r: string) => RATINGS.indexOf(r as Rating);

/** Set a rating. Returns the rating the row ends up with, or null if there's no such row. */
export function rateAsset(db: DatabaseSync, sha: string, rating: Rating, opts: { admin?: boolean } = {}): Rating | null {
  const row = db.prepare("SELECT rating FROM library WHERE sha = ?").get(sha) as { rating: string } | undefined;
  if (!row) return null;
  if (opts.admin || rank(rating) > rank(row.rating)) {
    db.prepare("UPDATE library SET rating = ?, rated_at = ? WHERE sha = ?").run(rating, Date.now(), sha);
    return rating;
  }
  return row.rating as Rating;
}

export function ratingOf(db: DatabaseSync, file: string): Rating | null {
  const row = db.prepare("SELECT rating FROM library WHERE file = ? OR sha = ?").get(file, file.replace(/\.\w+$/, "")) as { rating: string } | undefined;
  return row ? (row.rating as Rating) : null;
}

/** Rows waiting for the output check (oldest first), for sync-service's sweep. */
export function listUnrated(db: DatabaseSync, limit: number): Pick<LibraryAsset, "sha" | "file" | "kind" | "prompt" | "thumb">[] {
  return db.prepare(`SELECT sha, file, kind, prompt, thumb FROM library
    WHERE rating = 'unrated' AND removed_at IS NULL AND kind != 'npc-voice' ORDER BY created_at LIMIT ?`)
    .all(limit) as unknown as Pick<LibraryAsset, "sha" | "file" | "kind" | "prompt" | "thumb">[];
}

// ── jobs.db off the box (2026-11-10) ──────────────────────────────────
/**
 * The Library catalogue (prompts, makers, ratings, trash, job history) lives in jobs.db on the
 * box's disk; sync-service's backups only cover the world DB. Once an hour: a consistent copy
 * (VACUUM INTO), gzipped, to one private key. The bucket is versioned with 30-day expiry of old
 * versions, so that one key holds 30 days of hourly history. Restore: HANDOFF → Rebuild.
 */
export const JOBS_DB_BACKUP_KEY = "archive/backups/jobs.db.gz";

export async function backupJobsDb(db: DatabaseSync, dataDir: string): Promise<number | null> {
  if (!s3) return null;
  const tmp = join(dataDir, `jobs.backup-${process.pid}.db`);
  try {
    rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const body = gzipSync(readFileSync(tmp));
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: JOBS_DB_BACKUP_KEY, Body: body, ContentLength: body.length,
      ContentType: "application/gzip", CacheControl: "no-store", Metadata: { "taken-at": new Date().toISOString() },
    }));
    return body.length;
  } finally {
    rmSync(tmp, { force: true });
  }
}

// ── Blocked files leave the public CDN (2026-11-10) ────────────────────
const DISTRIBUTION = process.env.ASSETS_DISTRIBUTION_ID ?? "";
const cf = s3 && DISTRIBUTION && process.env.ASSETS_AWS_ACCESS_KEY_ID
  ? new CloudFrontClient({
      region: "us-east-1",
      credentials: { accessKeyId: process.env.ASSETS_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.ASSETS_AWS_SECRET_ACCESS_KEY ?? "" },
    })
  : null;

/**
 * Take a blocked file off the public prefixes: copy each public object to private
 * archive/blocked/<key> (kept: review, and legal preservation), delete the public one,
 * invalidate it at the CDN, and mark the row. Needs the narrow delete + invalidation
 * permissions in cloudformation-assets.yml; until those are applied it logs and the
 * startup backfill tries again. /assets already answers 410 for blocked files.
 */
export async function quarantineBlocked(db: DatabaseSync, sha: string): Promise<boolean> {
  if (!s3) return false;
  const row = db.prepare("SELECT file, kind FROM library WHERE sha = ? AND rating = 'blocked' AND quarantined = 0").get(sha) as { file: string; kind: string } | undefined;
  if (!row) return false;
  const keys = row.kind === "model"
    ? [`models/${row.file}`, `models/opt/${row.file}`, `models/${sha}.png`]
    : [`media/${row.file}`];
  const gone: string[] = [];
  for (const key of keys) {
    if (!(await exists(key))) continue;
    await s3.send(new CopyObjectCommand({ Bucket: BUCKET, CopySource: `${BUCKET}/${key}`, Key: `archive/blocked/${key}`, CacheControl: "no-store" }));
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    gone.push(`/${key}`);
  }
  if (gone.length && cf) {
    await cf.send(new CreateInvalidationCommand({
      DistributionId: DISTRIBUTION,
      InvalidationBatch: { CallerReference: `blocked-${sha.slice(0, 16)}-${Date.now()}`, Paths: { Quantity: gone.length, Items: gone } },
    }));
  }
  db.prepare("UPDATE library SET quarantined = 1 WHERE sha = ?").run(sha);
  console.log(`[library] blocked ${sha.slice(0, 8)}: ${gone.length} public file(s) moved to archive/blocked`);
  return true;
}

/** Startup: anything blocked but still public (e.g. before the permissions existed). */
export async function quarantinePending(db: DatabaseSync): Promise<void> {
  for (const { sha } of db.prepare("SELECT sha FROM library WHERE rating = 'blocked' AND quarantined = 0").all() as { sha: string }[]) {
    try { await quarantineBlocked(db, sha); } catch (err) { console.error(`[library] quarantine ${sha.slice(0, 8)} failed:`, (err as Error).message); }
  }
}
