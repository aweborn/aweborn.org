import express from "express";
import { initDb, closeDb } from "./db.js";
import { router } from "./routes.js";
import { loadSchedules, stopAll } from "./scheduler.js";

const PORT = parseInt(process.env.PORT ?? "3002", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

// ── Initialize ───────────────────────────────────────────────────────

initDb();

const app = express();
app.use(express.json());
app.use(router);

// Load agent schedules from database
loadSchedules();

// ── Start ────────────────────────────────────────────────────────────

const server = app.listen(PORT, HOST, () => {
  console.log(`[agent-runner] listening on ${HOST}:${PORT}`);
  console.log(`[agent-runner] endpoints: /health, /agents, /runs`);
});

// ── Graceful shutdown ────────────────────────────────────────────────

function shutdown() {
  console.log("[agent-runner] shutting down…");
  stopAll();
  closeDb();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
