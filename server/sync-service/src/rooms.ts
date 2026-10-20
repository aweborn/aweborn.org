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

import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import type { WebSocket } from "ws";
import { recordDiscovery } from "./identity.js";
import { onFirstDiscovery } from "./awe.js";
import type { WorldEntry, Vec3 } from "../../../shared/crdt-schema.js";
import {
  positionToSector,
  sectorKey,
  ORIGIN_WORLD_ID,
} from "../../../shared/crdt-schema.js";
import {
  initUniverseDoc,
  flushUniverseDoc,
  addWorldToUniverse,
  getAllWorldEntries,
  updatePlayerCount,
  updateResolvedPosition,
} from "./universe.js";
import { saveDoc, loadDoc, listDocIds, getDb } from "./persistence.js";
import { ManaLedger } from "./mana.js";
import { ManaAdmission } from "./admission.js";
import { insideFrontier, solidifyWithinFrontier } from "./frontier.js";
import { createWorldDoc } from "./world-factory.js";
import { resolveNewWorld } from "./resolver.js";
import { prepareChat, cleanChatText, ChatLimiter, CHAT_HISTORY, CHAT_MAX_BYTES } from "../../../shared/chat.js";
import { touchesChat } from "./chat-guard.js";

const FLUSH_INTERVAL_MS = 60_000; // 60 seconds

