/**
 * Aweborn — universe.db snapshot job
 *
 * Run by the `sync-backup` CronJob (infra/k3s/sync-service-deployment.yaml)
 * with the same image as sync-service:
 *
 *   node dist/server/sync-service/src/backup.js
 *
 * 1. `VACUUM INTO` a temp file: an online, transactionally consistent copy
 *    that is safe while sync-service is writing (WAL mode).
 * 2. Verify it: `PRAGMA integrity_check` + the `documents` table is readable.
 * 3. gzip → hourly/universe-<UTC stamp>.db.gz (+ daily/ on the first run of
 *    each UTC day) and atomically refresh latest.db.gz + latest.json, which
 *    the off-box job (.github/workflows/backup.yml) fetches.
 * 4. Prune: keep the newest KEEP_HOURLY hourly and KEEP_DAILY daily files.
 *
 * Env: DB_PATH (source), BACKUP_DIR, KEEP_HOURLY (48), KEEP_DAILY (30).
 * Exits non-zero on any failure so the Job shows as failed.
 */

import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const DB_PATH = process.env.DB_PATH ?? "/data/universe.db";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "/backups";
const KEEP_HOURLY = Number(process.env.KEEP_HOURLY ?? 48);
const KEEP_DAILY = Number(process.env.KEEP_DAILY ?? 30);

export interface SnapshotMeta {
  file: string;
  createdAt: string;
  sha256: string;
  bytes: number;
  rawBytes: number;
  documents: number;
  worlds: number;
}

function log(msg: string): void {
  console.log(`[backup] ${msg}`);
}

/** `2026-10-11T02:05:00.123Z` → `20261011T020500Z` */
function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/** Write via temp file + rename so readers never see a partial file. */
function writeAtomic(path: string, data: Buffer | string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, { mode: 0o644 });
  renameSync(tmp, path);
}

/** Delete all but the newest `keep` files matching `universe-*.db.gz`. */
function prune(dir: string, keep: number): number {
  const files = readdirSync(dir)
    .filter((f) => /^universe-.+\.db\.gz$/.test(f))
    .sort() // UTC stamps sort chronologically
    .reverse();
  const old = files.slice(keep);
  for (const f of old) rmSync(join(dir, f));
  return old.length;
}

/** Verify a raw SQLite snapshot; returns document counts or throws. */
export function verifySnapshot(path: string): { documents: number; worlds: number } {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma("integrity_check", { simple: true });
    if (result !== "ok") throw new Error(`integrity_check: ${String(result)}`);
    const { documents } = db
      .prepare("SELECT COUNT(*) AS documents FROM documents")
      .get() as { documents: number };
    const { worlds } = db
      .prepare("SELECT COUNT(*) AS worlds FROM documents WHERE doc_type = 'world'")
      .get() as { worlds: number };
    return { documents, worlds };
  } finally {
    db.close();
  }
}

export function runBackup(now = new Date()): SnapshotMeta {
  if (!existsSync(DB_PATH)) throw new Error(`source DB not found: ${DB_PATH}`);

  const hourlyDir = join(BACKUP_DIR, "hourly");
  const dailyDir = join(BACKUP_DIR, "daily");
  mkdirSync(hourlyDir, { recursive: true });
  mkdirSync(dailyDir, { recursive: true });

  // 1. Consistent online snapshot. Opened read-write (WAL readers need the
  //    -shm file) but only reads; VACUUM INTO never touches the source.
  const raw = join(BACKUP_DIR, `.snapshot-${process.pid}.db`);
  rmSync(raw, { force: true });
  const src = new Database(DB_PATH, { fileMustExist: true });
  try {
    src.pragma("busy_timeout = 10000");
    src.prepare("VACUUM INTO ?").run(raw);
  } finally {
    src.close();
  }

  try {
    // 2. Verify before it can replace anything.
    const counts = verifySnapshot(raw);

    // 3. Compress + publish.
    const rawBuf = readFileSync(raw);
    const gz = gzipSync(rawBuf, { level: 9 });
    const sha256 = createHash("sha256").update(gz).digest("hex");
    const name = `universe-${stamp(now)}.db.gz`;

    writeAtomic(join(hourlyDir, name), gz);

    const day = now.toISOString().slice(0, 10).replace(/-/g, "");
    const haveToday = readdirSync(dailyDir).some((f) => f.startsWith(`universe-${day}`));
    if (!haveToday) copyFileSync(join(hourlyDir, name), join(dailyDir, name));

    const meta: SnapshotMeta = {
      file: name,
      createdAt: now.toISOString(),
      sha256,
      bytes: gz.length,
      rawBytes: rawBuf.length,
      ...counts,
    };
    writeAtomic(join(BACKUP_DIR, "latest.db.gz"), gz);
    writeAtomic(join(BACKUP_DIR, "latest.json"), JSON.stringify(meta, null, 2) + "\n");

    // 4. Retention.
    const prunedH = prune(hourlyDir, KEEP_HOURLY);
    const prunedD = prune(dailyDir, KEEP_DAILY);

    log(
      `ok ${name}: ${counts.documents} docs (${counts.worlds} worlds), ` +
        `${rawBuf.length} → ${gz.length} bytes, sha256 ${sha256.slice(0, 12)}…` +
        `${haveToday ? "" : " (+daily)"}; pruned ${prunedH} hourly, ${prunedD} daily`,
    );
    return meta;
  } finally {
    rmSync(raw, { force: true });
  }
}

// Run when invoked directly (not when imported).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runBackup();
    const total =
      readdirSync(join(BACKUP_DIR, "hourly")).length + readdirSync(join(BACKUP_DIR, "daily")).length;
    log(`${total} snapshots on disk in ${BACKUP_DIR}`);
  } catch (err) {
    console.error("[backup] FAILED:", err);
    process.exit(1);
  }
}
