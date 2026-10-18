/**
 * genai-service: internal worker for generations (Phase 07).
 *
 * Not public. sync-service owns the player-facing API (session, mana
 * reserve → settle) and calls this service on the private network:
 *
 *   POST /jobs            { ref, kind: "model", prompt }  → { jobId }
 *   GET  /jobs/:id        → { status, progress, asset, costUsd, error }
 *   GET  /assets/:file    → the generated file (GLB); 302 to the CDN once it is in S3
 *   GET  /library?q=      → the asset library (every file ever made), newest first
 *   POST /llm             { ref, model, messages, json? } → { content, model, costUsd }
 *                         (OpenRouter; synchronous; caller validates the output)
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
import { chat, llmConfigured, type ChatMessage } from "./llm.js";
import { initLibrary, addToLibrary, archiveToS3, backfill, listLibrary, removeAsset, restoreAsset, listTrash, purgeAsset, CDN_URL, s3Enabled } from "./library.js";

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
try { db.exec("ALTER TABLE jobs ADD COLUMN creator TEXT"); } catch { /* already there */ }

interface JobRow {
  id: string; ref: string; kind: string; prompt: string; provider: string;
  provider_task: string | null; status: string; progress: number;
  asset: string | null; cost_usd: number | null; error: string | null; creator: string | null;
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
  const e = { at: Date.now(), ...entry };
  appendFileSync(join(DATA_DIR, "archive.jsonl"), JSON.stringify(e) + "\n");
  archiveToS3(e);
}

initLibrary(db);
void backfill(db, ASSET_DIR, DATA_DIR).catch((err) => console.error("[library] backfill failed:", (err as Error).message));

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
    // Shrink + upload first: the game loads the web copy the moment the job completes
    await addToLibrary(db, ASSET_DIR, { file: out.asset, kind: row.kind, prompt: row.prompt, provider: provider.name, jobId: id, ref: row.ref, creator: row.creator });
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
app.use(express.json({ limit: "256kb" }));

// genai-service is cluster-internal: sync-service is the only caller and does the authorization.
// api.aweborn.org still proxies it (health checks), and Caddy always sets X-Forwarded-For, so
// anything carrying that header came from the internet and may only read /health. (Caddy also
// 404s everything else at the edge; this is the second lock.)
app.use((req, res, next) => {
  if (req.path !== "/health" && (req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"])) return res.status(404).end();
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "genai-service", providers: { model: providerFor("model").name, llm: llmConfigured() ? "openrouter" : "none" }, library: s3Enabled() ? "s3" : "local" });
});

app.post("/llm", async (req, res) => {
  const { ref, model, messages, json, maxTokens } = req.body ?? {};
  const okMsgs = Array.isArray(messages) && messages.length > 0 && messages.length <= 80 &&
    messages.every((m: ChatMessage) => ["system", "user", "assistant"].includes(m?.role) && typeof m.content === "string");
  if (typeof ref !== "string" || typeof model !== "string" || !/^[\w.-]+\/[\w.:-]+$/.test(model) || !okMsgs) {
    return res.status(400).json({ error: "bad_request" });
  }
  if (!llmConfigured()) return res.status(503).json({ error: "llm_not_configured" });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90_000);
  try {
    const out = await chat({ model, messages, json: !!json, maxTokens: typeof maxTokens === "number" ? Math.min(maxTokens, 8000) : undefined }, ac.signal);
    archive({ kind: "llm", ref, provider: "openrouter", model: out.model, requested: model, messages, response: out.content, usage: out.usage, costUsd: out.costUsd, latencyMs: out.latencyMs });
    res.json({ content: out.content, model: out.model, costUsd: out.costUsd });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    archive({ kind: "llm", ref, provider: "openrouter", requested: model, messages, error: msg });
    console.error(`[genai] llm ${ref} failed:`, msg);
    res.status(502).json({ error: "llm_failed", message: msg.slice(0, 300) });
  } finally {
    clearTimeout(timer);
  }
});

app.post("/jobs", (req, res) => {
  const { ref, kind, prompt, creator } = req.body ?? {};
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
    "INSERT INTO jobs (id, ref, kind, prompt, provider, creator, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)",
  ).run(id, ref, kind, clean, providerFor(kind).name, typeof creator === "string" ? creator.slice(0, 80) : null, now, now);
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

app.get("/library", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 80) : "";
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
  res.json({ assets: listLibrary(db, q, limit), cdn: CDN_URL || null });
});

// Trash (sync-service checks who may call these). Removal never deletes; only purge does.
const SHA = /^[a-f0-9]{64}$/;
app.post("/library/:sha/remove", (req, res) => {
  const { by, onlyCreator } = req.body ?? {};
  if (!SHA.test(req.params.sha) || typeof by !== "string" || (onlyCreator !== undefined && typeof onlyCreator !== "string")) {
    return res.status(400).json({ error: "bad_request" });
  }
  const ok = removeAsset(db, req.params.sha, by, onlyCreator);
  res.status(ok ? 200 : 404).json({ ok });
});
app.get("/trash", (_req, res) => res.json({ assets: listTrash(db), cdn: CDN_URL || null }));
app.post("/trash/:sha/restore", (req, res) => {
  const ok = SHA.test(req.params.sha) && restoreAsset(db, req.params.sha);
  res.status(ok ? 200 : 404).json({ ok });
});
app.delete("/trash/:sha", async (req, res) => {
  try {
    const ok = SHA.test(req.params.sha) && (await purgeAsset(db, ASSET_DIR, req.params.sha));
    res.status(ok ? 200 : 404).json({ ok });
  } catch (err) {
    console.error("[library] purge failed:", (err as Error).message);
    res.status(500).json({ error: "purge_failed", message: (err as Error).message.slice(0, 200) });
  }
});

app.get("/assets/:file", (req, res) => {
  const file = req.params.file;
  if (!/^[a-f0-9]{64}\.(glb|png)$/.test(file)) return res.status(404).end();
  // In the library bucket: send the client to the CDN (cached at the edge, survives the box)
  const isPng = file.endsWith(".png");
  const glb = file.replace(/\.png$/, ".glb");
  const row2 = db.prepare("SELECT s3, thumb, opt FROM library WHERE file = ?").get(glb) as { s3: number; thumb: number; opt: number } | undefined;
  const inS3 = CDN_URL && (isPng ? row2?.thumb : row2?.s3);
  if (inS3) {
    // Short-lived redirect: which copy to serve (web-optimized vs original) can change
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.redirect(302, `${CDN_URL}/models/${!isPng && row2?.opt ? "opt/" : ""}${file}?c=2`);
  }
  const optFile = join(ASSET_DIR, "opt", file);
  const path = !isPng && existsSync(optFile) ? optFile : join(ASSET_DIR, file);
  if (!existsSync(path)) return res.status(404).end();
  res.setHeader("Content-Type", isPng ? "image/png" : "model/gltf-binary");
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
