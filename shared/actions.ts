/**
 * Enumerated Action Catalog (Phase 09, 9F rough draft).
 *
 * Every state-changing thing a client (or admin) can ask the server to do,
 * in one typed table: who may do it (actor tier), how it arrives (socket
 * message or HTTP route), whether it can be queued offline, and how far it
 * is along the move to "server is the only writer".
 *
 * Status:
 *  - `enforced`: a server handler checks this tier today (the route/handler named).
 *  - `policy`:   still a raw CRDT write (`0x04 world-update`), judged after the fact by
 *                `shared/world-policy.ts` (M1 stopgap: the server reverts what breaks it).
 *  - `server`:   server-written only; clients are refused.
 *  - `planned`:  named for the catalog; the typed intent doesn't exist yet.
 *
 * The rough draft is the catalog plus a drift check (`actions.test.ts` reads
 * the server source: every route and socket message here exists there, and
 * every socket message type there is in here). Typed intents replacing
 * `0x04 world-update` (object.* / terrain.shape), the offline intent queue,
 * and retiring `chat-guard.ts` are not done (phases/09 9F log).
 */

/** Who may act, weakest first. */
export const ACTOR_TIERS = ["any_session", "saved", "asset_maker", "world_creator", "admin_inflow", "admin"] as const;
export type ActorTier = (typeof ACTOR_TIERS)[number];

export type ActionStatus = "enforced" | "policy" | "server" | "planned";

export interface ActionDef {
  tier: ActorTier;
  /** How it reaches the server: a socket message type, or `METHOD /path`. */
  via: { ws: string } | { http: string } | null;
  /** May be predicted locally and queued while offline (replayed in order on reconnect). */
  offline: boolean;
  status: ActionStatus;
  /** Extra rule beyond the tier (mana cost, world policy, rate limit), for humans. */
  note?: string;
}

