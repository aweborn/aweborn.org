/**
 * One-off migration: legacy 5-char world IDs → permanent UUIDv4 (Milestone 8A).
 *
 * What it rewrites (in one SQLite transaction):
 *   - Universe CRDT (`__universe__` row): each `worlds` map key that isn't a
 *     UUIDv4 gets a new key; the entry is copied to it with `id` updated, and
 *     the old key is deleted. Done as Yjs ops on the existing doc so any stale
 *     client that reconnects merges the deletion instead of resurrecting it.
 *   - World docs (`documents` rows, doc_type='world'): row id renamed. World
 *     docs don't store their own ID internally, so content is untouched.
 *
 * Safety:
 *   - Stop the sync-service first (it holds docs in memory and flushes them).
 *   - Takes a consistent SQLite backup (incl. WAL) before writing.
 *   - Writes an old→new mapping JSON next to the DB.
 *   - Idempotent: a second run finds nothing to do.
 *
 * Usage (from server/sync-service):
 *   npx tsx scripts/migrate-world-ids.ts --db ../data/universe.db --dry-run
 *   npx tsx scripts/migrate-world-ids.ts --db ../data/universe.db
 */
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import * as Y from "yjs";
import { isWorldId } from "../../../shared/crdt-schema.js";

const UNIVERSE_DOC_ID = "__universe__";

// ── Args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dbArgIdx = args.indexOf("--db");
const dbPath = resolve(dbArgIdx >= 0 ? args[dbArgIdx + 1] : "data/universe.db");

if (!existsSync(dbPath)) {
  console.error(`DB not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// ── Load universe ────────────────────────────────────────────────────
function loadUniverse(): Y.Doc {
  const row = db.prepare("SELECT state_vector FROM documents WHERE id = ?").get(UNIVERSE_DOC_ID) as
    | { state_vector: Buffer }
    | undefined;
  const doc = new Y.Doc();
  if (row) Y.applyUpdate(doc, new Uint8Array(row.state_vector));
  return doc;
}

const universe = loadUniverse();
const worlds = universe.getMap<Y.Map<unknown>>("worlds");

const mapping: Record<string, string> = {};
for (const key of worlds.keys()) {
  if (!isWorldId(key)) mapping[key] = randomUUID();
}

const worldRows = db.prepare("SELECT id FROM documents WHERE doc_type = 'world'").all() as { id: string }[];
const orphanRows = worldRows.map((r) => r.id).filter((id) => !isWorldId(id) && !(id in mapping));

console.log(`DB: ${dbPath}`);
console.log(`Worlds in universe: ${worlds.size}  |  legacy IDs to migrate: ${Object.keys(mapping).length}`);
console.log(`World doc rows: ${worldRows.length}`);
for (const [oldId, newId] of Object.entries(mapping)) {
  const name = worlds.get(oldId)?.get("name");
  const hasRow = worldRows.some((r) => r.id === oldId);
  console.log(`  ${oldId} → ${newId}  "${name}"${hasRow ? "" : "  (no world doc yet; created lazily)"}`);
}
if (orphanRows.length) {
  console.log(`  ⚠ ${orphanRows.length} world doc row(s) with legacy IDs not in the universe (left untouched): ${orphanRows.join(", ")}`);
}

if (Object.keys(mapping).length === 0) {
  console.log("Nothing to migrate.");
  db.close();
  process.exit(0);
}
if (dryRun) {
  console.log("\n--dry-run: no changes written.");
  db.close();
  process.exit(0);
}

// ── Backup ───────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${dbPath}.pre-uuid-${stamp}.bak`;
await db.backup(backupPath);
console.log(`\nBackup written: ${backupPath}`);

// ── Rewrite universe CRDT (Yjs ops on the existing doc) ──────────────
universe.transact(() => {
  for (const [oldId, newId] of Object.entries(mapping)) {
    const oldMap = worlds.get(oldId)!;
    const newMap = new Y.Map<unknown>();
    for (const [k, v] of oldMap.entries()) newMap.set(k, v);
    newMap.set("id", newId);
    worlds.set(newId, newMap);
    worlds.delete(oldId);
  }
});

// ── Persist everything atomically ────────────────────────────────────
const saveUniverse = db.prepare(
  "UPDATE documents SET state_vector = ?, updated_at = unixepoch() * 1000 WHERE id = ?",
);
const renameWorld = db.prepare(
  "UPDATE documents SET id = ?, updated_at = unixepoch() * 1000 WHERE id = ? AND doc_type = 'world'",
);
db.transaction(() => {
  saveUniverse.run(Buffer.from(Y.encodeStateAsUpdate(universe)), UNIVERSE_DOC_ID);
  for (const [oldId, newId] of Object.entries(mapping)) renameWorld.run(newId, oldId);
})();

const mapPath = `${dbPath}.uuid-map-${stamp}.json`;
writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + "\n");
console.log(`Mapping written: ${mapPath}`);

// ── Verify from disk ─────────────────────────────────────────────────
const check = loadUniverse().getMap<Y.Map<unknown>>("worlds");
const problems: string[] = [];
if (check.size !== worlds.size) problems.push(`world count changed: ${worlds.size} → ${check.size}`);
for (const [key, m] of check.entries()) {
  if (!isWorldId(key)) problems.push(`non-UUID key remains: ${key}`);
  if (m.get("id") !== key) problems.push(`entry.id mismatch for ${key}: ${String(m.get("id"))}`);
}
const rowIds = new Set((db.prepare("SELECT id FROM documents WHERE doc_type = 'world'").all() as { id: string }[]).map((r) => r.id));
for (const oldId of Object.keys(mapping)) {
  if (rowIds.has(oldId)) problems.push(`world doc row still has legacy id: ${oldId}`);
}
db.close();

if (problems.length) {
  console.error("\n✖ Verification FAILED (restore from backup):\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`\n✔ Migrated ${Object.keys(mapping).length} world(s). All ${check.size} world IDs are UUIDv4.`);
