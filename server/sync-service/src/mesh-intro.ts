/**
 * Auto-pairing for the offline mesh (Phase 06 → Network-less play A2).
 *
 * While online, the server introduces players who are in the same world AND
 * come from the same public IP (the same Wi-Fi or hotspot), so their phones
 * open a direct WebRTC link with no QR codes. Only host ICE candidates are used
 * (src/lib/mesh.ts), so a link only forms between phones on one local network,
 * and it keeps working when the internet drops (the metro / venue case).
 *
 * Shape: per (world, IP) group the earliest screen is the hub (the mesh is a
 * star: the hub relays world updates and presence between the others). A newcomer
 * is told to offer to the hub; when the hub leaves, everyone left is introduced
 * to the next one. The server then relays SDP between the two, and only between
 * screens of the same group, so it can't be used as a general signaling relay.
 *
 * Plain class keyed by any object (a WebSocket in rooms.ts) so it's testable.
 * `place` runs on every presence message (10 Hz per client): O(1) unless the
 * screen changed world/IP. Tokens are random per socket (no player ids).
 */
import { randomBytes } from "node:crypto";

/** Joiners per hub (src/lib/mesh.ts MAX_MESH_PEERS). */
export const MESH_GROUP_MAX = 7;
const SIGNALS_PER_WINDOW = 30;
const SIGNAL_WINDOW_MS = 10_000;
export const MESH_SIGNAL_MAX_BYTES = 8 * 1024;

export type Intro<K> = [to: K, peerToken: string];

export class MeshIntro<K extends object> {
  private tokens = new Map<K, string>();
  private byToken = new Map<string, K>();
  private keyOf = new Map<K, string>();
  private groups = new Map<string, Set<K>>();
  private budget = new Map<K, { n: number; since: number }>();
  private counters = { intros: 0, relayed: 0, refused: 0 };

  constructor(private now: () => number = Date.now) {}

  token(k: K): string {
    let t = this.tokens.get(k);
    if (!t) {
      t = randomBytes(8).toString("hex");
      this.tokens.set(k, t);
      this.byToken.set(t, k);
    }
    return t;
  }

  /** Where this screen is now (world id or null for space, public IP). Returns intros to send. */
  place(k: K, ip: string | null, worldId: string | null): Intro<K>[] {
    const key = ip && worldId ? `${worldId}|${ip}` : null;
    const old = this.keyOf.get(k) ?? null;
    if (old === key) return [];
    const out = old ? this.remove(k, old) : [];
    if (!key) return out;
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = new Set()));
    this.keyOf.set(k, key);
    const hub = g.values().next().value as K | undefined;
    g.add(k);
    if (hub !== undefined && g.size <= MESH_GROUP_MAX) {
      this.counters.intros++;
      out.push([k, this.token(hub)]);
    }
    return out;
  }

  /** A screen disconnected. Returns intros for the rest of its group if it was the hub. */
  leave(k: K): Intro<K>[] {
    const key = this.keyOf.get(k);
    const out = key ? this.remove(k, key) : [];
    const t = this.tokens.get(k);
    if (t) this.byToken.delete(t);
    this.tokens.delete(k);
    this.budget.delete(k);
    return out;
  }

  /** The screen `from` may send signaling to `toToken` only within its own group, within budget. */
  relayTarget(from: K, toToken: unknown): K | null {
    if (typeof toToken !== "string") return null;
    const to = this.byToken.get(toToken);
    const key = this.keyOf.get(from);
    if (!to || to === from || !key || this.keyOf.get(to) !== key || !this.spend(from)) {
      this.counters.refused++;
      return null;
    }
    this.counters.relayed++;
    return to;
  }

  stats(): { screens: number; groups: number; intros: number; relayed: number; refused: number } {
    let groups = 0;
    for (const g of this.groups.values()) if (g.size > 1) groups++;
    return { screens: this.keyOf.size, groups, ...this.counters };
  }

  private remove(k: K, key: string): Intro<K>[] {
    this.keyOf.delete(k);
    const g = this.groups.get(key);
    if (!g) return [];
    const wasHub = g.values().next().value === k;
    g.delete(k);
    if (g.size === 0) {
      this.groups.delete(key);
      return [];
    }
    if (!wasHub || g.size < 2) return [];
    const it = g.values();
    const hub = it.next().value as K;
    const out: Intro<K>[] = [];
    let n = 1;
    for (const m of it) {
      if (++n > MESH_GROUP_MAX) break;
      this.counters.intros++;
      out.push([m, this.token(hub)]);
    }
    return out;
  }

  private spend(k: K): boolean {
    const t = this.now();
    let b = this.budget.get(k);
    if (!b || t - b.since > SIGNAL_WINDOW_MS) this.budget.set(k, (b = { n: 0, since: t }));
    return ++b.n <= SIGNALS_PER_WINDOW;
  }
}

