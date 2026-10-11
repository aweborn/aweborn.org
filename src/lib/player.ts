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
import { anonymousClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:1234";
/** Auth lives on the sync-service origin (same site as aweborn.org). */
const AUTH_URL: string = import.meta.env.VITE_AUTH_URL ?? SYNC_URL.replace(/^ws/, "http");

/** Give up on auth after this long and play as a guest (never block play). */
const AUTH_TIMEOUT_MS = 5_000;

export const authClient = createAuthClient({
  baseURL: AUTH_URL,
  fetchOptions: { credentials: "include" },
  plugins: [anonymousClient(), passkeyClient()],
});

export interface Player {
  /** Stable public player ID (UUID), or a per-tab `guest-…` ID. */
  playerId: string;
  /** Derived from `playerId`, so it's the same on every device. */
  color: string;
  /** Has a session but no real sign-in method linked yet. */
  isAnonymous: boolean;
  /** No session at all: nothing persists. */
  isGuest: boolean;
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
  return { playerId: id, color: colorForPlayer(id), isAnonymous: false, isGuest: true };
}

type SessionUser = { playerId?: string | null; isAnonymous?: boolean | null };

function toPlayer(user: SessionUser | undefined | null): Player | null {
  if (!user?.playerId) return null;
  return {
    playerId: user.playerId,
    color: colorForPlayer(user.playerId),
    isAnonymous: Boolean(user.isAnonymous),
    isGuest: false,
  };
}

async function resolvePlayer(): Promise<Player> {
  const existing = await authClient.getSession();
  const fromSession = toPlayer(existing.data?.user as SessionUser | undefined);
  if (fromSession) return fromSession;

  const created = await authClient.signIn.anonymous();
  const fromSignIn = toPlayer(created.data?.user as SessionUser | undefined);
  if (fromSignIn) return fromSignIn;

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

/** Re-read the session (e.g. after saving with a passkey). Same playerId. */
export async function refreshPlayer(): Promise<void> {
  const res = await authClient.getSession({ query: { disableCookieCache: true } });
  const player = toPlayer(res.data?.user as SessionUser | undefined);
  if (player) setPlayer(player);
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

/** Result of a sign-in action, phrased for players. */
export type AuthResult = { ok: true } | { ok: false; cancelled?: boolean; message: string };

const CANCEL_CODES = /CANCEL|ABORT|NOT_ALLOWED|PASSTHROUGH/i;

function fail(error: { code?: string; message?: string } | null | undefined, fallback: string): AuthResult {
  if (error?.code && CANCEL_CODES.test(error.code)) {
    return { ok: false, cancelled: true, message: "No worries, nothing changed." };
  }
  if (error?.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return { ok: false, message: "This device already has a passkey for your player." };
  }
  if (error?.code === "SESSION_NOT_FRESH") {
    return { ok: false, message: "For safety, sign in again first, then add this." };
  }
  return { ok: false, message: error?.message || fallback };
}

/** Save this player with a passkey on this device (Face ID, fingerprint, screen lock, or a phone). */
export async function saveWithPasskey(): Promise<AuthResult> {
  const res = await authClient.passkey.addPasskey({});
  if (res.error) return fail(res.error, "Couldn't create a passkey. Please try again.");
  await refreshPlayer();
  return { ok: true };
}

/** Sign in to a player saved on another device. Reloads into that player. */
export async function signInWithPasskey(): Promise<AuthResult> {
  const res = await authClient.signIn.passkey({});
  if (res.error) return fail(res.error, "Couldn't sign in with a passkey. Please try again.");
  window.location.reload();
  return { ok: true };
}

/**
 * Google. Anonymous players *sign in* (a new Google account becomes this
 * player; an existing one switches to that player). Saved players *link*
 * Google as another way in. Both redirect away and back.
 */
export async function continueWithGoogle(): Promise<AuthResult> {
  const here = window.location.href;
  const failed = `${window.location.origin}/?signin=failed`;
  const res = currentPlayer && !currentPlayer.isAnonymous
    ? await authClient.linkSocial({ provider: "google", callbackURL: here, errorCallbackURL: failed })
    : await authClient.signIn.social({ provider: "google", callbackURL: here, errorCallbackURL: failed });
  if (res.error) return fail(res.error, "Couldn't reach Google. Please try again.");
  return { ok: true }; // the browser is navigating to Google
}

/** Linked ways in, for the account panel. */
export async function listSignInMethods(): Promise<{ passkeys: number; google: boolean }> {
  const [passkeys, accounts] = await Promise.all([
    authClient.passkey.listUserPasskeys(),
    authClient.listAccounts(),
  ]);
  return {
    passkeys: passkeys.data?.length ?? 0,
    google: Boolean(accounts.data?.some((a) => a.providerId === "google")),
  };
}

/** Sign out of this device. The next visit starts a fresh anonymous player. */
export async function signOutOfDevice(): Promise<void> {
  await authClient.signOut();
  window.location.reload();
}
