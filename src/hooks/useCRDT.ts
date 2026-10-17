import { useEffect, useRef, useState, useCallback } from "react";
import type {
  Vec3,
} from "@aweborn/shared/crdt-schema";
import { playerReady } from "../lib/player";

const SYNC_URL = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:1234";

/** Reconnect backoff after a dropped socket (doubles per failed try, with jitter). */
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;
/** Back in view after this long hidden: assume the socket is a zombie, open a fresh one. */
const RESUME_RECYCLE_MS = 15_000;

// ── Wire Protocol (mirrors server's RoomManager protocol) ────────────
//
// [1 byte: type] [2 bytes: worldId length] [N bytes: worldId] [rest: data]
//
const MSG_TYPES: Record<string, number> = {
  "universe-sync": 0x01,
  "universe-update": 0x02,
  "world-sync": 0x03,
  "world-update": 0x04,
  "create-world": 0x05,
  "update-sectors": 0x06,
  "join-world": 0x07,
  "leave-world": 0x08,
  "presence": 0x09,
};

const MSG_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(MSG_TYPES).map(([k, v]) => [v, k])
);

function encodeMessage(type: string, data: Uint8Array, worldId?: string): Uint8Array {
  const typeNum = MSG_TYPES[type] ?? 0;
  const worldIdBytes = worldId ? new TextEncoder().encode(worldId) : new Uint8Array(0);
  const worldIdLen = worldIdBytes.length;

  const buf = new Uint8Array(1 + 2 + worldIdLen + data.length);
  buf[0] = typeNum;
  buf[1] = (worldIdLen >> 8) & 0xff;
  buf[2] = worldIdLen & 0xff;
  buf.set(worldIdBytes, 3);
  buf.set(data, 3 + worldIdLen);
  return buf;
}

function decodeMessage(raw: ArrayBuffer): {
  type: string;
  worldId: string | null;
  data: Uint8Array;
} | null {
  const bytes = new Uint8Array(raw);
  if (bytes.length < 3) return null;

  const typeNum = bytes[0];
  const type = MSG_TYPE_NAMES[typeNum];
  if (!type) return null;

  const worldIdLen = (bytes[1] << 8) | bytes[2];
  const worldId =
    worldIdLen > 0
      ? new TextDecoder().decode(bytes.slice(3, 3 + worldIdLen))
      : null;
  const data = bytes.slice(3 + worldIdLen);

  return { type, worldId, data };
}

// ── Connection State ─────────────────────────────────────────────────

export interface SyncConnection {
  /** Whether the WebSocket is currently connected */
  connected: boolean;
  /** Send a raw message to the server */
  send: (type: string, data: Uint8Array, worldId?: string) => void;
  /** Create a world on the server */
  createWorld: (name: string, creator: string, position: Vec3, color: string) => void;
  /** Update sector subscriptions */
  updateSectors: (sectors: string[]) => void;
  /** Join a world room (start receiving world CRDT updates) */
  joinWorld: (worldId: string) => void;
  /** Leave a world room (stop receiving world CRDT updates) */
  leaveWorld: (worldId: string) => void;
}

export type UniverseUpdateHandler = (type: string, data: Uint8Array) => void;
export type WorldUpdateHandler = (type: string, worldId: string, data: Uint8Array) => void;
export type PresenceHandler = (data: Uint8Array) => void;

/**
 * React hook that manages a WebSocket connection to the sync-service.
 *
 * This is the low-level transport hook. Higher-level stores (universeStore,
 * worldStore) build on top of this.
 *
 * Connects to /universe with sector subscriptions. World connections
 * are multiplexed over the same socket using the binary protocol.
 */
