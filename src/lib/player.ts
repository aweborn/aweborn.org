/**
 * Aweborn — the local player's identity.
 *
 * Anonymous-first: on boot we reuse the device's session, or silently create
 * an anonymous player (Better Auth, served by sync-service at /api/auth).
 * Everyone is welcome: if auth is unreachable (offline, cookies blocked) the
 * player continues as a *guest* with a per-tab ID and no persistence.
 *
 * `playerId` is public (presence, world `creator`). The credential is the
 * httpOnly session cookie, which JS never sees.
 */

import { createAuthClient } from "better-auth/client";
import { anonymousClient, emailOTPClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:1234";
/** Auth lives on the sync-service origin (same site as aweborn.org). */
export const AUTH_URL: string = import.meta.env.VITE_AUTH_URL ?? SYNC_URL.replace(/^ws/, "http");

/** Give up on auth after this long and play as a guest (never block play). */
const AUTH_TIMEOUT_MS = 5_000;

export const authClient = createAuthClient({
  baseURL: AUTH_URL,
  fetchOptions: { credentials: "include" },
  plugins: [anonymousClient(), passkeyClient(), emailOTPClient()],
});

export interface Player {
  /** Stable public player ID (UUID) of the character this device plays, or a per-tab `guest-…` ID. */
  playerId: string;
  /** Derived from `playerId`, so it's the same on every device. */
  color: string;
  /** Has a session but no real sign-in method linked yet. */
  isAnonymous: boolean;
  /** No session at all: nothing persists. */
  isGuest: boolean;
  /** Every character in this account (incl. `playerId`), oldest first. */
  characters: string[];
}

/** Same player, same colour everywhere (FNV-1a hash → hue). Customisable later. */
export function colorForPlayer(playerId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < playerId.length; i++) {
    h ^= playerId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hue = (h >>> 0) % 360;
  return `hsl(${hue}, 80%, 65%)`;
}

function guestPlayer(): Player {
  const key = "aweborn-guest-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `guest-${crypto.randomUUID().slice(0, 8)}`;
    sessionStorage.setItem(key, id);
  }
  return { playerId: id, color: colorForPlayer(id), isAnonymous: false, isGuest: true, characters: [id] };
}

type SessionUser = { playerId?: string | null; isAnonymous?: boolean | null };
type SessionData = { user?: SessionUser; characters?: string[] } | null | undefined;

function toPlayer(data: SessionData): Player | null {
  const user = data?.user;
  if (!user?.playerId) return null;
  const characters = data?.characters?.length ? data.characters : [user.playerId];
  return {
    playerId: user.playerId,
    color: colorForPlayer(user.playerId),
    isAnonymous: Boolean(user.isAnonymous),
    isGuest: false,
    characters,
  };
}

async function resolvePlayer(): Promise<Player> {
  const existing = await authClient.getSession();
  const fromSession = toPlayer(existing.data as SessionData);
  if (fromSession) return fromSession;

  const created = await authClient.signIn.anonymous();
  if (created.data?.user) {
    // Re-read: the session reports the active character + the account's list.
    const fresh = await authClient.getSession({ query: { disableCookieCache: true } });
    const fromSignIn = toPlayer(fresh.data as SessionData) ?? toPlayer({ user: created.data.user as SessionUser });
    if (fromSignIn) return fromSignIn;
  }

  throw new Error(created.error?.message ?? "anonymous sign-in returned no player");
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)),
  ]);
}

/**
 * Resolves once, at boot, to the local player. Never rejects: falls back to
 * a guest so the universe always opens.
 */
export const playerReady: Promise<Player> = withTimeout(resolvePlayer(), AUTH_TIMEOUT_MS)
  .then((player) => {
    console.log(`[player] ${player.isAnonymous ? "anonymous" : "signed-in"} player ${player.playerId}`);
    return player;
  })
  .catch((err: unknown) => {
    console.warn("[player] auth unavailable, continuing as guest:", err);
    return guestPlayer();
  });

// ── Live player state (for UI) ──────────────────────────────────────────────

let currentPlayer: Player | null = null;
const playerListeners = new Set<() => void>();

function setPlayer(player: Player): void {
  currentPlayer = player;
  playerListeners.forEach((fn) => fn());
}
void playerReady.then(setPlayer);

