import { useEffect, useRef, useState, useCallback } from "react";
import type { PlayerPresence, Vec3 } from "@aweborn/shared/crdt-schema";

const BROADCAST_INTERVAL_MS = 50; // ~20Hz

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

export interface UsePresenceReturn {
  /** This player's ID */
  playerId: string;
  /** This player's color */
  playerColor: string;
  /** All other players' presence data */
  players: Map<string, PlayerPresence>;
  /** Update this player's position */
  updatePosition: (position: Vec3, velocity: Vec3, inWorld: string | null) => void;
}

/**
 * Hook for managing player presence via a simple broadcast channel.
 *
 * For Phase 02 (dev/testing), this uses BroadcastChannel for same-origin
 * tab-to-tab presence. In Phase 06 (P2P), this will be upgraded to use
 * Yjs awareness protocol over WebRTC.
 *
 * Broadcasts local player state at ~20Hz and listens for other players.
 */
export function usePresence(): UsePresenceReturn {
  const playerId = useRef(getPlayerId()).current;
  const playerColor = useRef(getPlayerColor()).current;
  const [players, setPlayers] = useState<Map<string, PlayerPresence>>(new Map());

  const localState = useRef<PlayerPresence>({
    id: playerId,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    inWorld: null,
    color: playerColor,
  });

  const updatePosition = useCallback(
    (position: Vec3, velocity: Vec3, inWorld: string | null) => {
      localState.current = {
        ...localState.current,
        position,
        velocity,
        inWorld,
      };
    },
    []
  );

  useEffect(() => {
    // Use BroadcastChannel for same-origin tab-to-tab presence
    const channel = new BroadcastChannel("aweborn-presence");

    // Broadcast local state at ~20Hz
    const broadcastTimer = setInterval(() => {
      channel.postMessage(localState.current);
    }, BROADCAST_INTERVAL_MS);

    // Listen for other players
    const handleMessage = (event: MessageEvent<PlayerPresence>) => {
      const presence = event.data;
      if (presence.id === playerId) return; // Ignore self

      setPlayers((prev) => {
        const next = new Map(prev);
        next.set(presence.id, presence);
        return next;
      });
    };

    channel.addEventListener("message", handleMessage);

    // Clean up stale players every 2 seconds
    const cleanupTimer = setInterval(() => {
      setPlayers((prev) => {
        // BroadcastChannel doesn't give us "leave" events,
        // but stale entries will be overwritten by fresh broadcasts.
        // For now, keep all — we'll add TTL cleanup when switching to WebRTC.
        return prev;
      });
    }, 2000);

    // Announce arrival
    channel.postMessage(localState.current);

    return () => {
      clearInterval(broadcastTimer);
      clearInterval(cleanupTimer);
      channel.removeEventListener("message", handleMessage);
      channel.close();
    };
  }, [playerId]);

  return { playerId, playerColor, players, updatePosition };
}
