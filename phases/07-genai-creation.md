# Phase 07: World Creation & Gen AI

**Status:** `[~]` In Progress: planner, Meshy, Library, editing, interiors shipped; image/music/voice/text, Studio open; smooth voxels rough draft shipped (Rough Draft M5)
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
- `[x]` Client: blueprint chat panel (reply, chips, free direct edits on the card, version history) (2026-10-17: `PlannerPanel.tsx`, P key: reply, chips, model picker, read-only card. 2026-10-27 M5c: per-item remove / smaller / bigger / reword, rename, Undo, History with Restore)
- `[ ]` Client: Ghost preview (real voxel terrain + labeled wireframe boxes) and materialize-on-arrival
- `[ ]` Single-item loop after manifest ("make that lantern taller")

### Creation Archive
- `[ ]` CloudFormation: `aweborn-assets` (public via CloudFront, content-addressed) + `aweborn-creation-archive` (private, Intelligent-Tiering)
- `[ ]` genai-service writes every provider call + response, every planner turn and blueprint version, every manifest outcome
- `[ ]` `researchId` per player in archive objects; `research_identity` mapping table kept separate (never joined into research exports); deleting the account deletes the row
- `[ ]` Replay tool: rebuild a player's creation session from the archive (blueprint versions + seeds + calls)
- `[ ]` **Privacy page updated before launch** (prompts and creation history are kept for research)

