import { useEffect, useState, useCallback, useMemo } from "react";
import type { PlayerPresence, Vec3 } from "@aweborn/shared/crdt-schema";
import { playerReady } from "../lib/player";

/**
 * ~10 Hz (was 20 Hz until 2026-10-20). The server batches presence on the same
 * tick (rooms.ts presenceTick), and renderers already smooth toward the latest
 * position, so halving the rate halves the traffic without visible stutter.
 */
const BROADCAST_INTERVAL_MS = 100;
const STALE_TIMEOUT_MS = 3000; // Remove players not heard from in 3s

/** 1 cm precision: trims ~40% off every presence payload. */
const r2 = (n: number) => Math.round(n * 100) / 100;
const roundVec = (v: Vec3): Vec3 => ({ x: r2(v.x), y: r2(v.y), z: r2(v.z) });

// ── Singleton Presence Manager ───────────────────────────────────────
//
// Shared across all components that call usePresence(). Position updates
// are handled imperatively (no React re-renders). Only structural changes
// (player join/leave) trigger React re-renders.

type PresenceSendFn = (type: string, data: Uint8Array, worldId?: string) => void;

interface PresenceState {
  players: Map<string, PlayerPresence>;
  lastSeen: Map<string, number>;
}

// Filled in once the player resolves (persistent playerId, or a guest ID).
// Until then nothing is broadcast, so no throwaway IDs leak into presence.
let _playerId = "";
let _playerColor = "hsl(0, 0%, 75%)";
let _playerResolved = false;

const _state: PresenceState = {
  players: new Map(),
  lastSeen: new Map(),
};

const _localState: PlayerPresence = {
  id: _playerId,
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  inWorld: null,
  color: _playerColor,
};

/**
 * Structural version — increments ONLY when players join or leave.
 * This is what triggers React re-renders (not position updates).
 */
let _structuralVersion = 0;

/** All subscribed React components — notified only on structural changes */
const _listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of _listeners) fn();
}

void playerReady.then((player) => {
  _playerId = player.playerId;
  _playerColor = player.color;
  _localState.id = player.playerId;
  _localState.color = player.color;
  _playerResolved = true;
  _structuralVersion++;
  notifyListeners();
});

/** WebSocket send function, set by the component that owns the sync connection */
let _wsSend: PresenceSendFn | null = null;

/** Nearby phones over the offline mesh (src/lib/mesh.ts, M7b): the same JSON as the socket */
let _meshSend: ((payload: Uint8Array) => void) | null = null;

/** BroadcastChannel for local same-browser fallback */
let _broadcastChannel: BroadcastChannel | null = null;
let _broadcastTimer: ReturnType<typeof setInterval> | null = null;
let _cleanupTimer: ReturnType<typeof setInterval> | null = null;
let _refCount = 0;

function startPresenceLoop() {
  if (_broadcastTimer) return;

  _broadcastChannel = new BroadcastChannel("aweborn-presence");
  _broadcastChannel.addEventListener("message", handleLocalPresence);

  // Broadcast local state at ~20Hz (once the player is known)
  _broadcastTimer = setInterval(() => {
    if (!_playerResolved) return;
    _broadcastChannel?.postMessage(_localState);
    if (_wsSend || _meshSend) {
      const wire = {
        ..._localState,
        position: roundVec(_localState.position),
        velocity: roundVec(_localState.velocity),
        ...(_localState.facing ? { facing: { x: r2(_localState.facing.x), z: r2(_localState.facing.z) } } : {}),
      };
      const payload = new TextEncoder().encode(JSON.stringify(wire));
      _wsSend?.("presence", payload);
      _meshSend?.(payload);
    }
  }, BROADCAST_INTERVAL_MS);

  // Clean up stale players every 2 seconds
  _cleanupTimer = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, lastSeen] of _state.lastSeen) {
      if (now - lastSeen > STALE_TIMEOUT_MS) {
        _state.players.delete(id);
        _state.lastSeen.delete(id);
        changed = true;
      }
    }
    if (changed) {
      _structuralVersion++;
      notifyListeners();
    }
  }, 2000);

  if (_playerResolved) _broadcastChannel.postMessage(_localState);
}

