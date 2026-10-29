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
  RETURN_PORTAL_XZ,
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
import { Progress } from "./progress.js";
import { insideFrontier, solidifyWithinFrontier } from "./frontier.js";
import { createWorldDoc } from "./world-factory.js";
import { resolveNewWorld } from "./resolver.js";
import { prepareChat, cleanChatText, ChatLimiter, CHAT_HISTORY, CHAT_MAX_BYTES } from "../../../shared/chat.js";
import { touchesChat } from "./chat-guard.js";
import { WorldAuthority, CreateLimiter } from "./world-authority.js";
import { listCharacters } from "./identity.js";
import { isWorldOwnerId, type WorldActor } from "../../../shared/world-policy.js";
import { SimHost } from "./sim-host.js";

const FLUSH_INTERVAL_MS = 60_000; // 60 seconds

// (Worlds planted by guests before 2026-10-21 have creator "guest"; new ones need sign-in.)

// ── Presence (Card Event Readiness, 2026-10-20) ───────────────────────────
// Relaying every presence message to every client was O(n²) sends and pegged
// a core at 50 players (scripts/loadtest/bots.mjs). Now the server keeps each
// socket's latest presence and, once per tick, sends every client ONE batch
// with the freshest states of the nearest players in the same place (space,
// or the same world). Same total bytes at small n, ~n× fewer sends, and a
// hard ceiling on what any phone has to parse.
/** Batches per second = 1000 / tick. Clients smooth between updates. */
const PRESENCE_TICK_MS = 100;
/** Most players any one client hears about per tick (nearest first). */
const PRESENCE_MAX_NEIGHBORS = 30;
/** Bigger presence payloads are dropped (a normal one is ~200 bytes). */
const PRESENCE_MAX_BYTES = 1024;

interface PresenceEntry {
  /** The client's JSON, validated as an object. */
  json: string;
  x: number;
  y: number;
  z: number;
  /** "" = flying in space; otherwise the world id (interior coordinates). */
  group: string;
  /** Last update time. */
  at: number;
}

/** Chat id for space (the universe outside worlds, Origin included). */
export const SPACE_CHAT_ID = "space";

interface WorldRoom {
  doc: Y.Doc;
  clients: Set<WebSocket>;
  lastFlush: number;
  /** Reverts client edits the sender wasn't allowed to make (Rough Draft M1). */
  authority: WorldAuthority;
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
  /** Heartbeat (M7c): when each socket's last ping was answered. */
  private lastPing = new WeakMap<WebSocket, number>();
  /** Account behind a socket, for the World Index. */
  private accountIds = new WeakMap<WebSocket, string>();
  /** Chat send limits, per player. */
  private chatLimiter = new ChatLimiter();
  /** New objects per socket: 60 per 30 s (steady building is ~2/s; stops spam walls). */
  private createLimiter = new CreateLimiter<WebSocket>(60, 30_000);
  /** Space chat: last CHAT_HISTORY lines, in memory (the archive keeps them all). */
  private spaceChat: Array<{ sender: string; text: string; t: number }> = [];
  /** Latest presence per socket, sent out in batches. */
  private presence = new Map<WebSocket, PresenceEntry>();
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private lastPresenceTick = 0;

  /** The universal mana pool & ledger (server-authoritative). */
  readonly mana: ManaLedger;
  /** Flow & admission: who may draw how much right now (Phase 05). */
  readonly admission: ManaAdmission;
  /** Awe = experience: XP, skills, chapters (Rough Draft M3). */
  readonly progress: Progress;
  /** Online flight authority (Phase 09, 9B): the shared sim, stepped per flying socket. */
  readonly sim = new SimHost(() => getAllWorldEntries(this.universeDoc));
  private frontierCount: { at: number; n: number } | null = null;

  constructor() {
    this.universeDoc = initUniverseDoc();
    this.startFlushTimer();
    this.lastPresenceTick = Date.now();
    this.presenceTimer = setInterval(() => this.presenceTick(), PRESENCE_TICK_MS);

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
    this.progress = new Progress(getDb(), () => this.worldsInFrontier());

    console.log("[rooms] room manager initialized");
  }

