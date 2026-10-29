/**
 * Online flight authority, client side (Phase 09, 9B + 9C rough draft).
 *
 * The client keeps predicting with the shared sim (`shared/sim/flight.ts`)
 * and never waits for the server. This module:
 *
 *  - numbers every fixed tick (`seq`) and keeps the last RING inputs,
 *  - online: sends them to the server in bundles of BUNDLE ticks (~20 Hz)
 *    together with where the client thinks it ended up (`sim-input`),
 *  - tells the server about out-of-sim moves (`sim-reset`: spawn, warp leap,
 *    teleport, leaving a world, brake, a new socket),
 *  - hands FlightController a server correction (`sim-correct`) to rewind to
 *    and replay the unacknowledged inputs on top of (rollback),
 *  - offline (9C): writes the same bundles (60 ticks each) plus resets to an
 *    offline flight log in IndexedDB (`offlineCache.ts`, survives reloads).
 *    Back online it sends `sim-resume` (start state + logged ticks) and the
 *    whole log, then clears it; the server replays it and corrects if it
 *    disagrees or the log holds more flight than the time away allowed.
 *
 * No React; useCRDT attaches the socket sender on open and detaches on close.
 * Normally the server agrees and sends nothing back, so online this costs one
 * small binary message per 3 ticks.
 *
 * Not yet (phases/09): corrections snap (no visual smoothing); ticks sent
 * into a socket that died without closing (until the heartbeat notices) are
 * lost rather than logged; at most 30 min of offline flight is kept.
 */
import type { FlightSimState, InputFrame } from '@aweborn/shared/sim/flight'
import {
  encodeInputBundle, encodeReset, encodeResume, decodeCorrection, decodeReset,
  MAX_FRAMES_PER_BUNDLE, type Correction,
} from '@aweborn/shared/sim/wire'
import { appendFlightLog, readFlightLog, clearFlightLog } from './offlineCache'

type Sender = (type: 'sim-input' | 'sim-reset' | 'sim-resume', data: Uint8Array) => void

const BUNDLE = 3
const RING = 256
/** Offline log cap: 30 min of ticks (the server never credits more per resume). */
const MAX_LOG_FRAMES = 30 * 60 * 60

/** Offline log entry kinds (first byte; the rest is the wire payload). */
const LOG_START = 1
const LOG_INPUT = 2
const LOG_RESET = 3

function entry(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + payload.length)
  out[0] = kind
  out.set(payload, 1)
  return out
}

class SimLink {
  private send: Sender | null = null
  /** Seq of the next tick to be recorded. */
  private seq = 0
  private epoch = 0
  /** First recorded seq not yet sent (or logged). */
  private unsentFrom = 0
  private needReset = true
  private frames: InputFrame[] = new Array(RING)
  private leash: (number | null)[] = new Array(RING)
  private pending: Correction | null = null
  private bundleLeash: number | null = null
  /** State after the last recorded tick (for a flush that excludes the current one). */
  private prev: FlightSimState | null = null
  /** This page is writing an offline log (it started with a LOG_START entry). */
  private logging = false
  private logFrames = 0
  private logFull = false
  readonly stats = { bundles: 0, resets: 0, corrections: 0, resumes: 0, logged: 0 }

  attach(send: Sender): void {
    // Offline ticks not yet in a 60-tick entry go into the log first
    if (this.logging && this.prev) this.flush(this.prev)
    this.send = send
    this.epoch = 0 // a new socket starts a new server-side session
    const continuous = this.logging // this page logged right up to now: no reset needed after the log
    this.uploadLog()
    this.logging = false
    this.logFrames = 0
    this.logFull = false
    this.unsentFrom = this.seq
    this.needReset = !continuous
  }

  detach(): void {
    if (!this.send) return // already offline (a recycle while reconnecting): keep logging
    this.send = null
    this.pending = null
    this.unsentFrom = this.seq // ticks sent into the dying socket are lost (the resume check allows for it)
  }

  /** A new socket (or nothing confirmed yet): the next step should open with a reset. */
  wantsReset(): boolean {
    return this.needReset && this.send !== null
  }

  /** The game moved the player outside the sim; `s` is the new state, before this tick's step. */
  reset(s: FlightSimState): void {
    this.needReset = false
    this.pending = null
    if (!this.send) {
      if (this.logging && this.prev) this.flush(this.prev)
      this.log(this.logging ? LOG_RESET : LOG_START, encodeReset({ nextSeq: this.seq, state: s }))
      this.logging = !this.logFull
      this.unsentFrom = this.seq
      return
    }
    this.unsentFrom = this.seq
    this.send('sim-reset', encodeReset({ nextSeq: this.seq, state: s }))
    this.stats.resets++
  }

