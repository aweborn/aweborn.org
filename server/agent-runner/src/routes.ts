import { Router, type Request, type Response } from "express";
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  listRuns,
  getRun,
  type AgentInput,
} from "./db.js";
import { executeAgent } from "./engine.js";
import {
  scheduleAgent,
  unscheduleAgent,
  loadSchedules,
  getActiveCount,
} from "./scheduler.js";

export const router = Router();

// Express 5 params can be string | string[] — helper to extract as string
function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

// ── Health ───────────────────────────────────────────────────────────

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "agent-runner",
    scheduled: getActiveCount(),
  });
});

// ── Agents CRUD ──────────────────────────────────────────────────────

router.get("/agents", (_req: Request, res: Response) => {
  const agents = listAgents();
  res.json(agents);
});

router.post("/agents", (req: Request, res: Response) => {
  const { name, description, prompt, schedule, enabled, config } =
    req.body as AgentInput;

  if (!name || !prompt || !schedule) {
    res.status(400).json({
      error: "Missing required fields: name, prompt, schedule",
    });
    return;
  }

  const agent = createAgent({
    name,
    description,
    prompt,
    schedule,
    enabled,
    config,
  });

  // Update scheduler with new agent
  scheduleAgent(agent);

  res.status(201).json(agent);
});

router.get("/agents/:id", (req: Request, res: Response) => {
  const agent = getAgent(paramId(req));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(agent);
});

router.put("/agents/:id", (req: Request, res: Response) => {
  const updated = updateAgent(paramId(req), req.body as Partial<AgentInput>);
  if (!updated) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  // Reload this agent's schedule
  if (updated.enabled) {
    scheduleAgent(updated);
  } else {
    unscheduleAgent(updated.id);
  }

  res.json(updated);
});

router.delete("/agents/:id", (req: Request, res: Response) => {
  unscheduleAgent(paramId(req));
  const deleted = deleteAgent(paramId(req));
  if (!deleted) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json({ deleted: true });
});

// ── Trigger / Message ────────────────────────────────────────────────

router.post(
  "/agents/:id/trigger",
  async (req: Request, res: Response) => {
    const agent = getAgent(paramId(req));
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    try {
      const output = await executeAgent(agent, "manual");
      res.json({ status: "completed", output });
    } catch (err) {
      res.status(500).json({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

router.post(
  "/agents/:id/message",
  async (req: Request, res: Response) => {
    const agent = getAgent(paramId(req));
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const { message } = req.body as { message?: string };
    if (!message) {
      res.status(400).json({ error: "Missing required field: message" });
      return;
    }

    try {
      const output = await executeAgent(agent, "message", message);
      res.json({ status: "completed", output });
    } catch (err) {
      res.status(500).json({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

// ── Run History ──────────────────────────────────────────────────────

router.get("/agents/:id/runs", (req: Request, res: Response) => {
  const agent = getAgent(paramId(req));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const limit = parseInt(req.query.limit as string) || 50;
  const runs = listRuns(agent.id, Math.min(limit, 200));
  res.json(runs);
});

router.get("/runs/:id", (req: Request, res: Response) => {
  const run = getRun(paramId(req));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(run);
});
