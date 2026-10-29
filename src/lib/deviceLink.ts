/**
 * QR device linking, client side (Phase 08 I2, Rough Draft M9).
 *
 * The device that plays a player asks the server for a link code and shows
 * it as a QR of `aweborn.org/link#<code>` plus the typeable code. The new
 * device scans it (or types it) and redeems it: the server gives that device
 * its *own* session for the same account and character. Codes are single
 * use and die after 5 minutes (server/sync-service/src/device-link.ts).
 */
import { AUTH_URL } from "./player";

export interface LinkCode {
  code: string;
  expiresAt: number;
}

export type LinkResult = { ok: true } | { ok: false; message: string };

/** The code a phone camera opened `/link#<code>` with, until PlayerAccount takes it. */
let pendingCode: string | null = null;

/** main.tsx, before the first render: a camera opened `/link#<code>`. */
export function takeDeviceLinkUrl(): void {
  if (window.location.pathname !== "/link") return;
  const code = decodeURIComponent(window.location.hash.slice(1)).trim();
  window.history.replaceState(null, "", "/");
  if (code) pendingCode = code;
}

/** Read once: the account panel opens on the redeem step with this code filled in. */
export function takePendingLinkCode(): string | null {
  const c = pendingCode;
  pendingCode = null;
  return c;
}

export function linkUrl(code: string): string {
  return `${window.location.origin}/link#${code}`;
}

/** "ABCD2345" → "ABCD-2345", easier to read aloud and type. */
export function prettyCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

async function message(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
}

export async function createLinkCode(): Promise<LinkCode | { error: string }> {
  try {
    const res = await fetch(`${AUTH_URL}/api/auth/device-link/create`, { method: "POST", credentials: "include" });
    if (!res.ok) return { error: await message(res, "Couldn't make a code. Try again in a minute.") };
    return (await res.json()) as LinkCode;
  } catch {
    return { error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export async function redeemLinkCode(code: string): Promise<LinkResult> {
  try {
    const res = await fetch(`${AUTH_URL}/api/auth/device-link/redeem`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return { ok: false, message: await message(res, "That code didn't work. Make a new one on your other device.") };
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  }
}
