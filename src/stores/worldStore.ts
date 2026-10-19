/**
 * Aweborn — World Store
 *
 * Zustand store for the currently active World CRDT (Layer 2).
 * Provides reactive access to world meta, physics, objects, terrain,
 * and chat — all backed by the Y.Doc synced with the server.
 *
 * This store is only active when the player has entered a world.
 */

import type { BlueprintDraft, BlueprintSky } from '@aweborn/shared/blueprint';
import { create } from "zustand";
import * as Y from "yjs";
import type {
  WorldMeta,
  PhysicsParams,
  PlacedObject,
  ChatMessage,
} from "@aweborn/shared/crdt-schema";
import { DEFAULT_PHYSICS } from "@aweborn/shared/crdt-schema";

interface WorldState {
  /** World metadata */
  meta: WorldMeta | null;

  /** Physics parameters for this world */
  physics: PhysicsParams;

  /** All placed objects in the world */
  objects: Map<string, PlacedObject>;

  /** Chat messages */
  chat: ChatMessage[];

  /** Terrain seed */
  terrainSeed: number;

  /** Manifested voxel terrain params (Phase 07); everyone regenerates the same grid from them */
  voxelTerrain: VoxelTerrain | null;
  /** Shaped sky/lighting (null = the daylight default) */
  sky: BlueprintSky | null;

  /** Whether the world doc is loaded and synced */
  loaded: boolean;

  // ── Actions ──

  /** Load world state from a Y.Doc */
  loadFromDoc: (doc: Y.Doc) => void;

  /** Place a new object in the world */
  placeObject: (
    doc: Y.Doc,
    type: string,
    position: { x: number; y: number; z: number },
    rotation?: { x: number; y: number; z: number },
    scale?: { x: number; y: number; z: number },
    material?: string
  ) => string;

  /** Remove an object from the world */
  removeObject: (doc: Y.Doc, objectId: string) => void;

  /** Send a chat message */
  sendChat: (doc: Y.Doc, sender: string, text: string) => void;

  /** Update physics parameters */
  updatePhysics: (doc: Y.Doc, params: Partial<PhysicsParams>) => void;

  /** Reset store state (on world exit) */
  reset: () => void;
}

function readMeta(doc: Y.Doc): WorldMeta | null {
  const meta = doc.getMap("meta");
  const name = meta.get("name") as string | undefined;
  if (!name) return null;
  return {
    name,
    creator: (meta.get("creator") as string) ?? "",
    createdAt: (meta.get("createdAt") as number) ?? 0,
    color: (meta.get("color") as string) ?? "#ffffff",
    solidified: (meta.get("solidified") as boolean) ?? false,
  };
}

function readPhysics(doc: Y.Doc): PhysicsParams {
  const physics = doc.getMap("physics");
  return {
    gravityX: (physics.get("gravityX") as number) ?? DEFAULT_PHYSICS.gravityX,
    gravityY: (physics.get("gravityY") as number) ?? DEFAULT_PHYSICS.gravityY,
    gravityZ: (physics.get("gravityZ") as number) ?? DEFAULT_PHYSICS.gravityZ,
    friction: (physics.get("friction") as number) ?? DEFAULT_PHYSICS.friction,
    airResistance: (physics.get("airResistance") as number) ?? DEFAULT_PHYSICS.airResistance,
    bounceCoefficient: (physics.get("bounceCoefficient") as number) ?? DEFAULT_PHYSICS.bounceCoefficient,
    waterLevel: (physics.get("waterLevel") as number) ?? DEFAULT_PHYSICS.waterLevel,
  };
}

