/**
 * Character names (Rough Draft M1, 2026-10-27): replaces "Wanderer 4K2Q" in
 * chat and over heads. Shared so the client validates as you type and the
 * server enforces the same rules.
 */
import { cleanChatText, maskProfanity } from "./chat.js";

export const NAME_MIN = 2;
export const NAME_MAX = 20;

/** Names nobody may take (they'd read as staff or the game itself). */
const RESERVED = ["aweborn", "admin", "administrator", "moderator", "mod", "system", "server", "you", "staff", "official", "support"];

export type NameResult = { ok: true; name: string } | { ok: false; message: string };

/**
 * Clean and check a requested name: letters (any script), numbers, spaces and
 * `_ - . '`; 2–20 characters; no profanity; not a reserved word.
 */
export function cleanPlayerName(raw: unknown): NameResult {
  const text = cleanChatText(raw).replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  if (chars.length < NAME_MIN) return { ok: false, message: `At least ${NAME_MIN} characters.` };
  if (chars.length > NAME_MAX) return { ok: false, message: `At most ${NAME_MAX} characters.` };
  if (!/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} _\-.']*$/u.test(text)) {
    return { ok: false, message: "Letters, numbers, spaces and _ - . ' only." };
  }
  if (maskProfanity(text) !== text) return { ok: false, message: "Please pick another name." };
  const bare = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (RESERVED.some((r) => bare === r || (bare.startsWith(r) && /^\d+$/.test(bare.slice(r.length))))) {
    return { ok: false, message: "That name is reserved. Please pick another." };
  }
  return { ok: true, name: text };
}

/** A short, stable handle for players without a name yet: "Wanderer 4K2Q". */
export function wandererTag(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return `Wanderer ${(h >>> 0).toString(36).toUpperCase().padStart(4, "0").slice(-4)}`;
}
