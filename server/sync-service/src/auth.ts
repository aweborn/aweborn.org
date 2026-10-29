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

import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { anonymous, customSession, emailOTP, haveIBeenPwned } from "better-auth/plugins";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { hashPassword } from "better-auth/crypto";
import { passkey, getAuthenticatorName } from "@better-auth/passkey";
import { deviceLink } from "./device-link.js";
import { codeEmail, emailEnabled, existingAccountEmail, sendEmail, wayInChangedEmail } from "./email.js";
import {
  absorbAnonymous,
  countWaysIn,
  initIdentity,
  listCharacters,
  realEmail,
  resolveIdentity,
  setSessionCharacter,
  waysIn,
  type Identity,
} from "./identity.js";

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
 * Confirm it's you, our way. Better Auth's built-in check would lock
 * anonymous players out of saving their player for good: they have no
 * credential to re-authenticate with. So the built-in check is off
 * (`freshAge: 0`) and this hook enforces it only for saved players: any
 * change to how they sign in needs a session from the last 5 minutes, i.e.
 * a fresh passkey, email code or Google round trip on this device. Someone
 * holding a borrowed, signed-in phone can't pass that (I5, 2026-10-12).
 */
const FRESH_SESSION_MS = 5 * 60_000;
const MIN_PASSWORD = 10;
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

/**
 * Endpoints that sign this device in. From a *saved* device they may only
 * reach the same player (that's the "confirm it's you" re-check); a
 * different player is refused: sign out of this device first. Anonymous
 * devices are handled by the anonymous plugin's `onLinkAccount`.
 */
const SIGN_IN_PATH =
  /^\/(sign-in\/(email|email-otp|social|passkey)|callback\/|passkey\/verify-authentication|email-otp\/verify-email|verify-email)/;

/** Where to send a browser that was refused mid-OAuth. */
const APP_URL = process.env.APP_URL ?? (IS_PROD ? "https://aweborn.org" : "http://localhost:5173");

const DIFFERENT_PLAYER = {
  code: "DIFFERENT_PLAYER",
  message: "That belongs to a different player. Sign out of this device first to switch.",
};

type RawUser = { id: string; email?: string | null; emailVerified?: boolean | null; playerId?: string | null; isAnonymous?: boolean | null };
type Ctx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * The session this request arrived with (from its cookie), without touching
 * response cookies. `getSessionFromCtx` could append a Set-Cookie (refresh or
 * clear) and clobber the cookie of the sign-in we're observing.
 */
async function arrivingSession(ctx: Ctx) {
  const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
  if (!token) return null;
  const found = await ctx.context.internalAdapter.findSession(token).catch(() => null);
  if (!found || new Date(found.session.expiresAt).getTime() < Date.now()) return null;
  return found as { session: { id: string; token: string; createdAt: Date | string }; user: RawUser };
}

/** Tell the player (at their real email, if any) that a way in changed. */
function notify(user: RawUser | null | undefined, change: string, ...also: (string | null)[]): void {
  const to = new Set([user ? realEmail(user) : null, ...also].filter((x): x is string => Boolean(x)));
  for (const addr of to) void sendEmail(wayInChangedEmail(addr, change));
}

