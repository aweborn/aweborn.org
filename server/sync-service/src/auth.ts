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
import { anonymous, emailOTP, haveIBeenPwned } from "better-auth/plugins";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { passkey, getAuthenticatorName } from "@better-auth/passkey";
import { codeEmail, emailEnabled, existingAccountEmail, sendEmail } from "./email.js";

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

/**
 * Real (non-anonymous) accounts created in the last few minutes by this
 * process, so `onLinkAccount` can tell "this sign-in just created a new
 * account" from "this sign-in reached an existing player". Timing heuristics
 * can't: an existing player signing in moments after creation looks fresh.
 */
const NEW_ACCOUNT_TTL_MS = 5 * 60_000;
const newAccounts = new Map<string, number>();
function rememberNewAccount(userId: string): void {
  const now = Date.now();
  for (const [id, at] of newAccounts) if (now - at > NEW_ACCOUNT_TTL_MS) newAccounts.delete(id);
  newAccounts.set(userId, now);
}
function takeNewAccount(userId: string): boolean {
  const at = newAccounts.get(userId);
  newAccounts.delete(userId);
  return at !== undefined && Date.now() - at <= NEW_ACCOUNT_TTL_MS;
}

const DAY_S = 60 * 60 * 24;

/**
 * Passkeys are bound to the site the player sees (aweborn.org), not the auth
 * host (sync.aweborn.org). A parent domain is a valid RP ID for a subdomain.
 */
const PASSKEY_RP_ID = process.env.PASSKEY_RP_ID ?? (IS_PROD ? "aweborn.org" : "localhost");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const GOOGLE_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

/** Email codes (sign-in, verify, reset) last this long. */
const CODE_MINUTES = 10;

/** Which sign-in methods the client should offer (GET /api/auth/methods). */
export function authMethods(auth: Auth | null) {
  return {
    enabled: auth !== null,
    passkey: auth !== null,
    google: auth !== null && GOOGLE_ENABLED,
    // Email code + email/password: on whenever mail can be sent (SES in prod).
    email: auth !== null && emailEnabled,
  };
}

/**
 * Session freshness, our way. Better Auth's built-in check (session < 1 day
 * old) would lock anonymous players out of saving their player for good:
 * they have no credential to re-authenticate with. So the built-in check is
 * off (`freshAge: 0`) and this hook enforces it only for players who already
 * have a real sign-in method (they can simply sign in again).
 */
const FRESH_SESSION_MS = DAY_S * 1000;
const SENSITIVE_PATHS = new Set([
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/delete-passkey",
  "/link-social",
  "/unlink-account",
  "/delete-user",
  "/change-email",
  "/change-password",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
]);

