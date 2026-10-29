/**
 * QR device linking (Phase 08 I2, Rough Draft M9).
 *
 * A device that plays a player (any session, anonymous included: "anonymous
 * first") asks for a link code: 8 characters, single use, 5 minutes. It shows
 * the code as a QR (`aweborn.org/link#<code>`) and as text. The new device
 * redeems it and gets its *own* new session for the same account, playing
 * the same character; the old device's secret is never copied. Devices are
 * listed / revoked with Better Auth's own `list-sessions` / `revoke-session`.
 *
 * Endpoints (Better Auth plugin, under /api/auth):
 *   POST /device-link/create   (session)  → { code, expiresAt }
 *   POST /device-link/redeem   { code }   → { playerId }  + Set-Cookie for the new session
 *
 * Codes live in memory (a restart just voids open codes). Brute force: 31^8
 * codes, ≤ 3 open per account, 10 redeem tries a minute per IP, and a code
 * dies on first use.
 *
 * Not yet (phases/08 log): the redeeming device's own throwaway anonymous
 * player is left as is (not merged or deleted); a saved player's device gets
 * no "confirm it's you" step beyond holding the other device.
 */
import { randomInt } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const CODE_LEN = 8;
export const LINK_CODE_TTL_MS = 5 * 60_000;
const MAX_OPEN_PER_ACCOUNT = 3;
const MAX_OPEN = 10_000;

interface Pending { userId: string; playerId: string | null; expiresAt: number }

/** Plain store so the rules are testable without Better Auth. */
export class LinkCodes {
  private codes = new Map<string, Pending>();
  constructor(private now: () => number = Date.now) {}

  create(userId: string, playerId: string | null): { code: string; expiresAt: number } | null {
    this.sweep();
    let open = 0;
    for (const p of this.codes.values()) if (p.userId === userId) open++;
    if (open >= MAX_OPEN_PER_ACCOUNT || this.codes.size >= MAX_OPEN) return null;
    let code = "";
    do {
      code = Array.from({ length: CODE_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    } while (this.codes.has(code));
    const expiresAt = this.now() + LINK_CODE_TTL_MS;
    this.codes.set(code, { userId, playerId, expiresAt });
    return { code, expiresAt };
  }

  /** Single use: a found code is gone after this, whatever happens next. */
  take(raw: string): Pending | null {
    const code = normalizeCode(raw);
    const p = this.codes.get(code);
    if (!p) return null;
    this.codes.delete(code);
    return p.expiresAt > this.now() ? p : null;
  }

  private sweep(): void {
    const t = this.now();
    for (const [c, p] of this.codes) if (p.expiresAt <= t) this.codes.delete(c);
  }
}

/** Typed codes: case-insensitive, spaces/dashes ignored. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "").slice(0, 16);
}

export function deviceLink(opts: {
  /** The character this session plays (null if none yet). */
  activeCharacter: (user: { id: string; playerId?: unknown }, sessionId: string) => string | null;
  /** Make a new session play `playerId` (identity.ts setSessionCharacter). */
  setCharacter: (sessionId: string, playerId: string) => void;
  onLinked?: (userId: string) => void;
}): BetterAuthPlugin {
  const codes = new LinkCodes();
  return {
    id: "device-link",
    endpoints: {
      createDeviceLink: createAuthEndpoint(
        "/device-link/create",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const s = ctx.context.session;
          const made = codes.create(s.user.id, opts.activeCharacter(s.user as { id: string; playerId?: unknown }, s.session.id));
          if (!made) throw new APIError("TOO_MANY_REQUESTS", { message: "You have a few codes open already. Use one or wait 5 minutes." });
          return ctx.json(made);
        },
      ),
      redeemDeviceLink: createAuthEndpoint(
        "/device-link/redeem",
        { method: "POST", body: z.object({ code: z.string().min(4).max(32) }) },
        async (ctx) => {
          const p = codes.take(ctx.body.code);
          if (!p) throw new APIError("BAD_REQUEST", { message: "That code didn't work. It may have expired: make a new one on your other device." });
          const user = await ctx.context.internalAdapter.findUserById(p.userId);
          if (!user) throw new APIError("BAD_REQUEST", { message: "That player is gone." });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Couldn't sign this device in. Try again." });
          if (p.playerId) opts.setCharacter(session.id, p.playerId);
          await setSessionCookie(ctx, { session, user });
          opts.onLinked?.(user.id);
          return ctx.json({ playerId: p.playerId });
        },
      ),
    },
    rateLimit: [
      { pathMatcher: (path) => path === "/device-link/redeem", window: 60, max: 10 },
      { pathMatcher: (path) => path === "/device-link/create", window: 60, max: 10 },
    ],
  } satisfies BetterAuthPlugin;
}
