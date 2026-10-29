/**
 * SQLite home for the flight authority's last confirmed state per character
 * (Phase 09, 9C). One row per character, overwritten as they fly (written in
 * batches by SimHost.flush(), every 60 s and at shutdown); rows untouched for
 * 30 days are removed. It lets a reconnect after a deploy be checked against
 * where the character really was, instead of being taken as a fresh spawn.
 */
import type Database from "better-sqlite3";
import type { FlightSimState } from "../../../shared/sim/flight.js";
import type { SimStore } from "./sim-host.js";

const RETENTION_MS = 30 * 24 * 3600_000;

export function sqliteSimStore(db: Database.Database, now: () => number = Date.now): SimStore {
  db.exec(`CREATE TABLE IF NOT EXISTS sim_last_known (
    player_id TEXT PRIMARY KEY, state TEXT NOT NULL, at INTEGER NOT NULL)`);
  const get = db.prepare("SELECT state, at FROM sim_last_known WHERE player_id = ?");
  const put = db.prepare(
    "INSERT INTO sim_last_known (player_id, state, at) VALUES (?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET state = excluded.state, at = excluded.at",
  );
  const prune = db.prepare("DELETE FROM sim_last_known WHERE at < ?");
  const putAll = db.transaction((rows: Array<{ playerId: string; s: FlightSimState; at: number }>) => {
    for (const r of rows) {
      const s = r.s;
      put.run(r.playerId, JSON.stringify([s.px, s.py, s.pz, s.vx, s.vy, s.vz, s.qx, s.qy, s.qz, s.qw, s.dampen]), r.at);
    }
    prune.run(now() - RETENTION_MS);
  });
  return {
    load(playerId) {
      const row = get.get(playerId) as { state: string; at: number } | undefined;
      if (!row) return null;
      try {
        const a = JSON.parse(row.state) as unknown;
        if (!Array.isArray(a) || a.length !== 11 || !a.every((x) => typeof x === "number" && Number.isFinite(x))) return null;
        const [px, py, pz, vx, vy, vz, qx, qy, qz, qw, dampen] = a as number[];
        return { s: { px, py, pz, vx, vy, vz, qx, qy, qz, qw, dampen, slingId: null }, at: row.at };
      } catch {
        return null;
      }
    },
    save(rows) {
      if (rows.length > 0) putAll(rows);
    },
  };
}
