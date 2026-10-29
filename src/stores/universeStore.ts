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
  ManaState,
} from "@aweborn/shared/crdt-schema";
import {
  positionToSector,
  adjacentSectorKeys,
  ORIGIN_WORLD_ID,
} from "@aweborn/shared/crdt-schema";
import { useWorldStore } from "./worldStore";
import { coCreatorsField } from "@aweborn/shared/world-policy";
import { interiorController } from "../systems/InteriorController";
import {
  loadUniverseDoc,
  saveUniverseDoc,
  loadWorldDoc,
  saveWorldDoc,
  queueOfflineWorldUpdate,
  flushOfflineCache,
} from "../lib/offlineCache";

interface UniverseState {
  /** All known worlds (from Universe CRDT) */
  worlds: Map<string, WorldEntry>;

  /** Universe mana totals (server-written `mana` map; null until synced) */
  mana: ManaState | null;

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

  /** Player flight position (scene coordinates) */
  playerPosition: Vec3;

  /** Player flight velocity */
  playerVelocity: Vec3;

  /** Player flight rotation (quaternion) */
  playerRotation: { x: number; y: number; z: number; w: number };

  /** Player speed (magnitude of velocity) */
  playerSpeed: number;

  /** Connection status */
  connected: boolean;

  /**
   * Callback for sending world doc updates to the server.
   * Set by the component that owns the sync connection.
   */
  _worldDocUpdateHandler: ((worldId: string, update: Uint8Array) => void) | null;

  // ── Actions ──

  /** Cold-start offline: load the cached Universe CRDT (main.tsx, after initOfflineCache, before the first render) */
  hydrateFromOfflineCache: () => void;

  /** Initialize the universe doc from a sync payload */
  applyUniverseUpdate: (update: Uint8Array, isFullSync: boolean) => void;

  /** Initialize or update the active world doc */
  applyWorldUpdate: (worldId: string, update: Uint8Array, isFullSync: boolean) => void;

  /** Update player flight state (position, velocity, rotation) */
  updatePlayerState: (pos: Vec3, vel: Vec3, rot: { x: number; y: number; z: number; w: number }, speed: number) => void;

  /** Update camera position (triggers sector subscription changes) */
  setCameraPosition: (pos: Vec3) => void;

  /** Enter a world */
  enterWorld: (worldId: string) => void;

  /** Exit the current world (steps back up to parentWorldId if nested, or all the way to space if `toSpace` is true) */
  exitWorld: (toSpace?: boolean) => void;

  /** Set connection status */
  setConnected: (connected: boolean) => void;

  /** Register a handler for outgoing world doc updates */
  setWorldDocUpdateHandler: (handler: ((worldId: string, update: Uint8Array) => void) | null) => void;
}

/**
 * Parse a Y.Map world entry into a WorldEntry object.
 */
function ymapToWorldEntry(m: Y.Map<unknown>): WorldEntry {
  const parentWorldId = m.get("parentWorldId") as string | undefined;
  const allowPortals = m.get("allowPortals") as boolean | undefined;
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
    ...(parentWorldId ? { parentWorldId } : {}),
    ...(allowPortals !== undefined ? { allowPortals } : {}),
    ...coCreatorsField(m.get("coCreators")),
  };
}

/**
 * Refresh the worlds map from the universe doc.
 *
 * Origin (the portal) is skipped: it's a real CRDT entry so links resolve,
 * but the portal is rendered and simulated by dedicated code (AwebornPortal,
 * GravitySystem, WarpSystem, RadarMinimap). Including it would double it.
 */
function refreshWorlds(doc: Y.Doc): Map<string, WorldEntry> {
  const worlds = new Map<string, WorldEntry>();
  const worldsMap = doc.getMap("worlds");
  worldsMap.forEach((value, key) => {
    if (key === ORIGIN_WORLD_ID) return;
    const worldMap = value as Y.Map<unknown>;
    worlds.set(key, ymapToWorldEntry(worldMap));
  });
  return worlds;
}

/** Read the server-written mana map (null if it hasn't synced yet). */
function readMana(doc: Y.Doc): ManaState | null {
  const m = doc.getMap("mana");
  if (!m.has("frontierRadius")) return null;
  return m.toJSON() as ManaState;
}

function createUniverseDoc(onChange: (doc: Y.Doc) => void): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap("worlds").observeDeep(() => onChange(doc));
  doc.getMap("mana").observe(() => onChange(doc));
  return doc;
}

function wireWorldDoc(
  worldId: string,
  doc: Y.Doc,
  getState: () => UniverseState,
): void {
  doc.on("update", (delta: Uint8Array, origin: unknown) => {
    saveWorldDoc(worldId, doc);
    if (origin !== "remote") {
      const s = getState();
      if (s.connected && s._worldDocUpdateHandler) {
        s._worldDocUpdateHandler(worldId, delta);
      } else {
        queueOfflineWorldUpdate(worldId, delta);
      }
    }
  });
}

