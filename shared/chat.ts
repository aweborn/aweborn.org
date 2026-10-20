/**
 * In-world chat rules (shared by the server, which enforces them, and the
 * client, which uses them to give instant feedback).
 *
 * Messages are plain text. Anyone can type any language or emoji (UTF-8), so
 * the cleaner keeps real text and removes only what can't be shown honestly:
 * control and invisible characters, text-direction overrides, private-use
 * and unassigned code points, lone surrogates and zalgo stacks of combining
 * marks. Nothing here ever builds HTML or SQL: messages travel inside the
 * world's binary CRDT document and are rendered by React as text nodes.
 */

export const CHAT_MAX_CHARS = 200;
/** Messages kept per world (oldest dropped). */
export const CHAT_HISTORY = 200;
/** At least this long between a player's messages. */
export const CHAT_MIN_GAP_MS = 700;
/** At most this many messages per window. */
export const CHAT_BURST = 8;
export const CHAT_WINDOW_MS = 30_000;
/** Raw wire payload cap (bytes): a 200-character message is at most ~800. */
export const CHAT_MAX_BYTES = 2048;

/** Invisible or direction-changing format characters (ZWJ and variation selectors stay: emoji need them). */
const BAD_FORMAT = /\u034F|[\u00AD\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB]/gu;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const NOT_TEXT = /[\p{Cc}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}]/gu;
/** More than three combining marks in a row is a tower, not a letter. */
const MARK_TOWER = /(\p{M}{3})\p{M}+/gu;

/** Clean a raw message: a string of at most {@link CHAT_MAX_CHARS} characters, or "" if nothing is left. */
export function cleanChatText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let s = raw.slice(0, CHAT_MAX_CHARS * 8); // bound the work before anything else
  s = s.replace(LONE_SURROGATE, "");
  try {
    s = s.normalize("NFC");
  } catch {
    return "";
  }
  s = s.replace(/[\t\n\r\u0085\u2028\u2029]+/g, " ").replace(BAD_FORMAT, "").replace(NOT_TEXT, "");
  s = s.replace(MARK_TOWER, "$1");
  s = s.replace(/\s+/g, " ").trim();
  return Array.from(s).slice(0, CHAT_MAX_CHARS).join("").trim();
}

// ── Profanity ────────────────────────────────────────────────────────
//
// A starting list, matched as whole words after undoing common letter
// swaps (f*ck, sh1t, ph) and repeated letters. Stored rot13 so the source
// stays readable; refine it in play testing. Whole-word matching avoids the
// "Scunthorpe problem" (no masking inside innocent words).

const ROT13_WORDS = [
  "shpx", "shpxre", "shpxvat", "zbgureshpxre", "fuvg", "fuvggl", "ovgpu", "phag", "nffubyr", "qvpx", "chffl", "jubre",
  "fyhg", "onfgneq", "avttre", "avttn", "snttbg", "snt", "ergneq", "xvxr", "fcvp", "puvax", "genaal", "pbpx", "gjng", "jnax",
];
const rot13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const BLOCKED = new Set(ROT13_WORDS.map(rot13));

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

function normalizeWord(word: string): string {
  let w = word.toLowerCase().replace(/[013457@$]/g, (c) => LEET[c] ?? c);
  w = w.replace(/[^a-z]/g, "").replace(/ph/g, "f");
  return w.replace(/(.)\1+/g, "$1");
}
const BLOCKED_COLLAPSED = new Set([...BLOCKED].map((w) => w.replace(/ph/g, "f").replace(/(.)\1+/g, "$1")));

/** Mask blocked words with asterisks, keeping everything else exactly as typed. */
export function maskProfanity(text: string): string {
  return text.replace(/[\p{L}\p{N}@$*]+/gu, (token) => {
    // "f*ck", "sh*t": a star stands in for a vowel
    const hit = ["u", "i"].some((v) => BLOCKED_COLLAPSED.has(normalizeWord(token.replace(/\*/g, v))));
    return hit ? "*".repeat(Array.from(token).length) : token;
  });
}

/** Full pipeline the server applies to every message: clean, then mask. */
export function prepareChat(raw: unknown): string {
  return maskProfanity(cleanChatText(raw));
}

// ── Rate limiting ────────────────────────────────────────────────────

/** Per-player send times; returns null if allowed (and records it), else why not. */
export class ChatLimiter {
  private sent = new Map<string, number[]>();

  check(playerId: string, now: number): "too_fast" | "too_many" | null {
    const times = (this.sent.get(playerId) ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
    const last = times[times.length - 1];
    if (last !== undefined && now - last < CHAT_MIN_GAP_MS) return "too_fast";
    if (times.length >= CHAT_BURST) return "too_many";
    times.push(now);
    this.sent.set(playerId, times);
    if (this.sent.size > 5000) {
      for (const [id, ts] of this.sent) if (now - (ts[ts.length - 1] ?? 0) > CHAT_WINDOW_MS) this.sent.delete(id);
    }
    return null;
  }
}
