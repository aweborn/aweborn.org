/**
 * Online flight authority, client side (Phase 09, 9B rough draft).
 *
 * The client keeps predicting with the shared sim (`shared/sim/flight.ts`)
 * and never waits for the server. This module:
 *
 *  - numbers every fixed tick (`seq`) and keeps the last RING inputs,
 *  - sends them to the server in bundles of BUNDLE ticks (~20 Hz) together
 *    with where the client thinks it ended up (`sim-input`),
 *  - tells the server about out-of-sim moves (`sim-reset`: spawn, warp leap,
 *    teleport, leaving a world, brake, a new socket),
 *  - hands FlightController a server correction (`sim-correct`) to rewind to
 *    and replay the unacknowledged inputs on top of (rollback).
 *
 * No React; useCRDT attaches the socket sender on open and detaches on close.
 * Normally the server agrees and sends nothing back, so this costs one small
 * binary message per 3 ticks.
 *
 * Not yet (phases/09): corrections snap (no visual smoothing); offline inputs
 * are not kept for replay after a reconnect (9C).
 */
import type { FlightSimState, InputFrame } from '@aweborn/shared/sim/flight'
import {
  encodeInputBundle, encodeReset, decodeCorrection, MAX_FRAMES_PER_BUNDLE, type Correction,
} from '@aweborn/shared/sim/wire'

type Sender = (type: 'sim-input' | 'sim-reset', data: Uint8Array) => void

const BUNDLE = 3
const RING = 256

class SimLink {
  private send: Sender | null = null
  /** Seq of the next tick to be recorded. */
  private seq = 0
  private epoch = 0
  /** First recorded seq not yet sent. */
  private unsentFrom = 0
  private needReset = true
  private frames: InputFrame[] = new Array(RING)
  private leash: (number | null)[] = new Array(RING)
  private pending: Correction | null = null
  private bundleLeash: number | null = null
  /** State after the last recorded tick (for a flush that excludes the current one). */
  private prev: FlightSimState | null = null
  readonly stats = { bundles: 0, resets: 0, corrections: 0 }

  attach(send: Sender): void {
    this.send = send
    this.needReset = true
  }

  detach(): void {
    this.send = null
    this.pending = null
  }

  /** A new socket (or nothing confirmed yet): the next step should open with a reset. */
  wantsReset(): boolean {
    return this.needReset && this.send !== null
  }

  /** The game moved the player outside the sim; `s` is the new state, before this tick's step. */
  reset(s: FlightSimState): void {
    this.needReset = false
    this.pending = null
    this.unsentFrom = this.seq
    if (!this.send) return
    this.send('sim-reset', encodeReset({ nextSeq: this.seq, state: s }))
    this.stats.resets++
  }

  /** After each fixed step: record the input and, every BUNDLE ticks, send. */
  record(input: InputFrame, after: FlightSimState, leashRadius: number | null): void {
    const i = this.seq % RING
    // Leash radius is per bundle on the wire: flush before it changes mid-bundle
    if (this.seq > this.unsentFrom && leashRadius !== this.bundleLeash && this.prev) this.flush(this.prev)
    if (this.seq === this.unsentFrom) this.bundleLeash = leashRadius
    this.frames[i] = input
    this.leash[i] = leashRadius
    this.seq = (this.seq + 1) >>> 0
    this.prev = this.prev ? Object.assign(this.prev, after) : { ...after }
    if (!this.send) {
      this.unsentFrom = this.seq
      return
    }
    if (this.seq - this.unsentFrom >= BUNDLE) this.flush(after)
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

  private flush(after: FlightSimState): void {
    const n = Math.min((this.seq - this.unsentFrom) >>> 0, MAX_FRAMES_PER_BUNDLE)
    if (n === 0 || !this.send) return
    const frames: InputFrame[] = []
    for (let k = 0; k < n; k++) frames.push(this.frames[(this.unsentFrom + k) % RING])
    this.send('sim-input', encodeInputBundle({
      firstSeq: this.unsentFrom, epoch: this.epoch, leashRadius: this.bundleLeash, state: after, frames,
    }))
    this.unsentFrom = (this.unsentFrom + n) >>> 0
    this.stats.bundles++
  }
}

/** Singleton link between the flight controller and the universe socket. */
export const simLink = new SimLink()
