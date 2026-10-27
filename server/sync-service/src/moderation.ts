/**
 * Moderation (Rough Draft M1, 2026-10-27): mute and report.
 *
 * - **Mute** hides a player's chat lines and speech bubbles for you. Anyone can
 *   mute (kept on the device); with a session the list is also saved here so
 *   it follows you to every device.
 * - **Report** files what that player said where you are. The evidence is
 *   taken from the server's own chat archive (their recent lines in that
 *   place, as typed), never from the reporter's copy, so it can't be forged.
 *   Reports wait for a person to review them (admin page, MANA_ADMIN_TOKEN).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "./persistence.js";
import { cleanChatText } from "../../../shared/chat.js";

export const MAX_MUTES = 500;
export const REPORT_REASONS = ["harassment", "hate", "sexual", "spam", "personal_info", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/** Reports per account per hour (generous for a real problem, useless for spam). */
const REPORTS_PER_HOUR = 10;
/** Evidence: the target's lines in that place over the last hour, newest 30. */
const EVIDENCE_WINDOW_MS = 3600_000;
const EVIDENCE_LINES = 30;
const PLAYER_ID = /^[A-Za-z0-9_-]{1,64}$/;

let ready = false;
function db() {
  const d = getDb();
  if (!ready) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS player_mute (
        account_id TEXT NOT NULL, target_id TEXT NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY (account_id, target_id));
      CREATE TABLE IF NOT EXISTS report (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
        reporter_id TEXT NOT NULL, account_id TEXT NOT NULL, target_id TEXT NOT NULL,
        place TEXT NOT NULL, reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
        evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
        resolved_at INTEGER, resolution TEXT);
      CREATE INDEX IF NOT EXISTS report_status ON report(status, at);
      CREATE INDEX IF NOT EXISTS report_target ON report(target_id, at);
      CREATE TABLE IF NOT EXISTS chat_messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, player_id TEXT NOT NULL,
        text TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS chat_messages_player ON chat_messages(player_id, at);`);
    ready = true;
  }
  return d;
}

export function isPlayerId(v: unknown): v is string {
  return typeof v === "string" && PLAYER_ID.test(v);
}

export function listMutes(accountId: string): string[] {
  return (db().prepare(`SELECT target_id FROM player_mute WHERE account_id = ? ORDER BY at`).all(accountId) as { target_id: string }[]).map(
    (r) => r.target_id,
  );
}

/** Mute or unmute; false when the list is full. */
export function setMute(accountId: string, targetId: string, on: boolean, at = Date.now()): boolean {
  const d = db();
  if (!on) {
    d.prepare(`DELETE FROM player_mute WHERE account_id = ? AND target_id = ?`).run(accountId, targetId);
    return true;
  }
  const n = (d.prepare(`SELECT COUNT(*) AS n FROM player_mute WHERE account_id = ?`).get(accountId) as { n: number }).n;
  if (n >= MAX_MUTES) return false;
  d.prepare(`INSERT OR IGNORE INTO player_mute (account_id, target_id, at) VALUES (?, ?, ?)`).run(accountId, targetId, at);
  return true;
}

export type ReportResult = { ok: true; id: number; evidence: number } | { ok: false; status: number; error: string; message: string };

/** File a report. `place` = a world id, or "space". */
export function fileReport(
  accountId: string,
  reporterId: string,
  input: { targetId?: unknown; place?: unknown; reason?: unknown; note?: unknown },
  now = Date.now(),
): ReportResult {
  const { targetId, place, reason } = input;
  if (!isPlayerId(targetId) || targetId === reporterId) return { ok: false, status: 400, error: "bad_target", message: "Pick someone to report." };
  if (typeof place !== "string" || place.length > 64) return { ok: false, status: 400, error: "bad_place", message: "Something went wrong. Please try again." };
  if (!REPORT_REASONS.includes(reason as ReportReason)) return { ok: false, status: 400, error: "bad_reason", message: "Pick a reason." };
  const note = cleanChatText(input.note).trim().slice(0, 500);
  const d = db();
  const recent = (d.prepare(`SELECT COUNT(*) AS n FROM report WHERE account_id = ? AND at > ?`).get(accountId, now - 3600_000) as { n: number }).n;
  if (recent >= REPORTS_PER_HOUR) {
    return { ok: false, status: 429, error: "slow_down", message: "Thanks. We have your reports; please give us a little time to look." };
  }
  const evidence = (
    d
      .prepare(`SELECT text, at FROM chat_messages WHERE player_id = ? AND world_id = ? AND at > ? ORDER BY at DESC LIMIT ?`)
      .all(targetId, place, now - EVIDENCE_WINDOW_MS, EVIDENCE_LINES) as { text: string; at: number }[]
  ).reverse();
  const r = d
    .prepare(`INSERT INTO report (at, reporter_id, account_id, target_id, place, reason, note, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(now, reporterId, accountId, targetId, place, reason as string, note, JSON.stringify(evidence));
  return { ok: true, id: Number(r.lastInsertRowid), evidence: evidence.length };
}

interface ReportRow {
  id: number;
  at: number;
  reporter_id: string;
  target_id: string;
  place: string;
  reason: string;
  note: string;
  evidence: string;
  status: string;
  resolved_at: number | null;
  resolution: string | null;
}

export function listReports(status: "open" | "resolved", limit = 100) {
  const rows = db()
    .prepare(`SELECT * FROM report WHERE status = ? ORDER BY at DESC LIMIT ?`)
    .all(status, Math.min(500, Math.max(1, limit))) as ReportRow[];
  const counts = db().prepare(`SELECT target_id, COUNT(*) AS n FROM report WHERE status = 'open' GROUP BY target_id`).all() as {
    target_id: string;
    n: number;
  }[];
  const openAgainst = new Map(counts.map((c) => [c.target_id, c.n]));
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    reporterId: r.reporter_id,
    targetId: r.target_id,
    place: r.place,
    reason: r.reason,
    note: r.note,
    evidence: JSON.parse(r.evidence) as { text: string; at: number }[],
    status: r.status,
    resolvedAt: r.resolved_at,
    resolution: r.resolution,
    openAgainstTarget: openAgainst.get(r.target_id) ?? 0,
  }));
}