  /** After each fixed step: record the input and send / log full bundles. */
  record(input: InputFrame, after: FlightSimState, leashRadius: number | null): void {
    if (!this.send && !this.logging && !this.logFull && this.prev) {
      // Going offline: the log opens with the state before this tick
      this.unsentFrom = this.seq
      this.log(LOG_START, encodeReset({ nextSeq: this.seq, state: this.prev }))
      this.logging = !this.logFull
    }
    const i = this.seq % RING
    // Leash radius is per bundle on the wire: flush before it changes mid-bundle
    if (this.seq > this.unsentFrom && leashRadius !== this.bundleLeash && this.prev) this.flush(this.prev)
    if (this.seq === this.unsentFrom) this.bundleLeash = leashRadius
    this.frames[i] = input
    this.leash[i] = leashRadius
    this.seq = (this.seq + 1) >>> 0
    this.prev = this.prev ? Object.assign(this.prev, after) : { ...after }
    if (!this.send && !this.logging) {
      this.unsentFrom = this.seq
      return
    }
    if (this.seq - this.unsentFrom >= (this.send ? BUNDLE : MAX_FRAMES_PER_BUNDLE)) this.flush(after)
  }

  /** From useCRDT on `sim-correct`. Applied at the start of the next fixed step. */
  onCorrection(data: Uint8Array): void {
    const c = decodeCorrection(data)
    if (!c) return
    this.epoch = c.epoch
    this.pending = c
    this.stats.corrections++
  }

  /** The correction to apply now, if any (FlightController). */
  takeCorrection(): Correction | null {
    const c = this.pending
    this.pending = null
    return c
  }

  /**
   * Inputs recorded after `ackSeq`, oldest first, for the replay; null if the
   * ring no longer has them all (then the caller just resets).
   */
  since(ackSeq: number): { frame: InputFrame; leash: number | null }[] | null {
    const from = (ackSeq + 1) >>> 0
    const n = (this.seq - from) >>> 0
    if (n > RING - 1) return null
    const out: { frame: InputFrame; leash: number | null }[] = []
    for (let k = 0; k < n; k++) {
      const i = (from + k) % RING
      out.push({ frame: this.frames[i], leash: this.leash[i] })
    }
    return out
  }

  /** Bundle the recorded-but-unsent ticks: to the socket online, to the offline log otherwise. */
  private flush(after: FlightSimState): void {
    const n = Math.min((this.seq - this.unsentFrom) >>> 0, MAX_FRAMES_PER_BUNDLE)
    if (n === 0) return
    if (!this.send && !this.logging) return
    const frames: InputFrame[] = []
    for (let k = 0; k < n; k++) frames.push(this.frames[(this.unsentFrom + k) % RING])
    const bytes = encodeInputBundle({
      firstSeq: this.unsentFrom, epoch: this.epoch, leashRadius: this.bundleLeash, state: after, frames,
    })
    this.unsentFrom = (this.unsentFrom + n) >>> 0
    if (this.send) {
      this.send('sim-input', bytes)
      this.stats.bundles++
    } else {
      this.logFrames += n
      this.log(LOG_INPUT, bytes)
    }
  }

  private log(kind: number, payload: Uint8Array): void {
    if (this.logFull) return
    if (this.logFrames > MAX_LOG_FRAMES) {
      // Too long offline to replay: drop the log; back online it's a plain (distance-checked) reset
      clearFlightLog()
      this.logFull = true
      this.logging = false
      return
    }
    appendFlightLog(entry(kind, payload))
    this.stats.logged++
  }

  /** Send the offline log (possibly from an earlier page load): resume, then every entry in order. */
  private uploadLog(): void {
    const log = readFlightLog()
    if (log.length === 0 || !this.send) return
    clearFlightLog()
    const start = log[0][0] === LOG_START ? decodeReset(log[0].subarray(1)) : null
    if (!start) return // not a log we understand: drop it
    let frames = 0
    for (const e of log) if (e[0] === LOG_INPUT && e.length > 7) frames += e[7] // count byte (offset 6 in the bundle)
    this.send('sim-resume', encodeResume({ nextSeq: start.nextSeq, frames, state: start.state }))
    this.stats.resumes++
    for (let k = 1; k < log.length; k++) {
      const e = log[k]
      const payload = e.slice(1)
      if (e[0] === LOG_INPUT) {
        payload[4] = 0 // epoch 0: what the new server session expects
        payload[5] = 0
        this.send('sim-input', payload)
      } else if (e[0] === LOG_RESET) {
        this.send('sim-reset', payload)
      }
    }
  }
}

/** Singleton link between the flight controller and the universe socket. */
export const simLink = new SimLink()
