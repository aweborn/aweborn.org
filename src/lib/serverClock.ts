import { addSample, bestOffset, clockSample, type ClockSample } from '@aweborn/shared/clock'

/**
 * The server's clock, estimated from heartbeat pings (shared/clock.ts). Use
 * `serverNow()` for anything every client must compute the same way from time:
 * roaming creatures, kicks, nudges, "is this chat line fresh?". Offline it keeps
 * the last offset measured (remembered across reloads), which drifts by at most
 * a few ms a minute on a normal device.
 */

const KEY = 'aweborn.clockOffset'
let samples: ClockSample[] = []
let offset = (() => {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && Math.abs(v) < 86_400_000 ? v : 0
  } catch {
    return 0
  }
})()
let lastPingAt = 0

/** Call when a ping goes out. */
export function notePingSent(at = Date.now()): void {
  lastPingAt = at
}

/** Call with a pong's payload (8 bytes: server time, float64 little-endian). Old servers send none. */
export function notePong(data: Uint8Array, at = Date.now()): void {
  if (data.byteLength < 8 || !lastPingAt) return
  const serverTime = new DataView(data.buffer, data.byteOffset, 8).getFloat64(0, true)
  const s = clockSample(lastPingAt, serverTime, at)
  lastPingAt = 0
  if (!s) return
  samples = addSample(samples, s)
  offset = bestOffset(samples)
  try {
    localStorage.setItem(KEY, String(Math.round(offset)))
  } catch {
    /* private mode */
  }
}

/** Server time now (ms since epoch), as best we know it. */
export const serverNow = (): number => Date.now() + offset

/** For the dev console / tests: how far this device's clock is from the server's, and how sure. */
export const clockStatus = () => ({ offsetMs: Math.round(offset), samples: samples.length, bestRttMs: samples.reduce((m, s) => Math.min(m, s.rtt), Infinity) })

