/**
 * Offline mesh (Phase 06, Rough Draft M7b): phones next to each other play the
 * same world over a WebRTC DataChannel, no internet needed.
 *
 * Signaling is two QR codes (shared/mesh-signal.ts): the host shows an offer,
 * the joiner scans it and shows an answer, the host scans that. Only host ICE
 * candidates are used (no STUN/TURN), so both phones must be on the same Wi-Fi
 * or hotspot, which is the point: people in one room.
 *
 * Over each link:
 *   - the active world's Y.Doc: state vectors on open / world change, then every
 *     update (local, server or from another link) except the ones that came in
 *     on that same link, so a host relays between joiners (star)
 *   - presence (the same JSON as the room socket) so peers see each other
 *
 * Updates from a peer carry the link as their Y origin (`{ mesh: true }`).
 * universeStore never sends those to the server: each phone uploads only its own
 * edits (its offline queue) when it reconnects, so the server checks every edit
 * against the player who made it.
 */
import * as Y from "yjs";
import { create } from "zustand";
import { parseSdp, buildSdp, signalToText, textToSignal } from "@aweborn/shared/mesh-signal";
import { useUniverseStore } from "../stores/universeStore";
import { handleWebSocketPresence, setMeshPresenceSender } from "../hooks/usePresence";
import { teleportSystem } from "../systems/TeleportSystem";

const T_SV = 1;
const T_UPDATE = 2;
const T_PRESENCE = 3;
const T_CHUNK = 0xff;
/** Safe message size on every browser's SCTP stack; bigger frames are split. */
const CHUNK_BYTES = 16 * 1024;
/** A reassembled message may be at most 8 MB (a large world's full state). */
const MAX_PARTS = 512;
const GATHER_MS = 2500;
const CONNECT_MS = 30_000;
/** The joiner shows its code until the host has scanned it. */
const ANSWER_WAIT_MS = 180_000;
export const MAX_MESH_PEERS = 6;

export type MeshPhase = "idle" | "preparing" | "showing-offer" | "showing-answer" | "connecting" | "connected" | "failed";

interface MeshState {
  phase: MeshPhase;
  /** Text for the QR on screen (offer URL or answer). */
  code: string | null;
  error: string | null;
  /** Open links. */
  peers: number;
  panelOpen: boolean;
  /** A `/j#…` link this page was opened with, waiting for the panel. */
  joinText: string | null;
}

export const useMeshStore = create<MeshState>(() => ({
  phase: "idle",
  code: null,
  error: null,
  peers: 0,
  panelOpen: false,
  joinText: null,
}));

export function openMeshPanel(): void {
  useMeshStore.setState({ panelOpen: true });
}

export function closeMeshPanel(): void {
  // A half-made link is dropped; open links keep playing
  if (pending && !pending.open) {
    pending.close();
    pending = null;
  }
  const s = useMeshStore.getState();
  useMeshStore.setState({
    panelOpen: false,
    joinText: null,
    code: null,
    error: null,
    phase: s.peers > 0 ? "connected" : "idle",
  });
}

/** main.tsx, before the first render: a phone camera opened `/j#<offer>`. */
export function takeJoinLink(): void {
  if (window.location.pathname !== "/j") return;
  const text = window.location.href;
  window.history.replaceState(null, "", "/");
  useMeshStore.setState({ panelOpen: true, joinText: text });
}

class MeshLink {
  /** The Y origin marker universeStore checks (never forwarded to the server). */
  readonly mesh = true;
  readonly pc = new RTCPeerConnection({ iceServers: [] });
  readonly dc: RTCDataChannel;
  open = false;
  /** The world our state vector was last sent for (a received one is answered with ours once). */
  svSentFor: string | null = null;
  timer: ReturnType<typeof setTimeout> | null = null;
  private parts = new Map<number, { count: number; got: number; data: Uint8Array[] }>();
  private nextMsg = 1;

