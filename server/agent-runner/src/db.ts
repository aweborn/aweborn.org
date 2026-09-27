import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";

// ── Types ────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  schedule: string;
  enabled: number;
  config: string;
  created_at: string;
  updated_at: string;
}

export interface AgentInput {
  name: string;
  description?: string;
  prompt: string;
  schedule: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface Run {
  id: string;
  agent_id: string;
  trigger: "schedule" | "manual" | "message";
  status: "running" | "completed" | "failed";
  input: string | null;
  output: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

// ── Database ─────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? "/app/data";
const DB_PATH = path.join(DATA_DIR, "agent-runner.db");

let db: Database.Database;

export function initDb(): void {
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      prompt      TEXT NOT NULL,
      schedule    TEXT NOT NULL,
      enabled     INTEGER DEFAULT 1,
      config      TEXT DEFAULT '{}',
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      trigger     TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual', 'message')),
      status      TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
      input       TEXT,
      output      TEXT,
      error       TEXT,
      started_at  TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      duration_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_runs_agent_id ON runs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
  `);

  console.log(`[db] initialized at ${DB_PATH}`);
}

export function closeDb(): void {
  db?.close();
}

// ── Agent CRUD ───────────────────────────────────────────────────────

const stmtCache = new Map<string, Database.Statement>();

function stmt(sql: string): Database.Statement {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

export function listAgents(): Agent[] {
  return stmt("SELECT * FROM agents ORDER BY created_at DESC").all() as Agent[];
}

export function getAgent(id: string): Agent | undefined {
  return stmt("SELECT * FROM agents WHERE id = ?").get(id) as
    | Agent
    | undefined;
}

export function createAgent(input: AgentInput): Agent {
  const id = randomUUID();
  stmt(`
    INSERT INTO agents (id, name, description, prompt, schedule, enabled, config)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.description ?? null,
    input.prompt,
    input.schedule,
    input.enabled !== false ? 1 : 0,
    JSON.stringify(input.config ?? {})
  );
  return getAgent(id)!;
}

export function updateAgent(
  id: string,
  input: Partial<AgentInput>
): Agent | undefined {
  const existing = getAgent(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    fields.push("name = ?");
    values.push(input.name);
  }
  if (input.description !== undefined) {
    fields.push("description = ?");
    values.push(input.description);
  }
  if (input.prompt !== undefined) {
    fields.push("prompt = ?");
    values.push(input.prompt);
  }
  if (input.schedule !== undefined) {
    fields.push("schedule = ?");
    values.push(input.schedule);
  }
  if (input.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(input.enabled ? 1 : 0);
  }
  if (input.config !== undefined) {
    fields.push("config = ?");
    values.push(JSON.stringify(input.config));
  }

  if (fields.length === 0) return existing;

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE agents SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values
  );
  return getAgent(id);
}

export function deleteAgent(id: string): boolean {
  const result = stmt("DELETE FROM agents WHERE id = ?").run(id);
  return result.changes > 0;
}

// ── Run CRUD ─────────────────────────────────────────────────────────

export function createRun(
  agentId: string,
  trigger: Run["trigger"],
  input?: string
): Run {
  const id = randomUUID();
  stmt(`
    INSERT INTO runs (id, agent_id, trigger, status, input)
    VALUES (?, ?, ?, 'running', ?)
  `).run(id, agentId, trigger, input ?? null);
  return getRun(id)!;
}

export function completeRun(
  id: string,
  output: string,
  durationMs: number
): void {
  stmt(`
    UPDATE runs
    SET status = 'completed', output = ?, finished_at = datetime('now'), duration_ms = ?
    WHERE id = ?
  `).run(output, durationMs, id);
}

export function failRun(
  id: string,
  error: string,
  durationMs: number
): void {
  stmt(`
    UPDATE runs
    SET status = 'failed', error = ?, finished_at = datetime('now'), duration_ms = ?
    WHERE id = ?
  `).run(error, durationMs, id);
}

export function getRun(id: string): Run | undefined {
  return stmt("SELECT * FROM runs WHERE id = ?").get(id) as Run | undefined;
}

export function listRuns(
  agentId: string,
  limit: number = 50
): Run[] {
  return stmt(
    "SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?"
  ).all(agentId, limit) as Run[];
}
