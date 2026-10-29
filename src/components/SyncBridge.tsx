import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSyncConnection } from "../hooks/useCRDT";
import { handleWebSocketPresence, setPresenceSender } from "../hooks/usePresence";
import { useUniverseStore } from "../stores/universeStore";
import { useWorldStore } from "../stores/worldStore";
import { useChatStore, onChatNotice } from "../stores/chatStore";
import { drainPendingWorldUpdates } from "../lib/offlineCache";
import { connectivityTier, useNavigatorOnline, usePendingWorlds } from "../hooks/useConnectivity";
import { useMeshStore } from "../lib/mesh";
import { adjacentSectorKeys } from "@aweborn/shared/crdt-schema";

/** Don't flash "reconnecting" for blips (boot, a deploy restart, a Wi-Fi hop). */
const SHOW_OFFLINE_AFTER_MS = 4000;

/**
 * The sync connection: universe + world rooms, presence, chat. Always mounted.
 *
 * Until 2026-10-21 this lived inside the backtick dev panel (CRDTDevOverlay).
 * Everything the panel showed now has a home in the real UI (world list →
 * World Index + the worlds themselves, players → their orbs, chat → ChatPanel,
 * placing → Library, Create World → PlantWorldPanel), so the panel was retired
 * and only its wiring moved here. The one thing players never saw was the
 * connection state, so a small chip appears while the socket is down.
 */
export function SyncBridge() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId);
  const applyUniverseUpdate = useUniverseStore((s) => s.applyUniverseUpdate);
  const applyWorldUpdate = useUniverseStore((s) => s.applyWorldUpdate);
  const setWorldDocUpdateHandler = useUniverseStore((s) => s.setWorldDocUpdateHandler);
  const resetWorld = useWorldStore((s) => s.reset);

  // Default sector keys (centered at origin)
  const sectorKeys = useMemo(() => adjacentSectorKeys({ sx: 0, sy: 0, sz: 0 }), []);

  const onUniverseUpdate = useCallback(
    (type: string, data: Uint8Array) => applyUniverseUpdate(data, type === "universe-sync"),
    [applyUniverseUpdate],
  );
  const onWorldUpdate = useCallback(
    (type: string, worldId: string, data: Uint8Array) => applyWorldUpdate(worldId, data, type === "world-sync"),
    [applyWorldUpdate],
  );

  const { connected, send, joinWorld, leaveWorld } = useSyncConnection(
    sectorKeys,
    onUniverseUpdate,
    onWorldUpdate,
    handleWebSocketPresence,
    useCallback((worldId: string | null, data: Uint8Array) => onChatNotice(data, worldId), []),
  );

  // Chat: the server stamps the sender and writes the line into the world's log
  useEffect(() => {
    useChatStore.getState().setSender((worldId, text) => {
      send("chat", new TextEncoder().encode(JSON.stringify({ text })), worldId);
    });
    return () => useChatStore.getState().setSender(null);
  }, [send]);

  // Local world changes go to the server
  useEffect(() => {
    setWorldDocUpdateHandler((worldId: string, update: Uint8Array) => send("world-update", update, worldId));
    return () => setWorldDocUpdateHandler(null);
  }, [send, setWorldDocUpdateHandler]);

  // Keep universeStore.connected in sync and flush any offline world edits on reconnect
  useEffect(() => {
    useUniverseStore.getState().setConnected(connected);
  }, [connected]);

  // Keep the server-side world room in sync with activeWorldId, however the
  // player got there: entering, Escape, a teleport link / card tap.
  const joinedWorldRef = useRef<string | null>(null);
  useEffect(() => {
    if (!connected) {
      joinedWorldRef.current = null; // the server drops rooms on disconnect
      return;
    }
    const prev = joinedWorldRef.current;
    if (prev !== activeWorldId) {
      if (prev) {
        leaveWorld(prev);
        if (!activeWorldId) resetWorld();
      }
      if (activeWorldId) joinWorld(activeWorldId);
      joinedWorldRef.current = activeWorldId;
    }
    // Flush any world CRDT edits made while offline (after join-world so the room is open)
    for (const item of drainPendingWorldUpdates()) {
      send("world-update", item.update, item.worldId);
    }
  }, [connected, activeWorldId, joinWorld, leaveWorld, resetWorld, send]);

  // Presence goes out over the same socket
  useEffect(() => {
    setPresenceSender(send);
    return () => setPresenceSender(null);
  }, [send]);

  // Connection chip: the connectivity tier (Phase 06). Reconnecting waits a moment (blips); solo shows at once,
  // since navigator.onLine === false is reliable. Online shows nothing.
  const online = useNavigatorOnline();
  const pendingWorlds = usePendingWorlds();
  const meshPeers = useMeshStore((s) => s.peers);
  const tier = connectivityTier(connected, online, meshPeers);
  const [showOffline, setShowOffline] = useState(false);
  useEffect(() => {
    if (connected) {
      setShowOffline(false);
      return;
    }
    const t = setTimeout(() => setShowOffline(true), SHOW_OFFLINE_AFTER_MS);
    return () => clearTimeout(t);
  }, [connected]);

  const waiting = pendingWorlds === 1 ? "1 world" : `${pendingWorlds} worlds`;
  const message =
    tier === "mesh"
      ? `No internet: playing with ${meshPeers === 1 ? "1 nearby player" : `${meshPeers} nearby players`}. It all syncs when you’re back`
      : tier === "solo"
      ? pendingWorlds > 0
        ? `Offline: playing solo. Changes in ${waiting} will sync when you’re back`
        : "Offline: playing solo. What you build is saved on this device"
      : tier === "reconnecting" && showOffline
        ? pendingWorlds > 0
          ? `Reconnecting… changes in ${waiting} waiting to sync`
          : "Reconnecting… others can’t see you right now"
        : null;

  // The live region stays mounted (empty while online) so a status that appears inside it gets announced
  return (
    <div className="sync-status-region" role="status" aria-live="polite">
      {message && (
        <div id="sync-status" className="sync-status" data-tier={tier}>
          <span className="sync-status-dot" aria-hidden="true" />
          {message}
        </div>
      )}
    </div>
  );
}