  constructor() {
    this.dc = this.pc.createDataChannel("aweborn", { negotiated: true, id: 0 });
    this.dc.binaryType = "arraybuffer";
    this.dc.onopen = () => onLinkOpen(this);
    this.dc.onclose = () => onLinkClosed(this);
    this.dc.onmessage = (e: MessageEvent) => {
      if (e.data instanceof ArrayBuffer) this.receive(new Uint8Array(e.data));
    };
    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState;
      if (st === "failed" || st === "closed") onLinkClosed(this);
    };
  }

  send(type: number, worldId: string | null, payload: Uint8Array): void {
    if (this.dc.readyState !== "open") return;
    const w = new TextEncoder().encode(worldId ?? "");
    const frame = new Uint8Array(2 + w.length + payload.length);
    frame[0] = type;
    frame[1] = w.length;
    frame.set(w, 2);
    frame.set(payload, 2 + w.length);
    try {
      if (frame.length <= CHUNK_BYTES) return this.dc.send(frame);
      const count = Math.ceil(frame.length / CHUNK_BYTES);
      if (count > MAX_PARTS) return; // too big to carry; the server syncs it later
      const id = this.nextMsg++ >>> 0;
      for (let i = 0; i < count; i++) {
        const data = frame.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
        const part = new Uint8Array(9 + data.length);
        const v = new DataView(part.buffer);
        part[0] = T_CHUNK;
        v.setUint32(1, id);
        v.setUint16(5, i);
        v.setUint16(7, count);
        part.set(data, 9);
        this.dc.send(part);
      }
    } catch {
      /* channel closing */
    }
  }

  private receive(bytes: Uint8Array): void {
    try {
      if (bytes[0] === T_CHUNK) {
        if (bytes.length < 9) return;
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const id = v.getUint32(1);
        const idx = v.getUint16(5);
        const count = v.getUint16(7);
        if (count === 0 || count > MAX_PARTS || idx >= count) return;
        let msg = this.parts.get(id);
        if (!msg) {
          if (this.parts.size >= 4) this.parts.clear(); // a peer that never finishes can't pile up memory
          msg = { count, got: 0, data: [] };
          this.parts.set(id, msg);
        }
        if (msg.count !== count || msg.data[idx]) return;
        msg.data[idx] = bytes.slice(9);
        if (++msg.got < count) return;
        this.parts.delete(id);
        const total = msg.data.reduce((n, d) => n + d.length, 0);
        const whole = new Uint8Array(total);
        let off = 0;
        for (const d of msg.data) {
          whole.set(d, off);
          off += d.length;
        }
        return this.receive(whole);
      }
      if (bytes.length < 2) return;
      const wl = bytes[1]!;
      if (bytes.length < 2 + wl) return;
      const worldId = wl ? new TextDecoder().decode(bytes.subarray(2, 2 + wl)) : null;
      handleFrame(this, bytes[0]!, worldId, bytes.subarray(2 + wl));
    } catch {
      /* a malformed frame from a peer is dropped */
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      this.dc.close();
      this.pc.close();
    } catch {
      /* already closed */
    }
  }
}

const links = new Set<MeshLink>();
let pending: MeshLink | null = null;

function handleFrame(link: MeshLink, type: number, worldId: string | null, payload: Uint8Array): void {
  if (type === T_PRESENCE) {
    handleWebSocketPresence(payload);
    return;
  }
  const { activeWorldId, activeWorldDoc } = useUniverseStore.getState();
  if (!worldId || worldId !== activeWorldId || !activeWorldDoc) return; // only the world we're both in
  if (type === T_SV) {
    link.send(T_UPDATE, worldId, Y.encodeStateAsUpdate(activeWorldDoc, payload));
    if (link.svSentFor !== worldId) sendStateVector(link); // they may have entered after our first one
  } else if (type === T_UPDATE) Y.applyUpdate(activeWorldDoc, payload, link);
}

// ── the active world doc ↔ every open link ──

let watchedDoc: Y.Doc | null = null;
let watchedWorld: string | null = null;
let unsubUniverse: (() => void) | null = null;

function onDocUpdate(update: Uint8Array, origin: unknown): void {
  for (const l of links) if (l.open && origin !== l) l.send(T_UPDATE, watchedWorld, update);
}

function sendStateVector(l: MeshLink): void {
  if (!watchedDoc || !watchedWorld) return;
  l.svSentFor = watchedWorld;
  l.send(T_SV, watchedWorld, Y.encodeStateVector(watchedDoc));
}

function watchActiveWorld(): void {
  const { activeWorldId, activeWorldDoc } = useUniverseStore.getState();
  if (activeWorldDoc === watchedDoc) return;
  watchedDoc?.off("update", onDocUpdate);
  watchedDoc = activeWorldDoc;
  watchedWorld = activeWorldId;
  watchedDoc?.on("update", onDocUpdate);
  for (const l of links) if (l.open) sendStateVector(l);
}

function startSharing(): void {
  if (unsubUniverse) return;
  unsubUniverse = useUniverseStore.subscribe(watchActiveWorld);
  watchActiveWorld();
  setMeshPresenceSender((payload) => {
    for (const l of links) if (l.open) l.send(T_PRESENCE, null, payload);
  });
}

function stopSharing(): void {
  unsubUniverse?.();
  unsubUniverse = null;
  watchedDoc?.off("update", onDocUpdate);
  watchedDoc = null;
  watchedWorld = null;
  setMeshPresenceSender(null);
}

function onLinkOpen(link: MeshLink): void {
  if (link.open) return;
  link.open = true;
  if (link.timer) clearTimeout(link.timer);
  link.timer = null;
  if (pending === link) pending = null;
  links.add(link);
  startSharing();
  sendStateVector(link);
  useMeshStore.setState({ phase: "connected", code: null, error: null, peers: links.size });
}

