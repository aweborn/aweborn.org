/**
 * Creation safety check (Rough Draft M1, 2026-10-27).
 *
 * Runs before a planner blueprint is shown and before any prompt reaches
 * Meshy (Make, manifest, redo). Two layers:
 *   1. Local: the chat blocklist (free, instant, always on).
 *   2. Classifier: one small LLM call via genai-service /llm that returns
 *      { allowed, category, suggestion }. Verdicts are cached by text.
 *
 * If the classifier is unreachable we let the prompt through (the local list
 * still applies, the planner has its own safety rules, and Meshy moderates
 * too) and log it, so an OpenRouter hiccup never takes creation down at an
 * event. Every block is saved in `safety_flag` for review.
 */
import { createHash } from "node:crypto";
import { getDb } from "./persistence.js";
import { tryResearchId } from "./research.js";
import { maskProfanity } from "../../../shared/chat.js";

const GENAI_URL = process.env.GENAI_URL ?? "http://genai-service:3001";
export const SAFETY_MODEL = process.env.SAFETY_MODEL ?? "anthropic/claude-haiku-5.5";
const TIMEOUT_MS = 10_000;
const CACHE_MAX = 5000;

export type SafetyCategory =
  | "sexual" | "hate" | "gore" | "self_harm" | "real_person" | "ip" | "personal_info" | "profanity" | "other";

export type SafetyVerdict =
  | { ok: true; costUsd: number }
  | { ok: false; category: SafetyCategory; suggestion: string; message: string; costUsd: number };

const SAFETY_SYSTEM = `You check prompts for Aweborn, an all-ages game where players describe 3D objects, worlds, sounds and music and they get generated.
Decide whether ALL of the given texts are OK to generate. Block only:
- sexual or suggestive content, nudity
- hate, slurs, harassment, extremist symbols
- gore, graphic injury, torture (cartoon swords, monsters, skulls, ruins and spooky things are fine)
- self-harm or suicide
- real, identifiable people (living or historical) by name or likeness
- copyrighted characters, franchises or brands (e.g. Pikachu, Mario, Coca-Cola)
- personal info (addresses, phone numbers, emails)
Everything else is allowed, including fantasy violence, weapons, dark or sad moods.
Reply with ONE JSON object and nothing else:
{"allowed": boolean, "category": "none"|"sexual"|"hate"|"gore"|"self_harm"|"real_person"|"ip"|"personal_info"|"other", "suggestion": string}
suggestion: when blocked, a short original idea in the same spirit that would be allowed (under 12 words, concrete and fun, e.g. "a yellow storm-mouse with lightning-bolt ears"); otherwise "".`;

const CATEGORY_TEXT: Record<SafetyCategory, string> = {
  sexual: "it reads as sexual",
  hate: "it reads as hateful",
  gore: "it's too gory",
  self_harm: "it touches on self-harm",
  real_person: "it names a real person",
  ip: "it's someone else's character or brand",
  personal_info: "it has personal info in it",
  profanity: "it has a word we don't allow",
  other: "it isn't something we make here",
};

function messageFor(category: SafetyCategory, suggestion: string): string {
  const base = `That can't be made here: ${CATEGORY_TEXT[category]}.`;
  return suggestion ? `${base} Try something like “${suggestion}”.` : `${base} Try an idea of your own.`;
}

