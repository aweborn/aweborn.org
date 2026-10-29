/**
 * Wire format for online flight authority (Phase 09, 9B).
 *
 * Message ids (rooms.ts / useCRDT.ts): 0x0d sim-input, 0x0e sim-correct,
 * 0x0f sim-reset (0x0a–0x0c were taken by chat, presence-batch and ping).
 * Payloads are little-endian binary after the usual [type][worldIdLen][worldId]
 * header (worldId empty).
 *
 *  sim-input   (client → server, ~20 Hz)
 *    u32 firstSeq · u16 epoch · u8 count · f64 leashRadius (NaN = none)
 *    · 11 × f64 client state after the last frame · count × (u16 bits, i8 yaw, i8 pitch)
 *  sim-correct (server → client)
 *    u32 ackSeq · u16 epoch · 11 × f64 server state after ackSeq
 *  sim-reset   (client → server: the game moved the player outside the sim:
 *               warp leap, card/link teleport, leaving a world, spawn, resume)
 *    u32 nextSeq · 11 × f64 new state
 *  sim-resume  (client → server, 0x10, 9C: back online with an offline flight log;
 *               the log's sim-input / sim-reset messages follow straight after)
 *    u32 nextSeq · u32 logged frames · 11 × f64 state when the log began
 */
import type { FlightSimState, InputFrame } from "./flight.js";

export const SIM_STATE_DOUBLES = 11;
export const MAX_FRAMES_PER_BUNDLE = 60;
const FRAME_BYTES = 4;
const INPUT_HEADER = 4 + 2 + 1 + 8 + SIM_STATE_DOUBLES * 8;
const CORRECT_BYTES = 4 + 2 + SIM_STATE_DOUBLES * 8;
const RESET_BYTES = 4 + SIM_STATE_DOUBLES * 8;
const RESUME_BYTES = 4 + 4 + SIM_STATE_DOUBLES * 8;

export interface InputBundle {
  firstSeq: number;
  epoch: number;
  leashRadius: number | null;
  /** Client's predicted state after the last frame (dampen included; slingId is not sent). */
  state: FlightSimState;
  frames: InputFrame[];
}

export interface Correction {
  ackSeq: number;
  epoch: number;
  state: FlightSimState;
}

export interface SimReset {
  nextSeq: number;
  state: FlightSimState;
}

function writeState(v: DataView, o: number, s: FlightSimState): void {
  const a = [s.px, s.py, s.pz, s.vx, s.vy, s.vz, s.qx, s.qy, s.qz, s.qw, s.dampen];
  for (let i = 0; i < SIM_STATE_DOUBLES; i++) v.setFloat64(o + i * 8, a[i], true);
}

function readState(v: DataView, o: number): FlightSimState | null {
  const a: number[] = [];
  for (let i = 0; i < SIM_STATE_DOUBLES; i++) {
    const x = v.getFloat64(o + i * 8, true);
    if (!Number.isFinite(x)) return null;
    a.push(x);
  }
  return { px: a[0], py: a[1], pz: a[2], vx: a[3], vy: a[4], vz: a[5], qx: a[6], qy: a[7], qz: a[8], qw: a[9], dampen: a[10], slingId: null };
}

export function encodeInputBundle(b: InputBundle): Uint8Array {
  const n = Math.min(b.frames.length, MAX_FRAMES_PER_BUNDLE);
  const buf = new Uint8Array(INPUT_HEADER + n * FRAME_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint32(0, b.firstSeq >>> 0, true);
  v.setUint16(4, b.epoch & 0xffff, true);
  v.setUint8(6, n);
  v.setFloat64(7, b.leashRadius ?? NaN, true);
  writeState(v, 15, b.state);
  let o = INPUT_HEADER;
  for (let i = 0; i < n; i++) {
    const f = b.frames[i];
    v.setUint16(o, f.bits & 0xffff, true);
    v.setInt8(o + 2, f.yaw);
    v.setInt8(o + 3, f.pitch);
    o += FRAME_BYTES;
  }
  return buf;
}

/** Null on anything malformed (wrong length, non-finite state, >60 frames). */
export function decodeInputBundle(data: Uint8Array): InputBundle | null {
  if (data.length < INPUT_HEADER) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = v.getUint8(6);
  if (n === 0 || n > MAX_FRAMES_PER_BUNDLE || data.length !== INPUT_HEADER + n * FRAME_BYTES) return null;
  const leash = v.getFloat64(7, true);
  const state = readState(v, 15);
  if (!state) return null;
  const frames: InputFrame[] = [];
  let o = INPUT_HEADER;
  for (let i = 0; i < n; i++) {
    const yaw = v.getInt8(o + 2), pitch = v.getInt8(o + 3);
    frames.push({ bits: v.getUint16(o, true), yaw: Math.max(-127, yaw), pitch: Math.max(-127, pitch) });
    o += FRAME_BYTES;
  }
  return {
    firstSeq: v.getUint32(0, true),
    epoch: v.getUint16(4, true),
    leashRadius: Number.isFinite(leash) && leash > 0 ? leash : null,
    state,
    frames,
  };
}

export function encodeCorrection(c: Correction): Uint8Array {
  const buf = new Uint8Array(CORRECT_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint32(0, c.ackSeq >>> 0, true);
  v.setUint16(4, c.epoch & 0xffff, true);
  writeState(v, 6, c.state);
  return buf;
}

export function decodeCorrection(data: Uint8Array): Correction | null {
  if (data.length !== CORRECT_BYTES) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const state = readState(v, 6);
  return state ? { ackSeq: v.getUint32(0, true), epoch: v.getUint16(4, true), state } : null;
}

export function encodeReset(r: SimReset): Uint8Array {
  const buf = new Uint8Array(RESET_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint32(0, r.nextSeq >>> 0, true);
  writeState(v, 4, r.state);
  return buf;
}

export function decodeReset(data: Uint8Array): SimReset | null {
  if (data.length !== RESET_BYTES) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const state = readState(v, 4);
  return state ? { nextSeq: v.getUint32(0, true), state } : null;
}

export interface SimResume {
  nextSeq: number;
  /** Ticks in the offline log that follows (the server grants that much extra time, up to the time it was away). */
  frames: number;
  state: FlightSimState;
}

export function encodeResume(r: SimResume): Uint8Array {
  const buf = new Uint8Array(RESUME_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint32(0, r.nextSeq >>> 0, true);
  v.setUint32(4, r.frames >>> 0, true);
  writeState(v, 8, r.state);
  return buf;
}

export function decodeResume(data: Uint8Array): SimResume | null {
  if (data.length !== RESUME_BYTES) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const state = readState(v, 8);
  return state ? { nextSeq: v.getUint32(0, true), frames: v.getUint32(4, true), state } : null;
}
