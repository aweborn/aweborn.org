/**
 * Server clock (2026-11-01): one time base for everything clients compute from
 * the clock (roaming creatures, kicks, nudges), instead of each device's own.
 *
 * Device clocks disagree: phones are usually NTP-synced to within ~0.1 s, but a
 * hand-set or drifting clock can be seconds or minutes out, and then two players
 * would see a creature in two places. So, like NTP / Cristian's algorithm:
 *
 *   client sends ping at t0 → server answers with its time S → client receives at t1
 *   rtt = t1 − t0,  offset ≈ S + rtt/2 − t1   (exact if the path is symmetric)
 *
 * The error is at most rtt/2, so we keep the sample with the **smallest round
 * trip** among the recent ones (the least-delayed packet is the most accurate),
 * and let it expire so a device clock that's drifting gets re-measured.
 */

export interface ClockSample {
  /** Estimated server − local time (ms). */
  offset: number;
  /** Round trip (ms): this sample's error bound is ±rtt/2. */
  rtt: number;
  /** Local time the sample was taken. */
  at: number;
}

/** Samples older than this stop counting (drift is re-measured). */
export const CLOCK_SAMPLE_TTL_MS = 5 * 60_000;
/** Most samples kept. */
export const CLOCK_SAMPLES = 12;

/** One ping/pong exchange → a sample, or null if it can't be trusted. */
export function clockSample(sentAt: number, serverTime: number, receivedAt: number): ClockSample | null {
  const rtt = receivedAt - sentAt;
  if (!Number.isFinite(serverTime) || !Number.isFinite(rtt) || rtt < 0 || rtt > 10_000) return null;
  return { offset: serverTime + rtt / 2 - receivedAt, rtt, at: receivedAt };
}

/** Add a sample to the window (newest last, bounded, expired ones dropped). */
export function addSample(samples: readonly ClockSample[], s: ClockSample): ClockSample[] {
  return [...samples.filter((x) => s.at - x.at < CLOCK_SAMPLE_TTL_MS), s].slice(-CLOCK_SAMPLES);
}

/** The offset to use: the lowest-round-trip sample's (0 with none). */
export function bestOffset(samples: readonly ClockSample[]): number {
  let best: ClockSample | null = null;
  for (const s of samples) if (!best || s.rtt < best.rtt) best = s;
  return best ? best.offset : 0;
}

