/**
 * Aweborn — Room Manager
 *
 * Manages WebSocket rooms for the two-layer CRDT architecture:
 * - Universe room: clients subscribe to sector-based sub-rooms
 * - World rooms: clients join when entering a world, leave on exit
 *
 * Handles lazy loading/unloading of World Y.Docs, periodic flushing
 * to SQLite, and integration with the spatial resolver.
 */

import * as Y from "yjs";
import type { WebSocket } from "ws";
import type { WorldEntry, Vec3 } from "../../../shared/crdt-schema.js";
import {
  positionToSector,
  sectorKey,
} from "../../../shared/crdt-schema.js";
import {
  initUniverseDoc,
  flushUniverseDoc,
  addWorldToUniverse,
  getAllWorldEntries,
  updatePlayerCount,
  updateResolvedPosition,
} from "./universe.js";
import { saveDoc, loadDoc, listDocIds } from "./persistence.js";
import { createWorldDoc } from "./world-factory.js";
import { resolveNewWorld } from "./resolver.js";

const FLUSH_INTERVAL_MS = 60_000; // 60 seconds

interface WorldRoom {
  doc: Y.Doc;
  clients: Set<WebSocket>;
  lastFlush: number;
}

interface UniverseClient {
  ws: WebSocket;
  /** Sector keys this client is subscribed to */
  sectors: Set<string>;
}

export class RoomManager {
  /** The Universe Y.Doc — always in memory */
  readonly universeDoc: Y.Doc;

  /** Per-world Y.Docs — loaded on demand */
  private worldRooms = new Map<string, WorldRoom>();

  /** Universe room clients */
  private universeClients = new Map<WebSocket, UniverseClient>();

  /** Flush interval handle */
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.universeDoc = initUniverseDoc();
    this.startFlushTimer();

    // When the universe doc changes, broadcast updates to subscribed clients
    this.universeDoc.on("update", (update: Uint8Array, _origin: unknown) => {
      this.broadcastUniverseUpdate(update);
    });

