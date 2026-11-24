/**
 * Match records, stored (Phase 10, slice 2): the hard rule is that no match runs
 * unrecorded and every record can be replayed, forever. See shared/match.ts for the
 * recording model (setup + per-tick samples + control inputs + events + result).
 *
 * Three tables in universe.db (so the hourly/S3 backups cover them):
 *   matches        one row per match: the setup it started from, and at the end its events and result
 *   match_frames   the recorded ticks, appended in chunks while the match runs (about every 5 s),
 *                  so a crash loses seconds, not the match
 *   match_players  who was in which slot (a character's replays are found here)
 *
 * Kept forever: there is no delete. Erasing a player (`erasePlayer`) keeps the replay,
 * which is also the other players' record, and turns the erased player into an anonymous
 * stand-in in it (Q10b): the id becomes `stand-in:<slot>`, the name "Player", the
 * research id is cleared.
 *
 * Research (Q10b): each human slot is stamped `research_ok` at the start of the match
 * (was the player behind the 18+ door then? see age-door.ts). `researchCopy` is the only
 * form a record leaves in for research: research ids instead of player ids, no character
 * names, and anyone who isn't a research candidate as a stand-in.
 *
 * A match that never finished because the server restarted is closed on boot with a
 * null result (its frames up to the last chunk are still there).
 *
 * Pure SQL over the minimal db interface (better-sqlite3 in the service, node:sqlite in
 * tests). Every method is synchronous.
 */
import type { MatchEvent, MatchFrame, MatchRecord, MatchResult, MatchSetup } from "../../../shared/match.js";
import type { MatchSummary } from "../../../shared/match-protocol.js";
import type { SqlDb } from "./build-requests.js";

interface MatchRow {
  id: string; world_id: string; game_version: number; template: string; seed: number; sim_version: number;
  started_at: number; ended_at: number | null; winner: number | null;
  scores: string | null; setup: string; events: string | null; result: string | null;
}
interface PlayerRow { match_id: string; slot: number; player_id: string | null; team: number; kind: "human" | "npc"; name: string }

const parse = <T>(json: string | null | undefined, dflt: T): T => {
  if (!json) return dflt;
  try {
    return JSON.parse(json) as T;
  } catch {
    return dflt;
  }
};

