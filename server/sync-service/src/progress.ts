/**
 * Progress: awe = the character's experience (Rough Draft M3, 2026-10-27).
 *
 * One row per character (XP, skill uses, explorer stats, the highest chapter
 * reached) plus an append-only `xp_event` log. Every grant has a kind and,
 * where it can repeat, a ref, so retries never double-count: (character,
 * kind, ref) is unique.
 *
 * Sources: server-observed (entering a world, first visits, reactions,
 * settled creations, planting a world) and client-reported (piloting and
 * building skills, flight distance), the same cheap-check trust level as
 * World Index sightings until Phase 09 derives them on the server.
 *
 * Awe never touches the ledger or the high-water line (Alex, 2026-10-27).
 */

import type Database from "better-sqlite3";
import type { PlayerProgress } from "../../../shared/crdt-schema.js";
import {
  SKILLS,
  WARP_CHAPTER,
  XP,
  chapterFor,
  creationXp,
  emptyStats,
  levelFor,
  masteredCount,
  masteryUses,
  progressView,
  type ProgressStats,
  type ProgressView,
  type Skill,
} from "../../../shared/progress.js";

/** Characters that existed before the ladder shipped start at Maker (they've already played; caps unchanged). */
const LEGACY_FLOOR = 5;
/** Fastest flight is 80 u/s; allow a little slack per report. */
const MAX_FLIGHT_SPEED = 100;
const FLIGHT_SLACK = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Row {
  character_id: string;
  xp: number;
  stats: string;
  chapter: number;
  floor: number;
  level_at_warp: number | null;
  flight_at: number | null;
}

/** What changed, for the client's toasts. */
export interface ProgressDelta {
  xp: number;
  level?: number;
  chapter?: number;
}