export function useSyncConnection(
  sectorKeys: string[],
  onUniverseUpdate?: UniverseUpdateHandler,
  onWorldUpdate?: WorldUpdateHandler,
  onPresence?: PresenceHandler,
): SyncConnection {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onUniverseUpdateRef = useRef(onUniverseUpdate);
  const onWorldUpdateRef = useRef(onWorldUpdate);
  const onPresenceRef = useRef(onPresence);

  // Keep handler refs current
  onUniverseUpdateRef.current = onUniverseUpdate;
  onWorldUpdateRef.current = onWorldUpdate;
  onPresenceRef.current = onPresence;

  const send = useCallback(
    (type: string, data: Uint8Array, worldId?: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(encodeMessage(type, data, worldId) as unknown as ArrayBuffer);
      }
    },
    []
  );

  const createWorld = useCallback(
    (name: string, creator: string, position: Vec3, color: string) => {
      const payload = JSON.stringify({ name, creator, position, color });
      send("create-world", new TextEncoder().encode(payload));
    },
    [send]
  );

  const updateSectors = useCallback(
    (sectors: string[]) => {
      send("update-sectors", new TextEncoder().encode(JSON.stringify(sectors)));
    },
    [send]
  );

  const joinWorld = useCallback(
    (worldId: string) => {
      // Send empty data — the worldId in the header is all the server needs
      send("join-world", new Uint8Array(0), worldId);
    },
    [send]
  );

  const leaveWorld = useCallback(
    (worldId: string) => {
      send("leave-world", new Uint8Array(0), worldId);
    },
    [send]
  );

  useEffect(() => {
    const sectorsParam = sectorKeys.join(",");
    const url = `${SYNC_URL}/universe?sectors=${encodeURIComponent(sectorsParam)}`;

    // Open the socket only once the player is resolved, so the session
    // cookie exists and the server attaches our playerId at upgrade.
    // (playerReady never rejects; guests connect without a session.)
    //
    // The socket must survive real life: phones lock, switch apps, hop
    // between Wi-Fi and cell, and the server restarts on deploys. Before
    // 2026-10-17 a dropped socket stayed dropped, so two phones lost each
    // other for the rest of the session. Now: reconnect with backoff, and on
    // coming back (visible again, back online, restored from bfcache) open a
    // fresh socket, because iOS often keeps a dead one that still says OPEN.
    // On reconnect the server resends universe-sync, CRDTDevOverlay rejoins
    // the active world room, and presence resumes on the next 50 ms tick.
    let cancelled = false;
    let ws: WebSocket | null = null;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let hiddenAt = 0;

    const clearRetry = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || retryTimer) return;
      // In the background, wait for the page to come back (onResume).
      if (document.visibilityState === "hidden") return;
      const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** retries);
      const delay = base * (0.5 + Math.random() * 0.5); // jitter: don't stampede after a deploy
      retries++;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (cancelled) return;
      clearRetry();
      const sock = new WebSocket(url);
      sock.binaryType = "arraybuffer";
      ws = sock;
      wsRef.current = sock;

      sock.addEventListener("open", () => {
        if (ws !== sock) return;
        retries = 0;
        setConnected(true);
        console.log("[sync] connected to sync-service");
      });

      sock.addEventListener("close", () => {
        if (ws !== sock) return; // replaced on purpose (recycle / unmount)
        ws = null;
        wsRef.current = null;
        setConnected(false);
        console.log("[sync] disconnected from sync-service; reconnecting");
        scheduleReconnect();
      });

      sock.addEventListener("error", (err) => {
        console.error("[sync] WebSocket error:", err);
      });

      sock.addEventListener("message", (event) => {
        if (ws !== sock) return;
        const msg = decodeMessage(event.data as ArrayBuffer);
        if (!msg) return;

        switch (msg.type) {
          case "universe-sync":
          case "universe-update":
            onUniverseUpdateRef.current?.(msg.type, msg.data);
            break;
          case "world-sync":
          case "world-update":
            if (msg.worldId) {
              onWorldUpdateRef.current?.(msg.type, msg.worldId, msg.data);
            }
            break;
          case "presence":
            onPresenceRef.current?.(msg.data);
            break;
        }
      });
    };

    /** Drop the current socket (possibly a zombie) and open a fresh one now. */
    const recycle = (why: string) => {
      if (cancelled) return;
      const old = ws;
      ws = null;
      wsRef.current = null;
      if (old) {
        old.close();
        setConnected(false);
      }
      console.log(`[sync] ${why}: opening a fresh connection`);
      retries = 0;
      connect();
    };

    const onResume = (why: string, force: boolean) => {
      if (cancelled || document.visibilityState === "hidden") return;
      const awayMs = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
        recycle(why);
      } else if (ws.readyState === WebSocket.OPEN && (force || awayMs > RESUME_RECYCLE_MS)) {
        recycle(why);
      }
      // CONNECTING: let it finish.
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        clearRetry(); // no reconnect storms while suspended
      } else {
        onResume("back in view", false);
      }
    };
    const onOnline = () => onResume("back online", true); // new network: the old socket is dead
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) onResume("restored from bfcache", true);
    };

    void playerReady.then(() => {
      if (cancelled) return;
      connect();
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("online", onOnline);
      window.addEventListener("pageshow", onPageShow);
    });

    return () => {
      cancelled = true;
      clearRetry();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      const old = ws;
      ws = null;
      old?.close();
      wsRef.current = null;
      setConnected(false);
    };
    // Re-connect when sector keys change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorKeys.join(",")]);

  return { connected, send, createWorld, updateSectors, joinWorld, leaveWorld };
}