// ── Review log ────────────────────────────────────────────────────────
let ready = false;
function db() {
  const d = getDb();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS safety_flag (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, player_id TEXT,
      surface TEXT NOT NULL, category TEXT NOT NULL, layer TEXT NOT NULL, text TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS safety_flag_at ON safety_flag(at);`);
    ready = true;
  }
  return d;
}

function logFlag(playerId: string | null, surface: string, category: string, layer: "local" | "classifier", text: string) {
  try {
    db().prepare("INSERT INTO safety_flag (at, player_id, surface, category, layer, text) VALUES (?, ?, ?, ?, ?, ?)")
      .run(Date.now(), playerId, surface, category, layer, text.slice(0, 2000));
  } catch (err) {
    console.error("[safety] log failed:", (err as Error).message);
  }
}

export function listFlags(limit = 100): { id: number; at: number; playerId: string | null; surface: string; category: string; layer: string; text: string }[] {
  return (db().prepare("SELECT * FROM safety_flag ORDER BY id DESC LIMIT ?").all(Math.min(500, limit)) as {
    id: number; at: number; player_id: string | null; surface: string; category: string; layer: string; text: string;
  }[]).map((r) => ({ id: r.id, at: r.at, playerId: r.player_id, surface: r.surface, category: r.category, layer: r.layer, text: r.text }));
}

// ── Layer 1: local blocklist ─────────────────────────────────────────
export function localCheck(texts: string[]): boolean {
  return texts.every((t) => maskProfanity(t) === t);
}

// ── Layer 2: classifier (cached) ─────────────────────────────────────
type Cached = { allowed: true } | { allowed: false; category: SafetyCategory; suggestion: string };
const cache = new Map<string, Cached>();
function remember(key: string, v: Cached) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, v);
}

const CATEGORIES = new Set<SafetyCategory>(["sexual", "hate", "gore", "self_harm", "real_person", "ip", "personal_info", "other"]);

/** Parse the classifier's answer. Anything unreadable counts as "couldn't check" (null). */
export function parseVerdict(content: string): Cached | null {
  const a = content.indexOf("{");
  const b = content.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const j = JSON.parse(content.slice(a, b + 1)) as { allowed?: unknown; category?: unknown; suggestion?: unknown };
    if (typeof j.allowed !== "boolean") return null;
    if (j.allowed) return { allowed: true };
    const category = CATEGORIES.has(j.category as SafetyCategory) ? (j.category as SafetyCategory) : "other";
    const suggestion = typeof j.suggestion === "string" ? maskProfanity(j.suggestion.trim()).slice(0, 100) : "";
    return { allowed: false, category, suggestion };
  } catch {
    return null;
  }
}

type Classify = (ref: string, texts: string[], researchId?: string) => Promise<{ verdict: Cached | null; costUsd: number }>;

const classifyViaGenai: Classify = async (ref, texts, researchId) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GENAI_URL}/llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        ref, model: SAFETY_MODEL, json: true, maxTokens: 200, researchId,
        messages: [
          { role: "system", content: SAFETY_SYSTEM },
          { role: "user", content: texts.map((t, i) => `TEXT ${i + 1}: ${t}`).join("\n") },
        ],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { content?: string; costUsd?: number };
    if (!res.ok || typeof body.content !== "string") return { verdict: null, costUsd: body.costUsd ?? 0 };
    return { verdict: parseVerdict(body.content), costUsd: body.costUsd ?? 0 };
  } catch {
    return { verdict: null, costUsd: 0 };
  } finally {
    clearTimeout(timer);
  }
};

let classify: Classify = classifyViaGenai;
/** Tests swap the classifier. */
export function setClassifierForTests(fn: Classify | null) {
  classify = fn ?? classifyViaGenai;
  cache.clear();
}

/**
 * Check every text a creation would use. `surface` says where it came from
 * (make | plan | manifest | redo) for the review log.
 */
export async function checkCreation(playerId: string | null, surface: string, rawTexts: string[], ref: string): Promise<SafetyVerdict> {
  const texts = rawTexts.map((t) => t.trim()).filter(Boolean);
  if (!texts.length) return { ok: true, costUsd: 0 };

  if (!localCheck(texts)) {
    logFlag(playerId, surface, "profanity", "local", texts.join("\n"));
    return { ok: false, category: "profanity", suggestion: "", message: messageFor("profanity", ""), costUsd: 0 };
  }

  const key = createHash("sha256").update(texts.join("\u0000").toLowerCase()).digest("hex");
  let v = cache.get(key);
  let costUsd = 0;
  if (!v) {
    const out = await classify(`safety:${ref}`, texts, tryResearchId(playerId));
    costUsd = out.costUsd;
    if (!out.verdict) {
      console.warn(`[safety] classifier unavailable for ${ref}; letting it through (local list passed)`);
      return { ok: true, costUsd };
    }
    v = out.verdict;
    remember(key, v);
  }
  if (v.allowed) return { ok: true, costUsd };
  logFlag(playerId, surface, v.category, "classifier", texts.join("\n"));
  return { ok: false, category: v.category, suggestion: v.suggestion, message: messageFor(v.category, v.suggestion), costUsd };
}

/**
 * Book the classifier's real cost as its own creative draw (reserve → settle,
 * K = 100 mana per dollar). The request it guarded was already admitted.
 */
export function chargeCheck(
  ledger: { reserve(ref: string, est: number, playerId: string | null): { ok: boolean }; settle(ref: string, mana: number, note?: string): unknown },
  playerId: string | null, ref: string, costUsd: number,
): void {
  if (!(costUsd > 0)) return;
  const mana = Math.round(costUsd * 100 * 1000) / 1000;
  const r = `safety:${ref}`;
  if (ledger.reserve(r, mana, playerId).ok) ledger.settle(r, mana, "safety check");
}
