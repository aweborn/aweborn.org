/**
 * genai-service: internal worker for generations (Phase 07).
 *
 * Not public. sync-service owns the player-facing API (session, mana
 * reserve → settle) and calls this service on the private network:
 *
 *   POST /jobs            { ref, kind: "model", prompt }  → { jobId }
 *   GET  /jobs/:id        → { status, progress, asset, costUsd, error }
 *   GET  /assets/:file    → the generated file (GLB), content-addressed name
 *
 * Jobs live in a SQLite table in workflow shape (Alex, 2026-10-16), so a
 * restart can pick up where it left off. Every provider call and response is
 * appended to the creation archive (JSONL for now; S3 later, Phase 07).
 */
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, createReadStream, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { providerFor, type ProviderJob } from "./providers.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const ASSET_DIR = join(DATA_DIR, "assets");
mkdirSync(ASSET_DIR, { recursive: true });

// ── Job table ────────────────────────────────────────────────────────
const db = new DatabaseSync(join(DATA_DIR, "jobs.db"));
db.exec(`CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_task TEXT,
  status TEXT NOT NULL,          -- queued | processing | complete | failed
  progress INTEGER NOT NULL DEFAULT 0,
  asset TEXT,
  cost_usd REAL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`);

interface JobRow {
  id: string; ref: string; kind: string; prompt: string; provider: string;
  provider_task: string | null; status: string; progress: number;
  asset: string | null; cost_usd: number | null; error: string | null;
}

function update(id: string, fields: Partial<JobRow>): void {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE jobs SET ${sets}, updated_at = ? WHERE id = ?`).run(
    ...keys.map((k) => (fields as Record<string, string | number | null>)[k]), Date.now(), id,
  );
}

/** Creation archive: every provider call + response (research; Privacy page must say so before prod). */
export function archive(entry: Record<string, unknown>): void {
  appendFileSync(join(DATA_DIR, "archive.jsonl"), JSON.stringify({ at: Date.now(), ...entry }) + "\n");
}

// ── Runner ───────────────────────────────────────────────────────────
async function run(id: string): Promise<void> {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as unknown as JobRow | undefined;
  if (!row || row.status === "complete" || row.status === "failed") return;
  const provider = providerFor(row.kind);
  const job: ProviderJob = {
    id: row.id,
    prompt: row.prompt,
    providerTask: row.provider_task,
    assetDir: ASSET_DIR,
    onTask: (task) => update(id, { provider_task: task, status: "processing" }),
    onProgress: (p) => update(id, { progress: Math.max(0, Math.min(99, Math.round(p))) }),
    archive: (e) => archive({ jobId: id, provider: provider.name, ...e }),
  };
  try {
    update(id, { status: "processing" });
    const out = await provider.generate(job);
    update(id, { status: "complete", progress: 100, asset: out.asset, cost_usd: out.costUsd });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[genai] job ${id} failed:`, msg);
    update(id, { status: "failed", error: msg.slice(0, 500) });
  }
}

// Resume unfinished jobs after a restart
for (const r of db.prepare("SELECT id FROM jobs WHERE status IN ('queued','processing')").all() as { id: string }[]) {
  void run(r.id);
}

// ── HTTP ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "genai-service", providers: { model: providerFor("model").name } });
});

app.post("/jobs", (req, res) => {
  const { ref, kind, prompt } = req.body ?? {};
  if (typeof ref !== "string" || !ref || kind !== "model" || typeof prompt !== "string") {
    return res.status(400).json({ error: "bad_request" });
  }
  const clean = prompt.trim().slice(0, 600);
  if (!clean) return res.status(400).json({ error: "empty_prompt" });
  const existing = db.prepare("SELECT id FROM jobs WHERE ref = ?").get(ref) as { id: string } | undefined;
  if (existing) return res.json({ jobId: existing.id });
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO jobs (id, ref, kind, prompt, provider, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)",
  ).run(id, ref, kind, clean, providerFor(kind).name, now, now);
  void run(id);
  res.json({ jobId: id });
});

app.get("/jobs/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.params.id) as unknown as JobRow | undefined;
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({
    jobId: row.id, ref: row.ref, status: row.status, progress: row.progress,
    asset: row.asset, costUsd: row.cost_usd, error: row.error,
  });
});

app.get("/assets/:file", (req, res) => {
  const file = req.params.file;
  if (!/^[a-f0-9]{64}\.glb$/.test(file)) return res.status(404).end();
  const path = join(ASSET_DIR, file);
  if (!existsSync(path)) return res.status(404).end();
  res.setHeader("Content-Type", "model/gltf-binary");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  createReadStream(path).pipe(res);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[genai-service] listening on ${HOST}:${PORT} (model provider: ${providerFor("model").name})`);
});

function shutdown() {
  console.log("[genai-service] shutting down…");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
