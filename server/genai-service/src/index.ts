import express from "express";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = express();
app.use(express.json());

// ── Health check ─────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "genai-service" });
});

// ── Placeholder generation routes ────────────────────────────────────
// All routes return 501 Not Implemented until Phase 07
const GENERATION_ROUTES = [
  "model",
  "image",
  "music",
  "voice",
  "text",
  "terrain",
] as const;

for (const route of GENERATION_ROUTES) {
  app.post(`/generate/${route}`, (_req, res) => {
    res.status(501).json({
      error: "Not Implemented",
      message: `POST /generate/${route} is not yet implemented. See Phase 07.`,
    });
  });
}

// ── Start ────────────────────────────────────────────────────────────
const server = app.listen(PORT, HOST, () => {
  console.log(`[genai-service] listening on ${HOST}:${PORT}`);
});

// ── Graceful shutdown ────────────────────────────────────────────────
function shutdown() {
  console.log("[genai-service] shutting down…");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
