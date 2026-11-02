/**
 * Automatic retries for generation jobs. A provider hiccup (Meshy 429/5xx, a
 * task that fails on their side, a timeout, a dropped download) shouldn't
 * reach the maker as "The making didn't take". The runner puts the job back
 * in the queue with a backoff, under the same job id, so sync-service and the
 * client just keep seeing it queued/processing. Only a failure that won't fix
 * itself (bad request, no credits, safety refusal, not a humanoid), or running
 * out of attempts, ends the job as failed (and releases its mana hold).
 */

/** Total tries per job, the first included. */
export const MAX_ATTEMPTS = 4;
/** Wait before try 2, 3, 4. */
const BACKOFF_MS = [15_000, 60_000, 180_000];

/** Errors that would fail the same way again. */
const PERMANENT = /bad animate params|unsupported kind|too large|needs the meshy key|no skeleton|pose estimation|humanoid|moderat|violat|inappropriate|content policy|guardrail|zdr/i;

/** First HTTP status in a provider error ("meshy create failed: 429 ...", "elevenlabs 401 ..."). */
function statusOf(msg: string): number | null {
  const m = /\b([45]\d\d)\b/.exec(msg);
  return m ? Number(m[1]) : null;
}

export function isRetryable(msg: string): boolean {
  if (PERMANENT.test(msg)) return false;
  // A dropped/expired download link: the provider hands out a fresh one on the next poll
  if (/download failed/i.test(msg)) return true;
  const status = statusOf(msg);
  if (status !== null && status >= 400 && status < 500) return status === 408 || status === 425 || status === 429;
  return true; // 5xx, network errors, provider task failures, timeouts
}

/**
 * When to try again (ms from now), or null to fail for good.
 * `attempt` is the try that just failed (1-based).
 */
export function retryDelay(msg: string, attempt: number): number | null {
  if (attempt >= MAX_ATTEMPTS || !isRetryable(msg)) return null;
  return BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
}

/**
 * Which provider task the next try resumes from. A provider may say so on the
 * error (`resumeTask`). Otherwise: a task that itself failed or was canceled
 * is started over; anything else (a create call that errored, a timeout, a
 * failed download) keeps polling the task it had, so finished work isn't paid
 * for twice.
 */
export function resumeTaskAfter(err: unknown, current: string | null): string | null {
  const hint = (err as { resumeTask?: unknown } | null)?.resumeTask;
  if (hint === null || typeof hint === "string") return hint;
  const msg = (err as Error)?.message ?? "";
  if (/\b(failed|canceled):/i.test(msg) && /^meshy /i.test(msg) && !/\b(create|refine) failed:/i.test(msg)) return null;
  return current;
}