/** Readable label for the OS passkey picker (instead of a random placeholder). */
function playerEmail(id: string): string {
  return `player-${id.replace(/-/g, "").slice(0, 12)}@aweborn.invalid`;
}
/** Better Auth's default anonymous email, used before we set our own format. */
const LEGACY_ANON_EMAIL = /@anonymous\.placeholder\.invalid$/;

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
      // Off: see SENSITIVE_PATHS / the `hooks.before` below.
      freshAge: 0,
    },

    // Sign-in methods. Each one attaches to the same player (`playerId`).
    socialProviders: GOOGLE_ENABLED
      ? {
          google: {
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            // Shared/family devices: always let people pick the account.
            prompt: "select_account" as const,
          },
        }
      : {},

    account: {
      accountLinking: {
        enabled: true,
        // A player saved with a passkey has a placeholder email, so adding
        // Google later is always a "different email". Explicit links only
        // (requires the player's own session).
        allowDifferentEmails: true,
        trustedProviders: ["google"],
      },
    },

    // Email + password: a quieter alternative to the email code. The email is
    // always confirmed with a code first (emailOTP overrides verification).
    emailAndPassword: {
      enabled: emailEnabled,
      requireEmailVerification: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      onExistingUserSignUp: async ({ user }) => {
        void sendEmail(existingAccountEmail(user.email));
      },
    },
    emailVerification: {
      // Confirming the email (on the device that signed up) saves the player.
      autoSignInAfterVerification: true,
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!SENSITIVE_PATHS.has(ctx.path)) return;
        const session = await getSessionFromCtx(ctx);
        if (!session) return;
        if (session.user.isAnonymous) {
          // About to make this player's first passkey: give it a readable name
          // in the OS passkey picker. Best effort (label only).
          const { id, email, playerId } = session.user as { id: string; email: string; playerId?: string };
          if (ctx.path === "/passkey/generate-register-options" && playerId && LEGACY_ANON_EMAIL.test(email)) {
            const relabelled = playerEmail(playerId);
            await ctx.context.internalAdapter
              .updateUser(id, { email: relabelled })
              .then(() => {
                session.user.email = relabelled; // the plugin reads this cached session
              })
              .catch((err: unknown) => console.warn("[auth] could not relabel anonymous player:", err));
          }
          return;
        }
        const age = Date.now() - new Date(session.session.createdAt).getTime();
        if (age >= FRESH_SESSION_MS) {
          throw new APIError("FORBIDDEN", {
            code: "SESSION_NOT_FRESH",
            message: "For safety, sign in again before changing how you sign in.",
          });
        }
      }),
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            // Saving an anonymous player (any method: email code, password
            // sign-up, Google): the new account IS that player, from birth.
            // Covers sign-ups confirmed later, which never pass `onLinkAccount`.
            let playerId: string = randomUUID();
            if (ctx && !(user as { isAnonymous?: boolean | null }).isAnonymous) {
              const session = await getSessionFromCtx(ctx).catch(() => null);
              const anon = session?.user as { isAnonymous?: boolean | null; playerId?: string | null } | undefined;
              if (anon?.isAnonymous && anon.playerId) playerId = anon.playerId;
            }
            return { data: { ...user, playerId } };
          },
          after: async (user) => {
            if (!(user as { isAnonymous?: boolean | null }).isAnonymous) rememberNewAccount(user.id);
          },
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
      passkey({
        rpID: PASSKEY_RP_ID,
        rpName: "Aweborn",
        // `origin` unset: verified against the request's Origin, which Better
        // Auth has already checked against trustedOrigins.
        authenticatorSelection: {
          // Discoverable credentials: sign in on a new device with no username.
          residentKey: "required",
          userVerification: "preferred",
        },
        registration: {
          afterVerification: async ({ ctx, user, verification }) => {
            // A passkey on an anonymous player makes it a saved player. Same
            // user row, so playerId is untouched.
            const full = (await ctx.context.internalAdapter.findUserById(user.id)) as
              | { isAnonymous?: boolean | null; playerId?: string | null }
              | null;
            if (full?.isAnonymous) {
              await ctx.context.internalAdapter.updateUser(user.id, { isAnonymous: false });
              console.log(`[auth] player ${String(full.playerId)} saved with a passkey`);
            }
            return { name: getAuthenticatorName(verification.registrationInfo?.aaguid) || undefined };
          },
        },
      }),
      ...(emailEnabled
        ? [
            emailOTP({
              // Codes, not magic links: typed on the device being saved (a link
              // would sign in whichever browser opens the email), and a
              // stranger can't bind someone's inbox to their own device.
              sendVerificationOTP: async ({ email, otp, type }) => {
                void sendEmail(codeEmail(email, otp, type, CODE_MINUTES)); // not awaited: no timing oracle
              },
              otpLength: 6,
              // Local UI tests only: a known code. Never in production.
              ...(!IS_PROD && process.env.DEV_FIXED_OTP ? { generateOTP: () => process.env.DEV_FIXED_OTP } : {}),
              expiresIn: CODE_MINUTES * 60,
              allowedAttempts: 5,
              storeOTP: "hashed",
              overrideDefaultEmailVerification: true,
              sendVerificationOnSignUp: true,
              // Passkey-only players add a real email by "changing" their
              // placeholder one (no code to the placeholder: it can't receive).
              changeEmail: { enabled: true, verifyCurrentEmail: false },
            }),
            haveIBeenPwned({
              customPasswordCompromisedMessage:
                "That password has shown up in a data breach elsewhere. Please choose a different one.",
            }),
          ]
        : []),
      anonymous({
        // `player-<id>@aweborn.invalid`: readable in the OS passkey picker,
        // and `.invalid` can never be a real mailbox.
        generateRandomEmail: () => playerEmail(randomUUID()),
        onLinkAccount: async ({ anonymousUser, newUser, ctx }) => {
          const anonPlayerId = anonymousUser.user.playerId as string | undefined;
          if (!anonPlayerId) return;
          const isNew = takeNewAccount(newUser.user.id);
          if (newUser.user.playerId === anonPlayerId) {
            // Already inherited at creation (user.create.before).
            console.log(`[auth] linked anonymous player ${anonPlayerId} to a new account`);
          } else if (isNew) {
            // Fallback: brand-new account created without the anonymous
            // session in context. It simply becomes this player.
            await ctx.context.internalAdapter.updateUser(newUser.user.id, {
              playerId: anonPlayerId,
            });
            console.log(`[auth] linked anonymous player ${anonPlayerId} to a new account (fallback)`);
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