export class MatchStore {
  constructor(
    private readonly db: SqlDb,
    /** World names for the summaries (the store doesn't know worlds). */
    private readonly worldName: (worldId: string) => string = () => "",
    now: number = Date.now(),
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY, world_id TEXT NOT NULL, game_version INTEGER NOT NULL, template TEXT NOT NULL,
        seed INTEGER NOT NULL, sim_version INTEGER NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
        winner INTEGER, scores TEXT, setup TEXT NOT NULL, events TEXT, result TEXT
      );
      CREATE INDEX IF NOT EXISTS matches_world ON matches (world_id, started_at);
      CREATE TABLE IF NOT EXISTS match_frames (
        match_id TEXT NOT NULL, seq INTEGER NOT NULL, frames TEXT NOT NULL,
        PRIMARY KEY (match_id, seq)
      );
      CREATE TABLE IF NOT EXISTS match_players (
        match_id TEXT NOT NULL, slot INTEGER NOT NULL, player_id TEXT, research_id TEXT,
        team INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
        PRIMARY KEY (match_id, slot)
      );
      CREATE INDEX IF NOT EXISTS match_players_player ON match_players (player_id);
    `);
    // Added with the 18+ door: was this player a research candidate when the match began? (rows from before: 0)
    const cols = new Set((db.prepare("PRAGMA table_info(match_players)").all() as { name: string }[]).map((c) => c.name));
    if (!cols.has("research_ok")) db.exec("ALTER TABLE match_players ADD COLUMN research_ok INTEGER NOT NULL DEFAULT 0");
    // The server stopped while these ran: close them (result null), keep what was recorded
    db.prepare("UPDATE matches SET ended_at = ?, events = COALESCE(events, '[]') WHERE ended_at IS NULL").run(now);
  }

  /**
   * A match starts: its setup is stored whole before the first tick. `researchIds` is by
   * player id; `candidates` are the player ids behind the 18+ door right now (Q10b).
   */
  begin(setup: MatchSetup, startedAt: number, researchIds: Readonly<Record<string, string | undefined>> = {}, candidates: ReadonlySet<string> = new Set()): void {
    this.db.prepare(`INSERT INTO matches (id, world_id, game_version, template, seed, sim_version, started_at, setup)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(setup.matchId, setup.worldId, setup.game.version, setup.game.template, setup.seed, setup.simVersion, startedAt, JSON.stringify(setup));
    const add = this.db.prepare("INSERT INTO match_players (match_id, slot, player_id, research_id, team, kind, name, research_ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const s of setup.slots) {
      const human = s.kind === "human";
      const researchId = human ? researchIds[s.id] ?? null : null;
      // A candidate without a research id can't be keyed in a research copy, so they aren't one
      add.run(setup.matchId, s.slot, human ? s.id : null, researchId, s.team, s.kind, s.name, human && researchId && candidates.has(s.id) ? 1 : 0);
    }
  }

  /** Append a chunk of recorded ticks (in order). */
  appendFrames(matchId: string, frames: readonly MatchFrame[]): void {
    if (frames.length === 0) return;
    const row = this.db.prepare("SELECT COALESCE(MAX(seq), -1) + 1 AS seq FROM match_frames WHERE match_id = ?").get(matchId) as { seq: number };
    this.db.prepare("INSERT INTO match_frames (match_id, seq, frames) VALUES (?, ?, ?)").run(matchId, row.seq, JSON.stringify(frames));
  }

  /** The match is over: its events and result (null = it could not be finished properly). */
  finish(matchId: string, events: readonly MatchEvent[], result: MatchResult | null, endedAt: number): void {
    const setup = parse<MatchSetup | null>((this.db.prepare("SELECT setup FROM matches WHERE id = ?").get(matchId) as { setup: string } | undefined)?.setup, null);
    // Lists show rounds won when there are several rounds, the round's score when there is one
    const scores = result ? (setup && setup.game.settings.rounds > 1 ? result.rounds : result.scores) : null;
    this.db.prepare("UPDATE matches SET ended_at = ?, winner = ?, scores = ?, events = ?, result = ? WHERE id = ?")
      .run(endedAt, result ? result.winner : null, scores ? JSON.stringify(scores) : null, JSON.stringify(events), result ? JSON.stringify(result) : null, matchId);
  }

  /** The whole record, ready to replay. Null if there is no such match. */
  record(matchId: string): MatchRecord | null {
    const m = this.db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as MatchRow | undefined;
    const setup = parse<MatchSetup | null>(m?.setup, null);
    if (!m || !setup) return null;
    const chunks = this.db.prepare("SELECT frames FROM match_frames WHERE match_id = ? ORDER BY seq").all(matchId) as { frames: string }[];
    const frames: MatchFrame[] = [];
    for (const c of chunks) for (const f of parse<MatchFrame[]>(c.frames, [])) frames.push(f);
    return {
      v: 1, setup, frames,
      events: parse<MatchEvent[]>(m.events, []),
      result: parse<MatchResult | null>(m.result, null),
      startedAt: m.started_at, endedAt: m.ended_at,
    };
  }

  private summaries(rows: MatchRow[], you: ReadonlySet<string>): MatchSummary[] {
    if (rows.length === 0) return [];
    const players = this.db
      .prepare(`SELECT match_id, slot, player_id, team, kind, name FROM match_players WHERE match_id IN (${rows.map(() => "?").join(",")}) ORDER BY slot`)
      .all(...rows.map((r) => r.id)) as PlayerRow[];
    const by = new Map<string, PlayerRow[]>();
    for (const p of players) by.set(p.match_id, [...(by.get(p.match_id) ?? []), p]);
    return rows.map((m) => ({
      id: m.id, worldId: m.world_id, worldName: this.worldName(m.world_id), template: m.template, gameVersion: m.game_version,
      startedAt: m.started_at, endedAt: m.ended_at, winner: m.winner, scores: parse<number[]>(m.scores, []),
      roster: (by.get(m.id) ?? []).map((p) => ({
        slot: p.slot, team: p.team, kind: p.kind, name: p.name,
        ...(p.player_id !== null && you.has(p.player_id) ? { you: true } : {}),
      })),
    }));
  }

  /** A world's finished matches, newest first. */
  worldRecent(worldId: string, limit = 30): MatchSummary[] {
    const rows = this.db.prepare("SELECT * FROM matches WHERE world_id = ? AND ended_at IS NOT NULL ORDER BY started_at DESC, id LIMIT ?")
      .all(worldId, Math.max(1, Math.min(200, Math.floor(limit)))) as MatchRow[];
    return this.summaries(rows, new Set());
  }

  /** The finished matches these characters played, newest first (their slots are marked `you`). */
  playerRecent(playerIds: readonly string[], limit = 50): MatchSummary[] {
    if (playerIds.length === 0) return [];
    const rows = this.db.prepare(`SELECT * FROM matches WHERE ended_at IS NOT NULL AND id IN (
        SELECT match_id FROM match_players WHERE player_id IN (${playerIds.map(() => "?").join(",")})
      ) ORDER BY started_at DESC, id LIMIT ?`)
      .all(...playerIds, Math.max(1, Math.min(200, Math.floor(limit)))) as MatchRow[];
    return this.summaries(rows, new Set(playerIds));
  }

  /**
   * The record as research may see it (Q10b), or null if there is no such match.
   *   - A human who was behind the 18+ door when the match began, and still is
   *     (`stillCandidate`, by player id), appears under their research id.
   *   - Every other human is an anonymous stand-in (`stand-in:<slot>`): the match stays
   *     usable, their trace is nobody's.
   *   - No character names and no player ids, for anyone. NPC slots are unchanged.
   * Frames, events and the result speak in slots, so they are the record's own.
   */
  researchCopy(matchId: string, stillCandidate: (playerId: string) => boolean): MatchRecord | null {
    const record = this.record(matchId);
    if (!record) return null;
    const seats = this.db.prepare("SELECT slot, player_id, research_id, research_ok FROM match_players WHERE match_id = ?")
      .all(matchId) as { slot: number; player_id: string | null; research_id: string | null; research_ok: number }[];
    const bySlot = new Map(seats.map((s) => [s.slot, s]));
    const alias = new Map<string, string>();
    const slots = record.setup.slots.map((s) => {
      if (s.kind !== "human") return s;
      const seat = bySlot.get(s.slot);
      const ok = Boolean(seat?.research_ok && seat.research_id && seat.player_id && stillCandidate(seat.player_id));
      const id = ok ? seat!.research_id! : `stand-in:${s.slot}`;
      alias.set(s.id, id);
      return { ...s, id, name: "Player" };
    });
    // An id in `formed` that has no slot (someone linked who didn't end up playing) is dropped, never passed through
    const swap = (id: string) => alias.get(id) ?? (id.startsWith("npc:") ? id : null);
    const formed = {
      ...record.setup.formed,
      links: (record.setup.formed?.links ?? []).flatMap((l) => {
        const a = swap(l.a), b = swap(l.b);
        return a && b ? [{ ...l, a, b }] : [];
      }),
      together: (record.setup.formed?.together ?? []).map((g) => g.map(swap).filter((id): id is string => id !== null)).filter((g) => g.length > 1),
    };
    return { ...record, setup: { ...record.setup, slots, formed } };
  }

  /**
   * Erase a player from every record they are in. The replays stay (they are the other
   * players' records too); this player becomes an anonymous stand-in. Returns how many
   * matches were changed.
   */
  erasePlayer(playerId: string): number {
    return eraseFromMatches(this.db, playerId);
  }
}