    console.log("[rooms] room manager initialized");
  }

  // ── Universe Room ────────────────────────────────────────────────

  /**
   * Client joins the universe room, subscribing to specific sectors.
   */
  joinUniverse(ws: WebSocket, sectorKeys: string[]): void {
    const client: UniverseClient = {
      ws,
      sectors: new Set(sectorKeys),
    };
    this.universeClients.set(ws, client);

    // Send current universe state to the new client
    const state = Y.encodeStateAsUpdate(this.universeDoc);
    ws.send(this.encodeMessage("universe-sync", state));

    console.log(`[rooms] client joined universe (${sectorKeys.length} sectors)`);
  }

  /**
   * Update a universe client's sector subscriptions (e.g., as they move).
   */
  updateSectors(ws: WebSocket, sectorKeys: string[]): void {
    const client = this.universeClients.get(ws);
    if (client) {
      client.sectors = new Set(sectorKeys);
    }
  }

  /**
   * Client leaves the universe room.
   */
  leaveUniverse(ws: WebSocket): void {
    this.universeClients.delete(ws);
  }

  // ── World Rooms ──────────────────────────────────────────────────

  /**
   * Client enters a world. Lazy-loads the world doc from SQLite if
   * it's not already in memory.
   */
  joinWorld(ws: WebSocket, worldId: string): Y.Doc | null {
    let room = this.worldRooms.get(worldId);

    if (!room) {
      // Lazy load from SQLite
      const doc = new Y.Doc();
      const saved = loadDoc(worldId);
      if (saved) {
        Y.applyUpdate(doc, saved);
        console.log(`[rooms] loaded world "${worldId}" from database`);
      } else {
        // World doc doesn't exist in DB — it might be a newly created world
        // that hasn't been saved yet, or an invalid worldId
        const entry = this.getWorldEntry(worldId);
        if (!entry) {
          console.warn(`[rooms] world "${worldId}" not found in universe`);
          return null;
        }
        // Create a fresh world doc from the entry
        const newDoc = createWorldDoc(entry);
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(newDoc));
        newDoc.destroy();
        console.log(`[rooms] created new world doc for "${worldId}"`);
      }

      room = {
        doc,
        clients: new Set(),
        lastFlush: Date.now(),
      };
      this.worldRooms.set(worldId, room);

      // Broadcast world doc updates to all clients in the room
      doc.on("update", (update: Uint8Array, origin: unknown) => {
        this.broadcastWorldUpdate(worldId, update, origin);
      });
    }

    room.clients.add(ws);

    // Update player count in universe
    updatePlayerCount(this.universeDoc, worldId, room.clients.size);

    // Send current world state to the new client
    const state = Y.encodeStateAsUpdate(room.doc);
    ws.send(this.encodeMessage("world-sync", state, worldId));

    console.log(`[rooms] client joined world "${worldId}" (${room.clients.size} players)`);
    return room.doc;
  }

  /**
   * Client leaves a world. If it's the last client, flush to SQLite
   * and unload the doc from memory.
   */
  leaveWorld(ws: WebSocket, worldId: string): void {
    const room = this.worldRooms.get(worldId);
    if (!room) return;

    room.clients.delete(ws);

    // Update player count
    updatePlayerCount(this.universeDoc, worldId, room.clients.size);

    if (room.clients.size === 0) {
      // Last player left — flush and unload
      this.flushWorldDoc(worldId, room);
      room.doc.destroy();
      this.worldRooms.delete(worldId);
      console.log(`[rooms] unloaded world "${worldId}" (no players)`);
    }
  }

  // ── World Creation ───────────────────────────────────────────────

  /**
   * Create a new world at the given position.
   * Runs the spatial resolver and adds to the Universe CRDT.
   */
  createWorld(
    name: string,
    creator: string,
    intendedPosition: Vec3,
    color: string
  ): WorldEntry {
    const id = generateWorldId();
    const now = Date.now();
    const sector = sectorKey(positionToSector(intendedPosition));

    const entry: WorldEntry = {
      id,
      name,
      creator,
      intendedPosition,
      resolvedPosition: { ...intendedPosition },
      resolvedAt: 0,
      color,
      sector,
      solidified: false,
      solidifiedAt: 0,
      playerCount: 0,
      lastActive: now,
      createdAt: now,
    };

    // Run spatial resolver
    const existingWorlds = getAllWorldEntries(this.universeDoc);
    const resolvedPos = resolveNewWorld(existingWorlds, entry);
    entry.resolvedPosition = resolvedPos;
    entry.resolvedAt = now;
    entry.sector = sectorKey(positionToSector(resolvedPos));

    // Add to Universe CRDT
    addWorldToUniverse(this.universeDoc, entry);

    // Create and persist the world doc
    const worldDoc = createWorldDoc(entry);
    const state = Y.encodeStateAsUpdate(worldDoc);
    saveDoc(id, state, "world", entry.sector);
    worldDoc.destroy();

    console.log(`[rooms] created world "${name}" (${id}) at resolved position (${resolvedPos.x.toFixed(1)}, ${resolvedPos.y.toFixed(1)}, ${resolvedPos.z.toFixed(1)})`);
    return entry;
  }

  // ── Client Message Handling ──────────────────────────────────────

  /**
   * Handle an incoming message from a client.
   */
  handleMessage(ws: WebSocket, data: Buffer | ArrayBuffer | Buffer[]): void {
    try {
      const message = this.decodeMessage(data);
      if (!message) return;

      switch (message.type) {
        case "universe-update": {
          // Client sent a CRDT update for the universe
          Y.applyUpdate(this.universeDoc, message.data, ws);
          break;
        }
        case "world-update": {
          // Client sent a CRDT update for a specific world
          const room = message.worldId ? this.worldRooms.get(message.worldId) : null;
          if (room) {
            Y.applyUpdate(room.doc, message.data, ws);
          }
          break;
        }
        case "create-world": {
          // Client wants to create a world
          const payload = JSON.parse(new TextDecoder().decode(message.data)) as {
            name: string;
            creator: string;
            position: Vec3;
            color: string;
          };
          this.createWorld(payload.name, payload.creator, payload.position, payload.color);
          break;
        }
        case "update-sectors": {
          // Client is updating their sector subscriptions
          const sectors = JSON.parse(new TextDecoder().decode(message.data)) as string[];
          this.updateSectors(ws, sectors);
          break;
        }
        case "join-world": {
          // Client wants to enter a world (multiplexed over universe connection)
          if (message.worldId) {
            const doc = this.joinWorld(ws, message.worldId);
            if (!doc) {
              console.warn(`[rooms] join-world failed: world "${message.worldId}" not found`);
            }
          }
          break;
        }
        case "leave-world": {
          // Client wants to leave a world
          if (message.worldId) {
            this.leaveWorld(ws, message.worldId);
          }
          break;
        }
        default:
          console.warn(`[rooms] unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error("[rooms] error handling message:", err);
    }
  }

  /**
   * Handle a client disconnecting.
   */
  handleDisconnect(ws: WebSocket): void {
    // Remove from universe
    this.leaveUniverse(ws);

    // Remove from all world rooms
    for (const [worldId, room] of this.worldRooms.entries()) {
      if (room.clients.has(ws)) {
        this.leaveWorld(ws, worldId);
      }
    }
  }

  // ── Flush / Shutdown ─────────────────────────────────────────────

  /**
   * Flush all active world docs and the universe doc to SQLite.
   */
  flushAll(): void {
    let flushed = 0;

    // Flush universe
    flushUniverseDoc(this.universeDoc);

    // Flush active worlds
    for (const [worldId, room] of this.worldRooms.entries()) {
      this.flushWorldDoc(worldId, room);
      flushed++;
    }

    if (flushed > 0) {
      console.log(`[rooms] periodic flush: ${flushed} world docs + universe`);
    }
  }

  /**
   * Graceful shutdown: flush everything and clean up.
   */
  shutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    this.flushAll();

    // Destroy all docs
    for (const [, room] of this.worldRooms) {
      room.doc.destroy();
    }
    this.worldRooms.clear();
    this.universeDoc.destroy();

    console.log("[rooms] shutdown complete");
  }

  /**
   * Get stats for the /stats endpoint.
   */
  getStats(): {
    universeClients: number;
    activeWorlds: number;
    worldDetails: Array<{ id: string; players: number }>;
  } {
    const worldDetails: Array<{ id: string; players: number }> = [];
    for (const [id, room] of this.worldRooms) {
      worldDetails.push({ id, players: room.clients.size });
    }

    return {
      universeClients: this.universeClients.size,
      activeWorlds: this.worldRooms.size,
      worldDetails,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private getWorldEntry(worldId: string): WorldEntry | null {
    const worlds = this.universeDoc.getMap("worlds");
    const worldMap = worlds.get(worldId) as Y.Map<unknown> | undefined;
    if (!worldMap) return null;
    // Reconstruct from flat map (same logic as universe.ts)
    return {
      id: worldMap.get("id") as string,
      name: worldMap.get("name") as string,
      creator: worldMap.get("creator") as string,
      intendedPosition: {
        x: worldMap.get("intendedPosition.x") as number,
        y: worldMap.get("intendedPosition.y") as number,
        z: worldMap.get("intendedPosition.z") as number,
      },
      resolvedPosition: {
        x: worldMap.get("resolvedPosition.x") as number,
        y: worldMap.get("resolvedPosition.y") as number,
        z: worldMap.get("resolvedPosition.z") as number,
      },
      resolvedAt: worldMap.get("resolvedAt") as number,
      color: worldMap.get("color") as string,
      sector: worldMap.get("sector") as string,
      solidified: worldMap.get("solidified") as boolean,
      solidifiedAt: worldMap.get("solidifiedAt") as number,
      playerCount: worldMap.get("playerCount") as number,
      lastActive: worldMap.get("lastActive") as number,
      createdAt: worldMap.get("createdAt") as number,
    };
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushAll();
    }, FLUSH_INTERVAL_MS);
  }

  private flushWorldDoc(worldId: string, room: WorldRoom): void {
    const state = Y.encodeStateAsUpdate(room.doc);
    const entry = this.getWorldEntry(worldId);
    saveDoc(worldId, state, "world", entry?.sector);
    room.lastFlush = Date.now();
  }

  /**
   * Broadcast a universe update to all subscribed clients.
   */
  private broadcastUniverseUpdate(update: Uint8Array): void {
    const msg = this.encodeMessage("universe-update", update);
    for (const [, client] of this.universeClients) {
      if (client.ws.readyState === 1) {
        // OPEN
        client.ws.send(msg);
      }
    }
  }

  /**
   * Broadcast a world update to all clients in that world room.
   */
  private broadcastWorldUpdate(
    worldId: string,
    update: Uint8Array,
    origin: unknown
  ): void {
    const room = this.worldRooms.get(worldId);
    if (!room) return;

    const msg = this.encodeMessage("world-update", update, worldId);
    for (const client of room.clients) {
      // Don't echo back to the sender
      if (client !== origin && client.readyState === 1) {
        client.send(msg);
      }
    }
  }

  // ── Wire Protocol ────────────────────────────────────────────────
  //
  // Simple binary protocol:
  //   [1 byte: type] [2 bytes: worldId length] [N bytes: worldId] [rest: data]
  //
  // Message types:
  //   0x01 = universe-sync    (server → client: full state)
  //   0x02 = universe-update  (bidirectional: CRDT delta)
  //   0x03 = world-sync       (server → client: full state)
  //   0x04 = world-update     (bidirectional: CRDT delta)
  //   0x05 = create-world     (client → server: JSON payload)
  //   0x06 = update-sectors   (client → server: JSON payload)
  //   0x07 = join-world       (client → server: worldId in header)
  //   0x08 = leave-world      (client → server: worldId in header)

  private static readonly MSG_TYPES: Record<string, number> = {
    "universe-sync": 0x01,
    "universe-update": 0x02,
    "world-sync": 0x03,
    "world-update": 0x04,
    "create-world": 0x05,
    "update-sectors": 0x06,
    "join-world": 0x07,
    "leave-world": 0x08,
  };

  private static readonly MSG_TYPE_NAMES: Record<number, string> = Object.fromEntries(
    Object.entries(RoomManager.MSG_TYPES).map(([k, v]) => [v, k])
  );

  encodeMessage(type: string, data: Uint8Array, worldId?: string): Uint8Array {
    const typeNum = RoomManager.MSG_TYPES[type] ?? 0;
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

  decodeMessage(raw: Buffer | ArrayBuffer | Buffer[]): {
    type: string;
    worldId: string | null;
    data: Uint8Array;
  } | null {
    let bytes: Uint8Array;
    if (raw instanceof ArrayBuffer) {
      bytes = new Uint8Array(raw);
    } else if (Array.isArray(raw)) {
      bytes = new Uint8Array(Buffer.concat(raw));
    } else {
      bytes = new Uint8Array(raw);
    }

    if (bytes.length < 3) return null;

    const typeNum = bytes[0];
    const type = RoomManager.MSG_TYPE_NAMES[typeNum];
    if (!type) return null;

    const worldIdLen = (bytes[1] << 8) | bytes[2];
    const worldId = worldIdLen > 0
      ? new TextDecoder().decode(bytes.slice(3, 3 + worldIdLen))
      : null;
    const data = bytes.slice(3 + worldIdLen);

    return { type, worldId, data };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Generate a short, URL-safe world ID (5 chars, ~60M combinations).
 */
function generateWorldId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 5; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