export function resolveReport(id: number, resolution: string, now = Date.now()): boolean {
  const r = db()
    .prepare(`UPDATE report SET status = 'resolved', resolved_at = ?, resolution = ? WHERE id = ? AND status = 'open'`)
    .run(now, resolution.slice(0, 200), id);
  return r.changes > 0;
}

/**
 * `/api/admin/reports*` (Bearer MANA_ADMIN_TOKEN):
 *   GET  /api/admin/reports?status=open|resolved → { reports }
 *   POST /api/admin/reports/:id/resolve { resolution } → { ok }
 */
export function handleReportsAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  token: string,
  cors: Record<string, string>,
  readJson: (req: IncomingMessage) => Promise<unknown>,
): boolean {
  if (!path.startsWith("/api/admin/reports")) return false;
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors });
    res.end(JSON.stringify(body));
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...cors,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return true;
  }
  void (async () => {
    if (!token) return json(503, { error: "admin_disabled" });
    const got = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    const want = Buffer.from(token);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return json(401, { error: "unauthorized" });
    if (path === "/api/admin/reports" && req.method === "GET") {
      const status = new URL(req.url ?? "/", "http://x").searchParams.get("status") === "resolved" ? "resolved" : "open";
      return json(200, { reports: listReports(status) });
    }
    const m = /^\/api\/admin\/reports\/(\d+)\/resolve$/.exec(path);
    if (m && req.method === "POST") {
      const body = (await readJson(req).catch(() => null)) as { resolution?: unknown } | null;
      const resolution = typeof body?.resolution === "string" && body.resolution.trim() ? body.resolution.trim() : "reviewed";
      return json(resolveReport(Number(m[1]), resolution) ? 200 : 404, { ok: true });
    }
    return json(404, { error: "not_found" });
  })().catch((err: unknown) => {
    console.error("[reports-admin]", err);
    if (!res.headersSent) json(500, { error: "internal" });
  });
  return true;
}
