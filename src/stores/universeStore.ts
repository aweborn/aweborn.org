/**
 * Aweborn — Universe Store
 *
 * Zustand store backed by the Universe CRDT. Provides reactive access
 * to all worlds, mana state, and player presence.
 *
 * This store is the client-side "truth" for the star map view.
 */

import { create } from "zustand";
import * as Y from "yjs";
import type {
  WorldEntry,
  Vec3,
  SectorCoord,
} from "@aweborn/shared/crdt-schema";
import {
  positionToSector,
  adjacentSectorKeys,
} from "@aweborn/shared/crdt-schema";
import { useWorldStore } from "./worldStore";

interface UniverseState {
  /** All known worlds (from Universe CRDT) */
  worlds: Map<string, WorldEntry>;

  /** Current camera/player position */
  cameraPosition: Vec3;

  /** Current sector derived from camera position */
  currentSector: SectorCoord;

  /** Sector keys the client is subscribed to (3×3×3 cube) */
  subscribedSectors: string[];

  /** The internal Y.Doc for the universe (null until connected) */
  universeDoc: Y.Doc | null;

  /** Currently entered world ID (null = flying in universe) */
  activeWorldId: string | null;

  /** The Y.Doc for the active world (null = not in a world) */
  activeWorldDoc: Y.Doc | null;

  /** Connection status */
  connected: boolean;

  /**
   * Callback for sending world doc updates to the server.
   * Set by the component that owns the sync connection.
   */
  _worldDocUpdateHandler: ((worldId: string, update: Uint8Array) => void) | null;

  // ── Actions ──

  /** Initialize the universe doc from a sync payload */
  applyUniverseUpdate: (update: Uint8Array, isFullSync: boolean) => void;

  /** Initialize or update the active world doc */
  applyWorldUpdate: (worldId: string, update: Uint8Array, isFullSync: boolean) => void;

  /** Update camera position (triggers sector subscription changes) */
  setCameraPosition: (pos: Vec3) => void;

  /** Enter a world */
  enterWorld: (worldId: string) => void;

  /** Exit the current world */
  exitWorld: () => void;

  /** Set connection status */
  setConnected: (connected: boolean) => void;

  /** Register a handler for outgoing world doc updates */
  setWorldDocUpdateHandler: (handler: ((worldId: string, update: Uint8Array) => void) | null) => void;
}

/**
 * Parse a Y.Map world entry into a WorldEntry object.
 */
function ymapToWorldEntry(m: Y.Map<unknown>): WorldEntry {
  return {
    id: (m.get("id") as string) ?? "",
    name: (m.get("name") as string) ?? "Unknown",
    creator: (m.get("creator") as string) ?? "",
    intendedPosition: {
      x: (m.get("intendedPosition.x") as number) ?? 0,
      y: (m.get("intendedPosition.y") as number) ?? 0,
      z: (m.get("intendedPosition.z") as number) ?? 0,
    },
    resolvedPosition: {
      x: (m.get("resolvedPosition.x") as number) ?? 0,
      y: (m.get("resolvedPosition.y") as number) ?? 0,
      z: (m.get("resolvedPosition.z") as number) ?? 0,
    },
    resolvedAt: (m.get("resolvedAt") as number) ?? 0,
    color: (m.get("color") as string) ?? "#ffffff",
    sector: (m.get("sector") as string) ?? "0:0:0",
    solidified: (m.get("solidified") as boolean) ?? false,
    solidifiedAt: (m.get("solidifiedAt") as number) ?? 0,
    playerCount: (m.get("playerCount") as number) ?? 0,
    lastActive: (m.get("lastActive") as number) ?? 0,
    createdAt: (m.get("createdAt") as number) ?? 0,
  };
}

/**
 * Refresh the worlds map from the universe doc.
 */
function refreshWorlds(doc: Y.Doc): Map<string, WorldEntry> {
  const worlds = new Map<string, WorldEntry>();
  const worldsMap = doc.getMap("worlds");
  worldsMap.forEach((value, key) => {
    const worldMap = value as Y.Map<unknown>;
    worlds.set(key, ymapToWorldEntry(worldMap));
  });
  return worlds;
}

export const useUniverseStore = create<UniverseState>((set, get) => ({
  worlds: new Map(),
  cameraPosition: { x: 0, y: 0, z: 0 },
  currentSector: { sx: 0, sy: 0, sz: 0 },
  subscribedSectors: adjacentSectorKeys({ sx: 0, sy: 0, sz: 0 }),
  universeDoc: null,
  activeWorldId: null,
  activeWorldDoc: null,
  connected: false,
  _worldDocUpdateHandler: null,

  applyUniverseUpdate: (update, _isFullSync) => {
    let doc = get().universeDoc;
    if (!doc) {
      doc = new Y.Doc();
      // Observe changes to the worlds map
      const worldsMap = doc.getMap("worlds");
      worldsMap.observeDeep(() => {
        const currentDoc = get().universeDoc;
        if (currentDoc) {
          set({ worlds: refreshWorlds(currentDoc) });
        }
      });
    }

    Y.applyUpdate(doc, update);

    set({
      universeDoc: doc,
      worlds: refreshWorlds(doc),
    });
  },

  applyWorldUpdate: (worldId, update, isFullSync) => {
    const state = get();

    // Only apply if this is the active world
    if (state.activeWorldId !== worldId) return;

    let doc = state.activeWorldDoc;
    const isNewDoc = !doc || isFullSync;
    if (isNewDoc) {
      doc?.destroy();
      doc = new Y.Doc();

      // Wire outgoing updates: when the local doc changes, send delta to server
      doc.on("update", (delta: Uint8Array, origin: unknown) => {
        // Only send locally-originated changes (not updates from the server)
        if (origin !== "remote") {
          const handler = get()._worldDocUpdateHandler;
          handler?.(worldId, delta);
        }
      });
    }

    // Apply the incoming update, tagged as "remote" so we don't echo it back
    Y.applyUpdate(doc!, update, "remote");
    set({ activeWorldDoc: doc });

    // If this is a new doc (full sync), load it into the world store for reactive UI
    if (isNewDoc) {
      useWorldStore.getState().loadFromDoc(doc!);
    }
  },

  setCameraPosition: (pos) => {
    const newSector = positionToSector(pos);
    const current = get().currentSector;

    // Only update subscriptions if sector actually changed
    if (
      newSector.sx !== current.sx ||
      newSector.sy !== current.sy ||
      newSector.sz !== current.sz
    ) {
      set({
        cameraPosition: pos,
        currentSector: newSector,
        subscribedSectors: adjacentSectorKeys(newSector),
      });
    } else {
      set({ cameraPosition: pos });
    }
  },

  enterWorld: (worldId) => {
    set({ activeWorldId: worldId, activeWorldDoc: null });
  },

  exitWorld: () => {
    const doc = get().activeWorldDoc;
    doc?.destroy();
    set({ activeWorldId: null, activeWorldDoc: null });
  },

  setConnected: (connected) => set({ connected }),

  setWorldDocUpdateHandler: (handler) => set({ _worldDocUpdateHandler: handler }),
}));