export function getPlayerSnapshot(): Player | null {
  return currentPlayer;
}
export function subscribePlayer(fn: () => void): () => void {
  playerListeners.add(fn);
  return () => playerListeners.delete(fn);
}

/** Re-read the session (e.g. after saving with a passkey). */
export async function refreshPlayer(): Promise<void> {
  const res = await authClient.getSession({ query: { disableCookieCache: true } });
  const player = toPlayer(res.data as SessionData);
  if (player) setPlayer(player);
}

/** Play another character of this account on this device. Reloads into it. */
export async function switchCharacter(id: string): Promise<AuthResult> {
  const res = await fetch(`${AUTH_URL}/api/player/character`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }).catch(() => null);
  if (!res?.ok) return { ok: false, message: "Couldn't switch characters. Please try again." };
  window.location.reload();
  return { ok: true };
}

// ── Sign-in methods ─────────────────────────────────────────────────────────

export interface AuthMethods {
  enabled: boolean;
  passkey: boolean;
  google: boolean;
  email: boolean;
}
const NO_METHODS: AuthMethods = { enabled: false, passkey: false, google: false, email: false };

let methodsPromise: Promise<AuthMethods> | null = null;
/** Which sign-in methods the server offers (cached for the page's life). */
export function fetchAuthMethods(): Promise<AuthMethods> {
  methodsPromise ??= fetch(`${AUTH_URL}/api/auth/methods`)
    .then((r) => (r.ok ? (r.json() as Promise<AuthMethods>) : NO_METHODS))
    .then((m) => ({
      ...m,
      // WebAuthn needs browser support (and a secure context).
      passkey: m.passkey && typeof window !== "undefined" && "PublicKeyCredential" in window,
    }))
    .catch(() => NO_METHODS);
  return methodsPromise;
}

/** Result of a sign-in action, phrased for players. `needsConfirm`: re-check first. */
export type AuthResult = { ok: true } | { ok: false; cancelled?: boolean; needsConfirm?: boolean; message: string };

const CANCEL_CODES = /CANCEL|ABORT|NOT_ALLOWED|PASSTHROUGH/i;

function fail(
  error: { code?: string; message?: string; status?: number } | null | undefined,
  fallback: string,
): AuthResult {
  if (error?.code && CANCEL_CODES.test(error.code)) {
    return { ok: false, cancelled: true, message: "No worries, nothing changed." };
  }
  if (error?.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return { ok: false, message: "This device already has a passkey for your player." };
  }
  if (error?.code === "DIFFERENT_PLAYER") {
    return { ok: false, message: "That belongs to a different player. Sign out of this device first to switch." };
  }
  if (error?.code === "LAST_WAY_IN") {
    return { ok: false, message: "That's your only way in. Add another one first." };
  }
  if (error?.code && /ALREADY_(EXISTS|IN_USE|LINKED)|EMAIL_EXISTS/.test(error.code)) {
    return { ok: false, message: "That belongs to a different player, so it can't be added here." };
  }
  if (error?.code === "SESSION_NOT_FRESH") {
    return { ok: false, needsConfirm: true, message: "For safety, confirm it's you first." };
  }
  if (error?.status === 429) {
    return { ok: false, message: "That's a lot of tries. Take a breath and try again in a minute." };
  }
  if (error?.code === "INVALID_OTP" || error?.code === "OTP_EXPIRED" || error?.code === "TOO_MANY_ATTEMPTS") {
    return {
      ok: false,
      message:
        error.code === "INVALID_OTP"
          ? "That code doesn't match. Check the latest email and try again."
          : "That code has expired. Send a new one and you're set.",
    };
  }
  if (error?.code === "INVALID_EMAIL_OR_PASSWORD") {
    return { ok: false, message: "That email and password don't match. Try again, or get a code instead." };
  }
  if (error?.code === "PASSWORD_TOO_SHORT") {
    return { ok: false, message: "Use at least 10 characters. A short phrase works great." };
  }
  return { ok: false, message: error?.message || fallback };
}

// ── This device's memory (so sign-in can lead for returning players) ──────────