/** Old email per session, between `/email-otp/change-email`'s before and after hooks. */
const pendingEmailChange = new Map<string, string | null>();
/** session id → which way in an unlink is removing (the row is gone by the after hook). */
const pendingUnlink = new Map<string, "google" | "password">();

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
        // No `trustedProviders`: a Google account links (explicitly, or by
        // Better Auth's same-email implicit link) only if Google says its
        // email is verified. Trusting Google would also link Google accounts
        // registered under an unconfirmed, non-Gmail address: a takeover path.
        // Gmail addresses are always verified, so nobody real notices.
      },
    },

    // Email + password: a quieter alternative to the email code. The email is
    // always confirmed with a code first (emailOTP overrides verification).
    emailAndPassword: {
      enabled: emailEnabled,
      requireEmailVerification: true,
      minPasswordLength: MIN_PASSWORD,
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
        // A saved device can only sign in to *its own* player. Catch the
        // email cases early (before a code is sent or an account is made).
        if (
          ctx.path === "/email-otp/send-verification-otp" ||
          ctx.path === "/sign-in/email-otp" ||
          ctx.path === "/sign-in/email" ||
          ctx.path === "/sign-up/email"
        ) {
          const body = (ctx.body ?? {}) as { email?: string; type?: string };
          if (ctx.path === "/email-otp/send-verification-otp" && body.type !== "sign-in") return;
          const prev = await arrivingSession(ctx);
          if (!prev || prev.user.isAnonymous) return;
          const asked = String(body.email ?? "").trim().toLowerCase();
          if (ctx.path === "/sign-up/email" || asked !== (prev.user.email ?? "").toLowerCase()) {
            throw new APIError("FORBIDDEN", DIFFERENT_PLAYER);
          }
          return;
        }

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
            message: "For safety, confirm it's you first.",
          });
        }
        // Never remove the last way in.
        const body = (ctx.body ?? {}) as { id?: string; accountId?: string };
        const ways = waysIn(session.user.id);
        // One Google account per player: to use a different one, remove it first.
        if (ctx.path === "/link-social" && ways.google) {
          throw new APIError("BAD_REQUEST", {
            code: "ONE_GOOGLE",
            message: "This player already has Google. Remove it first to use a different Google account.",
          });
        }
        const unlinking =
          ctx.path !== "/unlink-account" || !body.accountId
            ? null
            : body.accountId === ways.accountIds.google
              ? "google"
              : body.accountId === ways.accountIds.password
                ? "password"
                : null;
        const removing =
          ctx.path === "/passkey/delete-passkey"
            ? ways.passkeys.some((p) => p.id === body.id)
            : unlinking === "google";
        if (removing && countWaysIn(ways) <= 1) {
          throw new APIError("BAD_REQUEST", {
            code: "LAST_WAY_IN",
            message: "That's your only way in. Add another one first.",
          });
        }
        if (unlinking) pendingUnlink.set(session.session.id, unlinking);
        if (ctx.path === "/email-otp/change-email") {
          pendingEmailChange.set(session.session.id, realEmail(session.user as RawUser));
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        if (!ctx.path) return;
        const failed = ctx.context.returned instanceof APIError;

        // Notices for changes to how a saved player signs in.
        if (SENSITIVE_PATHS.has(ctx.path) && !failed) {
          const session = await getSessionFromCtx(ctx).catch(() => null);
          const user = session?.user as RawUser | undefined;
          const body = (ctx.body ?? {}) as { newEmail?: string };
          const unlinked = session ? pendingUnlink.get(session.session.id) : undefined;
          if (session) pendingUnlink.delete(session.session.id);
          if (user && !user.isAnonymous) {
            if (ctx.path === "/passkey/verify-registration") notify(user, "a passkey was added");
            else if (ctx.path === "/passkey/delete-passkey") notify(user, "a passkey was removed");
            else if (ctx.path === "/unlink-account")
              notify(user, unlinked === "password" ? "your password was removed" : "Google sign-in was removed");
            else if (ctx.path === "/change-password") notify(user, "your password was changed");
            else if (ctx.path === "/email-otp/change-email" && session) {
              const old = pendingEmailChange.get(session.session.id) ?? null;
              pendingEmailChange.delete(session.session.id);
              const newEmail = String(body.newEmail ?? "").trim().toLowerCase();
              notify(user, `your email is now ${newEmail}`, old, newEmail);
            }
          }
          return;
        }
        if (ctx.path === "/email-otp/change-email") {
          const s = await getSessionFromCtx(ctx).catch(() => null);
          if (s) pendingEmailChange.delete(s.session.id);
        }
        if (ctx.path === "/email-otp/reset-password" && !failed) {
          const email = String((ctx.body as { email?: string } | undefined)?.email ?? "").trim().toLowerCase();
          if (email) void sendEmail(wayInChangedEmail(email, "your password was reset"));
          return;
        }

        // Sign-ins from a saved device: same player = "confirm it's you";
        // any other player is refused and nothing changes.
        if (!SIGN_IN_PATH.test(ctx.path)) return;
        const next = ctx.context.newSession as { session: { id: string; token: string }; user: RawUser } | null;
        if (!next) return;
        const prev = await arrivingSession(ctx);
        if (!prev || prev.user.isAnonymous) return;

        if (prev.user.id === next.user.id) {
          // Re-check passed. Keep playing the same character; retire the old session.
          if (prev.user.playerId) {
            const playing = resolveIdentity(prev.user.id, prev.user.playerId, prev.session.id).playerId;
            setSessionCharacter(next.session.id, playing);
          }
          // Retire the old session a moment later: plugin after-hooks still read
          // the arriving cookie, and if its session were already gone they'd
          // clear cookies, including the one for the session just made.
          const oldToken = prev.session.token;
          setTimeout(() => {
            void ctx.context.internalAdapter.deleteSession(oldToken).catch(() => undefined);
          }, 2_000).unref();
          return;
        }

        // A different player: undo the sign-in (drop its cookie + session, and
        // the account if this attempt just created it).
        ctx.context.responseHeaders?.delete("set-cookie");
        await ctx.context.internalAdapter.deleteSession(next.session.token).catch(() => undefined);
        if (newAccounts.has(next.user.id)) {
          newAccounts.delete(next.user.id);
          await ctx.context.internalAdapter.deleteUser(next.user.id).catch(() => undefined);
        }
        console.log(`[auth] refused: saved device tried to sign in to a different player`);
        if (ctx.path.startsWith("/callback/")) throw ctx.redirect(`${APP_URL}/?signin=different`);
        throw new APIError("FORBIDDEN", DIFFERENT_PLAYER);
      }),
    },

    databaseHooks: {
      account: {
        create: {
          after: async (account, ctx) => {
            // Google attached to an existing saved player (link, or Better
            // Auth's same-email implicit link): tell them.
            if (account.providerId !== "google" || !ctx || newAccounts.has(account.userId)) return;
            const user = (await ctx.context.internalAdapter.findUserById(account.userId).catch(() => null)) as RawUser | null;
            if (user && !user.isAnonymous) notify(user, "Google sign-in was added");
          },
        },
      },
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
      // Local e2e scripts only. Never in production.
      enabled: IS_PROD || !process.env.DEV_NO_RATE_LIMIT,
      // Per IP. Phones on cellular share carrier-grade NAT addresses, so one IP
      // can be a whole room (2026-10-20 load test: at 30/min, 30 of 60 phones
      // failed to start). Sized for growth (Alex: "hundreds and hundreds of
      // players in the span of weeks"); abuse is bounded by the email/passkey
      // routes' own checks and by guests having no gen AI.
      window: 60,
      max: 600,
      customRules: {
        "/sign-in/anonymous": { window: 60, max: 300 },
      },
    },

    advanced: {
      // Caddy overwrites X-Forwarded-For with the real client IP.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      // Rough Draft M9 (Safari 7-day cap): with /api/auth/* served from aweborn.org through
      // CloudFront (infra AuthProxy=true), the cookie must also reach sync.aweborn.org's socket.
      // Unset = host-only cookies on the auth host, as before.
      ...(process.env.AUTH_COOKIE_DOMAIN
        ? { crossSubDomainCookies: { enabled: true, domain: process.env.AUTH_COOKIE_DOMAIN } }
        : {}),
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
            // Signed in to an existing player from an anonymous device. Both
            // survive: the anonymous character (and its World Index) joins
            // that account, and this device keeps playing it. The player can
            // switch characters from the account panel.
            console.log(
              `[auth] anonymous player ${anonPlayerId} joined existing player ${String(newUser.user.playerId)}`
            );
          }
          try {
            const home = newUser.user.playerId as string | null | undefined;
            const joinedExisting = !isNew && home && home !== anonPlayerId;
            if (joinedExisting) resolveIdentity(newUser.user.id, home, newUser.session.id);
            absorbAnonymous(anonymousUser.user.id, anonPlayerId, newUser.user.id);
            setSessionCharacter(newUser.session.id, anonPlayerId);
          } catch (err) {
            console.error("[auth] could not carry the anonymous character over:", err);
          }
        },
      }),
      // QR device linking (Phase 08 I2, Rough Draft M9): a new device gets its own session, same character.
      deviceLink({
        activeCharacter: (user, sessionId) =>
          typeof user.playerId === "string" ? resolveIdentity(user.id, user.playerId, sessionId).playerId : null,
        setCharacter: (sessionId, playerId) => setSessionCharacter(sessionId, playerId),
        onLinked: (userId) => {
          void (async () => {
            const ctx = await authRef?.$context;
            const u = (await ctx?.internalAdapter.findUserById(userId)) as RawUser | null | undefined;
            notify(u, "a new device was linked with a link code");
          })();
        },
      }),
      // The session reports the character this device plays (not the user's
      // home character) plus the account's other characters. Internal hooks
      // (getSessionFromCtx) still see the raw user.
      customSession(async ({ user, session }) => {
        const raw = user as RawUser;
        if (!raw.playerId) return { user, session, characters: [] as string[] };
        const id = resolveIdentity(raw.id, raw.playerId, session.id);
        return {
          user: { ...user, playerId: id.playerId },
          session,
          characters: listCharacters(id.accountId).map((c) => c.id),
        };
      }),
    ],
  } satisfies BetterAuthOptions;
}

