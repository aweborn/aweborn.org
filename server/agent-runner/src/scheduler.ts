import cron, { type ScheduledTask } from "node-cron";
import { listAgents, getAgent, type Agent } from "./db.js";
import { executeAgent } from "./engine.js";

// ── Scheduler ────────────────────────────────────────────────────────

const activeTasks = new Map<string, ScheduledTask>();

/**
 * Load all enabled agents from the database and schedule them.
 * Called on startup and after agent create/update/delete.
 */
export function loadSchedules(): void {
  // Clear existing schedules
  for (const [id, task] of activeTasks) {
    task.stop();
    activeTasks.delete(id);
  }

  const agents = listAgents();
  let scheduled = 0;

  for (const agent of agents) {
    if (agent.enabled && cron.validate(agent.schedule)) {
      scheduleAgent(agent);
      scheduled++;
    }
  }

  console.log(
    `[scheduler] loaded ${scheduled}/${agents.length} agents`
  );
}

/**
 * Schedule a single agent. Replaces any existing schedule for that agent.
 */
export function scheduleAgent(agent: Agent): void {
  // Remove existing schedule if any
  const existing = activeTasks.get(agent.id);
  if (existing) {
    existing.stop();
    activeTasks.delete(agent.id);
  }

  if (!agent.enabled) return;

  if (!cron.validate(agent.schedule)) {
    console.warn(
      `[scheduler] invalid cron expression for agent "${agent.name}": ${agent.schedule}`
    );
    return;
  }

  const task = cron.schedule(agent.schedule, async () => {
    // Re-fetch agent to get latest config
    const currentAgent = getAgent(agent.id);
    if (!currentAgent || !currentAgent.enabled) {
      console.log(
        `[scheduler] skipping disabled/deleted agent "${agent.name}"`
      );
      return;
    }

    try {
      await executeAgent(currentAgent, "schedule");
    } catch {
      // Error already logged by engine
    }
  });

  activeTasks.set(agent.id, task);
  console.log(
    `[scheduler] scheduled agent "${agent.name}" (${agent.schedule})`
  );
}

/**
 * Unschedule a single agent.
 */
export function unscheduleAgent(id: string): void {
  const task = activeTasks.get(id);
  if (task) {
    task.stop();
    activeTasks.delete(id);
  }
}

/**
 * Stop all scheduled tasks. Called during shutdown.
 */
export function stopAll(): void {
  for (const [, task] of activeTasks) {
    task.stop();
  }
  activeTasks.clear();
  console.log("[scheduler] all tasks stopped");
}

/**
 * Get the number of actively scheduled agents.
 */
export function getActiveCount(): number {
  return activeTasks.size;
}
