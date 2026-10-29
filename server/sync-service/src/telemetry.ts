/**
 * Flight telemetry (Phase 09, 9D rough draft).
 *
 * The flight authority (SimHost) hands over each character's checked state;
 * we keep a downsampled path: at most one sample per SAMPLE_MS per character,
 * and only when they moved or switched mode. Rows are buffered in memory and
 * written in one transaction per flush (RoomManager's 60 s flush + shutdown).
 * Rows older than RETENTION_MS are deleted on each flush, so storage stays
 * bounded (≈ 1,800 rows per hour of flight per character, 14 days).
 *
 * Read: admin-only `GET /api/admin/flight-path?player=<id>&from=<ms>&to=<ms>`.
 * The Privacy page says what's kept, for how long and why.
 *
 * Not yet (phases/09): heatmap rollups, interior movement, input log segments
 * (only positions are kept), an admin page (JSON only).
 */
import type Database from "better-sqlite3";
import type { FlightSimState } from "../../../shared/sim/flight.js";

export const SAMPLE_MS = 2000;
export const RETENTION_MS = 14 * 24 * 3600_000;
const MIN_MOVE = 0.5;
/** Buffer cap between flushes (a flood can't grow memory without bound). */
const MAX_BUFFER = 50_000;
const MAX_PATH_ROWS = 5000;

interface Last { t: number; x: number; y: number; z: number; mode: number }
export interface FlightSample { t: number; x: number; y: number; z: number; mode: "drive" | "neutral" }

export class FlightTelemetry {
  private buffer: Array<[string, number, number, number, number, number]> = [];
  private last = new Map<string, Last>();
  private dropped = 0;
  private insert: Database.Statement;
  private prune: Database.Statement;
  private writeAll: (rows: Array<[string, number, number, number, number, number]>) => void;

  constructor(private db: Database.Database, private now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS flight_samples (
      player_id TEXT NOT NULL, t INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, mode INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_flight_samples_player_t ON flight_samples(player_id, t);
      CREATE INDEX IF NOT EXISTS idx_flight_samples_t ON flight_samples(t);`);
    this.insert = db.prepare("INSERT INTO flight_samples (player_id, t, x, y, z, mode) VALUES (?, ?, ?, ?, ?, ?)");
    this.prune = db.prepare("DELETE FROM flight_samples WHERE t < ?");
    this.writeAll = db.transaction((rows: Array<[string, number, number, number, number, number]>) => {
      for (const r of rows) this.insert.run(...r);
    });
  }

  /** A checked state at time `t` (SimHost; offline replays pass the estimated time of the tick). */
  note(playerId: string, s: FlightSimState, neutral: boolean, t: number): void {
    const mode = neutral ? 1 : 0;
    const prev = this.last.get(playerId);
    if (prev) {
      if (t - prev.t < SAMPLE_MS) return;
      const moved = (s.px - prev.x) ** 2 + (s.py - prev.y) ** 2 + (s.pz - prev.z) ** 2 >= MIN_MOVE * MIN_MOVE;
      if (!moved && mode === prev.mode) return;
    }
    if (this.buffer.length >= MAX_BUFFER) {
      this.dropped++;
      return;
    }
    const row: Last = { t, x: s.px, y: s.py, z: s.pz, mode };
    if (this.last.size >= 20_000 && !prev) this.last.clear(); // bound memory; worst case one extra sample each
    this.last.set(playerId, row);
    this.buffer.push([playerId, Math.round(t), s.px, s.py, s.pz, mode]);
  }

  flush(): void {
    if (this.buffer.length > 0) {
      const rows = this.buffer;
      this.buffer = [];
      this.writeAll(rows);
    }
    this.prune.run(this.now() - RETENTION_MS);
  }

  /** One character's path between two times (oldest first, at most 5,000 points). */
  path(playerId: string, from: number, to: number): FlightSample[] {
    this.flush();
    const rows = this.db
      .prepare("SELECT t, x, y, z, mode FROM flight_samples WHERE player_id = ? AND t >= ? AND t <= ? ORDER BY t LIMIT ?")
      .all(playerId, from, to, MAX_PATH_ROWS) as Array<{ t: number; x: number; y: number; z: number; mode: number }>;
    return rows.map((r) => ({ t: r.t, x: r.x, y: r.y, z: r.z, mode: r.mode ? "neutral" : "drive" }));
  }

  stats(): { buffered: number; dropped: number } {
    return { buffered: this.buffer.length, dropped: this.dropped };
  }
}