/** `creator` for worlds made by sockets with no session. */
const GUEST_CREATOR = "guest";

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

  /** Authenticated playerId (active character) per socket (from the session cookie at upgrade). */
  private playerIds = new WeakMap<WebSocket, string>();
  /** Account behind a socket, for the World Index. */
  private accountIds = new WeakMap<WebSocket, string>();
  /** Chat send limits, per player. */
  private chatLimiter = new ChatLimiter();

  /** The universal mana pool & ledger (server-authoritative). */
  readonly mana: ManaLedger;
  /** Flow & admission: who may draw how much right now (Phase 05). */
  readonly admission: ManaAdmission;

  constructor() {
    this.universeDoc = initUniverseDoc();
    this.startFlushTimer();

    // When the universe doc changes, broadcast updates to subscribed clients
    this.universeDoc.on("update", (update: Uint8Array, _origin: unknown) => {
      this.broadcastUniverseUpdate(update);
    });

    // Mana: rebuilt from the ledger, published into the Universe doc, and
    // republished on every ledger change (clients read it reactively).
    this.mana = new ManaLedger(getDb());
    this.mana.publish(this.universeDoc);
    this.applyFrontier();
    // Mana first, then the worlds it solidifies: clients see the new
    // lastDonationAt before the flags flip, so the wave can hold them.
    this.mana.onChange(() => {
      this.mana.publish(this.universeDoc);
      this.applyFrontier();
    });
    this.admission = new ManaAdmission(this.mana);

    console.log("[rooms] room manager initialized");
  }

  // ── Universe Room ────────────────────────────────────────────────

  /** Record the authenticated player behind a socket. */
  setPlayer(ws: WebSocket, playerId: string, accountId?: string): void {
    this.playerIds.set(ws, playerId);
    this.admission.markActive(playerId);
    if (accountId) this.accountIds.set(ws, accountId);
  }

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
    // Origin is the portal: a real world entry, but it has no interior.
    if (worldId === ORIGIN_WORLD_ID) return null;

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

    // World Index: entering a world is a visit (sighted → visited, or new).
    const accountId = this.accountIds.get(ws);
    if (accountId) {
      try {
        const characterId = this.playerIds.get(ws) ?? null;
        if (recordDiscovery(accountId, worldId, characterId).firstVisit) {
          // Shared awe counts other *players*: guests count, your own other tabs don't.
          const others = new Set<string>();
          for (const c of room.clients) {
            if (c === ws) continue;
            const other = this.accountIds.get(c) ?? this.playerIds.get(c);
            if (other !== accountId) others.add(other ?? `guest:${others.size}`);
          }
          onFirstDiscovery({
            accountId,
            worldId,
            characterId,
            companions: others.size,
            at: Date.now(),
          });
        }
      } catch (err) {
        console.warn("[rooms] could not record discovery:", err);
      }
    }

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
      solidified: false, // set below, once the resolver has placed it
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

    // Inside the Living Frontier, worlds are solid (ROADMAP). Outside they stay
    // Ghosts on the universe map until the Frontier reaches them. Same rule
    // for offline creations once synced.
    if (insideFrontier(resolvedPos, this.mana.state().frontierRadius)) {
      entry.solidified = true;
      entry.solidifiedAt = now;
    }

    // Add to Universe CRDT
    addWorldToUniverse(this.universeDoc, entry);

    // Create and persist the world doc
    const worldDoc = createWorldDoc(entry);
    const state = Y.encodeStateAsUpdate(worldDoc);
    saveDoc(id, state, "world", entry.sector);
    worldDoc.destroy();

    console.log(`[rooms] created world "${name}" (${id}) by ${creator} at resolved position (${resolvedPos.x.toFixed(1)}, ${resolvedPos.y.toFixed(1)}, ${resolvedPos.z.toFixed(1)})`);
    return entry;
  }

  // ── Client Message Handling ──────────────────────────────────────

  /**
   * Handle an incoming message from a client.
   */
  handleMessage(ws: WebSocket, data: Buffer | ArrayBuffer | Buffer[]): void {
    const activeId = this.playerIds.get(ws);
    if (activeId) this.admission.markActive(activeId);
    try {
      const message = this.decodeMessage(data);
      if (!message) return;

      switch (message.type) {
        case "universe-update": {
          // The Universe doc is server-written only (worlds via create-world,
          // mana via the ledger). Clients never send this; refuse it so nobody
          // can forge worlds or the mana pool.
          console.warn("[rooms] refused client universe-update");
          break;
        }
        case "world-update": {
          // Client sent a CRDT update for a specific world
          const room = message.worldId ? this.worldRooms.get(message.worldId) : null;
          if (room) {
            if (touchesChat(room.doc, message.data)) {
              console.warn("[rooms] refused client write to chat log");
              break;
            }
            Y.applyUpdate(room.doc, message.data, ws);
          }
          break;
        }
        case "chat": {
          this.handleChat(ws, message.worldId, message.data);
          break;
        }
        case "create-world": {
          // Client wants to create a world. The creator is always decided by
          // the server: the socket's player, or "guest" if it has no session.
          // (The client-sent `creator` is ignored; it could impersonate anyone.)
          const payload = JSON.parse(new TextDecoder().decode(message.data)) as {
            name: string;
            position: Vec3;
            color: string;
          };
          const creator = this.playerIds.get(ws) ?? GUEST_CREATOR;
          this.createWorld(payload.name, creator, payload.position, payload.color);
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
        case "presence": {
          // Relay presence to all other universe clients
          this.relayPresence(ws, message.data);
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

  /** Public lookup by ID (used by `GET /worlds/:id`). */
  lookupWorld(worldId: string): WorldEntry | null {
    return this.getWorldEntry(worldId);
  }

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
   * Solidify every Ghost world the Frontier now reaches (Phase 05) and mirror
   * the flag into each world's own doc, live if loaded, else on disk.
   */
  private applyFrontier(): void {
    const ids = solidifyWithinFrontier(this.universeDoc, this.mana.state().frontierRadius);
    for (const id of ids) {
      const room = this.worldRooms.get(id);
      if (room) {
        room.doc.getMap("meta").set("solidified", true);
        continue;
      }
      const saved = loadDoc(id);
      if (!saved) continue;
      const doc = new Y.Doc();
      Y.applyUpdate(doc, saved);
      doc.getMap("meta").set("solidified", true);
      saveDoc(id, Y.encodeStateAsUpdate(doc), "world", this.getWorldEntry(id)?.sector);
      doc.destroy();
    }
    if (ids.length) console.log(`[frontier] solidified ${ids.length} world(s) inside r = ${this.mana.state().frontierRadius.toFixed(1)} u`);
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

  /**
   * Relay a presence message to all other universe clients.
   * The data is opaque JSON — the server just forwards it.
   */
  private relayPresence(sender: WebSocket, data: Uint8Array): void {
    const msg = this.encodeMessage("presence", data);
    for (const [, client] of this.universeClients) {
      if (client.ws !== sender && client.ws.readyState === 1) {
        client.ws.send(msg);
      }
    }
  }

  /**
   * A player says something in the world they're in. The sender is whoever the
   * server knows this socket to be (never anything the client claims); the text
   * is cleaned, filtered and rate limited here. It is appended to the world's
   * chat log, which every player in the room receives like any other change.
   */
  private handleChat(ws: WebSocket, worldId: string | null, data: Uint8Array): void {
    const reply = (body: object) => {
      if (ws.readyState === 1) ws.send(this.encodeMessage("chat", new TextEncoder().encode(JSON.stringify(body)), worldId ?? undefined));
    };
    const playerId = this.playerIds.get(ws);
    const room = worldId ? this.worldRooms.get(worldId) : null;
    if (!playerId) return reply({ error: "no_session" });
    if (!room || !room.clients.has(ws)) return;
    if (data.length === 0 || data.length > CHAT_MAX_BYTES) return;
    let raw: unknown;
    try {
      raw = (JSON.parse(new TextDecoder().decode(data)) as { text?: unknown }).text;
    } catch {
      return;
    }
    const original = cleanChatText(raw); // archived as typed (sanitized, not masked)
    const text = prepareChat(raw); // what players see
    if (!text) return;
    const now = Date.now();
    const limited = this.chatLimiter.check(playerId, now);
    if (limited) return reply({ error: limited });
    // Permanent archive (research replay): never trimmed, unlike the CRDT log below.
    try {
      const d = getDb();
      d.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, player_id TEXT NOT NULL,
        text TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS chat_messages_world ON chat_messages(world_id, at);
        CREATE INDEX IF NOT EXISTS chat_messages_player ON chat_messages(player_id, at);`);
      d.prepare("INSERT INTO chat_messages (world_id, player_id, text, at) VALUES (?, ?, ?, ?)").run(worldId, playerId, original, now);
    } catch (err) {
      console.error("[rooms] failed to archive chat message", err);
    }
    room.doc.transact(() => {
      const chat = room.doc.getArray("chat");
      chat.push([{ sender: playerId, text, t: now }]);
      const over = chat.length - CHAT_HISTORY;
      if (over > 0) chat.delete(0, over);
    }, "server");
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
  //   0x0a = chat             (client → server: { text }; server → client: { error })

  private static readonly MSG_TYPES: Record<string, number> = {
    "universe-sync": 0x01,
    "universe-update": 0x02,
    "world-sync": 0x03,
    "world-update": 0x04,
    "create-world": 0x05,
    "update-sectors": 0x06,
    "join-world": 0x07,
    "leave-world": 0x08,
    "presence": 0x09,
    "chat": 0x0a,
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
 * Generate a permanent world ID (lowercase UUIDv4).
 * Printed NFC cards encode `/w/<worldId>`, so IDs must never change.
 */
function generateWorldId(): string {
  return randomUUID();
}