  /** Top-level worlds inside the Frontier now (explorer thresholds; cached a minute). */
  worldsInFrontier(now = Date.now()): number {
    if (this.frontierCount && now - this.frontierCount.at < 60_000) return this.frontierCount.n;
    const r = this.mana.state().frontierRadius;
    let n = 0;
    for (const w of this.allWorlds()) if (!w.parentWorldId && insideFrontier(w.resolvedPosition, r)) n++;
    this.frontierCount = { at: now, n };
    return n;
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
    // …and what's been said out in space, so latecomers can read it
    if (this.spaceChat.length) {
      ws.send(this.encodeMessage("chat", new TextEncoder().encode(JSON.stringify({ lines: this.spaceChat, history: true })), SPACE_CHAT_ID));
    }

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
    this.presence.delete(ws);
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
        authority: new WorldAuthority(doc),
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
        const entry = this.getWorldEntry(worldId);
        const edition = entry?.solidified === false ? "dreamt" : "solid";
        const now = Date.now();
        if (recordDiscovery(accountId, worldId, characterId, "visited", "flight", now, edition).firstVisit) {
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
            at: now,
          });
          if (characterId) {
            this.progress.firstVisit(characterId, worldId, others.size);
            // A reaction: someone else's awe at what you made.
            const creator = entry?.creator;
            if (creator && creator !== "system" && !listCharacters(accountId).some((c) => c.id === creator)) {
              this.progress.reaction(creator, worldId, accountId);
            }
          }
        }
        if (characterId) this.progress.useSkill(characterId, "enter");
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
   * If `parentWorldId` is set, this world is planted as a portal inside that world.
   */
  createWorld(
    name: string,
    creator: string,
    intendedPosition: Vec3,
    color: string,
    parentWorldId?: string,
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
      ...(parentWorldId ? { parentWorldId } : {}),
    };

    const existingWorlds = getAllWorldEntries(this.universeDoc);
    let frontierCheckPos: Vec3;

    if (parentWorldId) {
      // Nested world inside a parent world: nudge away from sibling portals (and the parent's own Return Portal)
      const parentEntry = this.getWorldEntry(parentWorldId);
      const obstacles: { x: number; z: number }[] = existingWorlds
        .filter((w) => w.parentWorldId === parentWorldId)
        .map((w) => w.resolvedPosition);
      if (parentEntry?.parentWorldId) {
        obstacles.push(RETURN_PORTAL_XZ);
      }
      const pos = { ...intendedPosition };
      const MIN_PORTAL_DIST = 4;
      for (let pass = 0; pass < 8; pass++) {
        let moved = false;
        for (const sib of obstacles) {
          const dx = pos.x - sib.x;
          const dz = pos.z - sib.z;
          const d = Math.hypot(dx, dz);
          if (d < MIN_PORTAL_DIST) {
            const nx = d > 1e-4 ? dx / d : 1;
            const nz = d > 1e-4 ? dz / d : 0;
            pos.x = sib.x + nx * MIN_PORTAL_DIST;
            pos.z = sib.z + nz * MIN_PORTAL_DIST;
            moved = true;
          }
        }
        if (!moved) break;
      }
      pos.x = Math.max(-155, Math.min(155, pos.x));
      pos.z = Math.max(-155, Math.min(155, pos.z));
      entry.resolvedPosition = pos;
      entry.resolvedAt = now;

      const root = this.rootWorld(parentWorldId);
      entry.sector = root?.sector ?? "0:0:0";
      frontierCheckPos = root?.resolvedPosition ?? pos;
    } else {
      // Outer-space world: run spatial resolver against outer-space worlds only
      const spaceWorlds = existingWorlds.filter((w) => !w.parentWorldId);
      const resolvedPos = resolveNewWorld(spaceWorlds, entry);
      entry.resolvedPosition = resolvedPos;
      entry.resolvedAt = now;
      entry.sector = sectorKey(positionToSector(resolvedPos));
      frontierCheckPos = resolvedPos;
    }

    // Inside the Living Frontier, worlds are solid (ROADMAP). Outside they stay
    // Ghosts on the universe map until the Frontier reaches them. Same rule
    // for offline creations once synced.
    if (insideFrontier(frontierCheckPos, this.mana.state().frontierRadius)) {
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

    console.log(
      `[rooms] created world "${name}" (${id}) by ${creator}${parentWorldId ? ` inside ${parentWorldId}` : ""} at (${entry.resolvedPosition.x.toFixed(1)}, ${entry.resolvedPosition.y.toFixed(1)}, ${entry.resolvedPosition.z.toFixed(1)})`
    );
    this.sim.invalidateWorlds();
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
      // Heartbeat (M7c): echo at once so the client can tell a live socket from a zombie. Not activity.
      if (message.type === "ping") {
        const now = Date.now();
        if (now - (this.lastPing.get(ws) ?? 0) < 2000) return; // at most one echo per 2 s per socket
        this.lastPing.set(ws, now);
        if (ws.readyState === ws.OPEN) ws.send(this.encodeMessage("ping", new Uint8Array(0)));
        return;
      }
      const activeId = this.playerIds.get(ws);
      if (activeId) this.admission.markActive(activeId);

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
          if (!message.worldId || message.worldId === ORIGIN_WORLD_ID) break;
          const room = this.worldRooms.get(message.worldId);
          if (room) {
            if (touchesChat(room.doc, message.data)) {
              console.warn("[rooms] refused client write to chat log");
              break;
            }
            this.applyWorldUpdate(room.authority, message.data, ws, message.worldId);
          } else {
            // Offline edit flushed after reconnect when no one is currently in the room
            const entry = this.getWorldEntry(message.worldId);
            if (!entry) break;
            const doc = new Y.Doc();
            const saved = loadDoc(message.worldId);
            if (saved) Y.applyUpdate(doc, saved);
            else {
              const fresh = createWorldDoc(entry);
              Y.applyUpdate(doc, Y.encodeStateAsUpdate(fresh));
              fresh.destroy();
            }
            if (!touchesChat(doc, message.data)) {
              const authority = new WorldAuthority(doc);
              this.applyWorldUpdate(authority, message.data, ws, message.worldId);
              authority.destroy();
              saveDoc(message.worldId, Y.encodeStateAsUpdate(doc), "world", entry.sector);
            } else {
              console.warn("[rooms] refused offline client write to chat log");
            }
            doc.destroy();
          }
          break;
        }
        case "chat": {
          this.handleChat(ws, message.worldId, message.data);
          break;
        }
        case "create-world": {
          // Retired 2026-10-21: it let guests plant unlimited worlds. Worlds are
          // made via POST /api/player/world (signed-in, daily limit; world-create.ts).
          console.warn("[rooms] refused socket create-world (use POST /api/player/world)");
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
          // Kept until the next batch tick (see presenceTick)
          this.storePresence(ws, message.data);
          break;
        }
        case "sim-input":
        case "sim-reset": {
          const pid = this.playerIds.get(ws) ?? null;
          const fix = message.type === "sim-input" ? this.sim.input(ws, pid, message.data) : this.sim.reset(ws, pid, message.data);
          if (fix && ws.readyState === ws.OPEN) ws.send(this.encodeMessage("sim-correct", fix));
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
    this.sim.drop(ws);
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
    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
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

  /** Every world in the universe (Create World's daily limit counts from these). */
  allWorlds(): WorldEntry[] {
    return getAllWorldEntries(this.universeDoc);
  }

  /** Follow `parentWorldId` up to the outer-space ancestor world (with cycle guard, no depth limit). */
  rootWorld(worldId: string): WorldEntry | null {
    let cur = this.getWorldEntry(worldId);
    const seen = new Set<string>();
    while (cur?.parentWorldId) {
      if (seen.has(cur.id) || seen.has(cur.parentWorldId)) break;
      seen.add(cur.id);
      const parent = this.getWorldEntry(cur.parentWorldId);
      if (!parent) break;
      cur = parent;
    }
    return cur;
  }

  /** Update whether other players may plant child portals inside `worldId`. */
  setWorldPortalPolicy(worldId: string, allowPortals: boolean): boolean {
    return this.setWorldPolicyKey(worldId, "allowPortals", allowPortals);
  }

  /** Replace the world's co-creators (already cleaned; creator-only, checked by the caller). */
  setWorldCoCreators(worldId: string, coCreators: string[]): boolean {
    return this.setWorldPolicyKey(worldId, "coCreators", coCreators);
  }

  /** Server-only write of a policy key to the universe entry and the world's meta. */
  private setWorldPolicyKey(worldId: string, key: "allowPortals" | "coCreators", value: unknown): boolean {
    if (worldId === ORIGIN_WORLD_ID) return false;
    const worlds = this.universeDoc.getMap("worlds");
    const worldMap = worlds.get(worldId) as Y.Map<unknown> | undefined;
    if (!worldMap) return false;
    this.universeDoc.transact(() => {
      worldMap.set(key, value);
    }, "server");
    const room = this.worldRooms.get(worldId);
    if (room) {
      room.doc.transact(() => {
        room.doc.getMap("meta").set(key, value);
      }, "server");
    } else {
      const saved = loadDoc(worldId);
      if (saved) {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, saved);
        doc.getMap("meta").set(key, value);
        saveDoc(worldId, Y.encodeStateAsUpdate(doc), "world", this.getWorldEntry(worldId)?.sector);
        doc.destroy();
      }
    }
    return true;
  }

  /**
   * Who is writing to this world, and do they own it (creator or co-creator)?
   * Ownership is checked against every character on the socket's account, and
   * only computed if a judgement actually needs it.
   */
  private actorFor(ws: WebSocket, worldId: string): WorldActor {
    const id = this.playerIds.get(ws) ?? null;
    const accountId = this.accountIds.get(ws);
    let owner: boolean | undefined;
    const entry = () => this.getWorldEntry(worldId);
    return {
      id,
      get owner() {
        if (owner !== undefined) return owner;
        const w = entry();
        if (!w || !id) return (owner = false);
        const roles = { creator: w.creator, coCreators: w.coCreators };
        owner = isWorldOwnerId(id, roles) || (accountId ? listCharacters(accountId).some((c) => isWorldOwnerId(c.id, roles)) : false);
        return owner;
      },
    };
  }

  /** Apply a client's world update through the authority (reverting what they may not change). */
  private applyWorldUpdate(authority: WorldAuthority, update: Uint8Array, ws: WebSocket, worldId: string): void {
    const actor = this.actorFor(ws, worldId);
    const { reverted, details } = authority.apply(update, ws, actor, () => this.createLimiter.take(ws));
    if (reverted) {
      console.warn(`[rooms] reverted ${reverted} change(s) in ${worldId} by ${actor.id ?? "guest"}: ${details.slice(0, 6).join(", ")}`);
    }
  }

  private getWorldEntry(worldId: string): WorldEntry | null {
    const worlds = this.universeDoc.getMap("worlds");
    const worldMap = worlds.get(worldId) as Y.Map<unknown> | undefined;
    if (!worldMap) return null;
    const parentWorldId = worldMap.get("parentWorldId") as string | undefined;
    const allowPortals = worldMap.get("allowPortals") as boolean | undefined;
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
      ...(parentWorldId ? { parentWorldId } : {}),
      ...(allowPortals !== undefined ? { allowPortals } : {}),
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

  /** Validate and keep a client's latest presence. The payload stays opaque JSON otherwise. */
  private storePresence(sender: WebSocket, data: Uint8Array): void {
    if (data.length === 0 || data.length > PRESENCE_MAX_BYTES) return;
    let json: string;
    let p: { position?: { x?: unknown; y?: unknown; z?: unknown }; inWorld?: unknown };
    try {
      json = new TextDecoder().decode(data);
      p = JSON.parse(json);
    } catch {
      return;
    }
    if (!p || typeof p !== "object" || Array.isArray(p)) return;
    const x = Number(p.position?.x), y = Number(p.position?.y), z = Number(p.position?.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const group = typeof p.inWorld === "string" ? p.inWorld : "";
    this.presence.set(sender, { json, x, y, z, group, at: Date.now() });
  }

  /**
   * One presence batch per client per tick: the players in the same place
   * (space, or the same world) that moved since the last tick, nearest first,
   * at most PRESENCE_MAX_NEIGHBORS. Players who fall out of range simply stop
   * arriving, and the client drops them after its stale timeout.
   */
  private presenceTick(): void {
    const since = this.lastPresenceTick;
    this.lastPresenceTick = Date.now();
    if (this.presence.size < 2) return;

    // Fresh entries, grouped by place
    const groups = new Map<string, Array<[WebSocket, PresenceEntry]>>();
    for (const [ws, e] of this.presence) {
      if (e.at <= since) continue;
      let g = groups.get(e.group);
      if (!g) groups.set(e.group, (g = []));
      g.push([ws, e]);
    }
    if (groups.size === 0) return;

    for (const [ws] of this.universeClients) {
      if (ws.readyState !== 1) continue;
      const me = this.presence.get(ws);
      const pool = groups.get(me?.group ?? "");
      if (!pool) continue;
      let picked: Array<[WebSocket, PresenceEntry]>;
      if (pool.length - 1 <= PRESENCE_MAX_NEIGHBORS || !me) {
        picked = pool.length - 1 <= PRESENCE_MAX_NEIGHBORS ? pool : pool.slice(0, PRESENCE_MAX_NEIGHBORS + 1);
      } else {
        const d2 = (e: PresenceEntry) => (e.x - me.x) ** 2 + (e.y - me.y) ** 2 + (e.z - me.z) ** 2;
        picked = pool
          .filter(([other]) => other !== ws)
          .map((pe) => [pe, d2(pe[1])] as const)
          .sort((a, b) => a[1] - b[1])
          .slice(0, PRESENCE_MAX_NEIGHBORS)
          .map(([pe]) => pe);
      }
      let body = "";
      for (const [other, e] of picked) {
        if (other === ws) continue;
        body += body ? "," + e.json : e.json;
      }
      if (!body) continue;
      ws.send(this.encodeMessage("presence-batch", new TextEncoder().encode("[" + body + "]")));
    }
  }

  /**
   * Someone talks out in space (Origin included): no world doc there, so the
   * server keeps the recent lines in memory and sends each new line to every
   * universe client. Same cleaning, filter, limits and archive as world chat.
   */
  private handleSpaceChat(ws: WebSocket, data: Uint8Array): void {
    const reply = (body: object) => {
      if (ws.readyState === 1) ws.send(this.encodeMessage("chat", new TextEncoder().encode(JSON.stringify(body)), SPACE_CHAT_ID));
    };
    const playerId = this.playerIds.get(ws);
    if (!playerId) return reply({ error: "no_session" });
    if (!this.universeClients.has(ws)) return;
    if (data.length === 0 || data.length > CHAT_MAX_BYTES) return;
    let raw: unknown;
    try {
      raw = (JSON.parse(new TextDecoder().decode(data)) as { text?: unknown }).text;
    } catch {
      return;
    }
    const original = cleanChatText(raw);
    const text = prepareChat(raw);
    if (!text) return;
    const now = Date.now();
    const limited = this.chatLimiter.check(playerId, now);
    if (limited) return reply({ error: limited });
    this.archiveChat(SPACE_CHAT_ID, playerId, original, now);
    const line = { sender: playerId, text, t: now };
    this.spaceChat.push(line);
    if (this.spaceChat.length > CHAT_HISTORY) this.spaceChat.splice(0, this.spaceChat.length - CHAT_HISTORY);
    const msg = this.encodeMessage("chat", new TextEncoder().encode(JSON.stringify({ lines: [line] })), SPACE_CHAT_ID);
    for (const [client] of this.universeClients) if (client.readyState === 1) client.send(msg);
  }

  /** Permanent archive (research replay): never trimmed, unlike the live logs. */
  private archiveChat(worldId: string, playerId: string, text: string, at: number): void {
    try {
      const d = getDb();
      d.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, player_id TEXT NOT NULL,
        text TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS chat_messages_world ON chat_messages(world_id, at);
        CREATE INDEX IF NOT EXISTS chat_messages_player ON chat_messages(player_id, at);`);
      d.prepare("INSERT INTO chat_messages (world_id, player_id, text, at) VALUES (?, ?, ?, ?)").run(worldId, playerId, text, at);
    } catch (err) {
      console.error("[rooms] failed to archive chat message", err);
    }
  }

  /**
   * A player says something in the world they're in. The sender is whoever the
   * server knows this socket to be (never anything the client claims); the text
   * is cleaned, filtered and rate limited here. It is appended to the world's
   * chat log, which every player in the room receives like any other change.
   */
  private handleChat(ws: WebSocket, worldId: string | null, data: Uint8Array): void {
    if (!worldId || worldId === SPACE_CHAT_ID) return this.handleSpaceChat(ws, data);
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
    this.archiveChat(worldId!, playerId, original, now);
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
  //   0x05 = create-world     (retired 2026-10-21: refused; use POST /api/player/world)
  //   0x06 = update-sectors   (client → server: JSON payload)
  //   0x07 = join-world       (client → server: worldId in header)
  //   0x08 = leave-world      (client → server: worldId in header)
  //   0x0a = chat             (client → server: { text }; server → client: { error } | { lines, history? } for space)
  //   0x0b = presence-batch   (server → client: JSON array of presence states, once per tick)
  //   0x0c = ping             (client → server, echoed back empty: heartbeat, M7c)
  //   0x0d = sim-input        (client → server: binary input bundle + predicted state, shared/sim/wire.ts, 9B)
  //   0x0e = sim-correct      (server → client: authoritative state + acked seq, only on disagreement)
  //   0x0f = sim-reset        (client → server: an out-of-sim move — spawn, warp, teleport, world exit)

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
    "presence-batch": 0x0b,
    "ping": 0x0c,
    "sim-input": 0x0d,
    "sim-correct": 0x0e,
    "sim-reset": 0x0f,
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