export class Progress {
  constructor(
    private db: Database.Database,
    /** Worlds inside the Frontier now (explorer thresholds shrink with a sparse universe). */
    private worldsInFrontier: () => number = () => 10,
    private now: () => number = Date.now,
  ) {
    const fresh = !db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'progress'`).get();
    db.exec(`
      CREATE TABLE IF NOT EXISTS progress (
        character_id  TEXT PRIMARY KEY,
        xp            INTEGER NOT NULL DEFAULT 0,
        stats         TEXT    NOT NULL,
        chapter       INTEGER NOT NULL DEFAULT 1,
        floor         INTEGER NOT NULL DEFAULT 1,
        warp_at       INTEGER,
        level_at_warp INTEGER,
        flight_at     INTEGER,
        updated_at    INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS xp_event (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT    NOT NULL,
        kind         TEXT    NOT NULL,
        amount       INTEGER NOT NULL,
        ref          TEXT,
        at           INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS xp_event_ref ON xp_event(character_id, kind, ref) WHERE ref IS NOT NULL;
      CREATE INDEX IF NOT EXISTS xp_event_char_at ON xp_event(character_id, at);
    `);
    const hasCharacters = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'character'`).get();
    if (fresh && hasCharacters) {
      // One-time: everyone who already played keeps what they had (Maker caps).
      const stats = JSON.stringify(emptyStats());
      db.prepare(
        `INSERT OR IGNORE INTO progress (character_id, stats, chapter, floor, updated_at)
         SELECT id, ?, ?, ?, ? FROM character`,
      ).run(stats, LEGACY_FLOOR, LEGACY_FLOOR, this.now());
    }
  }

  // ── Reading ──────────────────────────────────────────────────────

  view(characterId: string): ProgressView & { levelsSinceWarp: number } {
    const r = this.load(characterId);
    const stats = parseStats(r.stats);
    const v = progressView(r.xp, stats, r.chapter, this.worldsInFrontier());
    return { ...v, levelsSinceWarp: r.level_at_warp === null ? 0 : Math.max(0, v.level - r.level_at_warp) };
  }

  /** What admission needs (`baseCap`). */
  playerProgress(characterId: string): PlayerProgress {
    const v = this.view(characterId);
    return { chapter: v.chapter, warpUnlocked: v.warpUnlocked, levelsSinceWarp: v.levelsSinceWarp };
  }

  // ── Events ───────────────────────────────────────────────────────

  /** A skill used successfully `n` times (client-reported ones are capped by the caller). */
  useSkill(characterId: string, skill: Skill, n = 1): ProgressDelta {
    return this.mutate(characterId, (r, stats) => {
      const before = stats.skills[skill] ?? 0;
      const after = before + Math.max(1, Math.floor(n));
      stats.skills[skill] = after;
      let xp = 0;
      if (before === 0) xp += this.grant(r, "skill", XP.skillFirst, skill);
      const m = masteryUses(skill);
      if (before < m && after >= m) xp += this.grant(r, "mastery", XP.skillMastered, skill);
      return xp;
    });
  }

  /** First sighting of a world by this character's account. */
  sighted(characterId: string, worldId: string): ProgressDelta {
    return this.mutate(characterId, (r, stats) => {
      const xp = this.grant(r, "sighting", XP.sighting, worldId);
      if (xp > 0) stats.sightings += 1;
      return xp;
    });
  }

  /** First visit (server-observed): shared awe doubles it. */
  firstVisit(characterId: string, worldId: string, companions: number): ProgressDelta {
    return this.mutate(characterId, (r, stats) => {
      const xp = this.grant(r, "visit", XP.firstVisit * (companions > 0 ? 2 : 1), worldId);
      if (xp > 0) stats.visits += 1;
      return xp;
    });
  }

  /** Someone else's first visit to a world you made: the main XP source for makers. */
  reaction(creatorId: string, worldId: string, visitorAccountId: string): ProgressDelta {
    return this.mutate(creatorId, (r) => this.grant(r, "reaction", XP.reaction, `${worldId}:${visitorAccountId}`));
  }

  /** A creation settled: concave XP, capped per rolling day, plus the skill use. */
  creation(characterId: string, mana: number, ref: string, skill: Skill = "mesh"): ProgressDelta {
    const d = this.useSkill(characterId, skill);
    const more = this.mutate(characterId, (r) => {
      const today = (this.db
        .prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM xp_event WHERE character_id = ? AND kind = 'creation' AND at >= ?`)
        .get(characterId, this.now() - DAY_MS) as { s: number }).s;
      const amount = Math.min(creationXp(mana), Math.max(0, XP.creationDailyMax - today));
      return amount > 0 ? this.grant(r, "creation", amount, ref) : 0;
    });
    return merge(d, more);
  }

  /**
   * Flight since the last report (client-reported, warp leaps excluded).
   * Cheap check: never more than max speed × elapsed time.
   */
  flight(characterId: string, distance: number, farthest: number): ProgressDelta {
    return this.mutate(characterId, (r, stats) => {
      const now = this.now();
      const elapsed = r.flight_at === null ? 60_000 : Math.min(10 * 60_000, now - r.flight_at);
      r.flight_at = now;
      const d = clampNum(distance, 0, (MAX_FLIGHT_SPEED * elapsed) / 1000 + FLIGHT_SLACK);
      const steps0 = Math.floor(stats.distance / XP.distanceStep);
      stats.distance += d;
      stats.farthest = Math.max(stats.farthest, clampNum(farthest, 0, 1e7));
      let xp = 0;
      for (let s = steps0 + 1; s <= Math.floor(stats.distance / XP.distanceStep); s++) xp += this.grant(r, "distance", XP.distance, String(s));
      return xp;
    });
  }

  // ── Internals ────────────────────────────────────────────────────

  private load(characterId: string): Row {
    const r = this.db.prepare(`SELECT * FROM progress WHERE character_id = ?`).get(characterId) as Row | undefined;
    if (r) return r;
    const row: Row = { character_id: characterId, xp: 0, stats: JSON.stringify(emptyStats()), chapter: 1, floor: 1, level_at_warp: null, flight_at: null };
    this.db
      .prepare(`INSERT OR IGNORE INTO progress (character_id, stats, chapter, floor, updated_at) VALUES (?, ?, 1, 1, ?)`)
      .run(characterId, row.stats, this.now());
    return row;
  }

  /** Load → change → recompute chapter (never drops) → save, in one transaction. */
  private mutate(characterId: string, fn: (r: Row, stats: ProgressStats) => number): ProgressDelta {
    return this.db.transaction((): ProgressDelta => {
      const r = this.load(characterId);
      const stats = parseStats(r.stats);
      const levelBefore = levelFor(r.xp, masteredCount(stats));
      const chapterBefore = r.chapter;
      let xp = fn(r, stats);

      const computed = chapterFor(stats, this.worldsInFrontier(), Math.max(r.floor, r.chapter));
      for (let n = r.chapter + 1; n <= computed; n++) xp += this.grant(r, "chapter", XP.chapter, String(n));
      r.chapter = Math.max(r.chapter, computed);
      const level = levelFor(r.xp, masteredCount(stats));
      let warpAt: number | null = null;
      if (chapterBefore < WARP_CHAPTER && r.chapter >= WARP_CHAPTER) {
        warpAt = this.now();
        r.level_at_warp = level;
      }
      this.db
        .prepare(
          `UPDATE progress SET xp = ?, stats = ?, chapter = ?, level_at_warp = ?, flight_at = ?, updated_at = ?,
                  warp_at = COALESCE(warp_at, ?) WHERE character_id = ?`,
        )
        .run(r.xp, JSON.stringify(stats), r.chapter, r.level_at_warp, r.flight_at, this.now(), warpAt, characterId);
      const delta: ProgressDelta = { xp };
      if (level > levelBefore) delta.level = level;
      if (r.chapter > chapterBefore) delta.chapter = r.chapter;
      return delta;
    })();
  }

  /** Append an XP event (deduped on ref) and add it to the row. Returns what was granted. */
  private grant(r: Row, kind: string, amount: number, ref?: string): number {
    if (!(amount > 0)) return 0;
    const res = this.db
      .prepare(`INSERT OR IGNORE INTO xp_event (character_id, kind, amount, ref, at) VALUES (?, ?, ?, ?, ?)`)
      .run(r.character_id, kind, Math.round(amount), ref ?? null, this.now());
    if (res.changes === 0) return 0;
    r.xp += Math.round(amount);
    return Math.round(amount);
  }
}

function parseStats(s: string): ProgressStats {
  try {
    const v = JSON.parse(s) as Partial<ProgressStats>;
    const skills: ProgressStats["skills"] = {};
    for (const k of SKILLS) {
      const n = v.skills?.[k];
      if (typeof n === "number" && n > 0) skills[k] = n;
    }
    return {
      skills,
      visits: num(v.visits),
      sightings: num(v.sightings),
      distance: num(v.distance),
      farthest: num(v.farthest),
    };
  } catch {
    return emptyStats();
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const clampNum = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, num(v)));

function merge(a: ProgressDelta, b: ProgressDelta): ProgressDelta {
  const out: ProgressDelta = { xp: a.xp + b.xp };
  const level = Math.max(a.level ?? 0, b.level ?? 0);
  const chapter = Math.max(a.chapter ?? 0, b.chapter ?? 0);
  if (level) out.level = level;
  if (chapter) out.chapter = chapter;
  return out;
}
