/**
 * Aweborn — SQLite Persistence Layer
 *
 * Stores serialized Yjs documents (state vectors) in a local SQLite database.
 * Used by the sync-service to persist world CRDTs and the universe CRDT
 * across server restarts.
 *
 * Data directory: server/data/ (created automatically)
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_DB_PATH =
  process.env.DB_PATH ??
  resolve(process.cwd(), "data/universe.db");

let db: Database.Database | null = null;

/**
 * Initialize the SQLite database. Creates the data directory and tables
 * if they don't exist.
 */
export function initDb(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL DEFAULT 'world',
      sector_key TEXT,
      state_vector BLOB NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(doc_type);
    CREATE INDEX IF NOT EXISTS idx_documents_sector ON documents(sector_key);
  `);

  console.log(`[persistence] database initialized at ${dbPath}`);
  return db;
}

/**
 * Get the active database instance. Throws if not initialized.
 */
function getDb(): Database.Database {
  if (!db) {
    throw new Error("[persistence] database not initialized — call initDb() first");
  }
  return db;
}

/**
 * Save a serialized Yjs document (state vector) to the database.
 * Upserts: creates if new, updates if existing.
 */
export function saveDoc(
  docId: string,
  stateVector: Uint8Array,
  docType: string = "world",
  sectorKey?: string
): void {
  const stmt = getDb().prepare(`
    INSERT INTO documents (id, doc_type, sector_key, state_vector, updated_at)
    VALUES (?, ?, ?, ?, unixepoch() * 1000)
    ON CONFLICT(id) DO UPDATE SET
      state_vector = excluded.state_vector,
      sector_key = excluded.sector_key,
      updated_at = excluded.updated_at
  `);
  stmt.run(docId, docType, sectorKey ?? null, Buffer.from(stateVector));
}

/**
 * Load a serialized Yjs document from the database.
 * Returns null if the document doesn't exist.
 */
export function loadDoc(docId: string): Uint8Array | null {
  const row = getDb()
    .prepare("SELECT state_vector FROM documents WHERE id = ?")
    .get(docId) as { state_vector: Buffer } | undefined;

  if (!row) return null;
  return new Uint8Array(row.state_vector);
}

/**
 * List all document IDs of a given type.
 */
export function listDocIds(docType: string = "world"): string[] {
  const rows = getDb()
    .prepare("SELECT id FROM documents WHERE doc_type = ?")
    .all(docType) as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * Delete a document from the database.
 */
export function deleteDoc(docId: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM documents WHERE id = ?")
    .run(docId);
  return result.changes > 0;
}

/**
 * Get metadata about stored documents (for stats/debugging).
 */
export function getStats(): { totalDocs: number; totalBytes: number; byType: Record<string, number> } {
  const total = getDb()
    .prepare("SELECT COUNT(*) as count, COALESCE(SUM(LENGTH(state_vector)), 0) as bytes FROM documents")
    .get() as { count: number; bytes: number };

  const byTypeRows = getDb()
    .prepare("SELECT doc_type, COUNT(*) as count FROM documents GROUP BY doc_type")
    .all() as { doc_type: string; count: number }[];

  const byType: Record<string, number> = {};
  for (const row of byTypeRows) {
    byType[row.doc_type] = row.count;
  }

  return {
    totalDocs: total.count,
    totalBytes: total.bytes,
    byType,
  };
}

/**
 * Close the database connection. Called during graceful shutdown.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.log("[persistence] database closed");
  }
}
