/**
 * One-off migration: legacy session-ID creators → "system" (Milestone 8B, I1).
 *
 * Before persistent identity, `creator` was a throwaway per-tab session ID
 * (`p-xxxxxx`, sessionStorage). Those players can never be identified again,
 * so their worlds are reassigned to "system" (Alex, 2026-10-11).
 *
 * What it rewrites (in one SQLite transaction):
 *   - Universe CRDT (`__universe__` row): `worlds[*].creator`, as Yjs ops on
 *     the existing doc so stale clients merge the change.
 *   - World docs (`documents` rows, doc_type='world'): `meta.creator`.
 *
 * Safety:
 *   - Stop the sync-service first (it holds docs in memory and flushes them).
 *   - Takes a consistent SQLite backup (incl. WAL) before writing.
 *   - Idempotent: a second run finds nothing to do.
 *
 * Usage (from server/sync-service):
 *   npx tsx scripts/migrate-legacy-creators.ts --db ../data/universe.db --dry-run
 *   npx tsx scripts/migrate-legacy-creators.ts --db ../data/universe.db
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import * as Y from "yjs";

const UNIVERSE_DOC_ID = "__universe__";
const LEGACY_CREATOR = /^p-[a-z0-9]{6}$/;
const NEW_CREATOR = "system";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KNOWN = (c: unknown) => c === NEW_CREATOR || c === "guest" || (typeof c === "string" && UUID.test(c));

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

function loadDoc(id: string): Y.Doc {
  const row = db.prepare("SELECT state_vector FROM documents WHERE id = ?").get(id) as
    | { state_vector: Buffer }
    | undefined;
  const doc = new Y.Doc();
  if (row) Y.applyUpdate(doc, new Uint8Array(row.state_vector));
  return doc;
}

// ── Find legacy creators ─────────────────────────────────────────────
const universe = loadDoc(UNIVERSE_DOC_ID);
const worlds = universe.getMap<Y.Map<unknown>>("worlds");
const legacyWorlds = [...worlds.entries()].filter(([, m]) => LEGACY_CREATOR.test(String(m.get("creator"))));
const unknownWorlds = [...worlds.entries()].filter(
  ([, m]) => !LEGACY_CREATOR.test(String(m.get("creator"))) && !KNOWN(m.get("creator")),
);

const worldIds = (db.prepare("SELECT id FROM documents WHERE doc_type = 'world'").all() as { id: string }[]).map(
  (r) => r.id,
);
const worldDocs = new Map<string, Y.Doc>();
for (const id of worldIds) {
  const doc = loadDoc(id);
  if (LEGACY_CREATOR.test(String(doc.getMap("meta").get("creator")))) worldDocs.set(id, doc);
  else doc.destroy();
}

console.log(`DB: ${dbPath}`);
console.log(`Universe worlds: ${worlds.size}  |  legacy creators: ${legacyWorlds.length}`);
for (const [id, m] of legacyWorlds) console.log(`  ${id}  "${String(m.get("name"))}"  ${String(m.get("creator"))} → ${NEW_CREATOR}`);
console.log(`World docs: ${worldIds.length}  |  legacy meta.creator: ${worldDocs.size}`);
if (unknownWorlds.length) {
  console.log(`  ⚠ ${unknownWorlds.length} world(s) with an unrecognised creator (left untouched):`);
  for (const [id, m] of unknownWorlds) console.log(`    ${id}  ${JSON.stringify(m.get("creator"))}`);
}

if (legacyWorlds.length === 0 && worldDocs.size === 0) {
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
const backupPath = `${dbPath}.pre-creators-${stamp}.bak`;
await db.backup(backupPath);
console.log(`\nBackup written: ${backupPath}`);

// ── Rewrite (Yjs ops on the existing docs), persist atomically ───────
universe.transact(() => {
  for (const [, m] of legacyWorlds) m.set("creator", NEW_CREATOR);
});
for (const doc of worldDocs.values()) {
  doc.transact(() => doc.getMap("meta").set("creator", NEW_CREATOR));
}

const save = db.prepare("UPDATE documents SET state_vector = ?, updated_at = unixepoch() * 1000 WHERE id = ?");
db.transaction(() => {
  if (legacyWorlds.length) save.run(Buffer.from(Y.encodeStateAsUpdate(universe)), UNIVERSE_DOC_ID);
  for (const [id, doc] of worldDocs) save.run(Buffer.from(Y.encodeStateAsUpdate(doc)), id);
})();

// ── Verify from disk ─────────────────────────────────────────────────
const problems: string[] = [];
const check = loadDoc(UNIVERSE_DOC_ID).getMap<Y.Map<unknown>>("worlds");
if (check.size !== worlds.size) problems.push(`world count changed: ${worlds.size} → ${check.size}`);
for (const [id, m] of check.entries()) {
  if (LEGACY_CREATOR.test(String(m.get("creator")))) problems.push(`universe still has legacy creator: ${id}`);
}
for (const id of worldDocs.keys()) {
  if (LEGACY_CREATOR.test(String(loadDoc(id).getMap("meta").get("creator")))) {
    problems.push(`world doc still has legacy meta.creator: ${id}`);
  }
}
db.close();

if (problems.length) {
  console.error("\n✖ Verification FAILED (restore from backup):\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`\n✔ Reassigned ${legacyWorlds.length} universe entr(ies) and ${worldDocs.size} world doc(s) to "${NEW_CREATOR}".`);