export const ACTIONS = {
  // ── Continuous simulation (9A–9C) ──
  "sim.flight_input": { tier: "any_session", via: { ws: "sim-input" }, offline: true, status: "enforced", note: "SimHost: real-time budget, corrections" },
  "sim.reset": { tier: "any_session", via: { ws: "sim-reset" }, offline: true, status: "enforced", note: "near a world or within honest-flier distance" },
  "sim.resume": { tier: "any_session", via: { ws: "sim-resume" }, offline: false, status: "enforced", note: "credit ≤ time away (30 min)" },
  "sim.interior_input": { tier: "any_session", via: null, offline: true, status: "planned", note: "shared/sim/interior.ts not yet under authority" },
  "sim.warp": { tier: "any_session", via: null, offline: true, status: "planned", note: "warp target in the World Index at that tick" },
  "presence.update": { tier: "any_session", via: { ws: "presence" }, offline: false, status: "enforced", note: "client-reported until server snapshots" },

  // ── World objects & terrain (still raw CRDT; 9F makes them typed intents) ──
  "object.place": { tier: "any_session", via: { ws: "world-update" }, offline: true, status: "policy", note: "placedBy must be the sender" },
  "object.transform": { tier: "any_session", via: { ws: "world-update" }, offline: true, status: "policy", note: "placer, creator or builders" },
  "object.recolor": { tier: "any_session", via: { ws: "world-update" }, offline: true, status: "policy", note: "placer, creator or builders" },
  "object.duplicate": { tier: "any_session", via: { ws: "world-update" }, offline: true, status: "policy" },
  "object.kick": { tier: "any_session", via: { ws: "world-update" }, offline: true, status: "policy", note: "KICK_LIMITS" },
  "object.settle": { tier: "any_session", via: { ws: "world-update" }, offline: true, status: "policy", note: "KICK_LIMITS" },
  "object.replace_asset": { tier: "any_session", via: { ws: "world-update" }, offline: true, status: "policy", note: "placer, creator or builders" },
  "object.remove": { tier: "any_session", via: { ws: "world-update" }, offline: true, status: "policy", note: "placer, creator or builders" },
  "terrain.shape": { tier: "world_creator", via: { ws: "world-update" }, offline: true, status: "policy", note: "creator + builders (M1); baseline was any saved explorer" },
  "world.join": { tier: "any_session", via: { ws: "join-world" }, offline: false, status: "enforced" },
  "world.leave": { tier: "any_session", via: { ws: "leave-world" }, offline: false, status: "enforced" },
  "universe.subscribe": { tier: "any_session", via: { ws: "update-sectors" }, offline: false, status: "enforced" },

  // ── Online, authenticated ──
  "world.plant": { tier: "saved", via: { http: "POST /api/player/world" }, offline: false, status: "enforced", note: "daily limit; parent allowPortals" },
  "world.set_policy": { tier: "world_creator", via: { http: "POST /api/player/world/policy" }, offline: false, status: "enforced", note: "allowPortals, co-creators" },
  "chat.send": { tier: "any_session", via: { ws: "chat" }, offline: false, status: "enforced", note: "ChatLimiter; server writes the log" },
  "library.create_model": { tier: "saved", via: { http: "POST /api/player/create" }, offline: false, status: "enforced", note: "mana; safety check" },
  "library.create_lore": { tier: "saved", via: { http: "POST /api/player/lore" }, offline: false, status: "enforced", note: "mana" },
  "architect.turn": { tier: "saved", via: { http: "POST /api/player/plan" }, offline: false, status: "enforced", note: "mana" },
  "architect.redo": { tier: "saved", via: { http: "POST /api/player/plan/redo" }, offline: false, status: "enforced", note: "mana" },
  "architect.manifest": { tier: "saved", via: { http: "POST /api/player/plan/manifest" }, offline: false, status: "enforced", note: "mana" },
  "architect.edit": { tier: "saved", via: { http: "POST /api/player/plan/edit" }, offline: false, status: "enforced", note: "free" },
  "architect.restore": { tier: "saved", via: { http: "POST /api/player/plan/restore" }, offline: false, status: "enforced", note: "free" },
  "cards.checkout": { tier: "any_session", via: { http: "POST /api/player/cards/checkout" }, offline: false, status: "enforced", note: "Stripe; hidden until VITE_CARD_CHECKOUT" },
  "account.switch_character": { tier: "any_session", via: { http: "POST /api/player/character" }, offline: false, status: "enforced" },
  "account.rename_character": { tier: "any_session", via: { http: "POST /api/player/character/name" }, offline: false, status: "enforced", note: "names.ts" },
  "account.set_password": { tier: "any_session", via: { http: "POST /api/player/password" }, offline: false, status: "enforced", note: "a guest session saving itself" },
  "player.mute": { tier: "any_session", via: { http: "POST /api/player/mute" }, offline: false, status: "enforced" },
  "player.report": { tier: "any_session", via: { http: "POST /api/player/report" }, offline: false, status: "enforced" },
  "player.save_location": { tier: "any_session", via: { http: "POST /api/player/location" }, offline: false, status: "enforced" },
  "progress.report": { tier: "any_session", via: { http: "POST /api/player/progress/report" }, offline: false, status: "enforced", note: "server judges each event" },
  "index.sighted": { tier: "any_session", via: { http: "POST /api/player/world-index/sighted" }, offline: false, status: "enforced", note: "cheap checks until sightings come from the replayed path" },
  "index.arrived": { tier: "any_session", via: { http: "POST /api/player/world-index/arrived" }, offline: false, status: "enforced" },

  // ── Server-written only (clients refused) ──
  "universe.write": { tier: "admin", via: { ws: "universe-update" }, offline: false, status: "server", note: "refused from clients" },
  "world.create_socket": { tier: "admin", via: { ws: "create-world" }, offline: false, status: "server", note: "retired: use world.plant" },

  // ── Admin ──
  "mana.inflow": { tier: "admin_inflow", via: { http: "POST /api/mana/inflow" }, offline: false, status: "enforced" },
  "mana.refund": { tier: "admin_inflow", via: { http: "POST /api/mana/refund" }, offline: false, status: "enforced" },
  "mana.draw": { tier: "admin", via: { http: "POST /api/mana/draw" }, offline: false, status: "enforced" },
  "cards.event_order": { tier: "admin", via: { http: "POST /api/admin/cards/event" }, offline: false, status: "enforced" },
  "cards.sets": { tier: "admin", via: { http: "POST /api/admin/card-sets" }, offline: false, status: "enforced" },
  "trash.manage": { tier: "admin", via: { http: "GET /api/admin/trash" }, offline: false, status: "enforced" },
  "reports.review": { tier: "admin", via: { http: "GET /api/admin/reports" }, offline: false, status: "enforced" },
  "telemetry.flight_path": { tier: "admin", via: { http: "GET /api/admin/flight-path" }, offline: false, status: "enforced" },
} as const satisfies Record<string, ActionDef>;

export type ActionId = keyof typeof ACTIONS;

/** Socket message types that carry no intent of their own (transport, heartbeat, server → client). */
export const WS_TRANSPORT = ["universe-sync", "world-sync", "presence-batch", "ping", "sim-correct"] as const;

/** Does an actor with these facts meet `tier`? (`world_creator` and `asset_maker` need the object in question.) */
export function meetsTier(
  tier: ActorTier,
  a: { session: boolean; saved: boolean; owner?: boolean; maker?: boolean; inflow?: boolean; admin?: boolean },
): boolean {
  switch (tier) {
    case "any_session": return a.session;
    case "saved": return a.session && a.saved;
    case "asset_maker": return a.session && a.saved && !!a.maker;
    case "world_creator": return a.session && !!a.owner;
    case "admin_inflow": return !!a.inflow || !!a.admin;
    case "admin": return !!a.admin;
  }
}

/** The actions a socket message type can carry (empty for transport / unknown). */
export function actionsForWs(type: string): ActionId[] {
  return (Object.keys(ACTIONS) as ActionId[]).filter((id) => {
    const v: ActionDef["via"] = ACTIONS[id].via;
    return v !== null && "ws" in v && v.ws === type;
  });
}
