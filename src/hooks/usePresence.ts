import { useEffect, useState, useCallback, useMemo } from "react";
import type { PlayerPresence, Vec3 } from "@aweborn/shared/crdt-schema";

const BROADCAST_INTERVAL_MS = 50; // ~20Hz
const STALE_TIMEOUT_MS = 3000; // Remove players not heard from in 3s

/**
 * Generate a random player ID for this session.
 * Persisted in sessionStorage so it survives hot-reloads.
 */
function getPlayerId(): string {
  const key = "aweborn-player-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `p-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

/**
 * Generate a random player color for this session.
 */
function getPlayerColor(): string {
  const key = "aweborn-player-color";
  let color = sessionStorage.getItem(key);
  if (!color) {
    const hue = Math.floor(Math.random() * 360);
    color = `hsl(${hue}, 80%, 65%)`;
    sessionStorage.setItem(key, color);
  }
  return color;
}

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

const _playerId = getPlayerId();
const _playerColor = getPlayerColor();

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

/** WebSocket send function, set by the component that owns the sync connection */
let _wsSend: PresenceSendFn | null = null;

/** BroadcastChannel for local same-browser fallback */
let _broadcastChannel: BroadcastChannel | null = null;
let _broadcastTimer: ReturnType<typeof setInterval> | null = null;
let _cleanupTimer: ReturnType<typeof setInterval> | null = null;
let _refCount = 0;

function startPresenceLoop() {
  if (_broadcastTimer) return;

  _broadcastChannel = new BroadcastChannel("aweborn-presence");
  _broadcastChannel.addEventListener("message", handleLocalPresence);

  // Broadcast local state at ~20Hz
  _broadcastTimer = setInterval(() => {
    _broadcastChannel?.postMessage(_localState);
    if (_wsSend) {
      const payload = new TextEncoder().encode(JSON.stringify(_localState));
      _wsSend("presence", payload);
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

  _broadcastChannel.postMessage(_localState);
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
 * Handle presence data received from the WebSocket (server relay).
 */
export function handleWebSocketPresence(data: Uint8Array): void {
  try {
    const json = new TextDecoder().decode(data);
    const presence = JSON.parse(json) as PlayerPresence;
    applyPresence(presence);
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
  updatePosition: (position: Vec3, velocity: Vec3, inWorld: string | null) => void;
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
    (position: Vec3, velocity: Vec3, inWorld: string | null) => {
      _localState.position = position;
      _localState.velocity = velocity;
      _localState.inWorld = inWorld;
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
