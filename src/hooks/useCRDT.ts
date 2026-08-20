import { useEffect, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const SYNC_URL =
  import.meta.env.VITE_SYNC_URL ?? "ws://localhost:1234";

interface UseCRDTOptions {
  /** Room name — maps to a Yjs document on the server */
  room: string;
}

interface UseCRDTReturn {
  /** The Yjs document instance (null until connected) */
  doc: Y.Doc | null;
  /** Whether the WebSocket is currently connected */
  connected: boolean;
  /** Whether the initial sync with the server is complete */
  synced: boolean;
}

/**
 * React hook that creates a Yjs document and connects it to
 * the sync-service via y-websocket.
 *
 * Usage:
 * ```tsx
 * const { doc, connected, synced } = useCRDT({ room: "universe" });
 * if (doc) {
 *   const worldsMap = doc.getMap("worlds");
 * }
 * ```
 */
export function useCRDT({ room }: UseCRDTOptions): UseCRDTReturn {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const yDoc = new Y.Doc();
    const provider = new WebsocketProvider(SYNC_URL, room, yDoc);

    setDoc(yDoc);

    provider.on("status", ({ status }: { status: string }) => {
      setConnected(status === "connected");
    });

    provider.on("sync", (isSynced: boolean) => {
      setSynced(isSynced);
    });

    return () => {
      provider.destroy();
      yDoc.destroy();
      setDoc(null);
      setConnected(false);
      setSynced(false);
    };
  }, [room]);

  return { doc, connected, synced };
}