function onLinkClosed(link: MeshLink): void {
  if (pending === link) {
    pending = null;
    link.close();
    fail("Couldn’t connect. Both phones need to be on the same Wi-Fi or hotspot.");
    return;
  }
  if (!links.delete(link)) return;
  link.close();
  if (links.size === 0) stopSharing();
  const s = useMeshStore.getState();
  useMeshStore.setState({
    peers: links.size,
    ...(links.size === 0 && s.phase === "connected" ? { phase: "idle" as const } : {}),
  });
}

function fail(message: string): void {
  useMeshStore.setState({ phase: "failed", code: null, error: message });
}

function gather(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const t = setTimeout(resolve, GATHER_MS);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

function arm(link: MeshLink, ms: number): void {
  if (link.timer) clearTimeout(link.timer);
  link.timer = setTimeout(() => {
    if (!link.open) onLinkClosed(link);
  }, ms);
}

function newPending(): MeshLink | null {
  if (pending) pending.close();
  pending = null;
  if (links.size >= MAX_MESH_PEERS) {
    fail(`Up to ${MAX_MESH_PEERS} nearby players at a time.`);
    return null;
  }
  pending = new MeshLink();
  return pending;
}

const NO_NETWORK = "This phone isn’t on any network to share. Turn on Wi-Fi or a hotspot (no internet needed), then try again.";

/** Host: make an offer for the world you're in and show it as a QR. */
export async function meshHost(): Promise<void> {
  const worldId = useUniverseStore.getState().activeWorldId;
  if (!worldId) return fail("Step into a world first, then share it.");
  const link = newPending();
  if (!link) return;
  useMeshStore.setState({ phase: "preparing", code: null, error: null });
  try {
    await link.pc.setLocalDescription(await link.pc.createOffer());
    await gather(link.pc);
    if (pending !== link) return; // cancelled meanwhile
    const sig = { ...parseSdp(link.pc.localDescription!.sdp, "offer"), worldId };
    if (sig.candidates.length === 0) {
      link.close();
      pending = null;
      return fail(NO_NETWORK);
    }
    useMeshStore.setState({ phase: "showing-offer", code: signalToText(sig, window.location.origin) });
  } catch {
    link.close();
    pending = null;
    fail("This browser couldn’t start a nearby game.");
  }
}

/** Host: the joiner's answer (scanned or pasted). Throws a readable message on a wrong code. */
export async function meshAcceptAnswer(text: string): Promise<void> {
  const link = pending;
  if (!link || useMeshStore.getState().phase !== "showing-offer") return;
  const sig = readCode(text);
  if (sig.kind !== "answer") throw new Error("That’s a code for joining. Scan the code the other phone shows after it scanned yours.");
  useMeshStore.setState({ phase: "connecting", code: null, error: null });
  await link.pc.setRemoteDescription({ type: "answer", sdp: buildSdp(sig) });
  arm(link, CONNECT_MS);
}

/** Joiner: the host's offer (scanned, pasted or a `/j#…` link). Throws a readable message on a wrong code. */
export async function meshJoin(text: string): Promise<void> {
  const sig = readCode(text);
  if (sig.kind !== "offer") throw new Error("That’s an answer code. Scan the code on the phone that’s sharing its world.");
  const link = newPending();
  if (!link) return;
  useMeshStore.setState({ phase: "preparing", code: null, error: null });

  if (sig.worldId) {
    const s = useUniverseStore.getState();
    if (s.activeWorldId !== sig.worldId) {
      // Known here (or online to look it up): the normal arrival. Otherwise step straight in and let
      // the host's phone fill the world in over the link.
      if (s.worlds.has(sig.worldId) || navigator.onLine) void teleportSystem.teleportToId(sig.worldId);
      else s.enterWorld(sig.worldId);
    }
  }

  try {
    await link.pc.setRemoteDescription({ type: "offer", sdp: buildSdp(sig) });
    await link.pc.setLocalDescription(await link.pc.createAnswer());
    await gather(link.pc);
    if (pending !== link) return;
    const ans = parseSdp(link.pc.localDescription!.sdp, "answer");
    if (ans.candidates.length === 0) {
      link.close();
      pending = null;
      return fail(NO_NETWORK);
    }
    useMeshStore.setState({ phase: "showing-answer", code: signalToText(ans, window.location.origin) });
    arm(link, ANSWER_WAIT_MS);
  } catch {
    link.close();
    pending = null;
    fail("This browser couldn’t join a nearby game.");
  }
}

/** Disconnect from everyone nearby. */
export function meshLeave(): void {
  if (pending) pending.close();
  pending = null;
  for (const l of [...links]) {
    links.delete(l);
    l.close();
  }
  stopSharing();
  useMeshStore.setState({ phase: "idle", code: null, error: null, peers: 0 });
}

function readCode(text: string) {
  try {
    return textToSignal(text);
  } catch {
    throw new Error("That isn’t an Aweborn code. Point the camera at the code on the other phone.");
  }
}