function readObjects(doc: Y.Doc): Map<string, PlacedObject> {
  const objects = new Map<string, PlacedObject>();
  const objectsMap = doc.getMap("objects");
  objectsMap.forEach((value, key) => {
    const m = value as Y.Map<unknown>;
    objects.set(key, {
      id: (m.get("id") as string) ?? key,
      type: (m.get("type") as string) ?? "cube",
      x: (m.get("x") as number) ?? 0,
      y: (m.get("y") as number) ?? 0,
      z: (m.get("z") as number) ?? 0,
      rotX: (m.get("rotX") as number) ?? 0,
      rotY: (m.get("rotY") as number) ?? 0,
      rotZ: (m.get("rotZ") as number) ?? 0,
      scaleX: (m.get("scaleX") as number) ?? 1,
      scaleY: (m.get("scaleY") as number) ?? 1,
      scaleZ: (m.get("scaleZ") as number) ?? 1,
      material: (m.get("material") as string) ?? "default",
      placedBy: (m.get("placedBy") as string) ?? "",
      placedAt: (m.get("placedAt") as number) ?? 0,
      kick: (m.get("kick") as PlacedObject["kick"]) ?? undefined,
      asset: (m.get("asset") as string) ?? undefined,
      prompt: (m.get("prompt") as string) ?? undefined,
      planKey: (m.get("planKey") as string) ?? undefined,
    });
  });
  return objects;
}

type VoxelTerrain = BlueprintDraft["terrain"];

/** Stored as a JSON string so concurrent writes replace it whole (last writer wins). */
function readVoxelTerrain(doc: Y.Doc): VoxelTerrain | null {
  const raw = doc.getMap("terrain").get("voxel");
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as VoxelTerrain;
  } catch {
    return null;
  }
}

function readSky(doc: Y.Doc): BlueprintSky | null {
  const raw = doc.getMap("terrain").get("sky");
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as BlueprintSky;
  } catch {
    return null;
  }
}

/** Manifest the terrain (and its sky): every client regenerates the same grid (shared/voxel.ts). */
export function setVoxelTerrain(doc: Y.Doc, terrain: VoxelTerrain, sky?: BlueprintSky | null): void {
  doc.transact(() => {
    const m = doc.getMap("terrain");
    m.set("voxel", JSON.stringify(terrain));
    if (sky) m.set("sky", JSON.stringify(sky));
    else m.delete("sky");
  });
}

function readChat(doc: Y.Doc): ChatMessage[] {
  const chat = doc.getArray("chat");
  const messages: ChatMessage[] = [];
  for (let i = 0; i < chat.length; i++) {
    const msg = chat.get(i) as Record<string, unknown>;
    messages.push({
      sender: (msg.sender as string) ?? "",
      text: (msg.text as string) ?? "",
      t: (msg.t as number) ?? 0,
    });
  }
  return messages;
}

export const useWorldStore = create<WorldState>((set, _get) => ({
  meta: null,
  physics: { ...DEFAULT_PHYSICS },
  objects: new Map(),
  chat: [],
  terrainSeed: 0,
  voxelTerrain: null,
  sky: null,
  loaded: false,

  loadFromDoc: (doc) => {
    // Read initial state
    set({
      meta: readMeta(doc),
      physics: readPhysics(doc),
      objects: readObjects(doc),
      chat: readChat(doc),
      terrainSeed: (doc.getMap("terrain").get("seed") as number) ?? 0,
      voxelTerrain: readVoxelTerrain(doc),
      sky: readSky(doc),
      loaded: true,
    });

    // Observe changes
    doc.getMap("meta").observeDeep(() => set({ meta: readMeta(doc) }));
    doc.getMap("physics").observeDeep(() => set({ physics: readPhysics(doc) }));
    doc.getMap("objects").observeDeep(() => set({ objects: readObjects(doc) }));
    doc.getArray("chat").observe(() => set({ chat: readChat(doc) }));
    doc.getMap("terrain").observe(() => set({ voxelTerrain: readVoxelTerrain(doc), sky: readSky(doc) }));
  },

  placeObject: (doc, type, position, rotation, scale, material) => {
    const id = `obj-${Math.random().toString(36).slice(2, 8)}`;
    const objectsMap = doc.getMap("objects");

    doc.transact(() => {
      const objMap = new Y.Map();
      objMap.set("id", id);
      objMap.set("type", type);
      objMap.set("x", position.x);
      objMap.set("y", position.y);
      objMap.set("z", position.z);
      objMap.set("rotX", rotation?.x ?? 0);
      objMap.set("rotY", rotation?.y ?? 0);
      objMap.set("rotZ", rotation?.z ?? 0);
      objMap.set("scaleX", scale?.x ?? 1);
      objMap.set("scaleY", scale?.y ?? 1);
      objMap.set("scaleZ", scale?.z ?? 1);
      objMap.set("material", material ?? "default");
      objMap.set("placedBy", "");  // Will be set by caller
      objMap.set("placedAt", Date.now());
      objectsMap.set(id, objMap);
    });

    return id;
  },

  removeObject: (doc, objectId) => {
    doc.getMap("objects").delete(objectId);
  },

  sendChat: (doc, sender, text) => {
    doc.getArray("chat").push([{ sender, text, t: Date.now() }]);
  },

  updatePhysics: (doc, params) => {
    const physics = doc.getMap("physics");
    doc.transact(() => {
      for (const [key, value] of Object.entries(params)) {
        physics.set(key, value);
      }
    });
  },

  reset: () => {
    set({ voxelTerrain: null, sky: null,
      meta: null,
      physics: { ...DEFAULT_PHYSICS },
      objects: new Map(),
      chat: [],
      terrainSeed: 0,
      loaded: false,
    });
  },
}));

