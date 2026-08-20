import { useEffect, useRef, useState, useCallback } from "react";
import type {
  Vec3,
} from "@aweborn/shared/crdt-schema";

const SYNC_URL = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:1234";

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
}

export type UniverseUpdateHandler = (type: string, data: Uint8Array) => void;
export type WorldUpdateHandler = (type: string, worldId: string, data: Uint8Array) => void;

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
  onWorldUpdate?: WorldUpdateHandler
): SyncConnection {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onUniverseUpdateRef = useRef(onUniverseUpdate);
  const onWorldUpdateRef = useRef(onWorldUpdate);

  // Keep handler refs current
  onUniverseUpdateRef.current = onUniverseUpdate;
  onWorldUpdateRef.current = onWorldUpdate;

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

  useEffect(() => {
    const sectorsParam = sectorKeys.join(",");
    const url = `${SYNC_URL}/universe?sectors=${encodeURIComponent(sectorsParam)}`;

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setConnected(true);
      console.log("[sync] connected to sync-service");
    });

    ws.addEventListener("close", () => {
      setConnected(false);
      console.log("[sync] disconnected from sync-service");
    });

    ws.addEventListener("error", (err) => {
      console.error("[sync] WebSocket error:", err);
    });

    ws.addEventListener("message", (event) => {
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
      }
    });

    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
    // Re-connect when sector keys change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorKeys.join(",")]);

  return { connected, send, createWorld, updateSectors };
}