export type WayIn = "passkey" | "google" | "email" | "password";
/** A saved player used this device before. Kept through sign-out on purpose. */
export interface Returning {
  email: string | null;
  lastMethod: WayIn | null;
  at: number;
}
const RETURNING_KEY = "aweborn-returning";

export function getReturning(): Returning | null {
  try {
    const v = JSON.parse(localStorage.getItem(RETURNING_KEY) ?? "null") as Returning | null;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}
export function rememberReturning(patch: Partial<Omit<Returning, "at">>): void {
  try {
    const prev = getReturning();
    const next: Returning = { email: null, lastMethod: null, ...prev, at: Date.now() };
    if (patch.email) next.email = patch.email;
    if (patch.lastMethod) next.lastMethod = patch.lastMethod;
    localStorage.setItem(RETURNING_KEY, JSON.stringify(next));
  } catch {
    /* private mode: no memory, no problem */
  }
}
/** "Not you?": forget who used this device. */
export function forgetReturning(): void {
  try {
    localStorage.removeItem(RETURNING_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Ask the password manager to drop a passkey the server doesn't know (a
 * removed passkey, or one from a deleted player). WebAuthn Signal API:
 * Chrome/Edge 132+, Safari 26+; a no-op elsewhere.
 */
function signalUnknownPasskey(credentialId: string | null | undefined): void {
  const PKC = (typeof window !== "undefined" ? window.PublicKeyCredential : undefined) as
    | (typeof PublicKeyCredential & {
        signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void>;
      })
    | undefined;
  if (!credentialId || !PKC?.signalUnknownCredential) return;
  const rpId = window.location.hostname.replace(/^www\./, "");
  void PKC.signalUnknownCredential({ rpId, credentialId }).catch(() => undefined);
}

/** Save this player with a passkey on this device (Face ID, fingerprint, screen lock, or a phone). */
export async function saveWithPasskey(): Promise<AuthResult> {
  const res = await authClient.passkey.addPasskey({});
  if (res.error) return fail(res.error, "Couldn't create a passkey. Please try again.");
  rememberReturning({ lastMethod: "passkey" });
  await refreshPlayer();
  return { ok: true };
}

/**
 * Sign in to a saved player (anonymous devices only). Reloads into that
 * player. `autoFill`: offer passkeys in the email field's autofill
 * (conditional mediation); resolves only if the player picks one.
 */
export async function signInWithPasskey(opts: { autoFill?: boolean } = {}): Promise<AuthResult> {
  if (opts.autoFill) {
    const PKC = window.PublicKeyCredential as typeof PublicKeyCredential | undefined;
    if (!PKC?.isConditionalMediationAvailable || !(await PKC.isConditionalMediationAvailable())) {
      return { ok: false, cancelled: true, message: "" };
    }
  }
  const res = await authClient.signIn.passkey({ autoFill: opts.autoFill, returnWebAuthnResponse: true });
  if (res.error) {
    if ("code" in res.error && res.error.code === "PASSKEY_NOT_FOUND") {
      signalUnknownPasskey((res as { webauthn?: { response?: { id?: string } } }).webauthn?.response?.id);
      return {
        ok: false,
        message: "That passkey belongs to a player that no longer exists. We've asked your device to forget it. Try another one.",
      };
    }
    return fail(res.error, "Couldn't sign in with a passkey. Please try again.");
  }
  rememberReturning({ lastMethod: "passkey" });
  window.location.reload();
  return { ok: true };
}

// ── Confirm it's you (saved players, before changing ways in) ───────────────
// Each one signs this device in again *to the same player*; the server
// refuses any other player. Good for 5 minutes.

export async function confirmWithPasskey(): Promise<AuthResult> {
  const res = await authClient.signIn.passkey({});
  if (res.error) return fail(res.error, "Couldn't confirm with a passkey. Please try again.");
  await refreshPlayer();
  return { ok: true };
}

const RECHECK_KEY = "aweborn-recheck";

/** Confirm with Google (redirects away and back; the panel reopens confirmed). */
export async function confirmWithGoogle(): Promise<AuthResult> {
  sessionStorage.setItem(RECHECK_KEY, "1");
  const res = await authClient.signIn.social({
    provider: "google",
    callbackURL: window.location.href,
    errorCallbackURL: `${window.location.origin}/?signin=failed`,
  });
  if (res.error) {
    sessionStorage.removeItem(RECHECK_KEY);
    return fail(res.error, "Couldn't reach Google. Please try again.");
  }
  return { ok: true };
}

/** True once, right after returning from a Google confirm. */
export function takeRecheckReturn(): boolean {
  const was = sessionStorage.getItem(RECHECK_KEY) === "1";
  sessionStorage.removeItem(RECHECK_KEY);
  return was;
}

/**
 * Google. Anonymous players *sign in* (a new Google account becomes this
 * player; an existing one switches to that player and this device's
 * character comes along). Saved players *link* Google to this player; a
 * Google account that belongs to another player is refused. Both redirect
 * away and back.
 */
export async function continueWithGoogle(): Promise<AuthResult> {
  const here = window.location.href;
  const failed = `${window.location.origin}/?signin=failed`;
  rememberReturning({ lastMethod: "google" }); // best guess; the page leaves for Google
  const res = currentPlayer && !currentPlayer.isAnonymous
    ? await authClient.linkSocial({ provider: "google", callbackURL: here, errorCallbackURL: failed })
    : await authClient.signIn.social({ provider: "google", callbackURL: here, errorCallbackURL: failed });
  if (res.error) return fail(res.error, "Couldn't reach Google. Please try again.");
  return { ok: true }; // the browser is navigating to Google
}

export interface SignInMethods {
  passkeys: { id: string; name: string | null; createdAt: string | number; credentialID?: string }[];
  google: boolean;
  email: string | null;
  password: boolean;
  accountIds: { google: string | null; password: string | null };
}

/** Every way into this player, for the account panel. */
export async function listSignInMethods(): Promise<SignInMethods> {
  const res = await fetch(`${AUTH_URL}/api/player/me`, { credentials: "include" });
  if (!res.ok) throw new Error(`player/me ${res.status}`);
  const me = (await res.json()) as { methods: SignInMethods };
  return me.methods;
}

/** Remove a way in (needs a fresh confirm; never the last one). */
export async function removePasskey(id: string, credentialID?: string): Promise<AuthResult> {
  const res = await authClient.passkey.deletePasskey({ id });
  if (res.error) return fail(res.error, "Couldn't remove that passkey. Please try again.");
  signalUnknownPasskey(credentialID); // so it stops showing up in the passkey picker
  return { ok: true };
}
async function unlink(which: "google" | "password", failMsg: string): Promise<AuthResult> {
  const accountId = (await listSignInMethods()).accountIds[which];
  if (!accountId) return { ok: true }; // already gone
  const res = await authClient.unlinkAccount({ accountId });
  return res.error ? fail(res.error, failMsg) : { ok: true };
}
export function removeGoogle(): Promise<AuthResult> {
  return unlink("google", "Couldn't remove Google. Please try again.");
}
export function removePassword(): Promise<AuthResult> {
  return unlink("password", "Couldn't remove the password. Please try again.");
}
/** Add a password to a saved player, or change it (needs a fresh confirm and a real email). */
export async function setPassword(password: string): Promise<AuthResult> {
  const res = await fetch(`${AUTH_URL}/api/player/password`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  }).catch(() => null);
  if (!res) return { ok: false, message: "Couldn't reach Aweborn. Check your connection and try again." };
  if (res.ok) return { ok: true };
  const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  return fail({ ...err, status: res.status }, "Couldn't save the password. Please try again.");
}

// ── Email (codes first, password as the quiet alternative) ──────────────────

/**
 * After a sign-in: same character → just refresh (the account may have grown).
 * Different character (this device signed in somewhere new) → reload so the
 * whole universe switches.
 */
async function settleSignIn(): Promise<AuthResult> {
  const before = currentPlayer?.playerId;
  const res = await authClient.getSession({ query: { disableCookieCache: true } });
  const after = toPlayer(res.data as SessionData);
  if (after && before && after.playerId !== before) {
    window.location.reload();
    return { ok: true };
  }
  if (after) setPlayer(after);
  return { ok: true };
}

const cleanEmail = (email: string) => email.trim().toLowerCase();

/** Step 1 of the email code: send a 6-digit code to this address. */
export async function sendEmailCode(email: string): Promise<AuthResult> {
  const res = await authClient.emailOtp.sendVerificationOtp({ email: cleanEmail(email), type: "sign-in" });
  if (res.error) return fail(res.error, "Couldn't send the code. Please check the address and try again.");
  return { ok: true };
}

/** Step 2: the code saves this player (new email) or signs in (known email). */
export async function verifyEmailCode(email: string, code: string): Promise<AuthResult> {
  const res = await authClient.signIn.emailOtp({ email: cleanEmail(email), otp: code.replace(/\D/g, "") });
  if (res.error) return fail(res.error, "Couldn't check that code. Please try again.");
  rememberReturning({ email: cleanEmail(email), lastMethod: "email" });
  return settleSignIn();
}

/** Password sign-up. The email is confirmed by code next (`confirmEmail`). */
export async function signUpWithPassword(email: string, password: string): Promise<AuthResult> {
  const res = await authClient.signUp.email({ email: cleanEmail(email), password, name: "" });
  if (res.error) return fail(res.error, "Couldn't create that. Please try again.");
  return { ok: true };
}

/** Confirm the email of a password sign-up. Signs in and saves this player. */
export async function confirmEmail(email: string, code: string): Promise<AuthResult> {
  const res = await authClient.emailOtp.verifyEmail({ email: cleanEmail(email), otp: code.replace(/\D/g, "") });
  if (res.error) return fail(res.error, "Couldn't check that code. Please try again.");
  rememberReturning({ email: cleanEmail(email), lastMethod: "password" });
  return settleSignIn();
}

/** Resend the confirmation code (never a sign-in code: that would drop the new password). */
export async function resendConfirmCode(email: string): Promise<AuthResult> {
  const res = await authClient.emailOtp.sendVerificationOtp({ email: cleanEmail(email), type: "email-verification" });
  if (res.error) return fail(res.error, "Couldn't send the code. Please try again.");
  return { ok: true };
}

/**
 * Password sign-in. `needsCode` means the email was never confirmed: the
 * server just sent a code, so the panel moves to `confirmEmail`.
 */
export async function signInWithPassword(email: string, password: string): Promise<AuthResult & { needsCode?: boolean }> {
  const res = await authClient.signIn.email({ email: cleanEmail(email), password });
  if (res.error) {
    if (res.error.status === 403) return { ok: false, needsCode: true, message: "Almost there! We sent a code to confirm your email." };
    return fail(res.error, "Couldn't sign in. Please try again.");
  }
  rememberReturning({ email: cleanEmail(email), lastMethod: "password" });
  return settleSignIn();
}

/** Forgot password, step 1: email a reset code. Same reply whether or not the email exists. */
export async function sendResetCode(email: string): Promise<AuthResult> {
  const res = await authClient.emailOtp.requestPasswordReset({ email: cleanEmail(email) });
  if (res.error) return fail(res.error, "Couldn't send the code. Please try again.");
  return { ok: true };
}

/** Forgot password, step 2: new password, then sign in with it. */
export async function resetPasswordWithCode(email: string, code: string, password: string): Promise<AuthResult> {
  const res = await authClient.emailOtp.resetPassword({ email: cleanEmail(email), otp: code.replace(/\D/g, ""), password });
  if (res.error) return fail(res.error, "Couldn't reset the password. Please try again.");
  return signInWithPassword(email, password);
}

/**
 * Saved players adding or replacing their email, confirmed by a code sent to
 * the new address. Needs a fresh confirm; an email that belongs to another
 * player is refused.
 */
export async function sendAddEmailCode(email: string): Promise<AuthResult> {
  const res = await authClient.emailOtp.requestEmailChange({ newEmail: cleanEmail(email) });
  if (res.error) return fail(res.error, "Couldn't send the code. Please try again.");
  return { ok: true };
}
export async function confirmAddEmail(email: string, code: string): Promise<AuthResult> {
  const res = await authClient.emailOtp.changeEmail({ newEmail: cleanEmail(email), otp: code.replace(/\D/g, "") });
  if (res.error) return fail(res.error, "Couldn't check that code. Please try again.");
  await refreshPlayer();
  return { ok: true };
}

/** Sign out of this device. The next visit starts a fresh anonymous player. */
export async function signOutOfDevice(): Promise<void> {
  await authClient.signOut();
  window.location.reload();
}