/**
 * `MatchStore.erasePlayer` without a store, for `forgetPlayer` (research.ts): any path that
 * forgets a player also turns them into a stand-in in every replay. Safe before the tables exist.
 */
export function eraseFromMatches(db: SqlDb, playerId: string): number {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'match_players'").get()) return 0;
    const seats = db.prepare("SELECT match_id, slot FROM match_players WHERE player_id = ?").all(playerId) as { match_id: string; slot: number }[];
    for (const seat of seats) {
      const row = db.prepare("SELECT setup FROM matches WHERE id = ?").get(seat.match_id) as { setup: string } | undefined;
      const setup = parse<MatchSetup | null>(row?.setup, null);
      if (setup) {
        const standIn = `stand-in:${seat.slot}`;
        const swap = (id: string) => (id === playerId ? standIn : id);
        setup.slots = setup.slots.map((s) => (s.kind === "human" && s.id === playerId ? { ...s, id: standIn, name: "Player" } : s));
        setup.formed = {
          ...setup.formed,
          links: (setup.formed?.links ?? []).map((l) => ({ ...l, a: swap(l.a), b: swap(l.b) })),
          together: (setup.formed?.together ?? []).map((g) => g.map(swap)),
        };
        db.prepare("UPDATE matches SET setup = ? WHERE id = ?").run(JSON.stringify(setup), seat.match_id);
      }
      db.prepare("UPDATE match_players SET player_id = NULL, research_id = NULL, research_ok = 0, name = 'Player' WHERE match_id = ? AND slot = ?").run(seat.match_id, seat.slot);
    }
    return seats.length;
  }