### genai-service: Core Framework
> *Reconciled 2026-10-27 against code: the shape differs from the plan (sync-service fronts every paid call; genai is cluster-internal with `/jobs`, `/llm`, `/library`), but the jobs are done.*
- `[~]` Implement the consistent request/response interface above *(per-kind routes `/jobs` (Meshy) + `/llm`; 2026-10-27 M5: `/jobs` also takes `image | sound | music | voice` with `params {seconds, loop}`, routed to `media.ts`)*
- `[x]` Request validation middleware *(per route; sync-service validates player input first)*
- `[x]` Mana admission: ask sync-service `requestDraw(player, estimate)` (pool − reserved, global cap, personal cap, priority queue) before proxying to the AI API; denial = "The world must be replenished…" *(`creations.ts` → `ManaAdmission`)*
- `[x]` Reserve → settle: reserve the estimate → generate → draw the actual cost
- `[x]` Task queue: track in-progress generations (in-memory or Redis) *(SQLite jobs + `MAX_CONCURRENT_JOBS = 4`; holds persisted in `creations`)*
- `[x]` Status polling endpoint (`GET /generate/status/:id`) *(`GET /jobs/:id`)*
- `[x]` Asset storage: upload completed assets to S3 or Lightsail object storage *(`aweborn-assets` + CloudFront, content-addressed)*
- `[~]` Cost table endpoint (`GET /generate/cost`) — returns current mana prices *(2026-10-27 M5: estimates live in [`shared/make-costs.ts`](../shared/make-costs.ts), shared by client and server; the Make panel shows the hold before you submit. No endpoint yet)*
- `[x]` Rate limiting per player = Phase 05 personal caps (one mechanism, not two)
- `[~]` Error handling: failed generations draw nothing (release the reservation) *(built; verify a failed Meshy job releases its hold. 2026-10-27 M5: holds no longer depend on the maker's tab: `sweepCreations` settles/releases unwatched jobs every minute and returns any hold older than 6 h)*

### genai-service: 3D Model Generation (Meshy AI)
- `[-]` ~~Migrate Meshy AI integration from `tokbot-backend/functions/src/avatars/`~~ written fresh in `providers.ts`
- `[x]` Text-to-3D API call → receive GLB model *(preview → refine with PBR)*
- `[x]` Status polling / webhook for completion *(polling, resumable)*
- `[x]` Thumbnail generation from 3D model *(client-rendered, uploaded once, 2026-10-23)*
- `[x]` Upload GLB + thumbnail to object storage
- `[x]` Return asset URLs in GenerateResult *(`PlacedObject.asset`)*

### genai-service: Image Generation
- `[x]` **[SEAM]** Evaluate providers: Stability AI, DALL-E, Flux, etc. *(2026-10-27 M5: OpenRouter, default `IMAGE_MODEL = microsoft/mai-image-2.6-flash` ≈ $0.02. Gemini image was the plan, but the OpenRouter account enforces zero data retention and every Gemini image endpoint refuses it; Alex to confirm)*
- `[x]` Implement proxy to chosen provider *(`server/genai-service/src/media.ts`; WebP ≤ 1024 px via sharp)*
- `[~]` Parameters: style, resolution, aspect ratio *(square 1024 only; style goes in the prompt)*
- `[~]` Use cases: object textures, world paintings, decals, skyboxes *(framed pictures in worlds; textures/decals/skyboxes later)*
- `[x]` Upload generated image to storage *(`media/<sha256>.webp`; served by the box until the assets stack lets CloudFront read `media/*`, then `MEDIA_CDN=1`)*

### genai-service: Music Generation
- `[~]` **[SEAM]** Evaluate providers: Suno, MusicGen, Udio, etc. *(2026-10-27 M5: ElevenLabs music + sound effects (one key); **key not set yet**, so a synthesized stand-in plays)*
- `[~]` Implement proxy to chosen provider *(`media.ts`; untested against the real API until the key lands)*
- `[~]` Parameters: genre, mood, duration, tempo *(length: sound 3/8/20 s, music 15/30/60 s; the rest goes in the prompt)*
- `[~]` Use cases: world ambient soundtrack, music loops, interactive instruments *(a world's own sound (creators/builders) + sound/music orbs; no instruments)*
- `[x]` Upload generated audio to storage *(`media/<sha256>.mp3`)*

### genai-service: Voice Generation
- `[~]` **[SEAM]** Evaluate providers: ElevenLabs, Play.ht, etc. *(2026-10-27 M5: ElevenLabs TTS; key pending, stand-in until then)*
- `[~]` Implement proxy to chosen provider *(`media.ts`)*
- `[~]` Parameters: voice preset, emotion, speed, language *(one default voice; ≤ 600 characters)*
- `[~]` Use cases: NPC voices, narration, recorded messages in worlds *(voice orbs that speak once as you walk up, then rest; no NPCs)*
- `[x]` Upload generated audio to storage

### genai-service: Text Generation
- `[x]` **[SEAM]** Evaluate providers: Gemini (recommended), GPT, Claude, etc. *(2026-10-27 M5: Claude Haiku via OpenRouter `/llm`, `LORE_MODEL`, ≈ 0.02 mana a sign)*
- `[x]` Implement proxy to chosen provider *(`POST /api/player/lore` → `writeLore` in `creations.ts`)*
- `[~]` Parameters: tone, length, format *(fixed: 2–5 sentences, under 90 words)*
- `[~]` Use cases: world lore, NPC dialogue, signs, object descriptions, names *(lore signs only)*
- `[x]` Content moderation/safety filtering *(the M1 safety check on the prompt **and** on the written text)*
- `[x]` Returns text directly (no storage needed) *(stored only as the sign's text in the world doc)*

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

- `[~]` Density-field grid (signed values per corner) instead of booleans: *rough draft (M5e) derives the field from the block grid per chunk (occupancy, blurred, clamped) instead of storing densities; the grid stays the truth*
- `[~]` Greedy mesher (blocks) + Surface Nets mesher (smooth), per chunk, in a Web Worker: *Surface Nets shipped in M5e ([`shared/surfaceNets.ts`](../shared/surfaceNets.ts)), on the main thread (~3 ms per hilly 32×32 chunk on a laptop); blocks keep the face-culled mesher (not greedy); Web Worker later*
- `[ ]` Triplanar material for smooth surfaces *(M5e uses vertex colours + smooth normals, no textures yet)*
- `[ ]` Parameters: blocks, features, scale
- `[ ]` Use cases: world landscape base, custom terrain pieces

### Client: Creation UI (Inside World Interior)
- `[ ]` Create `src/components/creation/CreationPanel.tsx` — in-world creation interface
- `[ ]` Prompt input bar (text field + generate button)
- `[~]` Type selector: model, image, music, voice, text, terrain *(2026-10-27 M5: Object · Picture · Sound · Music · Voice · Lore radio chips in `CreatePanel.tsx`; terrain stays the planner's free Shape terrain)*
- `[~]` Style/parameter controls per type *(length for sound/music, Loop switch for sounds)*
- `[x]` Mana cost preview (shows estimated cost before confirming) *("Holds up to N mana · you're only charged what it really costs")*
- `[x]` Generation progress indicator (polling status) *(makings list with progress bar)*
- `[ ]` Preview generated result before placing in world
- `[x]` Place in world: add asset to World CRDT with position/rotation/scale *(`placeModel` / `placeMedia`, a few steps ahead, facing you)*

### Client: Editing Tools (Free, Works Offline)
- `[x]` Create `src/components/HeldItemBar.tsx` (in-world editing controls while carrying an object)
- `[x]` Move/position objects (GRAB / `G`, follows player)
- `[x]` Rotate objects (`⟲`/`⟳` or `Z`/`X`)
- `[x]` Scale objects (`−`/`+` or `-`/`=`)
- `[x]` Delete objects (free, no mana return; `🗑` button or `Backspace`/`Delete` while carrying)
- `[x]` Duplicate objects (free — copies CRDT entry via `duplicateObject`, no new generation; `⧉` button while carrying)
- `[x]` Color/tint adjustment (free — `recolorObject` for blocks & shapes while carrying)
- `[x]` All edits work offline (CRDT operations, no server call)

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
- `[x]` Render AI-generated assets in WorldInterior (load GLB, apply textures, play audio) *(2026-10-27 M5: [`MediaObjects.tsx`](../src/components/MediaObjects.tsx): framed pictures, glowing sound orbs, lore signs; `PlacedObject` stayed flat, plus `media`, `loop`, `volume`, `text`; `WorldMeta.ambientSound`)*
- `[x]` Spatial audio for music/voice objects (proximity-based volume) *(PannerNode on the audio engine's world bus; loops within 34 u, one-shots within 5 u then rest)*

## Acceptance Criteria

- [ ] genai-service is running as a container on the k3s VPS
- [ ] At least one generation type works end-to-end (recommend: 3D model via Meshy)
- [ ] Mana is deducted for AI generation, refunded on failure
- [ ] Generated assets appear in the world and sync to other players via CRDT
- [ ] Editing (move, rotate, scale, delete) works offline and is free
- [ ] Cost table endpoint returns current mana prices
- [x] Placeholder seams exist for all generation types (even if not all are implemented) *(2026-10-27 M5: model, image, sound, music, voice, lore; audio is a stand-in until the ElevenLabs key)*
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
| `infra/cloudformation-assets.yml` | NEW | `aweborn-assets` + `aweborn-creation-archive` buckets (M5: CloudFront may read `media/*`) |
| `server/genai-service/src/media.ts` | NEW | Picture (OpenRouter), sound/music/voice (ElevenLabs), stand-ins (M5) |
| `shared/make-costs.ts` | NEW | Make kinds, lengths, estimates (M5) |
| `src/components/MediaObjects.tsx` | NEW | Pictures, sound orbs (positional audio), lore signs, world sound (M5) |
| `src/vendor/input-switch-polyfill.js` | NEW | Vendored `<input switch>` polyfill, CSS inlined (M5) |

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
| 2026-10-17 | **Planner archive + Ghost preview.** Every planner turn is saved for replay (Alex: "we save everything"): `plan_sessions` + `plan_events` in the sync DB (user message, every LLM request + raw response incl. invalid/repair, validated turn + blueprint version), covered by the hourly S3 backup; `GET /api/player/plan?worldId=` resumes the last plan on entering a world. `shared/voxel.ts`: deterministic voxel generator (integer hash noise, no trig), merged colliders flagged `step`, visible-cell list; `STEP_UP` in the interior sim lets players walk up one voxel (placed objects still block). `GhostPreview`: instanced voxel terrain that rises in per version + floating wireframe assets with labels; ◇ toggles it. Grid limit 40 (matches interior bounds). Next: Manifest (blueprint assets → Meshy jobs → placed models; terrain written to the World CRDT). |
| 2026-10-17 | **Manifest v1.** `POST /api/player/plan/manifest`: one hold + Meshy job per model/terrain-piece asset (prompt + art direction; preview quality), other kinds reported as "later"; logged as a `manifest` event. Client writes the voxel terrain params to the World CRDT (`terrain.voxel`, JSON string, last writer wins) so every visitor regenerates the same walkable grid (`WorldTerrain`); each finished model is placed at its blueprint cell, scaled to its size, tagged `planKey` (hides its ghost). Planner panel shows per-item progress; polling continues with the panel closed. Next: refine ("full") quality, re-manifest of single items, moving/rotating placed items. |
| 2026-10-17 | Privacy + Terms cover AI creation (kept for research, providers listed). **DeepSeek dropped** from the planner (Alex; no China processing), Privacy says so. **DEV gate lifted**: Create (C) and Planner (P) ship to prod. Fixes from Alex's first manifest: 200 MB GLB limit (Meshy files > 50 MB), creation holds persisted (`creations` table), manifest jobs resume on reload, camera zoom 1-4 inside worlds, daylight on voxel terrain. **Open (Alex):** a whole world (~350 mana) exceeds the personal daily cap, so most items were refused: raise the cap, let manifests exceed it, or have the planner size worlds to what is left today. |
| 2026-10-17 | **Caps raised (Alex):** maker 150→600, explorer 250→1000, +50/level, max 2500, p_solo 1200 (a whole textured world must fit in a day; MANA_COSTS.md still shows the old numbers). **Textured models:** Meshy preview → refine (`enable_pbr`), resumable via `refine:<task>`; $0.60 = 60 mana per model. Generated models no longer spin or bob. Voxel lighting: directional-led + stronger per-block shade (flat light hid the ground). Next: redo a single item, move/rotate placed items, direct blueprint edits. |
| 2026-10-17 | **Asset library (Alex: "a huge library of assets that others can use").** New `aweborn-assets` stack (`infra/cloudformation-assets.yml`, validated, **not yet deployed**): private versioned bucket, `models/` public via CloudFront at assets.aweborn.org (SimpleCORS), `archive/` private; IAM user `aweborn-genai-writer` (put/get, no delete). genai-service: `library` table (sha, prompt, kind, provider, job, bytes, s3), every finished model uploaded + catalogued, every archive entry written as its own private object, startup backfill of existing files + legacy archive; `/assets/*` 301s to the CDN once a file is in S3 (sync proxy passes redirects through); `GET /library?q=`. **Redo one item:** ↻ on each blueprint item, optional note rewrites its prompt (direct edit = new version, logged `edit`), one textured job, file swapped in place keeping position/rotation. **Grab:** G picks up the object in front, it follows you (≤10 CRDT writes/s, everyone sees it), Z/X turn it, G sets it down. Next: library browser (place anyone's creation), touch/gamepad for grab. |
| 2026-10-18 | **Creations hung at 99% (fixed, deployed `71a99de`).** Two causes. (1) Client: `CreatePanel`/`PlannerPanel` polled in an effect that only re-armed on state change, so one non-OK poll (the 503 below) ended polling for good; a `pollTick` now re-arms after every round. (2) Server: genai had a **100m CPU limit**, and the in-process gltf optimize of a 20 MB model took ~40 s and froze the event loop, so `/jobs/:id` failed. Optimize now runs in a **child process** (`ensureOptimizedIsolated`) and the limit is **1000m**. The job itself had completed; only the client gave up. |
| 2026-10-18 | **Library Remove + admin Trash (deployed `905733f`; Alex's design).** Makers remove their own assets with a small ✕ in the Library (inline confirm; hidden for everyone). Soft delete only: `library.removed_at/removed_by`, files kept, **placed copies keep working**, removed assets can't be newly placed. `public/admin-trash.html` (token = `MANA_ADMIN_TOKEN`, held in sessionStorage): list with Restore and Delete forever. API in `sync-service/src/trash.ts` (`/api/player/library/:sha/remove`, `/api/admin/library/:sha/remove`, `/api/admin/trash`, `…/restore`, `DELETE …/trash/:sha`); genai holds the data. Planner-made assets have no maker, so admin-only. Terms + Privacy updated (Oct 18). The test asset (`7367a9ed…`, "sensual and voluptuous woman") and its placed object `obj-33wukv` were removed to the trash (object JSON at `/data/trash-obj-33wukv.json` in the sync pod). **Open: Delete forever needs `s3:DeleteObject`; the assets IAM user is put/get only, so purge fails safely (before touching local files) until that is granted.** Next: the same trash for placed objects removed inside a world. |
| 2026-10-18 | **Security: genai-service locked to the cluster (`64de577`).** `api.aweborn.org` proxied genai to the internet, so `POST /jobs` (Meshy spend) and `POST /llm` (OpenRouter spend) had no auth. Caddy now serves only `/health` on that host, and genai refuses any non-`/health` request carrying `X-Forwarded-For` (second lock). Nothing in the game used that host (the client goes through `sync.aweborn.org`). |
| 2026-10-19 | **Decisions (Alex):** (1) **No trash for placed objects**: removing one from a scene just removes it; trash exists only to retire a *model* from the Library while keeping its data. Superseded the "same trash for both" note. (2) Manifest tested end to end: works. (3) **Refine-quality pass: dropped for now** (a model already costs close to $1). (4) Single-item re-make already shipped (↻). (5) **Worlds are built in stages**: terrain/lore/setting first, then models, later sound, voices, personas/behaviors, terrain editing, all in a future creative **Studio**. **Built (uncommitted, tsc clean):** terrain is its own free action ("Shape terrain", written straight from the blueprint, no server call); models are made separately ("Make models" for all, or ✦ per blueprint item, via the existing `keys` filter on `/plan/manifest`). **Open:** commit + deploy; log terrain shaping as a planner event; Studio design (`/grill-me`). |
| 2026-10-19 | **Bigger, chunked worlds (uncommitted, tsc + 20 shared tests pass).** Default world is now **320 x 16 x 320** (~100x the old 32x32 area; `LIMITS.world = 320` for x/z, `LIMITS.grid = 40` stays the height cap; planner prompt updated, local sync-service rebuilt). Terrain is chunked: `generateVoxels(terrain, region?)` makes any 32x32 chunk identically to the same slice of the full grid (test added); `src/stores/worldVoxels.ts` lazily generates/caches chunks; `GhostPreview` draws `VIEW_RADIUS = 3` chunks around the player (past the 50 m in-world fog); `Scene` collides with the 3x3 chunks around the player (`COLLIDE_RADIUS = 1`); walk bounds follow the world (`stepInterior(..., halfExtent)`, was a fixed 19.5). Old blueprints (size 32) keep their size and bounds (15.5). `plannerStore` no longer holds a whole grid. **Not done:** surroundings for old small worlds, far LOD beyond the load radius, per-world configurable size, profiling on a phone (instance counts: ~49 chunks drawn).
| 2026-10-19 | **Sky & lighting are part of the blueprint (uncommitted; tsc, lint, 21 shared tests pass; local sync-service rebuilt).** `BlueprintDraft.sky` = zenith, horizon, fog distance, sun {color, intensity, dir}, ambient {color, intensity}; parsed + clamped in `shared/blueprint.ts` (sun kept above the horizon), `DEFAULT_SKY` daylight for blueprints without one; planner prompt/schema updated (horizon never near-black). "Shape terrain" writes `sky` next to `voxel` in the World CRDT (`worldStore.sky`). `useAtmosphere()` picks ghost-blueprint sky > world sky > default and the draw radius from the quality tier (`worldChunks`: Low 3, Medium 4, High 5, Ultra 6 chunks); fog = horizon color, far = min(sky.fog, radius*32 - 8). `WorldInterior` lights/sky dome use it (old flat rooms unchanged); `TerrainLight` removed. Per-chunk frustum culling re-enabled. Earlier: ghost terrain is translucent violet; `liftTo` fixes spawning inside the ground. **To verify by eye:** chunk visibility with culling on, fog/horizon match at the seam, FPS at High/Ultra.
| 2026-10-19 | **Mana tracker + guest cap (uncommitted).** New pill (top centre) + panel: personal allowance left, in-flight holds, averages per planner turn / per model (last 7 days), world flow used, creative pool, active makers, recent charges. Backed by read-only `GET /api/player/mana` (`manaStatus` in creations.ts, `ManaAdmission.status`, `ManaLedger.playerUsage`); refreshes after every spend. **Guests (unsaved players) capped at 60 mana / 24 h** (see Phase 05 log); Terms + giving updated. Open: should the first planner turn be free for guests (a turn is ~10, a model 60). |
| 2026-10-19 | **Built-in Library shelves: Blocks + Shapes (uncommitted; tsc, lint, 25 shared tests pass).** Library (B) now has three tabs. **Blocks:** this world's own terrain blocks (from the blueprint) + a standard set (`STANDARD_BLOCKS`: stone, dirt, grass, sand, wood, brick, snow, glass, obsidian, gold); placed as `type: "block"` objects on the grid cell in front of you (`snapToCell`), at your feet's height, never inside the ground, stacking on blocks already there (`stackedY`). **Shapes:** cube, sphere, cylinder, cone, pyramid, ring (`SHAPES`), any color (color picker + quick swatches) and size 0.5 to 8 m (last choices remembered). **Made:** the existing model search (the only shelf that needs the network). All new items are **free and never touch the server**: `placeBlock` / `placeShape` write straight into the World CRDT (`shared/library.ts`, `PlacedObject.color`, `worldStore.ts`); library items keep their exact color, stand still (no bob/spin), glass is translucent. Existing primitive geometries resized to fit their unit colliders (cylinder r 0.5, ring 1 m across). 4 new tests in `shared/library.test.ts`. **Offline:** placing works with no connection inside a loaded session; a cold start offline still needs the world doc persisted locally (no IndexedDB persistence yet). **Not done:** non-uniform scale / rotate UI for placed shapes (grab can turn them), terrain-block editing (Studio), more shapes (slab, wedge, arch), per-player recents. |
| 2026-10-19 | Library thumbnails: Made shelf renders missing thumbs client-side (`src/lib/libraryThumbs.ts`), lazy via IntersectionObserver, one at a time, cached in localStorage. Follow-up: upload rendered thumbs to the server so all devices share them. |
| 2026-10-19 | In-world chat (Alex): server-authoritative. Client sends `chat` (wire 0x0a); the server stamps the sender from the session, cleans (UTF-8 text kept; control/invisible/bidi/private-use/zalgo stripped, 200 chars), masks a small profanity list, rate limits (700 ms gap, 8 per 30 s) and appends to the world's `chat` Y.Array (last 200 kept, so latecomers read history). Client writes to that array are refused (`chat-guard.ts`). UI: corner log + Enter to talk + speech bubbles over heads; text only ever rendered as React text nodes (no HTML), storage is binary CRDT (no SQL). Terms/Privacy updated. Open: mute/block, report, names instead of Wanderer tags, emotes, proximity-only option. |
| 2026-10-19 | **Keybindings panel (Alex), built in parallel with the chat thread.** All keys remappable; doubles as the controls legend. Press **H** or the keyboard button under the FPS counter. Tabs for Flying / Inside a world (same key, different job: W = Thrust vs Walk forward). Click a key, press the new one; clashes swap, Backspace unbinds, ↺ resets, Reset all. Fixed: Esc, backtick, Tab, Ctrl/Alt/Meta, F-keys. Stored in `localStorage` (`aweborn.keybindings`, overrides only). Rules + registry in `shared/keybindings.ts` (11 tests), store `src/stores/keybindingStore.ts`, UI `KeybindingsPanel.tsx/.css`. `InputManager` builds its key map from the bindings; HUD key caps follow remaps; M/B/C/P panels, in-world carry/rotate/scale/camera keys and chat's open key use `matchesBinding`. Committed and pushed in `96ac407` (together with the chat thread's files, under a keybindings-only message). Touch/gamepad not remappable. Chat tooltip still says "(Enter)". | Alex tries it; chat work is already in that commit but not deployed or tested end to end. Update chat's hardcoded "Enter" hints. Sticky-key and a remap-then-warp check on a real session. |
| 2026-10-20 | **Chat archive (secondary session).** Every accepted in-world chat message is now saved permanently in a new `chat_messages` table (sync DB, so the hourly S3 backup covers it): `world_id`, `player_id`, `text`, `at`, indexed on world and player. Saved **unmasked** (sanitized only: `cleanChatText`); the world's CRDT log still holds the profanity-masked text and the 200-line cap, so readers only see masked. Planner chat already had `player_id` + `world_id` in `plan_sessions`/`plan_events`, unchanged. No `researchId`: playerId + worldId are the keys. `privacy.html` updated (World chat line, new Research item "How people talk", retention line). tsc clean; not run end to end. | `docker compose up -d --build sync-service` locally, send a message, check `chat_messages`; deploy. Maybe: a masking-at-render option, an admin/export query for research replay, and deleting a player's chat on request. |
| 2026-10-22 | **Minecraft-style equip ("into hand") + repeat PLACE + GRAB/DROP action buttons.** Selecting a Block, Shape, or Made model in `LibraryPanel.tsx` now equips it into `heldItemStore.ts` and closes the Library sheet so you can see the world, walk/look around with a live translucent + wireframe placement preview (`HeldItemPreview` in `WorldInterior.tsx`), and tap **PLACE** (`#touch-btn-place`, or `V` / `placeHeld` on keyboard) repeatedly to build and stack without reopening the Library. Added **GRAB / DROP** (`#touch-btn-grab`, `G` / `carry` on keyboard) next to `KICK` in the right-thumb action arc (`TouchInputAdapter.ts`), plus `HeldItemBar.tsx` with rotate (`⟲`/`⟳`) and resize (`−`/`+`) tools and `×` to put the held item away. Checked at 390×844, 360×740, 844×390 (touch) and 1440×900 (desktop): zero overlaps, repeat placement + block stacking verified. | Alex playtests on his phone; next Card Event item (`phases/README.md`). |
| 2026-10-22 | **Card Event Readiness hardening (Steps 2–5): client-side model LOD + distance culling, Origin/world crowd scatter + chat/genai caps, cold-start offline PWA + CRDT cache/queue, and 3-step onboarding hints.** (1) Kept full-quality Meshy models in S3 and `MAX_TRIANGLES = 120_000` in `optimize.ts` per Alex; added client-built vertex-colored silhouette proxy meshes (`modelShapes.ts`) + per-tier `modelDetailDist` (`28 / 45 / 80 / 160` m in `qualityStore.ts`), fog-distance culling, and lazy GLB loading in `WorldInterior.tsx`. (2) Scattered card/link arrivals around a 3D halo facing Origin/planets (`TeleportSystem.ts` `computeArrivalPose`) and interior spawns (`InteriorController.ts`), capped simultaneous overhead speech bubbles to 4 (`ChatBubble.tsx`), and bounded active Meshy jobs (`MAX_CONCURRENT_JOBS = 4` in `genai-service/src/index.ts`) + serialized child glTF optimization (`optimize.ts`). (3) Built cold-start offline support: `public/sw.js` + `src/main.tsx` warm-cache registration, `src/lib/offlineCache.ts` for Universe/World `Y.Doc` localStorage persistence + `Y.mergeUpdates` offline edit queue, `SyncBridge.tsx` + `rooms.ts` reconnect flush, and offline `/w/<uuid>` lookup fallback. (4) Built portrait-first 3-step `OnboardingHint.tsx` (`1/3` Steer → `2/3` Fly → `3/3` Enter a world), verified at 390×844, 360×740, 844×390 (touch) and 1440×900 (desktop) with zero overlaps. | Alex playtests on his phone (Lost-world volcano FPS, touch controls, offline card tap). |
| 2026-10-22 | **Close-range client-side model decimation + relief-baked Lambert material (`modelShapes.ts`, `WorldInterior.tsx`, `qualityStore.ts`).** Alex reported close-range FPS inside worlds with Meshy models was still too low because `PlacedObjectMesh` rendered the full 120k-triangle PBR GLB inside `modelDetailDist`. Kept S3 assets and `optimize.ts` (`120_000` tris) untouched; on the client, `GeneratedModelLoader` never mounts the raw 120k PBR scene into WebGL, and `prepareModelAsset` uses `MeshoptSimplifier` (WASM, UV-aware, staggered 1 model/frame) to build 3 compacted LODs (`lod0` close: `modelMaxTris` = `900 / 1,600 / 3,200 / 6,500` tris for Low–Ultra, a **75×–133× close-range triangle cut**; `lod1` mid: `~520` tris; `lod2` far: `~190` tris) with blended high-res normals and per-vertex AO/cavity/grain shading. `bakeLiteMaterial` converts each model's `MeshStandardMaterial` to a single-texture `MeshLambertMaterial` with `normalMap` bump relief, `roughnessMap`/`aoMap` crevices, and a 64×64 procedural micro-grain layer composited onto a 512×512 diffuse canvas, then disposes the raw 120k geometry and 1024×1024 PBR textures from GPU memory. **Alex confirmed high framerate throughout play on mobile; also fixed black mobile screenshots (`480a060`: `preserveDrawingBuffer: true` on `<Canvas>`, lazy `loadStripe()` in `DonationModal.tsx`, and `📸 Share or save photo` in `MoreSheet.tsx`).** | Alex tests mobile screenshots & `••• More → Share or save photo`. |
| 2026-10-23 | **World-entry frame-slicing + determinate loading progress bar, in-world object editing (duplicate / recolor / delete), server thumbnail upload, and recursive worlds-within-worlds (`worldVoxels.ts`, `GhostPreview.tsx`, `modelShapes.ts`, `WorldTransition.tsx`, `HeldItemBar.tsx`, `libraryThumbs.ts`, `universe.ts`, `PlantWorldPanel.tsx`, `WorldInterior.tsx`).** (1) **Eliminated world-entry input freeze:** made `Chunk.colliders` lazy (only computed for the 3×3 chunks around the player), cached `BufferGeometry` per chunk (`chunkGeoCache`), streamed visible terrain chunks across frames (initial 9 chunks immediately so ground is under the player's feet, then +3 chunks/frame up to `tier.worldChunks`), moved `scene.clone(true)` / `Box3` / `registerModelShape` inside `prepChain`, and added `await nextFrame()` yields between vertex transform, `MeshoptSimplifier`, and `bakeLiteMaterial`; added a proportional `<progress class="world-load-progress">` HUD bar in `WorldTransition.tsx` tracking CRDT sync + terrain chunks + 3D models. (2) **In-world editing tools:** added Duplicate (`⧉`), Recolor (for shapes/blocks), and Delete (`🗑` or `Backspace`/`Delete`) in `HeldItemBar.tsx` / `worldStore.ts` (`duplicateObject`, `recolorObject`, `removeObject`). (3) **Server thumbnail upload:** client-rendered PNG thumbnails in `libraryThumbs.ts` upload once via `POST /api/player/library/:sha/thumb` → `genai-service` `POST /library/:sha/thumb` (validated PNG header + size cap, saved to local assets + S3, `thumb = 1` in `library`). (4) **Recursive worlds within worlds:** added `parentWorldId` (unlimited nesting depth; only the active world's `Y.Doc` is loaded), `🌱 Portal` tab in `MakeTabs` (`PlantWorldPanel` works inside worlds, with a creator toggle `Anyone` / `Only me` via `allowPortals` + `POST /api/player/world/policy`), glowing `ChildWorldPortal` orbs on parent terrain + physical `ParentWorldPortal` (`↑ Return to <Parent>`) at `RETURN_PORTAL_XZ = (0, 14)` in child worlds (`WorldInterior.tsx`), emerging right beside the child world's portal in the parent world on return (`restoreOnNextReset`, no client stack needed), touch `KICK` → `ENTER` swap near portals (`TouchInputAdapter.ts`), and root-world Frontier solidification (`frontier.ts`). | Alex playtests smooth world entry + loading bar, carrying edit tools (duplicate/recolor/delete), and planting/traversing portals inside worlds. |
| 2026-10-27 | **M5a/b: pictures, sounds, music, voice, lore** (Rough Draft). Make has six kinds (Object · Picture · Sound · Music · Voice · Lore), per-kind holds from [`shared/make-costs.ts`](../shared/make-costs.ts) (picture 7, sound 1, music ⌈s/4⌉+1, voice 0.5 + 0.005/char, lore 2), safety check per kind. genai `media.ts`: pictures via OpenRouter **MAI Image 2.6 Flash** (deviation: Gemini image is refused under the account's zero-data-retention rule), sound/music/voice via ElevenLabs (**key pending; synthesized stand-ins until then**), stored as `media/<sha>` and served by the box until the assets stack lets CloudFront read `media/*`. Lore = Claude Haiku, safety-checked in and out, placed as a sign; only the nearest sign opens its card, held on screen. In worlds: framed pictures (unlit), glowing orbs that play positionally (loop within earshot, or once as you walk up), and a creator-set **world sound**. Media skills (picture, sound, music, voice, lore) earn XP but don't gate chapter 6 (`EXPLORER_SKILLS`). Mana tracker gets a "pictures & sounds" bucket. **Holds sweeper:** a closed tab used to leave its hold forever (likely prod's stuck `reserved: 60`); `sweepCreations` now settles/releases unwatched jobs each minute and returns holds older than 6 h. Fixed on the way: the world-load HUD counted pictures/sounds as models (stuck at "Preparing creations"); a reused placeholder material kept pictures dark. **Known gaps:** sign text is written by the client into the world doc, not server-verified (Phase 09 intent authority); media objects have no colliders or pick-up yet. Privacy + Terms updated. Real-tap checks at 390×844 (with a real picture), 360×740, 844×390, 1440×900; no console errors or failed requests. 75 shared + 78 sync tests. | Alex: ElevenLabs key, apply the assets stack then `MEDIA_CDN=1`, confirm the picture model. Next: planner direct edits + history, terrain editing |
| 2026-10-27 | **M5c: planner direct edits + version history** (Rough Draft). Shared pure `parseEdit` / `applyEdit` in [`shared/blueprint.ts`](../shared/blueprint.ts) (ops: remove, prompt, size ×0.25–4 clamped to 0.1–20 m, rename; never mutates; tests in `shared/blueprint.test.ts`). Server ([`planner.ts`](../server/sync-service/src/planner.ts)): `POST /api/player/plan/edit {sessionId, base, edit}` is free (no planner call; new words go through the safety check, charged like a redo note), returns 409 + the current blueprint when `base` is stale (rechecked after the safety await), 30 edits/min per player; `GET /api/player/plan/versions` lists the last 100 turn/edit/restore versions from `plan_events`; `POST /api/player/plan/restore` brings a version back as a new one (history is never rewritten). Redo's reword now uses `applyEdit` instead of mutating the asset. Every version is logged with its blueprint, so the archive keeps edits too. Client card: ✦ / ↻ / − / + / ✎ / ✕ per item (−/+ only before it's placed: placed things are resized in the world), ✎ Rename, ↶ Undo (restores the version before your last edit), History list with Restore; the ghost follows every change. Layout fix found while checking: an open card used to push the actions and input out of the sheet over the phone thumb controls; it's now the sheet's one scroll area (sticky summary, chips step aside while it's open; on short landscape screens the actions and input step aside too, since the card was squeezed to one line). Real taps at 390×844, 360×740, 844×390, 1440×900: no console errors, no horizontal overflow, nothing spills below the sheet; tool targets 34×32 on touch. Not done: removing an item from the plan leaves anything already placed in the world. |
| 2026-10-28 | **M5d: terrain editing** (Rough Draft). Edits are a sparse overlay on the generated terrain, not a new grid: World CRDT `Y.Map("terrainEdits")`, key `"gi,j,gk"` → cell value (0 = air, n = the world's block n), helpers in [`shared/terrain-edits.ts`](../shared/terrain-edits.ts) (tests in `shared/terrain-edits.test.ts`). A cell set back to what the generator made is deleted, so the map holds only real differences; reshaping the terrain in the planner clears it in the same transaction. **Who:** same as the terrain (creator + co-creators); the server's world authority judges each changed key (owner only, legal key/value, ≤ 64 cells per update, ≤ 20,000 edits per world; owner deletes always pass), O(changed keys), 3 new tests. Client: `worldVoxels.ts` indexes edits per chunk and hands out an edited copy of a chunk under a new id, so only the touched chunk (and an edge neighbour when the cell is on a seam) re-meshes and re-collides. Library gets a **Terrain** shelf for owners in voxel worlds: ⛏ Dig + fill with each of the world's blocks; held like any item, the bar and touch button read Dig / Fill. Target = the column 1.6 m ahead, from 3 cells below your feet to head height (dig the highest non-air cell; fill on the highest solid one, which may replace water); the preview outline draws over the avatar and ground. The Library's shelf tabs now follow the tab pattern (arrow keys, Home/End, roving tabindex, tabpanels). **Sync bug found and fixed on the way:** on a first visit (no cached world doc) `enterWorld` wrote placeholder meta into the doc tagged "remote", so it was never sent; every later write from that browser built on it and sat **pending forever** on the server: neither applied nor reverted (a guest's illegal edit stayed on its screen; a new device's legal edits never reached anyone). Now the name shows from the Universe entry without touching the doc, and the world cache key moved to v2 so old caches holding those writes are dropped. Real taps at 390×844, 360×740, 844×390, 1440×900: dig ×2 + fill land in the CRDT and the mesh, no overflow, no console errors; a guest gets no Terrain shelf and its forced write is reverted on its own screen and never reaches the owner. 83 shared + 81 sync tests. Not done: smooth surfaces, digging/filling things you can't reach from the column ahead, an undo for edits. |
| 2026-10-28 | **M5e: smooth voxels** (Rough Draft). Blocks with `surface: "smooth"` are drawn by a Surface Nets mesher, [`shared/surfaceNets.ts`](../shared/surfaceNets.ts) (tests in `shared/surfaceNets.test.ts`); everything else keeps the block mesher. **How:** no stored density. Per chunk, each cell is 1 if solid (smooth or block), else 0; blurred [1, 6, 1]/8 per axis, then clamped (solid ≥ 0.75, else ≤ 0.25) so the surface separates exactly the cells the block faces would: a single dug or filled cell never vanishes, flat ground keeps its top at the block top, and the blur only moves the surface within a cell. One vertex per crossed lattice cube (mean of edge crossings), normals from the field gradient, colour from the highest smooth corner; quads only where a smooth cell meets air or liquid (no seam between smooth grass and block dirt; block faces toward smooth cells are culled). Each lattice edge belongs to the chunk of its lower cell, so chunks join without double walls; the mesher reads 2 cells past its chunk (global lookup, diagonals too) and only works up to the highest smooth row. Edits within 2 cells of a chunk edge now rebuild the neighbours (diagonal at a corner) (`edgeNeighbours(…, SMOOTH_REACH)`). **Flip for free:** Library → Terrain → *Smooth ground* switches (one per solid block, owners only, native `switch` + the vendored polyfill); `setVoxelTerrain` now clears dig/fill edits only when the ground's *shape* changes (`terrainShapeKey` ignores `surface`), so flipping keeps them; the planner's ghost and its colliders treat a drawing-only difference as the same terrain (`sameTerrainShape`). Planner prompt: smooth for natural ground, blocks for built/hard things. **Deviations from the proposal above:** physics stays on the block colliders (the drawn surface is within about half a cell; no trilinear sampling yet), no triplanar texturing, no Web Worker, field derived rather than stored. **Cost:** a hilly 32×32×48 chunk: ~3 ms to mesh on a laptop, 3,870 triangles vs 5,628 for the same chunk as blocks. Checked at 390×844, 360×740, 844×390, 1440×900 (flip on with the real switch, edits kept, flip back, no console errors; headless FPS capped at 61 both ways, so not a real phone number). |
