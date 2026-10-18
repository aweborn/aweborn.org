# Phase 07: World Creation & Gen AI

**Status:** `[ ]` Not Started
**Depends on:** [Phase 01: Foundation & Infra](./01-foundation.md) (genai-service container), [Phase 05: Mana Economy](./05-mana-economy.md) (mana cost validation), [Phase 04: Navigation & Controls](./04-navigation-controls.md) (interior control mapping)
**ROADMAP reference:** [Open Design Questions — World Interiors](../ROADMAP.md#open-design-questions)
**Estimated sessions:** 5-7

## Goal

Players can create rich, AI-generated content inside worlds: 3D avatars/characters, objects, landscapes, textures, music, ambient sounds, voices, and text/lore — all via natural language prompts. Each generation draws its **real compute cost** (× `K` = 100 mana per compute-dollar, so 1 mana = 1 cent) from the **universal mana pool**: nobody holds mana, gifts fill the pool (see [Phase 05 formula](./05-mana-economy.md#the-mana-pool-formula), 2026-10-13). Editing and arranging existing objects is free and works offline.

This phase answers the ROADMAP's open question: **"What can players actually do inside a world?"**

## Design Philosophy

| Principle | Implementation |
|-----------|---------------|
| **Online = Create, Offline = Edit** | AI prompting requires network (costs real API calls). Arranging, moving, resizing, coloring existing objects is local-only and free. |
| **Mana = Real Cost** | Each generation draws exactly its real compute cost × `K` from the shared pool. **No margin** (2026-10-13: non-profit costs are covered by the creative share `α` of each gift, not by marking up mana). The formula is abstracted (not tied to a specific model) so we can swap providers. |
| **Everything is a seam** | Each generation type is a separate endpoint in genai-service with a consistent interface. New modalities plug in without restructuring. |
| **Results live in the CRDT** | Generated assets are stored as URLs in the World CRDT. The asset files themselves go to object storage (S3 or Lightsail block storage). |
| **Plan first, then manifest** (2026-10-16) | Every creation starts as a **blueprint** written by the world planner, shaped with the player in a back-and-forth, previewed as a Ghost, and only then manifested. See [World Planner & Blueprints](#world-planner--blueprints) |
| **Keep everything** (Alex, 2026-10-16) | Every provider call and response, every blueprint version, every turn of the conversation is saved, so we can study how worlds get created and edited and get better at it. See [Creation Archive](#creation-archive) |

## Architecture: genai-service

```
genai-service (Node.js container on k3s VPS)
├── POST /plan                 → World planner: prompt or chat turn → blueprint (new version) + reply
├── POST /plan/:id/manifest    → reserve the estimate, fan out to the generators below, assemble
├── POST /generate/model      → Meshy AI (3D models, avatars, characters, terrain pieces)
├── POST /generate/image      → Gemini 3.1 Flash Image (textures, paintings, decals)
├── POST /generate/music      → Lyria 2 (ambient loops, soundtracks)
├── POST /generate/voice      → Gemini Flash TTS / ElevenLabs (NPC voices, narration)
├── POST /generate/text       → Claude Opus 5.5 for lore; Gemini Flash for small calls
├── POST /generate/terrain    → voxel grid from blueprint parameters (deterministic, free)
├── GET  /generate/status/:id → Poll generation status
├── GET  /generate/cost       → Current mana cost table
└── GET  /health              → Health check
```

Providers and prices: [MANA_COSTS.md](../MANA_COSTS.md) (2026-10-14/16). Every call above writes to the [Creation Archive](#creation-archive).

**Every request that costs money is counted** (Alex, 2026-10-16): planner chat turns, safety checks, retries, every generator call. Each is admitted, reserved and settled against the pool *and* the player's personal cap. Only free, local work (direct blueprint edits, voxel terrain, editing tools) skips the ledger.

**Orchestration (open, Alex likes Temporal).** A manifest is a workflow: fan out, poll Meshy for minutes, retry, and on failure release that item's reservation (a saga). Options, heaviest first:

| Option | Fit | Cost on our one k3s box |
|---|---|---|
| Temporal (TS SDK) | Best model for this: durable workflows, activities, retries, signals for chat turns | Self-hosting needs its server + Postgres/Cassandra (heavy); Temporal Cloud is paid |
| Restate | Durable execution, TS SDK, single binary | Light; younger project |
| DBOS / Inngest / Trigger.dev | Durable steps in TS | DBOS needs Postgres (we run SQLite); Inngest/Trigger.dev are hosted services (self-hostable, but more boxes) |
| SQLite job table in genai-service | Steps keyed by ledger refs (idempotent: the ledger already refuses duplicate `(kind, ref)`) | Free, matches the sync-service |

Proposal: start with the SQLite job table, written in workflow shape (pure step functions, idempotency keys, explicit compensation), so moving to Restate or Temporal later is a port, not a rewrite. **Zod** is the TypeScript Pydantic: it validates the planner's structured output (with the provider's JSON-schema mode).

**Decided (Alex, 2026-10-16): the SQLite job table** ("a really natural progression to a hosted database eventually"). Keep the workflow shape so the table can move to a hosted database (or Temporal/Restate) without rewriting the steps.

**Consistent request/response interface:**

```typescript
// Request (all types)
interface GenerateRequest {
  type: "model" | "image" | "music" | "voice" | "text" | "terrain";
  prompt: string;
  style?: string;          // e.g., "realistic", "cartoon", "pixel-art"
  parameters?: Record<string, unknown>;  // Type-specific params
  worldId: string;         // Which world this belongs to
  playerId: string;        // Who's creating it
}

// Response
interface GenerateResponse {
  taskId: string;          // For polling status
  estimatedMana: number;   // Mana reserved from the universal pool at admission
  estimatedTime: number;   // Seconds
  status: "queued" | "processing" | "complete" | "failed";
}

// Completed result (via status poll)
interface GenerateResult {
  taskId: string;
  status: "complete";
  assetUrl: string;        // URL to generated asset (S3/storage)
  thumbnailUrl?: string;
  metadata: {
    polygons?: number;     // For 3D models
    duration?: number;     // For audio
    dimensions?: [number, number]; // For images
    tokens?: number;       // For text
  };
  actualMana: number;      // Final mana cost (may differ from estimate)
}
```

## World Planner & Blueprints

> Designed 2026-10-16 with Alex: the player sees and shapes the plan before paying, **as a back-and-forth** ("those are the most engaging"). Reusing other players' creations: **not yet**.

The world planner is the one smart step between what a player asks for and the specialist generators. It never makes art itself: it writes a **blueprint**, a structured plan the cheaper specialist models carry out. One planner means one art direction (five separate Meshy calls would give five styles), a price before anything is spent, and one place for safety checks.

```text
"a quiet floating tea garden at dusk"
        │
        ▼
  World planner (Claude Opus 5.5) ──► blueprint v1 + a reply ("Here's your garden: a moon bridge,
        ▲                               five lanterns, koi pond. Red lacquer on the bridge?")
        │                                    │
        │  chat turn ("make it night,        ▼
        │  drop the koi") → blueprint v2   Ghost preview in the world: voxel terrain renders for real
        │                                  (free), every asset is a labeled ghost box at its spot
        │  direct edits on the card                  │
        └── (remove, swap, resize: free) ◄─────────┘
                                                     │  "Manifest — ≈ 376 mana"
                                                     ▼
  reserve the estimate → generators run in parallel → each ghost box materializes as its asset arrives
  → settle what each item actually cost (a failed item releases its share; the planner can retry it)
```

**The conversation.** The planner always answers with two things: a short, warm reply (what it made, one or two questions or suggestions as tappable chips) and a new blueprint version. The player can talk ("bigger pond", "more like Ghibli"), tap a chip, or edit the blueprint card directly. Direct edits are local and free; talking costs a planner turn. After manifesting, the same loop works on single items ("make that lantern taller" → a one-item plan → one regeneration).

**The Ghost preview is the hook.** The wireframe look is already Aweborn's language for "dreamed, not yet real" (a *blueprint preview*, not the Ghost *worlds* on the map, which are fully playable). A blueprint *is* a dream: the voxel terrain is generated from blueprint parameters (deterministic, in-browser, free), so the player stands in the real landscape while the assets wait as wireframes. Manifesting turns them solid one by one.

**Right-sized.** A whole world gets the full planner. "Add a lantern" gets a tiny plan (one small call + one Meshy object). The planner picks quick vs full quality per item and says so in the estimate.

### The planner's voice

> Alex, 2026-10-16: *"terse, but give them breathing room to think and create thoughtfully. Maybe even probing their curiosities and leading them gently through their own stream of thought."*

The planner is a quiet companion, not a salesperson. The world is the player's; the planner helps them find it.

- **Short.** One to three sentences per reply. The Ghost preview shows what changed, so the words don't have to.
- **One question at a time**, and only one worth asking. Prefer the senses and feelings ("What do you hear when you stand on the bridge?") over specs ("How many lanterns?").
- **Use their words.** If they said "quiet", the planner says "quiet", not "serene ambience".
- **Follow their thread.** Notice what they keep coming back to and ask about it. Lead gently, never steer them toward what's cheaper or easier to make.
- **Leave room.** Two or three chips plus an open "something else…". Silence is fine; the planner never nags, never pushes to manifest, never says "Ready to manifest?" unprompted more than once.
- **Honest about cost** when it matters ("A waterfall adds about 60 mana"), never as pressure.

Example:

```text
Player:  a quiet floating tea garden at dusk
Planner: A small island, a moon bridge, a few lanterns just lit. What makes it quiet for you?
         [no wind] [far from everything] [water sounds] [something else…]
Player:  far from everything. like nobody knows it's there
Planner: Then maybe it hides. Clouds below, nothing on the horizon. Should anyone ever find it?
         [a hidden path] [only by invitation] [no one] [something else…]
```

### Blueprint shape (draft)

```typescript
// shared/blueprint.ts (draft)
interface Blueprint {
  id: string;                  // stable across versions
  version: number;             // every planner turn or direct edit bumps it
  worldId: string;
  style: {
    artDirection: string;      // carried into every asset prompt
    palette: string[];         // hex colors
    lighting: string;          // "low golden dusk"
    timeOfDay?: string;
  };
  terrain: {
    kind: "voxel";
    size: [number, number, number];           // grid cells
    seed: number;
    blocks: { id: string; name: string; color: string; surface?: "blocks" | "smooth" }[];  // see Smooth voxels
    features: {                               // a deterministic generator turns these into the grid
      type: "plateau" | "hill" | "pond" | "path" | "cliff" | "floating-island";
      at: [number, number, number];
      radius: number;
      height?: number;
      block: string;
    }[];
  };
  assets: {
    key: string;               // "moon-bridge"
    kind: "model" | "terrain-piece" | "texture" | "music" | "ambience" | "voice" | "sfx";
    prompt: string;            // already includes the art direction
    quality: "quick" | "full";
    at?: [number, number, number];
    size?: [number, number, number];
    rotationY?: number;
  }[];
  lore?: { name: string; text: string };
  physics?: Partial<{ gravity: number; friction: number; waterLevel: number }>;
  estimate: { items: { key: string; mana: number }[]; planner: number; total: number };
}
```

### Decided

- **Every chat turn counts** against the pool and the player's personal cap (≈ 2–6 mana each), like any creation. No turn is "free with the manifest" (Alex, 2026-10-16: every request that costs money is counted)
- **No turn limit and no nagging.** The personal cap is the only limit; the planner never rushes the player (see [voice](#the-planners-voice))

### Open

- Reuse of existing assets (other players' creations, with credit): **later** (Alex, 2026-10-16); the archive below keeps it possible

## Creation Archive

> Alex, 2026-10-16: *"all these objects get saved in an S3 bucket… whenever we make a call, we save the responses. That way we can study how worlds get created and edited and improve on it."*

- **Two buckets.** `aweborn-assets` (public via CloudFront: the GLBs, images and audio that `assetUrl` points to, content-addressed `assets/<sha256>.<ext>` so identical files are stored once) and `aweborn-creation-archive` (private, never public).
- **What the archive keeps:** every provider call (provider, model, parameters, prompt, raw response metadata, latency, billed cost, asset hash) at `calls/<yyyy>/<mm>/<dd>/<callId>.json`; every planner turn and blueprint version at `sessions/<sessionId>/<version>.json`; manifest outcomes (what was kept, retried, deleted later). Edits after manifesting come from the World CRDT history the sync-service already persists.
- **Keyed for research, attached to the player** ([RESEARCH.md](../RESEARCH.md) principles 1–3; Alex, 2026-10-16). Every session belongs to the player who made it, but the link lives in its own place:
  - Archive objects carry only a `researchId` (random, one per player, not the account id or email).
  - A separate restricted table `research_identity (research_id, player_id, created_at)` in the sync-service maps it back. Research queries and exports never join it; only the service (and Alex, for support or replay) reads it.
  - **Replay works:** look up the player's `researchId`, pull their sessions and calls in order, and re-run them (same blueprint versions, same seeds, same voxel generator) to reproduce a creation step by step. The same pattern as Phase 09 flight traces.
  - **Deleting an account deletes the mapping row.** The traces stay for research but can no longer be tied to anyone. Assets in worlds stay with the world.
  - **The Privacy page must say we keep prompts and creation history, and how this link works, before this ships.**
- Storage is an infrastructure draw (Form 990 program, purpose `servers`), never the creative share. At today's scale it's cents a month (S3 Intelligent-Tiering).
- Both buckets in CloudFormation, like every other AWS resource.

## Tasks

### Interior Movement & Physics

> Added during the 2026-10-03 reconciliation. Phase 04 remapped the action map for world interiors, but the player cannot actually move inside a world yet. Building tools are useless without this, so do it first. Mana is **not** required; this can start before Phase 05.

- `[x]` Create `src/systems/InteriorController.ts` *(2026-10-17; **standard WASD** per Alex: W/S move, A/D strafe, Q/E turn, R/F look, Space jump + jetpack, K sprint)*: first/third-person movement using the Phase 04 interior action map (V=jump/jetpack, W/E=look, Q/R=move, A/F=strafe, S=back, Space=crouch, K=sprint)
- `[x]` Read per-world physics from World CRDT `Y.Map("physics")` (gravity vector, friction, air resistance, bounce, water level) and apply to player movement
- `[x]` *(Decided 2026-10-17: custom kinematic controller, `shared/sim/interior.ts`, deterministic: no trig, fixed 60 Hz, 11 tests.)* Choose physics engine (e.g., Rapier via `@react-three/rapier`) vs. custom kinematic controller — decide and log. **Constraint ([Phase 09](./09-authoritative-flight.md), 2026-10-12):** movement must be a deterministic step in `shared/sim` that also runs on the server (prediction + authority + offline replay). Rapier only with its cross-platform determinism build
- `[x]` *(placed objects = scaled AABBs, rotation ignored for now)* Collision with ground grid + placed objects (every world: Ghost vs solid is only the universe-map look, interiors are identical, per Alex 2026-10-17)
- `[x]` *(third-person follow, new; not CameraController)* Camera for interiors (reuse `CameraController` presets where possible)
- `[x]` *(2026-10-17; + facing; in-world players hidden on the universe map; Alex verified with two tabs)* Broadcast interior position via presence (`inWorld: worldId`) so players see each other inside worlds
- `[x]` *(2026-10-17: touch = stick turns/looks, thumb walks, pull back = backward, JUMP/SPRINT; gamepad = left stick walk/strafe, right stick turn/look, A jump, X/L3 sprint. Alex testing touch on prod; gamepad untested)* Touch + gamepad mappings for interior mode
- `[x]` *(2026-10-17, minimal per Alex: everything kickable; N / touch KICK / pad B kicks the object in front; `kick {v, t}` on the object, every client runs `kickedPosition` (deterministic), any client settles after 4 s = 2 CRDT writes per kick. Will be reworked.)* Event-sourced physics objects (kick/push → velocity written to CRDT) per ROADMAP "Event-Sourced Physics"

### Research: API Costs & Mana Formula
- `[x]` Researched 2026-10-14/16 → **[MANA_COSTS.md](../MANA_COSTS.md)** (per-item costs, bundles, model tiers, voxel terrain, proposed caps). The checklist below is kept for history
- `[x]` Research current pricing for each modality:
  - Meshy AI: cost per 3D model generation
  - Image generation: cost per image (DALL-E, Stability, etc.)
  - Music generation: cost per minute of audio
  - Voice generation: cost per minute of speech
  - Text generation: cost per 1K tokens
  - Terrain generation: cost per heightmap (if using AI, or procedural = free)
- `[ ]` Design abstract mana cost formula:
  - NOT tied to specific model/provider (so we can swap)
  - Based on observable output metrics where possible (e.g., complexity, duration, resolution)
  - Real cost × `K` (`K = 100`, 1 mana = $0.01 of compute); **no margin** (retired 2026-10-13)
  - Document in a `MANA_COSTS.md` reference file
- `[ ]` Define cost tiers (August ROADMAP placeholders rescaled to `K = 100`; replace with measured cost × K, e.g. a $0.30 generation = 30 mana):
  ```
  Simple object (low-poly, basic shape):    10-50 mana
  Complex object (detailed, textured):      50-200 mana
  Character/avatar (full 3D model):         200-1k mana
  Texture/image (applied to object):        5-20 mana
  Music loop (30-60 seconds):               50-200 mana
  Voice clip (10-30 seconds):               20-100 mana
  Text/lore (paragraph):                    1-5 mana
  Terrain patch (landscape section):        100-500 mana
  ```

### World Planner & Blueprints
- `[x]` `shared/blueprint.ts`: the Blueprint type + Zod validator (the planner's output is parsed and validated, never trusted) (2026-10-17: hand-written validator instead of Zod so the client imports it with no deps)
- `[x]` Decide orchestration → **SQLite job table in workflow shape** (Alex, 2026-10-16)
- `[~]` Planner system prompt written to [the voice](#the-planners-voice); test it on real first prompts before launch (2026-10-17: v1 in `server/sync-service/src/planner.ts`; reads well on Opus 5.5 and DeepSeek v4 Pro)
- `[ ]` Deterministic voxel terrain generator from `terrain` parameters, shared by client (preview) and server (manifest)
- `[x]` `POST /plan`: prompt or chat turn + current blueprint → planner (Claude Opus 5.5, structured output) → reply + chips + next version; estimate from the cost table (2026-10-17: `/api/player/plan` in sync-service → genai `/llm` on OpenRouter; model picker; one repair retry; sessions in memory, TODO persist)
- `[ ]` Safety check on every blueprint before it's shown (and again before manifest)
- `[x]` Planner turns admitted and drawn like any creation (Phase 05 reserve → settle) (reserve 10, settle billed cost: Opus ≈ 5 mana/turn, DeepSeek ≈ 0.7)
- `[ ]` `POST /plan/:id/manifest`: reserve the whole estimate, fan out per asset, settle per item, release failed items, offer retry
- `[~]` Client: blueprint chat panel (reply, chips, free direct edits on the card, version history) (2026-10-17: `PlannerPanel.tsx`, P key: reply, chips, model picker, read-only card; no direct edits or history yet)
- `[ ]` Client: Ghost preview (real voxel terrain + labeled wireframe boxes) and materialize-on-arrival
- `[ ]` Single-item loop after manifest ("make that lantern taller")

### Creation Archive
- `[ ]` CloudFormation: `aweborn-assets` (public via CloudFront, content-addressed) + `aweborn-creation-archive` (private, Intelligent-Tiering)
- `[ ]` genai-service writes every provider call + response, every planner turn and blueprint version, every manifest outcome
- `[ ]` `researchId` per player in archive objects; `research_identity` mapping table kept separate (never joined into research exports); deleting the account deletes the row
- `[ ]` Replay tool: rebuild a player's creation session from the archive (blueprint versions + seeds + calls)
- `[ ]` **Privacy page updated before launch** (prompts and creation history are kept for research)

### genai-service: Core Framework
- `[ ]` Implement the consistent request/response interface above
- `[ ]` Request validation middleware
- `[ ]` Mana admission: ask sync-service `requestDraw(player, estimate)` (pool − reserved, global cap, personal cap, priority queue) before proxying to the AI API; denial = "The world must be replenished…"
- `[ ]` Reserve → settle: reserve the estimate → generate → draw the actual cost
- `[ ]` Task queue: track in-progress generations (in-memory or Redis)
- `[ ]` Status polling endpoint (`GET /generate/status/:id`)
- `[ ]` Asset storage: upload completed assets to S3 or Lightsail object storage
- `[ ]` Cost table endpoint (`GET /generate/cost`) — returns current mana prices
- `[ ]` Rate limiting per player = Phase 05 personal caps (one mechanism, not two)
- `[ ]` Error handling: failed generations draw nothing (release the reservation)

### genai-service: 3D Model Generation (Meshy AI)
- `[ ]` Migrate Meshy AI integration from `tokbot-backend/functions/src/avatars/`
- `[ ]` Text-to-3D API call → receive GLB model
- `[ ]` Status polling / webhook for completion
- `[ ]` Thumbnail generation from 3D model
- `[ ]` Upload GLB + thumbnail to object storage
- `[ ]` Return asset URLs in GenerateResult

### genai-service: Image Generation
- `[ ]` **[SEAM]** Evaluate providers: Stability AI, DALL-E, Flux, etc.
- `[ ]` Implement proxy to chosen provider
- `[ ]` Parameters: style, resolution, aspect ratio
- `[ ]` Use cases: object textures, world paintings, decals, skyboxes
- `[ ]` Upload generated image to storage

### genai-service: Music Generation
- `[ ]` **[SEAM]** Evaluate providers: Suno, MusicGen, Udio, etc.
- `[ ]` Implement proxy to chosen provider
- `[ ]` Parameters: genre, mood, duration, tempo
- `[ ]` Use cases: world ambient soundtrack, music loops, interactive instruments
- `[ ]` Upload generated audio to storage

### genai-service: Voice Generation
- `[ ]` **[SEAM]** Evaluate providers: ElevenLabs, Play.ht, etc.
- `[ ]` Implement proxy to chosen provider
- `[ ]` Parameters: voice preset, emotion, speed, language
- `[ ]` Use cases: NPC voices, narration, recorded messages in worlds
- `[ ]` Upload generated audio to storage

### genai-service: Text Generation
- `[ ]` **[SEAM]** Evaluate providers: Gemini (recommended), GPT, Claude, etc.
- `[ ]` Implement proxy to chosen provider
- `[ ]` Parameters: tone, length, format
- `[ ]` Use cases: world lore, NPC dialogue, signs, object descriptions, names
- `[ ]` Content moderation/safety filtering
- `[ ]` Returns text directly (no storage needed)

### genai-service: Terrain Generation
- `[x]` **Decided (Alex, 2026-10-16):** default terrain is a **voxel grid** ("perfect grids have a nice feel", Minecraft-like), generated deterministically from blueprint parameters: free, offline-capable. AI terrain = **Meshy terrain pieces** (island, mesa, cliff, cave mouth) placed on the grid
- `[-]` ~~Evaluate approach: AI-based vs procedural~~ decided above
- `[ ]` Implement the voxel generator (see World Planner tasks) and terrain-piece placement

**Smooth voxels (proposal, Alex asked 2026-10-16: "have these voxel grids, but then smooth them?").** Yes, and it's a well-known technique. One grid, two looks:

- **Store density, not just solid/empty.** Each grid corner holds a number (negative inside, positive outside, like a signed distance). Blocky rendering only asks "is it inside?"; smooth rendering finds where the number crosses 0 between corners and puts the surface there.
- **Meshers** (all turn the grid into triangles; run per 32³ chunk in a Web Worker, then hand a `BufferGeometry` to three.js):
  - *Greedy meshing*: the crisp Minecraft look, merging flat faces into big quads.
  - *Surface Nets*: one vertex per cell, placed at the average of the zero-crossings. Simple (~150 lines), smooth, few triangles. **Recommended for smooth.**
  - *Marching Cubes*: the classic, a lookup table of 256 cases. three.js ships `MarchingCubes` in its addons, but it's built for metaballs in one fixed box, not chunked terrain.
  - *Dual Contouring*: smooth hills **and** sharp cliff edges, but needs surface normals per crossing; harder. Later, if Surface Nets looks too melted.
- **Per block type.** `surface: "blocks" | "smooth"` in the blueprint: hills and sand smooth, built stone crisp. The planner picks; players can flip it for free.
- **Looks:** normals from the density gradient (soft lighting); **triplanar texturing** (project the texture from x, y and z and blend), since smooth meshes have no natural UVs.
- **Physics stays on the grid, not the mesh.** The deterministic sim in `shared/sim` ([Phase 09](./09-authoritative-flight.md)) samples the density field (trilinear interpolation), which lands within a fraction of a cell of the smooth surface. The mesh stays purely visual, so client and server never disagree.
- **Libraries:** writing Surface Nets ourselves is small and keeps it deterministic; `isosurface` (npm, Mikola Lysenko) has reference versions; `three-mesh-bvh` for fast raycasts against the meshes (placing objects, picking).
- **To study:** Mikola Lysenko, *Smooth Voxel Terrain* (0fps.net, parts 1–2); Paul Bourke, *Polygonising a scalar field*; Boris the Brave, *Dual Contouring tutorial*; Eric Lengyel, *Transvoxel* (seams between levels of detail, much later).

- `[ ]` Density-field grid (signed values per corner) instead of booleans
- `[ ]` Greedy mesher (blocks) + Surface Nets mesher (smooth), per chunk, in a Web Worker
- `[ ]` Triplanar material for smooth surfaces
- `[ ]` Parameters: blocks, features, scale
- `[ ]` Use cases: world landscape base, custom terrain pieces

### Client: Creation UI (Inside World Interior)
- `[ ]` Create `src/components/creation/CreationPanel.tsx` — in-world creation interface
- `[ ]` Prompt input bar (text field + generate button)
- `[ ]` Type selector: model, image, music, voice, text, terrain
- `[ ]` Style/parameter controls per type
- `[ ]` Mana cost preview (shows estimated cost before confirming)
- `[ ]` Generation progress indicator (polling status)
- `[ ]` Preview generated result before placing in world
- `[ ]` Place in world: add asset to World CRDT with position/rotation/scale

### Client: Editing Tools (Free, Works Offline)
- `[ ]` Create `src/components/creation/EditTools.tsx`
- `[ ]` Move/position objects (drag or arrow keys)
- `[ ]` Rotate objects (handle or keyboard)
- `[ ]` Scale objects (handle or keyboard)
- `[ ]` Delete objects (free, no mana return)
- `[ ]` Duplicate objects (free — copies CRDT entry, no new generation)
- `[ ]` Color/tint adjustment (free)
- `[ ]` All edits work offline (CRDT operations, no server call)

### Client: Object Placement in World CRDT
- `[ ]` Extend World CRDT objects schema for AI-generated assets:
  ```typescript
  interface WorldObject {
    id: string;
    type: "primitive" | "ai-model" | "ai-image" | "ai-music" | "ai-voice" | "ai-text" | "ai-terrain";
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    assetUrl?: string;      // URL for AI-generated assets
    thumbnailUrl?: string;
    prompt?: string;        // The prompt that created this
    material?: string;      // For primitives
    color?: string;
    placedBy: string;       // Player ID
    createdAt: number;
    manaSpent: number;      // How much mana this cost
  }
  ```
  > **Schema note (2026-10-03):** the shipped `PlacedObject` in `shared/crdt-schema.ts` uses flat fields (`x, y, z, rotX…, scaleX…, material, placedBy, placedAt`). Either extend `PlacedObject` with the AI fields below or migrate existing objects to this nested shape. Decide before implementing.
- `[ ]` Render AI-generated assets in WorldInterior (load GLB, apply textures, play audio)
- `[ ]` Spatial audio for music/voice objects (proximity-based volume)

## Acceptance Criteria

- [ ] genai-service is running as a container on the k3s VPS
- [ ] At least one generation type works end-to-end (recommend: 3D model via Meshy)
- [ ] Mana is deducted for AI generation, refunded on failure
- [ ] Generated assets appear in the world and sync to other players via CRDT
- [ ] Editing (move, rotate, scale, delete) works offline and is free
- [ ] Cost table endpoint returns current mana prices
- [ ] Placeholder seams exist for all generation types (even if not all are implemented)
- [x] MANA_COSTS.md documents the cost formula and current rates (2026-10-14/16)
- [ ] A prompt becomes a blueprint the player can shape in a back-and-forth, preview as a Ghost, and manifest at the estimated price
- [ ] Every provider call, planner turn and blueprint version lands in the creation archive (Privacy page updated first)

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `server/genai-service/src/index.ts` | MODIFY | Replace placeholders with real routes |
| `server/genai-service/src/routes/` | NEW | Per-type route handlers |
| `server/genai-service/src/providers/` | NEW | AI provider adapters (Meshy, etc.) |
| `server/genai-service/src/storage.ts` | NEW | Asset upload to S3/storage |
| `server/genai-service/src/mana.ts` | NEW | Mana pre-check + deduction via sync-service |
| `src/components/creation/CreationPanel.tsx` | NEW | In-world creation UI |
| `src/components/creation/EditTools.tsx` | NEW | Free editing tools |
| `src/components/WorldInterior.tsx` | MODIFY | Render AI-generated assets |
| `shared/crdt-schema.ts` | MODIFY | Add WorldObject.assetUrl and related fields |
| `MANA_COSTS.md` | NEW (done) | Cost formula documentation |
| `shared/blueprint.ts` | NEW | Blueprint type + validator |
| `shared/voxel-terrain.ts` | NEW | Deterministic voxel generator (client preview + server) |
| `server/genai-service/src/planner.ts` | NEW | World planner (`POST /plan`, manifest) |
| `server/genai-service/src/archive.ts` | NEW | Creation archive writer (S3) |
| `src/components/creation/BlueprintPanel.tsx` | NEW | Planner chat, chips, direct edits, Ghost preview |
| `infra/cloudformation-assets.yml` | NEW | `aweborn-assets` + `aweborn-creation-archive` buckets |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| 2026-10-16 | **World Planner & Blueprints designed** with Alex (during the Phase 05 session): plan first, then manifest; the planner (Claude Opus 5.5) writes a blueprint the player shapes **in a back-and-forth** (reply + chips + free direct edits), previewed as a Ghost (real voxel terrain + wireframe assets), manifested at the estimated price with per-item settle. **Creation Archive** (Alex): save every call and response, every blueprint version, in S3 for research (private archive + public content-addressed assets bucket; research ids, Privacy page first). Terrain decided: voxel grid default + Meshy terrain pieces. Providers filled in from [MANA_COSTS.md](../MANA_COSTS.md). Reusing other players' assets: later. | Open: do chat turns count against the personal cap; turn limit. Implementation waits on Phase 05 Flow & Admission + Interior Movement |
| 2026-10-16 (later) | Alex's follow-ups: **every request that costs money counts** (chat turns included; no free first plan; no turn limit, the personal cap is the limit). **Planner voice** written (terse, one question at a time, use their words, follow their thread, never rush; example exchange). **Sessions attach to the player** through a separate `research_identity` table (never joined into research exports); traces replayable; deleting the account deletes the mapping. **Orchestration** options table (Temporal / Restate / DBOS / SQLite job table) + Zod as the TS Pydantic. **Standing rule** added to the README Session Protocol: Terms / Privacy / giving pages change with the decisions. Privacy (Oct 16): donation amounts and dates appear in the public ledger, never names. Giving page links the live pool and ledger. | Alex: pick orchestration (proposal: SQLite job table in workflow shape). Then Phase 05 Flow & Admission |
| 2026-10-16 (evening) | Alex: **orchestration = SQLite job table** in workflow shape (natural path to a hosted DB later). **Smooth voxels** proposal written (density grid; greedy meshing for blocks, Surface Nets for smooth, per block type `surface`; triplanar texturing; physics samples the density field, not the mesh, so Phase 09 determinism holds; study list). Phase 05 admission (`requestDraw`) now exists for every paid call. | Interior Movement first; then `shared/blueprint.ts` (Zod) + voxel generator |
| 2026-10-17 | **Interior Movement built** (Alex tested: "that worked"). Deterministic kinematic step in `shared/sim/interior.ts` (walk/sprint, jump, jetpack with fuel, swim, per-world gravity/friction/drag, AABB collision, 40×40 bounds; no trig so the server can replay it, Phase 09) + `InteriorController` + follow camera and capsule avatar in `Scene.tsx` (replaces the orbiting camera). Keys switched to standard WASD inside worlds. Also: dev panel places new worlds 10 u ahead; the bottom hint banner was removed. Local sync container was stale (no `better-auth`), rebuilt. | Next: presence inside worlds (see each other), touch/gamepad jump button; ROADMAP key table is stale (Alex to OK an edit) |
| 2026-10-17 (later) | **Presence inside worlds**: interior position + facing broadcast (`PlayerPresence.facing`, optional); other players in the same world drawn as capsules; players inside a world hidden on the universe map. Alex: two tabs, "saw two pills!!!" | Next: touch/gamepad interior controls |
| 2026-10-17 (evening) | Touch + gamepad interior controls; interior camera forced upright (entering at a roll tilted it); **kick** (event-sourced physics, minimal). Interior Movement task group done. | Next per Alex; Phase 07 build continues (Research: API costs, then planner) |
| 2026-10-17 | **World Planner v1.** `OPENROUTER_API_KEY` replaces the `LLM_API_KEY` placeholder (agent-runner too). `shared/blueprint.ts` (types, cost-table estimate, clamping validator); genai `POST /llm` (OpenRouter, archives every call with model + billed cost); sync `POST /api/player/plan` (server-held history, reserve → settle, repair retry); `PlannerPanel` (P, DEV-gated). Real turns: Opus 5.5 ≈ $0.05, DeepSeek v4 Pro ≈ $0.007. Next: Ghost preview (voxel terrain from the blueprint), then Manifest. |
