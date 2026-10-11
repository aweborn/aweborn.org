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

const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:1234";
/** Auth lives on the sync-service origin (same site as aweborn.org). */
const AUTH_URL: string = import.meta.env.VITE_AUTH_URL ?? SYNC_URL.replace(/^ws/, "http");

/** Give up on auth after this long and play as a guest (never block play). */
const AUTH_TIMEOUT_MS = 5_000;

export const authClient = createAuthClient({
  baseURL: AUTH_URL,
  fetchOptions: { credentials: "include" },
  plugins: [anonymousClient()],
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