export const useUniverseStore = create<UniverseState>((set, get) => {
  return {
    worlds: new Map<string, WorldEntry>(),
    mana: null,
    cameraPosition: { x: 0, y: 0, z: 0 },
    currentSector: { sx: 0, sy: 0, sz: 0 },
    subscribedSectors: adjacentSectorKeys({ sx: 0, sy: 0, sz: 0 }),
    universeDoc: null,
    activeWorldId: null,
    activeWorldDoc: null,
    playerPosition: { x: 0, y: 2, z: 10 },
    playerVelocity: { x: 0, y: 0, z: 0 },
    playerRotation: { x: 0, y: 0, z: 0, w: 1 },
    playerSpeed: 0,
    connected: false,
    _worldDocUpdateHandler: null,

    hydrateFromOfflineCache: () => {
      // The cache is read from IndexedDB asynchronously, so this runs after the store exists (was inline, pre-M7a)
      if (get().universeDoc) return;
      const cachedUniverse = loadUniverseDoc();
      if (!cachedUniverse) return;
      const doc = createUniverseDoc((d) =>
        set({ worlds: refreshWorlds(d), mana: readMana(d) }),
      );
      Y.applyUpdate(doc, cachedUniverse, "remote");
      set({ universeDoc: doc, worlds: refreshWorlds(doc), mana: readMana(doc) });
    },

    applyUniverseUpdate: (update, _isFullSync) => {
      let doc = get().universeDoc;
      if (!doc) {
        doc = createUniverseDoc((d) =>
          set({ worlds: refreshWorlds(d), mana: readMana(d) }),
        );
      }

      Y.applyUpdate(doc, update);
      saveUniverseDoc(doc);

      set({
        universeDoc: doc,
        worlds: refreshWorlds(doc),
        mana: readMana(doc),
      });
    },

    applyWorldUpdate: (worldId, update, _isFullSync) => {
      const state = get();

      // Only apply if this is the active world
      if (state.activeWorldId !== worldId) return;

      let doc = state.activeWorldDoc;
      const isNewDoc = !doc;
      if (!doc) {
        doc = new Y.Doc();
        wireWorldDoc(worldId, doc, get);
      }

      // Apply the incoming update, tagged as "remote" so we don't echo it back.
      // Keeping the existing doc (created in enterWorld) preserves any offline edits!
      Y.applyUpdate(doc, update, "remote");
      saveWorldDoc(worldId, doc);
      set({ activeWorldDoc: doc });

      if (isNewDoc) {
        useWorldStore.getState().loadFromDoc(doc);
      }
    },

    updatePlayerState: (pos, vel, rot, speed) => {
      set({ playerPosition: pos, playerVelocity: vel, playerRotation: rot, playerSpeed: speed });
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
      const prevDoc = get().activeWorldDoc;
      flushOfflineCache(); // write the previous world's last edits before its doc goes
      prevDoc?.destroy();

      const doc = new Y.Doc();
      const cached = loadWorldDoc(worldId);
      if (cached) {
        Y.applyUpdate(doc, cached, "remote");
      }
      // Cold offline entry (world not synced yet): show the Universe entry's name/colour until the doc syncs.
      // Never write it into the doc: local writes tagged "remote" are never sent, and every later write from
      // this client builds on them, so the server would hold all of them as pending forever (found 2026-10-28).
      const entry = get().worlds.get(worldId);
      const fallbackMeta = entry
        ? {
            name: entry.name,
            creator: entry.creator,
            createdAt: entry.createdAt,
            color: entry.color,
            solidified: entry.solidified,
            ...(entry.parentWorldId ? { parentWorldId: entry.parentWorldId } : {}),
            ...(entry.allowPortals !== undefined ? { allowPortals: entry.allowPortals } : {}),
          }
        : null;
      wireWorldDoc(worldId, doc, get);
      set({ activeWorldId: worldId, activeWorldDoc: doc });
      useWorldStore.getState().loadFromDoc(doc, fallbackMeta);
    },

    exitWorld: (toSpace = false) => {
      const curId = get().activeWorldId;
      const curWorld = curId ? get().worlds.get(curId) : undefined;
      const parentId =
        !toSpace && curId
          ? (curWorld?.parentWorldId ?? useWorldStore.getState().meta?.parentWorldId)
          : undefined;
      if (parentId) {
        // Physically linked portal: emerge in the parent world right in front of this child world's portal
        if (curWorld) {
          interiorController.restoreOnNextReset({
            x: curWorld.resolvedPosition.x,
            y: Math.max(0, curWorld.resolvedPosition.y),
            z: curWorld.resolvedPosition.z + 2.6,
            fx: 0,
            fz: -1,
            pitch: 0,
            vx: 0,
            vy: 0,
            vz: 0,
          });
        }
        get().enterWorld(parentId);
        return;
      }
      const doc = get().activeWorldDoc;
      flushOfflineCache();
      doc?.destroy();
      useWorldStore.getState().reset();
      set({ activeWorldId: null, activeWorldDoc: null });
    },

    setConnected: (connected) => set({ connected }),

    setWorldDocUpdateHandler: (handler) => set({ _worldDocUpdateHandler: handler }),
  };
});

// Dev only (tree-shaken from prod): lets local verify scripts reach the live world doc
if (import.meta.env.DEV) {
  ;(window as unknown as { awebornUniverse: unknown }).awebornUniverse = useUniverseStore
}