// ── Event-sourced physics (Phase 07): 2 CRDT writes per kick ─────────

/** Start a kick: every client simulates the flight from the object's x/y/z. */
export function kickObject(doc: Y.Doc, objectId: string, v: { vx: number; vy: number; vz: number }): void {
  const m = doc.getMap("objects").get(objectId) as Y.Map<unknown> | undefined;
  if (!m || m.get("kick")) return; // already flying
  m.set("kick", { ...v, t: Date.now() });
}

/** Settle a kick: write the landing spot and clear it. Idempotent (same result on every client). */
export function settleObject(doc: Y.Doc, objectId: string, pos: { x: number; y: number; z: number }): void {
  const m = doc.getMap("objects").get(objectId) as Y.Map<unknown> | undefined;
  if (!m || !m.get("kick")) return;
  doc.transact(() => {
    m.set("x", pos.x);
    m.set("y", pos.y);
    m.set("z", pos.z);
    m.delete("kick");
  });
}

/** Place a generated model (Phase 07) in the world CRDT. */
export function placeModel(
  doc: Y.Doc,
  asset: string,
  prompt: string,
  position: { x: number; y: number; z: number },
  placedBy: string,
  opts: { scale?: number; rotY?: number; planKey?: string } = {},
): string {
  const id = `obj-${Math.random().toString(36).slice(2, 8)}`;
  doc.transact(() => {
    const m = new Y.Map();
    m.set("id", id);
    m.set("type", "model");
    m.set("x", position.x);
    m.set("y", position.y);
    m.set("z", position.z);
    m.set("rotX", 0);
    m.set("rotY", opts.rotY ?? 0);
    m.set("rotZ", 0);
    m.set("scaleX", opts.scale ?? 1);
    m.set("scaleY", opts.scale ?? 1);
    m.set("scaleZ", opts.scale ?? 1);
    m.set("material", "default");
    m.set("placedBy", placedBy);
    if (opts.planKey) m.set("planKey", opts.planKey);
    m.set("placedAt", Date.now());
    m.set("asset", asset);
    m.set("prompt", prompt.slice(0, 600));
    doc.getMap("objects").set(id, m);
  });
  return id;
}

/** Move/rotate a placed object (grab, Phase 07). Clears any kick in flight. */
export function moveObject(doc: Y.Doc, objectId: string, pos: { x: number; y: number; z: number }, rotY: number, scale?: { x: number; y: number; z: number }): void {
  const m = doc.getMap("objects").get(objectId) as Y.Map<unknown> | undefined;
  if (!m) return;
  doc.transact(() => {
    m.set("x", pos.x);
    m.set("y", pos.y);
    m.set("z", pos.z);
    m.set("rotY", rotY);
    if (scale) {
      m.set("scaleX", scale.x);
      m.set("scaleY", scale.y);
      m.set("scaleZ", scale.z);
    }
    if (m.has("kick")) m.delete("kick");
  });
}

/** Replace a placed model's file in place (redo an item): keeps where it stands and how it's turned. */
export function replaceModelAsset(doc: Y.Doc, objectId: string, asset: string, prompt: string): void {
  const m = doc.getMap("objects").get(objectId) as Y.Map<unknown> | undefined;
  if (!m) return;
  doc.transact(() => {
    m.set("asset", asset);
    m.set("prompt", prompt.slice(0, 600));
  });
}