export type Auth = ReturnType<typeof createAuthFromOptions>;
function createAuthFromOptions(options: ReturnType<typeof buildOptions>) {
  return betterAuth(options);
}
/** The live instance, for plugin callbacks that run after creation (device-link notices). */
let authRef: Auth | null = null;

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
  initIdentity(db);
  authRef = createAuthFromOptions(options);
  return authRef;
}

/** The raw session behind a request (user + session ids), or null. */
export async function getRawSession(auth: Auth, headers: Headers) {
  const res = await auth.api.getSession({ headers });
  if (!res) return null;
  return {
    userId: res.user.id,
    sessionId: res.session.id,
    playerId: (res.user as RawUser).playerId ?? null,
    isAnonymous: Boolean((res.user as RawUser).isAnonymous),
  };
}

/** Resolve the account + active character behind a request's session cookie, or null. */
export async function getIdentity(auth: Auth, headers: Headers): Promise<Identity | null> {
  const s = await getRawSession(auth, headers);
  if (!s?.playerId) return null;
  // `playerId` here is already the active character (customSession).
  return { accountId: s.userId, playerId: s.playerId };
}

/** Have I Been Pwned range check (only 5 hash chars leave the server). Throws if unreachable. */
async function passwordIsBreached(password: string): Promise<boolean> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const res = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
    headers: { "Add-Padding": "true", "User-Agent": "aweborn.org" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`pwnedpasswords ${res.status}`);
  const suffix = sha1.slice(5);
  return (await res.text()).split(/\r?\n/).some((line) => {
    const [hash, count] = line.split(":");
    return hash === suffix && Number(count) > 0;
  });
}

