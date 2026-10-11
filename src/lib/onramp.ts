/**
 * Aweborn — gentle "Save your player" onramp (Phase 08).
 *
 * Anonymous players are always welcome. We suggest saving only after a
 * meaningful moment (first world created, or ~10 minutes of play), never as a
 * wall, and at most once a day. Dismissing is always fine.
 */

const PLAYTIME_KEY = "aweborn-playtime-s";
const PROMPTED_AT_KEY = "aweborn-save-prompted-at";
const MOMENT_EVENT = "aweborn:meaningful-moment";

/** Total visible play time before we suggest saving. */
export const PLAYTIME_THRESHOLD_S = 10 * 60;
const PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type MeaningfulMoment = "world-created" | "playtime";

/** Call when something worth keeping happens (e.g. the player made a world). */
export function markMeaningfulMoment(moment: MeaningfulMoment): void {
  window.dispatchEvent(new CustomEvent<MeaningfulMoment>(MOMENT_EVENT, { detail: moment }));
}

export function onMeaningfulMoment(fn: (moment: MeaningfulMoment) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<MeaningfulMoment>).detail);
  window.addEventListener(MOMENT_EVENT, handler);
  return () => window.removeEventListener(MOMENT_EVENT, handler);
}

function readNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage blocked (private mode): the prompt just may show again.
  }
}

/** True if we haven't suggested saving in the last day. */
export function canPromptNow(): boolean {
  return Date.now() - readNumber(PROMPTED_AT_KEY) >= PROMPT_COOLDOWN_MS;
}

export function recordPrompted(): void {
  writeNumber(PROMPTED_AT_KEY, Date.now());
}

/**
 * Count visible play time across visits; fires a "playtime" moment once the
 * threshold is crossed (and again on later visits, subject to the daily cap).
 */
export function trackPlaytime(): () => void {
  const TICK_S = 15;
  let fired = false;
  const id = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const total = readNumber(PLAYTIME_KEY) + TICK_S;
    writeNumber(PLAYTIME_KEY, total);
    if (!fired && total >= PLAYTIME_THRESHOLD_S) {
      fired = true;
      markMeaningfulMoment("playtime");
    }
  }, TICK_S * 1000);
  return () => window.clearInterval(id);
}
