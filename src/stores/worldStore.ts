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
import { progress } from "./progressStore";
import { cleanColor } from "@aweborn/shared/library";
import { coCreatorsField } from "@aweborn/shared/world-policy";
import { TERRAIN_EDITS_MAP, TERRAIN_EDIT_LIMITS, editKey, terrainShapeKey } from "@aweborn/shared/terrain-edits";
import { changeTerrainEdits, resetTerrainEdits, terrainCellAt } from "./worldVoxels";

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

  /** Load world state from a Y.Doc (`fallbackMeta`: shown until the doc has synced its own) */
  loadFromDoc: (doc: Y.Doc, fallbackMeta?: WorldMeta | null) => void;

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


  /** Update physics parameters */
  updatePhysics: (doc: Y.Doc, params: Partial<PhysicsParams>) => void;

  /** Reset store state (on world exit) */
  reset: () => void;
}

function readMeta(doc: Y.Doc): WorldMeta | null {
  const meta = doc.getMap("meta");
  const name = meta.get("name") as string | undefined;
  if (!name) return null;
  const parentWorldId = meta.get("parentWorldId") as string | undefined;
  const allowPortals = meta.get("allowPortals") as boolean | undefined;
  const ambientSound = meta.get("ambientSound") as string | undefined;
  return {
    name,
    creator: (meta.get("creator") as string) ?? "",
    createdAt: (meta.get("createdAt") as number) ?? 0,
    color: (meta.get("color") as string) ?? "#ffffff",
    solidified: (meta.get("solidified") as boolean) ?? false,
    ...(parentWorldId ? { parentWorldId } : {}),
    ...(allowPortals !== undefined ? { allowPortals } : {}),
    ...(typeof ambientSound === "string" && /^[a-f0-9]{64}\.(mp3|wav)$/.test(ambientSound) ? { ambientSound } : {}),
    ...coCreatorsField(meta.get("coCreators")),
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
      color: (m.get("color") as string) ?? undefined,
      placedBy: (m.get("placedBy") as string) ?? "",
      placedAt: (m.get("placedAt") as number) ?? 0,
      kick: (m.get("kick") as PlacedObject["kick"]) ?? undefined,
      nudge: (m.get("nudge") as PlacedObject["nudge"]) ?? undefined,
      asset: (m.get("asset") as string) ?? undefined,
      prompt: (m.get("prompt") as string) ?? undefined,
      planKey: (m.get("planKey") as string) ?? undefined,
      media: (m.get("media") as PlacedObject["media"]) ?? undefined,
      loop: (m.get("loop") as boolean) ?? undefined,
      volume: (m.get("volume") as number) ?? undefined,
      text: (m.get("text") as string) ?? undefined,
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

/**
 * Manifest the terrain (and its sky): every client regenerates the same grid (shared/voxel.ts).
 * Clears dig/fill edits when the ground's shape changes (they belong to the old ground); a change
 * to how blocks are drawn only (smooth ↔ blocks, M5e) keeps them.
 */
export function setVoxelTerrain(doc: Y.Doc, terrain: VoxelTerrain, sky?: BlueprintSky | null): void {
  doc.transact(() => {
    const m = doc.getMap("terrain");
    const before = m.get("voxel");
    const next = JSON.stringify(terrain);
    m.set("voxel", next);
    if (sky) m.set("sky", JSON.stringify(sky));
    else m.delete("sky");
    if (before !== next && !sameShape(before, terrain)) doc.getMap(TERRAIN_EDITS_MAP).clear();
  });
}

function sameShape(before: unknown, next: VoxelTerrain): boolean {
  if (typeof before !== "string") return false;
  try {
    return terrainShapeKey(JSON.parse(before) as VoxelTerrain) === terrainShapeKey(next);
  } catch {
    return false;
  }
}

/** Draw one solid block smooth or as blocks (owners; M5e). Same cells, so edits stay. */
export function setBlockSurface(doc: Y.Doc, terrain: VoxelTerrain, sky: BlueprintSky | null, blockId: string, smooth: boolean): void {
  const blocks = terrain.blocks.map((b) => {
    if (b.id !== blockId) return b;
    const { surface: _surface, ...rest } = b;
    return smooth ? { ...rest, surface: "smooth" as const } : rest;
  });
  setVoxelTerrain(doc, { ...terrain, blocks }, sky);
}

/**
 * Dig or fill one terrain cell (Rough Draft M5d): `v` 0 = air, n = blocks[n - 1].
 * Setting a cell back to what the generator made deletes its edit. Owners only
 * (the server reverts anyone else). False if the world's edit cap is reached.
 */
export function editTerrainCell(doc: Y.Doc, t: VoxelTerrain, gi: number, j: number, gk: number, v: number): boolean {
  if (j < 1 || j >= t.size[1] || gi < 0 || gk < 0 || gi >= t.size[0] || gk >= t.size[2]) return false;
  const map = doc.getMap(TERRAIN_EDITS_MAP);
  const key = editKey(gi, j, gk);
  if (v === terrainCellAt(t, gi, j, gk, false)) {
    if (map.has(key)) map.delete(key);
    return true;
  }
  if (!map.has(key) && map.size >= TERRAIN_EDIT_LIMITS.maxEdits) return false;
  map.set(key, v);
  return true;
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

  loadFromDoc: (doc, fallbackMeta = null) => {
    const edits = doc.getMap(TERRAIN_EDITS_MAP);
    const voxelTerrain = readVoxelTerrain(doc);
    // The edit overlay first, so the first frame already shows the dug/filled ground
    resetTerrainEdits(voxelTerrain, edits.entries());
    // Read initial state
    set({
      meta: readMeta(doc) ?? fallbackMeta,
      physics: readPhysics(doc),
      objects: readObjects(doc),
      chat: readChat(doc),
      terrainSeed: (doc.getMap("terrain").get("seed") as number) ?? 0,
      voxelTerrain,
      sky: readSky(doc),
      loaded: true,
    });

    // Observe changes
    doc.getMap("meta").observeDeep(() => set({ meta: readMeta(doc) ?? fallbackMeta }));
    doc.getMap("physics").observeDeep(() => set({ physics: readPhysics(doc) }));
    doc.getMap("objects").observeDeep(() => set({ objects: readObjects(doc) }));
    doc.getArray("chat").observe(() => set({ chat: readChat(doc) }));
    doc.getMap("terrain").observe((ev) => {
      const t = readVoxelTerrain(doc);
      if (ev.keysChanged.has("voxel")) resetTerrainEdits(t, edits.entries());
      set({ voxelTerrain: t, sky: readSky(doc) });
    });
    // Dig/fill (M5d): only the changed cells, never the whole map
    edits.observe((ev) => {
      changeTerrainEdits([...ev.keysChanged].map((k) => [k, edits.get(k)] as [string, unknown]));
    });
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

  updatePhysics: (doc, params) => {
    const physics = doc.getMap("physics");
    doc.transact(() => {
      for (const [key, value] of Object.entries(params)) {
        physics.set(key, value);
      }
    });
  },

  reset: () => {
    resetTerrainEdits(null);
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
  if (!opts.planKey) progress.use("place");
  return id;
}

/**
 * Place a picture, a sounding orb or a lore sign (Rough Draft M5). `rotY`
 * turns a picture/sign to face the player who placed it.
 */
export function placeMedia(
  doc: Y.Doc,
  item:
    | { type: "picture"; asset: string; prompt: string }
    | { type: "sound"; asset: string; prompt: string; media: "sound" | "music" | "voice"; loop: boolean }
    | { type: "sign"; text: string; prompt: string },
  position: { x: number; y: number; z: number },
  placedBy: string,
  rotY = 0,
): string {
  const id = `obj-${Math.random().toString(36).slice(2, 8)}`;
  doc.transact(() => {
    const m = new Y.Map();
    m.set("id", id);
    m.set("type", item.type);
    m.set("x", position.x);
    m.set("y", position.y);
    m.set("z", position.z);
    m.set("rotX", 0);
    m.set("rotY", rotY);
    m.set("rotZ", 0);
    m.set("scaleX", 1);
    m.set("scaleY", 1);
    m.set("scaleZ", 1);
    m.set("material", "default");
    m.set("placedBy", placedBy);
    m.set("placedAt", Date.now());
    m.set("prompt", item.prompt.slice(0, 600));
    if (item.type !== "sign") m.set("asset", item.asset);
    if (item.type === "sound") {
      m.set("media", item.media);
      m.set("loop", item.loop);
      m.set("volume", 0.8);
    }
    if (item.type === "sign") m.set("text", item.text.slice(0, 700));
    doc.getMap("objects").set(id, m);
  });
  progress.use("place");
  return id;
}

/** The world's own sound (creators and co-creators only; the server reverts anyone else). Null clears it. */
export function setWorldSound(doc: Y.Doc, asset: string | null): void {
  const meta = doc.getMap("meta");
  if (asset) meta.set("ambientSound", asset);
  else meta.delete("ambientSound");
}

/**
 * Place a Library item (a block or a basic shape) in the world CRDT. Free: no
 * server involved, so it works offline and syncs when the connection is back.
 */
function placeLibraryItem(
  doc: Y.Doc,
  item: { type: string; material: string; label: string; color: string; scale: number; rotY?: number },
  position: { x: number; y: number; z: number },
  placedBy: string,
): string {
  const id = `obj-${Math.random().toString(36).slice(2, 8)}`;
  doc.transact(() => {
    const m = new Y.Map();
    m.set("id", id);
    m.set("type", item.type);
    m.set("x", position.x);
    m.set("y", position.y);
    m.set("z", position.z);
    m.set("rotX", 0);
    m.set("rotY", item.rotY ?? 0);
    m.set("rotZ", 0);
    m.set("scaleX", item.scale);
    m.set("scaleY", item.scale);
    m.set("scaleZ", item.scale);
    m.set("material", item.material);
    m.set("color", cleanColor(item.color));
    m.set("placedBy", placedBy);
    m.set("placedAt", Date.now());
    m.set("prompt", item.label.slice(0, 60));
    doc.getMap("objects").set(id, m);
  });
  progress.use("place");
  return id;
}

/** A unit block (terrain-style) at a cell center. */
export function placeBlock(
  doc: Y.Doc,
  block: { id: string; name: string; color: string },
  position: { x: number; y: number; z: number },
  placedBy: string,
): string {
  return placeLibraryItem(doc, { type: "block", material: block.id, label: block.name, color: block.color, scale: 1 }, position, placedBy);
}

/** A basic shape (cube, sphere, cone, ring …) in any color and size. */
export function placeShape(
  doc: Y.Doc,
  shape: { id: string; name: string },
  opts: { color: string; size: number },
  position: { x: number; y: number; z: number },
  placedBy: string,
  rotY = 0,
): string {
  return placeLibraryItem(doc, { type: shape.id, material: "default", label: shape.name, color: opts.color, scale: opts.size, rotY }, position, placedBy);
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

/** Recolor a placed shape or block in the world CRDT. */
export function recolorObject(doc: Y.Doc, objectId: string, color: string): void {
  const m = doc.getMap("objects").get(objectId) as Y.Map<unknown> | undefined;
  if (!m) return;
  doc.transact(() => {
    m.set("color", cleanColor(color));
  });
}

/** Duplicate a placed object at the given position/rotation/scale (keeps the original held). */
export function duplicateObject(
  doc: Y.Doc,
  sourceId: string,
  pos: { x: number; y: number; z: number },
  rotY: number,
  scale: { x: number; y: number; z: number },
  placedBy: string,
): string | null {
  const src = doc.getMap("objects").get(sourceId) as Y.Map<unknown> | undefined;
  if (!src) return null;
  const id = `obj-${Math.random().toString(36).slice(2, 8)}`;
  doc.transact(() => {
    const m = new Y.Map();
    src.forEach((v, k) => {
      if (k === "kick" || k === "planKey" || k === "nudge") return;
      m.set(k, v);
    });
    m.set("id", id);
    m.set("x", pos.x);
    m.set("y", pos.y);
    m.set("z", pos.z);
    m.set("rotY", rotY);
    m.set("scaleX", scale.x);
    m.set("scaleY", scale.y);
    m.set("scaleZ", scale.z);
    if (placedBy) m.set("placedBy", placedBy);
    m.set("placedAt", Date.now());
    doc.getMap("objects").set(id, m);
  });
  return id;
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