export type SetPasswordResult =
  | { ok: true; changed: boolean }
  | { ok: false; status: number; code: string; message: string };

/**
 * A saved player adds (or changes) a password, for people who like them.
 * Better Auth's `setPassword` is server-only and can't change an existing
 * one without the old password, so this is ours, with the same guards as
 * every other change to how a player signs in: saved players only, a real
 * confirmed email (it's the username), confirmed within 5 minutes, breach
 * check, and a notice email. Other devices stay signed in, as for passkeys.
 */
export async function setPlayerPassword(auth: Auth, headers: Headers, password: unknown): Promise<SetPasswordResult> {
  const no = (status: number, code: string, message: string) => ({ ok: false as const, status, code, message });
  const res = await auth.api.getSession({ headers });
  if (!res) return no(401, "NO_SESSION", "Please sign in first.");
  const user = res.user as RawUser;
  if (user.isAnonymous) return no(400, "SAVE_FIRST", "Save your player first.");
  const email = realEmail(user);
  if (!email) return no(400, "NEEDS_EMAIL", "Add your email first: you'll sign in with your email and this password.");
  if (Date.now() - new Date(res.session.createdAt).getTime() >= FRESH_SESSION_MS) {
    return no(403, "SESSION_NOT_FRESH", "For safety, confirm it's you first.");
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return no(400, "PASSWORD_TOO_SHORT", "Use at least 10 characters. A short phrase works great.");
  }
  if (password.length > 128) return no(400, "PASSWORD_TOO_LONG", "That's a very long password. Keep it under 128 characters.");
  try {
    if (await passwordIsBreached(password)) {
      return no(400, "PASSWORD_COMPROMISED", "That password has shown up in a data breach elsewhere. Please choose a different one.");
    }
  } catch (err) {
    console.warn("[auth] breach check failed:", err);
    return no(503, "CHECK_FAILED", "Couldn't check that password right now. Please try again in a minute.");
  }
  const ctx = await auth.$context;
  const hash = await hashPassword(password);
  const account = await ctx.internalAdapter.findCredentialAccount(user.id);
  const changed = Boolean(account?.password);
  if (!account) {
    await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
  } else {
    await ctx.internalAdapter.updatePassword(user.id, hash);
  }
  notify(user, changed ? "your password was changed" : "a password was added");
  return { ok: true, changed };
}
