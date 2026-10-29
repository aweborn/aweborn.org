/**
 * One screen steers (Phase 08 I1b, Rough Draft M9).
 *
 * A player can be open on several screens at once (phone + laptop, two
 * tabs). Only one of them flies the ship the others see: the *driver*. The
 * newest screen to connect takes over (you just opened it, so you mean to
 * play there), and any screen that is actually flown (non-idle input) takes
 * it back. The others are *followers*: their presence isn't relayed, and
 * the client shows "Playing on another screen".
 *
 * Plain class keyed by any object (a WebSocket in rooms.ts) so the rules
 * are testable. Every call returns the `[socket, isDriver]` notices to send.
 * All operations are O(1) per call except a driver leaving, which picks the
 * newest remaining screen of that one player.
 */
export type SteerNotice<K> = [K, boolean];

export class Steering<K extends object> {
  private driver = new Map<string, K>();
  private screens = new Map<string, Set<K>>();
  private counters = { takeovers: 0 };

  /** A screen for `playerId` connected: it becomes the driver. */
  join(k: K, playerId: string): SteerNotice<K>[] {
    let set = this.screens.get(playerId);
    if (!set) this.screens.set(playerId, (set = new Set()));
    set.add(k);
    return this.makeDriver(k, playerId);
  }

  /** The screen sent real (non-idle) flight input: it steers from now on. */
  active(k: K, playerId: string): SteerNotice<K>[] {
    if (this.driver.get(playerId) === k || !this.screens.get(playerId)?.has(k)) return [];
    this.counters.takeovers++;
    return this.makeDriver(k, playerId);
  }

  /** Another screen of the same player is steering: don't relay this one. */
  isFollower(k: K, playerId: string | null | undefined): boolean {
    if (!playerId) return false;
    const d = this.driver.get(playerId);
    return d !== undefined && d !== k;
  }

  leave(k: K, playerId: string): SteerNotice<K>[] {
    const set = this.screens.get(playerId);
    if (!set?.delete(k)) return [];
    if (set.size === 0) {
      this.screens.delete(playerId);
      this.driver.delete(playerId);
      return [];
    }
    if (this.driver.get(playerId) !== k) return [];
    let newest: K | undefined;
    for (const s of set) newest = s; // Sets keep insertion order: last = newest
    this.driver.set(playerId, newest!);
    return [[newest!, true]];
  }

  stats(): { players: number; multiScreen: number; takeovers: number } {
    let multi = 0;
    for (const s of this.screens.values()) if (s.size > 1) multi++;
    return { players: this.screens.size, multiScreen: multi, ...this.counters };
  }

  private makeDriver(k: K, playerId: string): SteerNotice<K>[] {
    const old = this.driver.get(playerId);
    this.driver.set(playerId, k);
    const set = this.screens.get(playerId)!;
    if (set.size === 1) return []; // alone: nothing to tell anyone
    const out: SteerNotice<K>[] = [[k, true]];
    if (old && old !== k && set.has(old)) out.push([old, false]);
    return out;
  }
}