function stopPresenceLoop() {
  if (_broadcastTimer) {
    clearInterval(_broadcastTimer);
    _broadcastTimer = null;
  }
  if (_cleanupTimer) {
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
  }
  if (_broadcastChannel) {
    _broadcastChannel.removeEventListener("message", handleLocalPresence);
    _broadcastChannel.close();
    _broadcastChannel = null;
  }
}

/**
 * Process an incoming PlayerPresence object.
 * Only triggers React re-renders when a NEW player joins.
 * Position updates are silent mutations (read imperatively in animation loops).
 */
function applyPresence(presence: PlayerPresence): void {
  if (!presence || presence.id === _playerId) return;

  const isNew = !_state.players.has(presence.id);
  _state.players.set(presence.id, presence);
  _state.lastSeen.set(presence.id, Date.now());

  // Only notify React on structural changes (join)
  if (isNew) {
    _structuralVersion++;
    notifyListeners();
  }
}

function handleLocalPresence(event: MessageEvent<PlayerPresence>) {
  applyPresence(event.data);
}

/**
 * Handle presence data received from the WebSocket: a single state (legacy
 * relay) or a server batch (an array of states, one per nearby player).
 */
export function handleWebSocketPresence(data: Uint8Array): void {
  try {
    const json = new TextDecoder().decode(data);
    const parsed = JSON.parse(json) as PlayerPresence | PlayerPresence[];
    if (Array.isArray(parsed)) for (const p of parsed) applyPresence(p);
    else applyPresence(parsed);
  } catch {
    // Ignore malformed presence data
  }
}

/**
 * Set the WebSocket send function.
 */
export function setPresenceSender(send: PresenceSendFn | null): void {
  _wsSend = send;
}

/** Set by the offline mesh while it has open links. */
export function setMeshPresenceSender(send: ((payload: Uint8Array) => void) | null): void {
  _meshSend = send;
}

/**
 * Imperative access to the latest player presence data.
 * Use in useFrame() / requestAnimationFrame() loops for smooth updates
 * WITHOUT triggering React re-renders.
 */
export function getPresenceState(): ReadonlyMap<string, PlayerPresence> {
  return _state.players;
}

// ── React Hook ───────────────────────────────────────────────────────

export interface UsePresenceReturn {
  /** This player's ID */
  playerId: string;
  /** This player's color */
  playerColor: string;
  /**
   * Player map — new reference ONLY when players join/leave.
   * For position data in animation loops, use getPresenceState() instead.
   */
  players: Map<string, PlayerPresence>;
  /** Update this player's position */
  updatePosition: (position: Vec3, velocity: Vec3, inWorld: string | null, facing?: { x: number; z: number }) => void;
}

/**
 * Hook for managing player presence.
 *
 * PERFORMANCE: This hook only re-renders on structural changes (player
 * join/leave). Position updates at 20Hz are handled imperatively via
 * getPresenceState() in animation loops (useFrame / requestAnimationFrame).
 */
export function usePresence(): UsePresenceReturn {
  const [version, setVersion] = useState(_structuralVersion);

  // Snapshot the players Map only on structural changes (join/leave)
  const players = useMemo(() => new Map(_state.players), [version]);

  // Subscribe to structural changes
  useEffect(() => {
    _refCount++;
    if (_refCount === 1) startPresenceLoop();

    const listener = () => setVersion(_structuralVersion);
    _listeners.add(listener);

    return () => {
      _listeners.delete(listener);
      _refCount--;
      if (_refCount === 0) stopPresenceLoop();
    };
  }, []);

  const updatePosition = useCallback(
    (position: Vec3, velocity: Vec3, inWorld: string | null, facing?: { x: number; z: number }) => {
      _localState.position = position;
      _localState.velocity = velocity;
      _localState.inWorld = inWorld;
      _localState.facing = facing;
    },
    []
  );

  return {
    playerId: _playerId,
    playerColor: _playerColor,
    players,
    updatePosition,
  };
}
