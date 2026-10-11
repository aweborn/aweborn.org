/**
 * Aweborn — Player identity (Better Auth)
 *
 * Anonymous-first: every visitor silently becomes a player (no signup wall,
 * so an NFC card tap drops you straight into a world). Real sign-in methods
 * (QR device linking, passkeys, magic link, social, email + password) attach
 * later. See phases/08-nfc-trading-cards.md → Persistent Player Identity.
 *
 * `playerId` vs Better Auth's `user.id`:
 *   When an anonymous user links a real sign-in, Better Auth creates a NEW user
 *   and deletes the anonymous one. So `user.id` is not stable. `playerId` is
 *   our own column: public (presence, world `creator`), never a credential,
 *   and carried over to the new user in `onLinkAccount`.
 *
 * Storage: the auth tables live in `universe.db` (shared connection) so the
 * hourly on-box + S3 backups and the DR restore cover them with no changes.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";

/** Browser origins allowed to call the auth API with credentials. */
export const TRUSTED_ORIGINS = [
  "https://aweborn.org",
  "https://www.aweborn.org",
  ...(process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const IS_PROD = process.env.NODE_ENV === "production";

export function isTrustedOrigin(origin: string | undefined): origin is string {
  if (!origin) return false;
  return TRUSTED_ORIGINS.includes(origin) || (!IS_PROD && LOCAL_ORIGIN.test(origin));
}

/** A fresh sign-up has its user and session created within the same request. */
const FRESH_USER_WINDOW_MS = 60_000;

const DAY_S = 60 * 60 * 24;

function buildOptions(db: Database.Database) {
  return {
    database: db,
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:1234",
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: IS_PROD
      ? TRUSTED_ORIGINS
      : [...TRUSTED_ORIGINS, "http://localhost:*", "http://127.0.0.1:*"],

    user: {
      additionalFields: {
        // Stable public player identity. Server-assigned; clients can't set it.
        playerId: { type: "string", required: false, input: false },
      },
    },

    session: {
      // Anonymous players have no way back in if the session lapses, so keep
      // it long-lived and refreshed on use. Sessions are per device and revocable.
      expiresIn: 365 * DAY_S,
      updateAge: DAY_S,
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({ data: { ...user, playerId: randomUUID() } }),
        },
      },
    },

    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        // Generous: a whole event on one venue Wi-Fi may tap cards at once.
        "/sign-in/anonymous": { window: 60, max: 30 },
      },
    },

    advanced: {
      // Caddy overwrites X-Forwarded-For with the real client IP.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },

    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser, ctx }) => {
          const anonPlayerId = anonymousUser.user.playerId as string | undefined;
          if (!anonPlayerId) return;
          const created = new Date(newUser.user.createdAt).getTime();
          const sessionStart = new Date(newUser.session.createdAt).getTime();
          if (Math.abs(sessionStart - created) <= FRESH_USER_WINDOW_MS) {
            // Brand-new account: it simply becomes this player.
            await ctx.context.internalAdapter.updateUser(newUser.user.id, {
              playerId: anonPlayerId,
            });
            console.log(`[auth] linked anonymous player ${anonPlayerId} to a new account`);
          } else {
            // Signed in to an existing player from an anonymous device. The
            // existing playerId wins; merging the anonymous World Index is I5.
            console.log(
              `[auth] anonymous player ${anonPlayerId} signed in to existing player ${newUser.user.playerId} (merge: I5)`
            );
          }
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}

export type Auth = ReturnType<typeof createAuthFromOptions>;
function createAuthFromOptions(options: ReturnType<typeof buildOptions>) {
  return betterAuth(options);
}

/**
 * Create the auth instance and apply any pending schema migrations
 * (idempotent, like `initDb()`).
 *
 * Returns null (auth disabled, everyone plays as a guest) if production has
 * no real secret, e.g. right after a VPS rebuild, which installs a
 * `REPLACE_ME` placeholder. The universe must never go down over auth.
 */
export async function initAuth(db: Database.Database): Promise<Auth | null> {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  if (IS_PROD && (secret.length < 32 || secret === "REPLACE_ME")) {
    console.error(
      "[auth] ✖ BETTER_AUTH_SECRET missing or weak: player identity DISABLED, everyone is a guest. " +
        "Restore the original secret into aweborn-secrets (see HANDOFF → Player identity).",
    );
    return null;
  }
  const options = buildOptions(db);
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(options);
  if (toBeCreated.length || toBeAdded.length) {
    const names = [...toBeCreated, ...toBeAdded].map((t) => t.table).join(", ");
    console.log(`[auth] migrating auth schema: ${names}`);
    await runMigrations();
  }
  return createAuthFromOptions(options);
}

/** Resolve the player behind a request's session cookie, or null. */
export async function getPlayerId(auth: Auth, headers: Headers): Promise<string | null> {
  const session = await auth.api.getSession({ headers });
  const playerId = (session?.user as { playerId?: string } | undefined)?.playerId;
  return playerId ?? null;
}
