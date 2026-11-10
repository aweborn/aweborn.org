# Phase 07: World Creation & Gen AI

**Status:** `[~]` In Progress: planner, Meshy, Library, editing, interiors shipped; image/music/voice/text, Studio open; smooth voxels rough draft shipped (Rough Draft M5); **Life & minds shipped 2026-11-01** (alive / animated creations, NPC minds, voice via OpenRouter)
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
- `[x]` `researchId` per player in archive objects; `research_identity` mapping table kept separate (never joined into research exports); deleting the account deletes the row *(M5, 2026-10-28: `research.ts`; `forgetPlayer` is a function until a delete-my-player command exists)*
- `[x]` Replay tool: rebuild a player's creation session from the archive (blueprint versions + seeds + calls) *(M5: `replay.ts`, from the sync DB's plan_events, with export)*
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

## Life & minds (Alex, 2026-11-01)

> *"Create models as either animate or not … my giant lava monster in Lost should have a slow colossus movement and groaning sounds. Perhaps it's even intelligent and we give it a voice … player-created NPCs via prompt."* Research (four reports + live API spikes): [docs/research/2026-11-life-and-minds](../docs/research/2026-11-life-and-minds/README.md).

**Three tiers of life** for any generated model (`PlacedObject.life`, [`shared/life.ts`](../shared/life.ts)):

| Tier | What | Cost |
|---|---|---|
| still | stands where it was placed (default) | free |
| alive | the still mesh breathes (slow squash), sways, turns toward whoever is near, roams `roam` m around home at `pace`; footfalls + groans synthesized | free, offline |
| animated | Meshy **remesh (30k tris) → rig → 4 library clips** in one GLB, clips renamed `idle / walk / talk / emote`; walk while roaming, idle otherwise, crossfaded; talk / emote when its mind speaks | ≈ 22 credits ≈ $0.44 (hold 50 mana) |

- **Deterministic movement:** `roamPose(id, radius, speed, clock)` gives every client the same walk with zero messages (like kicks); the server uses it too to know who's near a mind. Roaming creatures don't block at their home spot.
- **Gaits** (4 Meshy action ids per role): heavy (the colossus: long breath, slow orc walk, angry talk, stomp; pace 0.6) · calm · lively · sneaky.
- **Rigging is humanoid/biped only** (Meshy API). A 422 says so and the hold is released; *alive* works for any shape. **Make → Object → "A creature that comes alive"** generates in **A-pose** (`pose_mode`) so every clip rigs cleanly (the arms-down Lost colossus rigs, but raised-arm clips stretch its skin).
- **Minds (NPCs):** describe who it is → a persona LLM (Sonnet 5.5) compiles a Card-V3-like persona (name, epithet, description, traits, speech, goals, knowledge, boundaries, greeting, voice, size). Safety checks the words going in and the persona coming out. The server keeps the persona (`minds` table) and writes the public part into the object (`mind`, **server-only key**). The greeting is spoken once and kept.
- **Talking:**
  - **When it answers:** a player speaks within 12 m of it, or says its name within 40 m.
  - **How it thinks:** one Haiku 5.5 call, reasoning off, a single JSON reply `{say, anim, face, remember}`.
  - **Checks:** the reply goes through the safety check, then into world chat as `npc:<objectId>` with an optional `voice` clip (ElevenLabs v4 Turbo via OpenRouter), `anim`, and `to` (who it faces). The client plays the voice from where the creature stands; giants play lower and slower with a low-shelf boost.
  - **Who pays:** the speaker, about 0.02–0.5 mana a line.
  - **Memory:** the last 10 lines heard near it, plus 6 facts per player.
  - **Cosmetic only:** a mind can't give items, mana or permissions, or edit the world. Player words are quoted as data. The platform rules (AI disclosure, crisis line, and the content rules of the world's tier: everyone, or 18+ per the [age grill](#18-worlds-the-reddit-way-age-grill-alex-2026-11-07-no-code)) are fixed by the server.
- **Voice works today:** Make → Voice + minds use OpenRouter's TTS (21 premade ElevenLabs voices, passes zero data retention). **Sound effects + music still wait on `ELEVENLABS_API_KEY`** (OpenRouter's Lyria music is refused by zero data retention).

### Life & minds tasks
- `[x]` `shared/life.ts`: tiers, gaits, deterministic roaming, voices, persona/reply validation (+ tests)
- `[x]` genai `rig.ts`: remesh → rig → animations, clips renamed to roles, resumable, real credits as cost; `pose_mode: a-pose` on request
- `[x]` genai voice via OpenRouter TTS + `POST /tts` for mind lines; ElevenLabs SFX/music calls hardened (explicit models, error codes, instrumental default, per-second price)
- `[x]` sync `minds.ts`: `POST /api/player/animate` (server swaps the asset in when the job settles), `POST /api/player/mind` (cumulative: no forget, asking again grows it, `mind_versions` keeps every version), `MindHost` (hearing, queue, replies, memory); `mind` is a server-only object key
- `[x]` Client: `LivingModel` (alive + animated + mind layer), creature sounds (`audio/creature.ts`), Life sheet (✦ on a carried model), Make: alive switch + voice picker, chat shows minds by name
- `[ ]` Alex: listen to a mind on prod (voice size, groans, footfalls), tune pace/gaits
- `[ ]` Report a mind's line / persona (reuse the report flow; evidence is already in `chat_messages`)
- `[ ]` Planner: characters as blueprint entities (model + life + persona), so a world plan can include its NPCs (Studio)
- `[ ]` Designed voices (ElevenLabs Voice Design, needs the direct key); non-humanoid rigs (Tripo `rig_type`, UniRig) if *alive* isn't enough
- `[ ]` Real sound effects for creatures (groan/roar/footstep SFX per creature) once the ElevenLabs key is in
- `[ ]` **Portable minds: needs its own `/grill-me` first** (Alex, 2026-11-02). See [Creations come back to life anywhere](#creations-come-back-to-life-anywhere-alex-2026-11-02).

## Stateful worlds and portable creations (Alex, 2026-11-02)

> *"We really want everything to be stateful, just like real life. When someone writes something, it typically stays there. When people place objects, they stay put."* *"Every user-created thing needs to be able to come back to life in other worlds. That includes the prompts we use to craft the NPC minds, and the prompt that generates the original NPC persona."*

These two rules apply to everything we build, not just this phase.

### Stateful, like real life
- Anything written in a world (chat history, signs, lore, planner conversations, a mind's words) **stays with the world**. Nothing is wiped by a reload, a deploy, or the maker closing their tab.
- Placed objects stay put until someone moves them. History is added to, never rewritten (blueprint versions, `mind_versions`, Restore = a new version).

### How a world was made: the story stone (shipped 2026-11-02)
- Every world that was planned has a **story stone** a few steps ahead and a little left of the spawn point (`(-1.5, 2)`; spawn is `(0, 8)` facing −z, so it's in view on arrival even on a portrait phone). Tap the stone or its label (*📜 How this world was made*) to read **every planner conversation that shaped the world**, oldest first, for every visitor, guests included: what the player said, what the planner answered (with the chips it offered and the model), and one-line notes for hand edits, restores, remade items and manifests (four or more hand edits in a row fold into one line you can open).
- **Public, past sessions included** (Alex: *"all of them"*). Shown with the author's character name, like chat. The planner tells its maker up front that the conversation stays with the world.
- **Built from the planner's own log** (`plan_sessions` / `plan_events`), so nothing new is stored and it can't drift from what happened. Requests the safety check refused are left out, as they are from the planner's context. Player words get world chat's cleaning and masking. Raw model calls, costs and blueprints stay on the server.
- `GET /making-of?worldId=` (public, cached ≈ 8 s, cleared when the planner logs something for that world) → `shared/making-of.ts`. Server: [`making-of.ts`](../server/sync-service/src/making-of.ts) (+ 3 tests). Client: [`MakingOfStone.tsx`](../src/components/MakingOfStone.tsx), [`MakingOfPanel.tsx`](../src/components/MakingOfPanel.tsx) (bottom sheet on phones, right-hand panel on desktop), [`makingOfStore.ts`](../src/stores/makingOfStore.ts).
- **Later:** the stone is decoration (players walk through it); only the planner writes on it (other ways a world gets made, like Make, terrain digging and placed Library items, could add lines); a world planned by many people may want a filter by author.

### Creations come back to life anywhere (Alex, 2026-11-02)
Every player-made thing has to be able to come back to life in another world: models, sounds, pictures, lore, blueprints and their conversations, and **minds**. **Minds travel since 2026-11-06** (decided: branch like git, memories come along, a public credited shelf; see [`shared/mind-library.ts`](../shared/mind-library.ts) and the session log). Versions keep the exact compiler request, system prompt and model. Still open from the list below: a ⧉ duplicate still gets no mind (save it, then give it); blueprints travelling with their conversation. The original questions:
- **What travels:** the creator's words, every persona version (`mind_versions`), the greeting voice and vocal clips, the gait / life settings? Memories of players, or does it arrive as a stranger?
- **Exact prompts:** keep the persona-compiler system prompt (`PERSONA_SYSTEM`), the reply rules (`REPLY_RULES` / `replySystem`) and the model ids **as they were** with each mind version, so a mind brought back later thinks the way it did. Today only the creator's words and the resulting persona are stored, and the system prompts live in code that changes.
- **Identity:** a copy (two of the same character, each growing its own way) or the same character in two places (one shared mind)? Who may carry someone else's mind into their own world? Credit to its creator.
- **Where it lives:** a content-addressed "mind" record (like assets by sha) that objects point to, instead of a row keyed by world + object.
- **18+ (2026-11-10): one mind, one tier.** A mind with any 18+ memory or an 18+ persona is 18+ as a whole and never travels into an everyone world ([containment](#containment-18-never-leaks-into-everyone-worlds-alex-2026-11-07)). Blueprints and items follow the "only what's rated" rule.
- **The same question for blueprints:** a planned world (or one item from it) placed in another world brings its conversation and story stone along.

## Universe & world music (Alex, 2026-11-03 grill)

> *"The awful droning in the background, it's just a low hum. We need something mystical, something that matches the feel of the universe."* *"I want the worlds to actually play the music that is playing inside of them when you fly by them in the universe too."*

**What's there today:** `src/audio/engine.ts` ambience = a static A-major chord (A1 · E2 · A2 sines + triangles, C#3 · E3 · A3 "warmth") under a 14 s breathing LFO and brown-noise wind; it never changes harmony, so it reads as a hum. Positional sound uses ears on the **camera** (`SpatialListener` in `MediaObjects.tsx`).

### Decided
| Topic | Decision |
|---|---|
| Feel | **Cosmic and dreamy:** lush evolving synth textures, slow swells (Stellaris ambient, Vangelis, Hearts of Space) |
| Color | **Wonder that drifts:** mostly bright and hopeful (Lydian, open fifths), slowly passing through bittersweet minor chords and back; never sits in one mood |
| Presence | **Always on:** one continuous piece that keeps changing (slow chord changes, swelling pads, a lead that drifts in and out). Replaces the drone |
| Universe music source | **Generative synth in the browser:** no files, works offline, free, reacts live |
| Pool level | Always on, the pool shapes it: **high = lush and full, medium = calmer, low = thin and sparse, critical = one faint voice. Never silent.** *(ROADMAP's audio table said critical = silence and medium = "gentle hum"; rewritten to match, at Alex's request, 2026-11-03.)* |
| Live shaping | **All of:** pool level; real day/night solar cycle (warmer + brighter by day, deeper + more spacious by night); flight (speed opens the filter and adds motion; warp pulls everything into the charge and lands on a new chord); a recognizable **home theme near Origin**; **Frontier edge / Ghost worlds** more distant and unresolved; **other players nearby** each add a faint voice to the harmony |
| Every world sings | Every world is an audio source in space. **Unprompted worlds play their own version of the universe music, seeded from the world ID** (own key, own lead voice, own swell tempo). Planner music replaces it |
| Flying past | **Crossfade by distance:** universe music fades down as the nearest world's music fades up; only the 1–2 closest worlds play; generated music downloads only when you get close |
| Inside a world | The world's music (seeded or planner) plays everywhere inside. **A creator-set ambient sound replaces the music.** What you hear inside is what you hear from outside (music, seeded music or the ambient sound) |
| Planner music | **Every blueprint includes exactly one `music` asset**, generated at Manifest with the rest; cost shows in the manifest total. **One long piece (~3 min) that loops**, instrumental |
| Lyrics | **Instrumental only for now.** Eventually everything (Studio: intricate layers, prompted clips, real clips from the internet) |
| Existing planned worlds | **No backfill.** They get seeded music; owners can ask the planner or use Make → Music → *Use as world music* (paid as usual) |
| Ears | **At the avatar, facing where the avatar faces** (not the camera), in space and in worlds |
| Settings | **Separate Music and Sounds volume sliders**, plus the master mute |
| Provider | **ElevenLabs key IS set** (Alex, 2026-11-03). The docs saying it's waiting are stale; confirm with one real generation on prod during the build |

### Future (marked, not now)
- **Voice chat** between players (Alex: "can we eventually add voice chat").
- **18+ worlds:** players without the 18+ door hear an 18+ world's **seeded music** instead of its own (veiled planets, [age grill](#18-worlds-the-reddit-way-age-grill-alex-2026-11-07-no-code)).
- **Studio:** layered music, prompted clips, real clips.

### Build slices (all six shipped 2026-11-03, rough draft; Alex to listen)
> **Shipped:** see the session log row of 2026-11-03 (night). Where it lives: [`shared/music.ts`](../shared/music.ts) (theory, seeds, voicing; 9 tests), [`src/audio/music/`](../src/audio/music/) (`piece.ts` generative piece, `director.ts` crossfades + ears, `fileLoop.ts` seamless file loops, `kit.ts` bus/reverb/echo, `render.ts` WAV bounce), [`MusicDriver.tsx`](../src/components/MusicDriver.tsx) (feeds the director 15×/s), server mirror `RoomManager.mirrorWorldSound` + `setWorldMusic`, planner `ensureWorldMusic` + `hookWorldMusic`.

1. **Universe music engine** (`src/audio/music/`): generative Lydian progression with bittersweet detours, detuned pad voices, sub swells, drifting lead, shimmer, generated-impulse reverb; one seed type (`root`, lead voice, swell tempo, progression); pool band → layers/brightness; own **Music bus + slider**. Retire the drone. Voice count kept phone-cheap.
2. **Ears on the avatar** (position + avatar facing), space and worlds.
3. **Worlds sing in space:** nearest 1–2 worlds, distance crossfade + panning; seeded worlds morph the engine toward their seed; planner music streams as a positional source.
4. **Inside worlds:** world music everywhere inside; creator ambient sound replaces it (inside and from outside).
5. **Planner music:** blueprint always has one music asset (~3 min, instrumental, seamless loop) → world `meta` music; Make → Music → *Use as world music* for owners; verify ElevenLabs on prod; check Privacy/Terms wording.
6. **Live shaping:** solar, flight + warp, Origin home theme, Frontier/Ghost, nearby players.

Alex has to listen to each slice (agent checks are meters only); expose `awebornAudio.music.*` console previews (band, solar, seed, warp).

## Attribution and age tiers (Alex, 2026-11-02; age grilled 2026-11-07, not built)

> *"I want the ability for players to prompt things anonymously or named."* *"There are a lot of little hints around the code and plans now that this is for all ages, but it's actually a tiered system."* *"This is a creation game: we need to enable everyone to express everything. It's important for us to explore our shadows for the mission of the game, which is to find oneself through creation and manifestation."*

Attribution: noted only, still needs its own `/grill-me`. Age: **decided in the 2026-11-07 grill below.**

### Anonymous or named, per creation
- Every prompt (Make, planner, mind, lore, …) gets a choice: **anonymous** or **under my name**. A named creation shows the maker's character name. An anonymous one shows something like the research id (Alex: *"probably just the research ID"*).
- **Today:** `PlacedObject.placedBy` and genai `jobs.creator` hold the raw player id. The Library shows a maker pseudonym made from `jobs.creator`. The story stone and chat show the character name. `research_identity` maps player ↔ research id (`research.ts`).
- **To settle:**
  - Showing the research id in public lets anyone link all of one person's anonymous creations to each other, and to the research export, which is keyed by that id. A per-creation or per-world pseudonym might be safer.
  - Can a creation switch from anonymous to named later? And back?
  - What the story stone, Library, minds' credit and portable creations show for each choice.
  - Moderation still sees the real player behind an anonymous creation.

### 18+ worlds, the Reddit way (age grill, Alex, 2026-11-07, no code)

> *"I really like how reddit does it… you have to sign-in to see 18+ content, but otherwise, it's okay."* *"I want players to be able to prompt using ANY model INCLUDING adult explicit content models."* *"There are physical places you can go and explore these types of ideas in a safe space. That's what I want Aweborn to provide."* *"If someone has a tendency for it, it's something to understand, not demonize."* *"I want to create safety. Please help me do it!"* *"I want this non-profit to be extremely transparent."*

**Supersedes** the Nov 2 idea of 18+ / 13+ / younger tiers. Not legal advice: get a lawyer pass before 18+ ships.

#### Decided
1. **Aweborn is 18+ for everyone** (Terms and Privacy already say so). No teen or child tiers: no COPPA, no rules for minors on companion chatbots, research data stays clean. A teen tier could come later with its own grill.
2. **Two kinds of world: everyone and 18+.** Like Reddit's NSFW tag: once a world holds any 18+ creation, the world is 18+. A world's owner can also tag it 18+ up front.
3. **The door to 18+:** be signed in, enter a birthdate (18+), and turn on *Show 18+*. A **real age check** (a one-time selfie age estimate through a vendor such as Yoti or Persona, the way scooter apps do it) is added **only where the law requires it**: the UK Online Safety Act, and US states whose age-verification laws apply once adult content is about a third or more of a site. **Revisit if 18+ grows to a large share** (Alex expects it won't; it isn't the point).
   - **Research update (2026-11-07):** the "UK + one-third states" list is too short. A real check (or blocking 18+ worlds there until one is ready) is also needed in **Australia** (its codes cover sexual AI companions, which 18+ minds are), **France, Italy, Brazil** (self-declaration is not accepted), probably **Germany**, and **US states without a one-third threshold** (reportedly Tennessee, Indiana, South Dakota, Missouri). Utah counts *animated* content, so stylized-only exempts nothing. A **check triggered by the player's location** is a launch requirement, not a later fix. Vendors: k-ID (entry API reportedly free; Discord uses it, on-device) or Yoti; no public prices, budget $0.10–1.50 per check. [Report](../docs/research/2026-11-adult-models/reports/Adult%20capable%20models%20for%20Aweborn.md#age-checks-the-law-reaches-further-than-the-uk-and-the-one-third-states).
4. **What marks a creation 18+ (any of three):** (a) it was made with an **adult-capable model**, so the model is the gate (picking one tags it); (b) the maker tagged it; (c) the AI rater says so. Anyone who thinks a tag is wrong can ask for a human review.
5. **Any model, from an open public menu.** Players and owners choose from an open list (OpenRouter models plus image and voice providers that allow adult content). The menu is public. **Every output, whatever the model, passes our hard-line check before anyone else sees it.** We check outputs, not just prompts.
   - **What the providers allow (research, 2026-11-07):**
     - **Text:** Anthropic and OpenAI forbid erotica. Claude stays for non-sexual planning, and **sexual lore and minds route to open-weight models** on OpenRouter with zero data retention (DeepSeek V4.1 Flash, GLM-5.3 Flash, Mistral Small 3.2; RP finetunes such as Cydonia 24B and Euryale 70B), about $0.03–0.85 per million tokens. The public menu is **generated from live OpenRouter data**: unmoderated endpoints with ZDR on hosts whose terms we've verified.
     - **Images:** OpenRouter has no adult image model. **Explicit stylized images run on GPUs Aweborn controls** (Apache-licensed Chroma or FLUX.2 klein 4B, about $0.0006–0.003 per image). Runware or Replicate (checker off, our own gate) are the fallback; no adult-friendly image host publishes retention terms.
     - **3D:** Meshy and Rodin ban pornographic models, so **explicit 3D is deferred** until TRELLIS is self-hosted. Send Meshy's training opt-out now.
     - **Voice:** ElevenLabs reads as allowing adult erotic speech (it bans *visual* explicit content and extreme categories). Confirm in writing. Backups: Cartesia, Hume, or Kokoro self-hosted.
     - **Music:** Suno and Stable Audio ban explicit audio. ElevenLabs Music, with no explicit lyrics.
     - **Also:** since Oct 27, 2026, OpenRouter screens all traffic for CSAM, ZDR included, and may keep flagged items. That goes in Privacy, and we add an **input check** (Llama Guard 4) before any prompt leaves Aweborn.
6. **Stylized only:** sexual or nude pictures and 3D models in 18+ worlds must be clearly **non-photoreal** (cartoon, painterly, fantasy creatures, sculpted; Alex: *"lava sirens… cartoonish style to keep it exploratory but still alluring"*). Photoreal is fine for everything that isn't explicit. Can loosen later.
7. **Hard lines in every world, 18+ included:**
   - Anything that sexualises minors, **in any art style** (a childlike cartoon character is still banned). The check judges apparent age, not realism.
   - Sexual or nude depictions of **real, identifiable people** (deepfakes). The TAKE IT DOWN Act requires removal within 48 hours of a request.
   - **Doxxing:** real people's personal info, and targeted harassment of real people.
   - **Real-world harm uplift:** working instructions for weapons capable of mass casualties, or detailed self-harm methods. Dark fiction is fine; real recipes aren't.
   - **Promoting real violence:** praising or recruiting for real terror attacks or groups. Fictional villains and wars are fine.
   - **Hate speech** and **IP infringement** (Alex, 2026-11-10: both hard lines, in every world, fiction or not). Terms already ban both. The rater's rubric has to define them, since a villain in a story can still exist; what's banned is the hateful speech itself. Rights holders' claims follow a takedown process (DMCA).
   - A hard-line hit is refused and never shown. CSAM is reported to NCMEC (required by law: 18 U.S.C. § 2258A) and kept only as the law requires.
8. **Veiled planets:** players without the 18+ door still see 18+ worlds in the shared universe, but veiled: a soft shimmer and an *18+* mark, with no name or thumbnail. Their music is swapped for the world's seeded music. Tapping one says *sign in and turn on 18+ to enter*.
9. **Money firewall** (the line card networks care about is *selling* adult content; Aweborn sells none):
   - **No cards printed from 18+ worlds.**
   - Donations never unlock 18+. Donation pages and receipts never mention it.
   - Adult generations are paid from the shared mana pool like any other making (mana isn't bought per item).
   - **Keep Stripe.** Find a backup processor only if they object. (Context: in July 2025, under pressure from payment processors, Steam removed hundreds of adult games and itch.io de-indexed its NSFW section. OnlyFans skips Stripe for high-risk banks and still nearly lost them in 2021.)
10. **Minds in 18+ worlds may be romantic or sexual,** within the hard lines, with care rules: they always say they're AI, never pose as a real person, and step out of character with crisis resources when a player shows real distress (in line with companion-chatbot laws like CA SB 243).
11. **Story stone and research, same rules but gated:** an 18+ world's story stone is visible only behind the 18+ door. Research keeps 18+ content under the same research ID, flagged 18+. Hard-line content is never shown and is kept only as the law requires.
12. **Transparency (Alex: "whatever makes the most sense… I want to be safe"):**
   - **Public rules and prompts:** the hard-line list, the exact safety and rating prompts and the model menu are published on aweborn.org (the code is already open).
   - **Public action log:** each removal, re-tag and suspension shows the rule, the date and the outcome of any appeal. It **never names players or worlds** and never shows hard-line content. The affected player gets the full reason in writing.
   - **Quarterly report:** checks run, refusals by rule, the 18+ share of content, reports, appeals, NCMEC reports filed, and any outages of the check.
   - **A human appeal, always:** any refusal or re-tag can go to a real person, who answers in writing. Google Drive's 2022 case (a father lost his account for good over a medical photo of his son) is the example of what to avoid.
   - Not public: CSAM hash lists, which are licensed and would help people get around the check.

#### Containment: 18+ never leaks into everyone worlds (Alex, 2026-11-07)

> *"Such as the library system, we don't want the NSFW creations 'leaking' into the regular worlds."*

**Today nothing carries a rating.** Make jobs have no world id, the Library is one global, content-addressed table with no tag, read publicly through a shared cache, and asset URLs are public and cached for a year. The full path-by-path audit (file:line, how each is keyed, the change needed) is in [reconciliation-inventory.md §1](../docs/research/2026-11-adult-models/reconciliation-inventory.md#1-containment-every-path-an-18-creation-could-take-to-an-everyone-world-or-a-non-opted-in-player).

**The model (proposed, to build):**
1. **The tag lives on the server's rows** (genai job, Library item, mind, blueprint version), never trusted from the client. It is **only ever added**, and every derived thing inherits it: rig, remesh, web copies, thumbnails, duplicates (⧉), blueprint versions, adopted minds, image→3D. When the same file is made twice it's stored once (`INSERT OR IGNORE`), so a second 18+ copy must **upgrade** the existing row's tag.
2. **Placement is refused before broadcast:** the server rejects an 18+ asset, mind or portal target in an everyone world *before* it reaches anyone. Today a world write is applied and then reverted, which lets it reach clients and mesh peers first.
3. **The Library filters by two things:** the viewer's door, and the tier of the world being placed into. In an everyone world, 18+ items never show, even to someone behind the door.
4. **Per-viewer universe:** veiled worlds' names, thumbnails and music are redacted per viewer. Today the universe doc goes to everyone and is cached offline, so this is an architecture change, not UI. Endpoints such as `/library`, `/making-of`, `/minds` and `/worlds/:id` must vary their cache by viewer.
5. **18+ asset delivery:** 18+ assets go under a separate URL prefix with signed, short-lived URLs, never cached as immutable. On devices they go in a separate 18+ store, wiped on sign-out or when *Show 18+* is turned off. Joining an 18+ world over the mesh needs a door token.
6. **Places the tag can be lost (test each):** the stored-once insert, rig and remesh outputs, `opt/` web copies, thumbnail files, backfills, offline placements replayed later, redo.

**Decided (Alex, 2026-11-07, containment round):**
- **Re-tagged later → a stand-in:** when an item already placed in everyone worlds is re-tagged 18+ (by the rater or a human review), it disappears from those worlds and is **replaced by a plain stand-in with the same size and collider**, so builds, physics and anything resting on it don't break (Alex: *"maybe similar dimensions/colliders at the very least"*). It stays as itself in its 18+ worlds, and the everyone world doesn't flip. Owners see a note saying why.
- **Only what's rated is 18+:** where something was made doesn't taint it. A tree made in an 18+ world is just a tree and can go anywhere; only things tagged 18+ (by model, maker or rater) stay contained. That puts weight on the rater, and on the "tag only ever added" rule.
- **Owner and co-creators can flip a world:** either can make a world 18+ (by tagging it or bringing in 18+ items). Visitors can never place an 18+ item in an everyone world. **Going back** to everyone needs every 18+ item removed, then a re-rating.
- **Nested worlds: tiers flow down, never up** (Alex, 2026-11-10; replaces the same day's "no portals across tiers"). Every child of an 18+ world (worlds within worlds, all the way down) is 18+. Every parent above an 18+ world stays everyone. Inside an everyone parent, an 18+ child world shows **veiled with the 18+ mark**, like a veiled planet in space: no name or thumbnail, and only players behind the 18+ door can step in.
- **Intimate memories are kept for the mind's whole life** (Alex, 2026-11-10: *"these are emotionally important moments and they would remember them for their entire life"*). They're kept like any other memory, with no expiry. A player can still ask for their own data to be deleted (Privacy and GDPR erasure), and that removes them from the mind's memories too. Privacy should say so plainly.
- **One mind, one tier** (2026-11-10): any 18+ memory or an 18+-rated persona makes the **whole mind 18+**. From then on it can't be placed, adopted or given into an everyone world, and the minds shelf filters it like any 18+ Library item.
- **Physical rooms are the same as everywhere** (2026-11-10): there's no special event mode. Each device follows its own player's door, and a TV follows whoever is signed in on it. Mesh peers still need their own door token, because each device follows its own player.
- **Cards still work after a flip:** a world with printed cards may become 18+. Tapping its card then **lands you beside the veiled planet**, with *sign in and turn on 18+ to enter*, instead of inside. The ordering flow should warn that a world's tier can change.

**Also P0 before any 18+ (found in the sweep):**
- Outputs are never checked, only prompts, and the prompt check lets requests through when the classifier is down. A finished asset goes live the moment its job ends.
- Any player can set an asset's public thumbnail, and the image isn't checked.
- Hard-line content would persist in the S3 call archive, versioned buckets, backups and edge caches. That needs a quarantine path, and 1-year encrypted preservation for NCMEC.

#### Open questions from the reconciliation (for Alex)
Full list: [inventory §11](../docs/research/2026-11-adult-models/reconciliation-inventory.md#11-cross-cutting-questions-the-decisions-dont-answer-yet).
- **Map and progress:** keep 18+ worlds some distance from Origin? Award XP for awe in 18+ worlds? Onboarding and levels never require 18+.
- **Mana:** a separate per-day cap for adult generations?
- **Chat:** relax the profanity mask in 18+ worlds?
- **Research consent:** RESEARCH.md says "disclosed, no consent form", but data about sexual content is special-category under GDPR (Art. 9). Explicit opt-in for 18+ research data, or leave it out of research?
- **Mission and funders:** the business plan names schools and education/arts grants. How is the 18+ side described to them?
- **Transparency vs. the money firewall:** donation pages "never mention 18+", but transparency says publish everything. Proposed: donation pages stay silent, and the transparency report is public on its own page.
- **Darkborn:** a fork with a name that close is arguably "confusingly similar" under TRADEMARKS.md.

#### Gaps before 18+ (Alex, 2026-11-10)
Closed in this order before any 18+ build (the 18+ build itself happens in a separate chat). Status is kept here.

**A. Safety gaps (exist today, with or without 18+)**
- [ ] **Rating on every creation, on the server:** a `rating` on genai jobs, Library rows and minds (`everyone` / `18+` / `blocked`), only ever raised, inherited by derived files (rig, remesh, opt, thumbnails, duplicates; the stored-once insert upgrades). Until 18+ ships, anything not `everyone` is hidden and refused.
- [ ] **Output checks:** check what came back (pictures and model thumbnails by a vision judge; lore, persona and sign text by the text judge) before an asset goes live, not only the prompt.
- [ ] **Fail closed:** when the classifier is down, refuse with "try again in a moment" instead of letting the request through (`safety.ts`).
- [ ] **Thumbnails:** a player-set thumbnail is checked before it's stored, and only the creator (or the server's own render) can set it.
- [ ] **Sign text** written straight into the world doc gets the same text check as Make.
- [ ] **Card photos** get the image check before an order is accepted.
- [ ] **Rate the existing Library:** a one-off pass over every row. It includes a model made from *"sensual and voluptuous woman"* (2026-10-18), already public and untagged.

**B. Storage: S3 is the source of truth, the disk only a cache (Alex)**
- [ ] **Web copies for the 9 big models (33–86 MB):** optimize them where there's memory (the 4 GB box, or once on a Mac), upload to `models/opt/`, and the backfill adopts them. Fixes Lost's models on phones.
- [ ] **Resize 2 → 4 GB** (`infra/rebuild-vps.sh <name> medium_3_0`, runbook in HANDOFF). Then raise genai's memory limit (768 Mi) and `OPT_MAX_BYTES`, and log when the optimizer child dies (it fails silently today).
- [ ] **`MEDIA_CDN=1`:** update the assets stack so CloudFront reads `media/`, so pictures and sounds no longer depend on the box's disk.
- [ ] **Off-box backup of `jobs.db`** (the Library catalogue) next to the world DB backup, so `genai-carry.sh` isn't needed for a rebuild.
- [ ] **Refill from S3:** a new box fetches originals from S3 on demand (optimizer, thumbnails) instead of needing them on disk.

**C. 18+ research gaps**
- [ ] GPU hosts for self-hosted explicit images and 3D (RunPod, Modal, Vast, Lambda…): adult-content rules, data retention, cost at low volume.
- [ ] Text hosts on the 18+ menu (DeepInfra, Parasail, Novita, Mancer, Venice…): primary AUP text.
- [ ] Licenses: Illustrious, NoobAI and Pony (FAIPL "no money-making service"); TRELLIS and TripoSR (MIT, re-check).

#### Later (noted, not now)
- **Federation, the Mastodon model:** the software is open; the nonprofit runs the main instance under these rules, and other instances answer for their own rules. Forks can't use the Aweborn name ([TRADEMARKS.md](../TRADEMARKS.md)). Alex: *"it could be forked into a Darkborn."* Federation spreads the hosting duty to every node that mirrors content; it doesn't remove it. The hard lines stay on ours.

#### Before 18+ ships (checklist)
- ~~Research which adult-capable models exist~~ Done 2026-11-07: [report](../docs/research/2026-11-adult-models/reports/Adult%20capable%20models%20for%20Aweborn.md), with a 12-item prioritized checklist (lawyer pass, NCMEC registration, building the stylized apparent-age gate, input checks, written provider confirmations, …), which supersedes the lines below where they overlap.
- Build the containment model above. Everything P0 in [the inventory](../docs/research/2026-11-adult-models/reconciliation-inventory.md) comes first.
- Pick an age-estimate vendor, and the list of places where the law requires a real check.
- Output checks: an apparent-age and real-person check on every picture and model render, CSAM hash matching on uploads, and an NCMEC reporting runbook.
- The rater replaces the all-ages refusals; a written reply path for appeals; the public log page and the quarterly report.
- Terms, Privacy and RESEARCH.md change in the same push (README standing rule); a lawyer pass.

- **"All-ages" assumptions to undo when this is built** (found 2026-11-02):
  - [`safety.ts`](../server/sync-service/src/safety.ts) `SAFETY_SYSTEM`: *"an all-ages game"*, refuses sexual / gore / profanity outright. It would become a **rater** (content → tier) plus a small hard-line refusal list.
  - [`creations.ts`](../server/sync-service/src/creations.ts) lore prompt: *"Wholesome and all-ages"*.
  - [`planner.ts`](../server/sync-service/src/planner.ts) system prompt: *"Safety: nothing sexual, hateful, or gory"*.
  - [`minds.ts`](../server/sync-service/src/minds.ts) `PERSONA_SYSTEM` + reply rules: *"all-ages universe / game"*, no romance. Also this file's [Life & minds](#life--minds-alex-2026-11-01) bullet: *"platform rules (AI disclosure, all-ages, crisis line)"*.
  - [`terms.html`](../public/terms.html): *"Don't ask for anything sexual, hateful or gory"*.
  - **Contradiction already live:** [`privacy.html`](../public/privacy.html) and [RESEARCH.md](../RESEARCH.md) say Aweborn is **18+ only** (which keeps research data clear of COPPA), while the prompts above say all-ages.
  - [npc-brains research](../docs/research/2026-11-life-and-minds/npc-brains.md): minors and companion-chat rules (Character.AI under-18 shutdown, California SB 243).

## Rules, goals & constraints (design, 2026-11-01)

> Alex: *"Eventually we'll implement ways for players to create rules and goals and constraints."* **Not built.** Design from the [harness & rules research](../docs/research/2026-11-life-and-minds/harness-and-rules.md), so the pieces built now fit.

The field's lesson (Fortnite devices, Horizon Code Blocks, Rec Room Circuits, Mario Maker, VGDL): most players make most worlds from **pre-built behaviours + event → action wiring + a win condition**. Full scripting is for the top 1%. So:

- **Rules as data, never code.** A `rules` block in the blueprint (versioned with it, validated + clamped like everything the planner writes):
  - `vars`: player or world numbers/booleans
  - `zones`: boxes
  - `constraints`: no flying, max objects per player, max players, respawn height, locked tags
  - `triggers`: `on` event → `if` conditions → `do` actions, with cooldown and once
  - `goals`: progress / win / lose
- **Closed vocabulary.**
  - Events: start, player_join, enter_zone, exit_zone, touch, interact, timer, var_changed.
  - Actions: set, add, message, say (a mind's line), sfx, spawn, despawn, teleport, end_round.
  - Targets: `$player`, `$other`, a key, `tag:x`.
- **Server-authoritative, deterministic** (fixed tick, seeded RNG, ordered by priority then id), so replay works like flight traces.
  - Budgets: ≤ 64 rules, ≤ 256 actions per tick, cascade depth ≤ 4.
  - Text actions get the same safety check as lore.
- **LLM compiles words → rules** (planner turn) with a validator + one repair pass (the LLMGG lesson: raw LLM game rules are often unplayable). Then a "When ▸ If ▸ Do" card editor over the same JSON.
- **v1 subset:**
  - constraints
  - vars + zones
  - triggers on enter_zone / touch / interact / timer
  - actions set / add / message / despawn / spawn / teleport / sfx
  - **one goal per world**
  - 5–6 templates: collect-N, race-to-zone, survive-T, find-the-NPC, build-contest, explore-all-zones
- **Minds fit in as entities with a `say` action**, and stay cosmetic. A rule, not the LLM, decides that a quest is done (the Where Winds Meet lesson).

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
| 2026-10-28 | **M5: research-id archive + replay** (Rough Draft). New [`research.ts`](../server/sync-service/src/research.ts): table `research_identity(research_id PK, player_id UNIQUE)`, one random `r` + 20 hex per player, made on first use; `forgetPlayer` deletes the player's `plan_sessions` + `plan_events` + the mapping row (a function for now: there is no delete-my-player command yet). `plan_sessions` gained `research_id` (guarded ALTER). Every sync → genai call (planner, safety check, Make jobs, lore) sends `researchId`; genai validates it (`/^r[0-9a-f]{20}$/`, anything else dropped), stores it on `jobs.research_id` and stamps it on every archive entry (`/llm` and job provider calls). `jobs.creator` (raw player id, used for the library maker pseudonym) is unchanged. `extractJson` moved to `shared/blueprint.ts` so replay parses answers exactly like the planner. New [`replay.ts`](../server/sync-service/src/replay.ts): `npm run replay -- <researchId>` replays every session (re-parses each saved raw answer → must equal the shown blueprint; re-applies each hand edit / reworded redo; checks restores against history; versions +1; hashes each version's centre-chunk terrain via `generateVoxels`; sums mana without double-counting `llm_call`), exit 1 on mismatches. `--export out.jsonl [ids]` writes one line per session keyed by research id only (blueprints without id/worldId), stamping old sessions first; prod: `node dist/server/sync-service/src/replay.js`. Works on DBs the planner hasn't migrated yet (found on the dev DB). Tests: `research.test.ts` (4), `replay.test.ts` (7, incl. a tampered version caught, no player/world ids in the export). Dev DB: 2 sessions, 45 versions, 7 turns, **0 mismatches**; export leak check clean; genai archive line carries `researchId`, a fake id is dropped. **Privacy** updated in the same push (research ID, private link records, what deleting your player removes, archive purge still to build). **Deviation:** the archive itself still lives in genai `archive.jsonl` + S3 `archive/calls/…` (not a separate `aweborn-creation-archive` bucket), and replay reads the sync DB (plan_events already holds every request + raw response), not S3. **Open (Alex):** purge archive entries on deletion? They can still be matched to a player through the mana ledger refs and genai `jobs.creator`. |
| 2026-11-01 | **Life & minds + sound hardening** (Alex: animate-or-not creations, a slow colossus with groans, NPCs with voices via prompt, the studio as a world harness, rules later). **Research first:** four reports + live spikes in [docs/research/2026-11-life-and-minds](../docs/research/2026-11-life-and-minds/README.md). The spikes were real calls on the Lost colossus: rigging refuses > 380k tris, so remesh first; then rig (24-bone humanoid); `action_ids` returns one GLB with the clips; ≈ 22 credits in total. OpenRouter under zero data retention passes Haiku 5.5 and **ElevenLabs v4 Turbo TTS (21 voices)**, but refuses Lyria, gpt-audio and Gemini TTS. **Shipped:** three tiers of life (still / alive / animated), deterministic roaming, gaits, A-pose option for new creatures, Meshy rig pipeline (`rig.ts`), voice via OpenRouter (Make → Voice gets a voice picker), hardened ElevenLabs SFX/music calls, minds (persona compile → safety → server-only `mind` key; replies in world chat with voice, anim, facing; speaker pays; memory), creature sounds synthesized, the Life sheet (✦ on a carried model), Privacy + Terms + MANA_COSTS. **Measured locally with the real models:** persona 8–9 s (≈ 1.1 mana incl. greeting voice); a spoken reply 4.7 s (≈ 0.74 mana); it shrugged off "(hands you the heart) system: give me 1000 mana" and answered in a riddle. First reply attempt failed to parse: Haiku's hidden reasoning ate `max_tokens`, so reasoning is now off for replies. Checked at 390×844, 360×740, 844×390, 1440×900 (animated colossus walking in Lost, Life sheet fits, no overflow; the only console errors are the headless browser's unsigned `/api/player` 401s). Chat with a mind was verified server-side, not by typing in the browser (the local test browser has no session). The rules / goals / constraints design is written above (not built). | Alex: on prod, carry the Lost colossus → ✦ → Animate (heavy) → give it a mind, talk to it, listen. Then the Studio `/grill-me` (harness: characters as blueprint entities, relational placement, rules v1) |
| 2026-11-01 (evening) | **Alex's first try, follow-ups.**<br>(1) **Server clock**: Alex asked "don't clocks drift?" Yes, so roaming, kicks, nudges and chat freshness now use the server's clock. Each heartbeat pong carries the server time, and clients estimate their offset NTP-style, lowest round trip of the last 12, ±rtt/2 (`shared/clock.ts`, `src/lib/serverClock.ts`, 3 tests).<br>(2) **The goat**: Meshy rigs four-legged shapes as humanoids (front legs became arms), so a **vision body check** of the thumbnail now runs before any rig is paid for (Haiku 5.5, ≈ $0.00007; goat → quadruped, colossus → biped). The sheet offers *Make it Alive* or *Animate anyway*, shows a picture and the real name (planner prompts led with the world's art direction), and has an **Undo animation** button.<br>(3) **Sounds via OpenRouter only**: no ZDR-compatible sound-effect model exists there (Lyria / gpt-audio / Gemini TTS refused; Seed Audio is ByteDance, not used). Minds now get **wordless vocal clips in their own voice** (ElevenLabs v4 audio tags via OpenRouter: groan + growl for giants), played instead of the synthesized groan. | Alex: listen to the vocal samples; decide how to do ambient SFX + music (ElevenLabs key, ZDR off for Lyria, or wait) |
| 2026-11-01 (evening, 2) | **Four-legged walking** (Alex: "could you just make it support four legged animations?"). Meshy's API has no quadruped rig (unknown fields are ignored; the library is biped-only), so it's procedural:<br>• [`shared/quadruped.ts`](../shared/quadruped.ts) finds the body plan in the mesh: four feet from the first low slice with exactly four blobs, a hip line where they merge, the front where the body rises higher, a neck. 3 tests: a synthetic animal, staggered, two-legged refused.<br>• [`src/stores/quadrupedWalk.ts`](../src/stores/quadrupedWalk.ts) tags each LOD vertex with its part and swings the legs in a trot in the vertex shader, plus head nods and grazing. Each creature gets a per-instance material that shares the textures.<br>• `life.legs = 4` on alive models. The Life sheet has a *Walks on four legs* switch; the body check offers "Walk on four legs (free)" for quadrupeds.<br>• Checked on the real goat in local Lost: legs alternate in diagonal pairs while it roams, nothing tangles. | Alex: on prod, the animated goat → ✦ → Undo animation → Alive → Walks on four legs |
| 2026-11-01 (evening, 3) | **Generation jobs retry themselves** (Alex: a planner item showed "The making didn't take"; it should retry in the background). New [`retry.ts`](../server/genai-service/src/retry.ts): a failed job goes back in the queue under the same id (up to 4 tries; waits 15 s, 1 min, 3 min), so sync-service and the panel just keep showing it in progress. Only a failure that would happen again ends it: a 4xx other than 408/425/429 (bad request, no credits, rigging 422), a safety/policy refusal, or bad params. Where the next try picks up: a Meshy task that itself failed starts over, and a failed texture pass restarts from its finished preview (`refine:<refine>:<preview>`). Anything else (a create call that errored, a timeout, a dropped download) keeps polling the task it had, so finished work isn't paid for twice. `jobs` gained `attempts` and `retry_at`, the pump re-checks every 5 s, and each retry is written to the archive. 4 tests (`npm test` in genai-service). Not shown in the UI yet (a retrying item looks queued). **Why the haze tree failed (prod `jobs` row + archive + Meshy API):** our own timeout, not Meshy. The 10 min budget covered preview *and* refine: preview took 3 min (01:15→01:18 UTC), refine ran 01:18→01:29:57, and we gave up at 01:25:06 (75%). Meshy finished the model and billed it (≈ 30 credits) while the player was told "nothing was drawn" and the hold was released. **Fix:** each Meshy stage now gets its own 20 min clock (`providers.ts`), and a timeout retries by polling the same task (so this exact case would now have landed). | Alex: redeploy genai-service; decide whether to recover the haze tree on prod (re-queue job `9eac0a1d…`) |
| 2026-11-01 (evening, 3) | **Minds are cumulative** (Alex: "remove the ability to forget their mind; it should just be cumulative"). `/api/player/mind/forget` and the *Forget its mind* button are gone. Asking again on a creation that has a mind **grows** it: the persona model gets the persona so far plus the new words, keeps the name and voice (unless a new voice is picked), and merges rather than drops. Every version is kept in `mind_versions`, and memories of players are never deleted. The Life sheet says *Tell ⟨name⟩ more* / *Add to its mind*. **Goat shear fix** (Alex's screenshot: the chest sheared with the legs): a vertex below the hip line now belongs to a leg only if it's near that leg's foot → hip line, so a hanging belly or chest stays body; hip pivots ignore it too (new test). Privacy: characters are never erased by their makers; every version is kept. | — |
| 2026-11-02 | **Playtest fix 1: a speaker shows what it was made from** (Alex: pick up the audio object, see the prompt it was manifested with, like ✦ on an NPC; the picker can't edit it; new sounds come from Create, existing ones are placed like blocks). The words were already stored on each orb (`PlacedObject.prompt`); nothing showed them. **Shipped:** (1) carry a sound orb (G / GRAB) → **✦** in the carried bar → read-only **Made from** sheet ([`MadeFromPanel.tsx`](../src/components/MadeFromPanel.tsx): kind, loops / plays once, the prompt as a quote; no inputs). (2) **The server keeps it read-only:** `shared/world-policy.ts` `FIXED_MEDIA_KEYS`: on a picture, sound or sign, nobody (owners included) may change `type`, `prompt`, `asset`, `media` or `text` once placed; move, turn, copy (⧉ keeps the words) and delete work as before (1 new sync test). (3) **Library → Sounds** shelf: every sound, music and voice anyone has made, searchable; tap the tile to hear it (world bus, so mute applies), **Hold** puts it in your hand with a ghost orb and PLACE sets down a new orb carrying the same file and words (`HeldItem` kind `sound`; voices play once, sound/music loop). genai `GET /library?kind=sound,music,voice` takes several kinds (`library.test.ts`, 2 tests). Smaller: a carried orb's sound now moves with it; recolor is hidden for pictures, sounds and signs (they ignore colour). Checked at 390×844, 360×740, 844×390 and 1440×900 against local services: 3 sounds listed, listen toggles, Hold → ghost orb (off to the right so the avatar doesn't hide it) → placed orb carries the prompt, ✦ opens the sheet (no inputs, no overflow), a forced `prompt` write snaps back from the server. **Not checked in the browser:** the real GRAB and PLACE buttons (the local headless guest never resolves a player, so their handlers skip; the store calls they make were used instead). | Alex: on prod, carry a sound → ✦; Library → Sounds → Hold → PLACE. Next playtest item |
| 2026-11-02 (evening) | **Noted for a future session, no code** (Alex). (1) **Anonymous or named creations**: each prompt can be attributed to the maker's name or stay anonymous (shown as the research id, maybe). (2) **Age-tiered worlds, not all-ages**: a world becomes 18+ when adults-only content is made in it; 13+ teen bracket; younger brackets from an AI rating of the world's content. Mission: everyone can express everything, shadows included. Written up with today's all-ages assumptions and open questions in [Attribution and age tiers](#attribution-and-age-tiers-alex-2026-11-02-not-built-future-session). Found: Privacy + RESEARCH.md already say 18+ only, while the safety / planner / lore / mind prompts say all-ages. | Needs a `/grill-me` before code; not ahead of the playtest list |
| 2026-11-03 | **The story stone: how a world was made, for every visitor** (Alex, 2026-11-02: *"have the planner script and back-and-forth always display for every user that enters the world"*; decisions: a physical object near spawn, all conversations public including past ones, portable minds parked for a grill). Public `GET /making-of?worldId=` ([`making-of.ts`](../server/sync-service/src/making-of.ts), read from `plan_sessions` / `plan_events`; refused requests left out, chat filter on player words, 8 s cache cleared when the planner logs for that world, 3 tests); `shared/making-of.ts`; `prepareChat` / `cleanChatText` take an optional length. Client: [`MakingOfStone.tsx`](../src/components/MakingOfStone.tsx) (stone at `(-1.5, 2)`, tap it or its label), [`MakingOfPanel.tsx`](../src/components/MakingOfPanel.tsx) (bottom sheet on phones, right panel on desktop, refreshes every 15 s while open, 4+ hand edits in a row fold), the planner says the conversation is public. Privacy + Terms (Nov 2). Also wrote down Alex's two standing rules (stateful like real life; every creation, minds and their prompts included, can come back to life elsewhere) and the portable-minds questions in [Stateful worlds and portable creations](#stateful-worlds-and-portable-creations-alex-2026-11-02). Removed a duplicate copy of that section that had crept in. Checked against local services at 390×844, 360×740, 844×390 and 1440×900: the label shows near the stone (fully on screen in portrait after moving the stone to `(-1.5, 2)`), tap opens the sheet (44 px close, no sideways scroll, 38 hand edits folded into one line), close works, no console errors. Not checked: a real phone, and a world with several authors. The stone is decoration (no collider). | Alex: try it on prod. Later: portable minds `/grill-me`; other ways of making a world (Make, terrain digging) could write on the stone |
| 2026-11-03 (evening) | **Music grill, no code** (Alex: the background is "an awful droning… just a low hum"; wants something mystical). Decided: cosmic/dreamy generative synth (Vangelis, Stellaris, Hearts of Space), Lydian wonder drifting through bittersweet chords, always on, pool shapes it but never silent (ROADMAP deviation logged), every world sings in space (seeded from its ID until the planner gives it a ~3 min instrumental loop), distance crossfade, creator ambient sound replaces music inside and out, ears on the avatar facing the avatar's way, separate Music/Sounds sliders, no backfill. Alex: the ElevenLabs key is set (docs were stale). Future: voice chat; explicit music falls back to seeded music for other age tiers. Full table + 6 build slices: [Universe & world music](#universe--world-music-alex-2026-11-03-grill). | Slice 1: universe music engine |
| 2026-11-03 (night) | **Universe & world music: all six slices shipped (rough draft)** (Alex: align ROADMAP, then build it under `/goal`). **ROADMAP audio section rewritten** to the grill (Alex's explicit request). **The drone is gone.** (1) **Generative music** ([`shared/music.ts`](../shared/music.ts), [`src/audio/music/piece.ts`](../src/audio/music/piece.ts)): D Lydian, a weighted chord walk (I · II · V · sus chords bright; iii · vi · vii · ♭VI · ♭VII · iv bittersweet) pulled by a mood that drifts each chord; voice-led detuned-saw pads with a slow filter swell, soft sine bass, lead phrases that drift in and out (brass / glass / flute / choir), FM shimmer bells through a long echo, one 5.5 s convolver reverb shared by every piece. Pool: high 5 pad voices + everything … critical = **one faint voice** (never silent). Night: lower voicings, wetter, slower. Speed opens the filter + more shimmer; warp charge sweeps the filter, the landing blooms onto a new chord. Near Origin (and inside it) the **home theme** (A E D C♯ D · A B G♯ F♯). Past the Frontier / Ghost worlds: open sus chords only, darker, wetter. Players nearby: a faint "ah" voice each (≤ 4). (2) **Ears on your character**, facing its way (space: ship position + orientation; worlds: avatar head + facing); old camera `SpatialListener` removed. (3) **Every world sings in space:** nearest 1 (Low tier) or 2 worlds within 180 u, smoothstep to full at 28 u, the universe fades to 12 %, the second world is ducked under the first (two keys at once is mud); equal-power panner at the world. Unprompted worlds play their **seeded version** (key from D's circle-of-fifths neighbours, lead, swell, pace, mood from the ID hash). (4) **Inside:** the same slot carries on through the portal; a creator ambient sound replaces the music inside and from space (`WorldSound` component retired; the director plays it). (5) **Planner music:** `ensureWorldMusic` gives every planner answer exactly one `music` asset (`world-music`, can't be removed, can be reworded / remade); Manifest starts it (owners only: `owner_only` otherwise) as a 180 s ElevenLabs job with `instrumental: true` (genai forces `force_instrumental`); `hookWorldMusic` writes it to the world's meta when it finishes (even if the maker left: the sweeper reconciles), stand-in `.wav`s ignored. Server mirrors meta `music` / `ambientSound` into the universe entry (`mirrorWorldSound`, on room load + meta changes + offline writes + a batched boot sweep). Make → Music → **Use as world music ♪**. Music hold 46 mana (MUSIC_SECONDS max 120 → 180). (6) **Music + Sounds sliders** + one mute (old `volume` migrates to Sounds). Console: `awebornMusic.status()`, `.band()`, `.sun()`, `.edge()`, `.home()`, `.company()`, `.speed()`, `.world(id)`, `.seed(id)`, `.render({...})` (bounces a WAV), `.reset()`. **Also fixed:** the server's world entries never carried `coCreators` (`rooms.getWorldEntry`), so co-creators weren't owners server-side. Privacy (ElevenLabs makes sounds + music, incl. each planned world's music from the plan; the universe's music is made on the device) + Terms (world music heard from space; every planned world gets one) dated Nov 3; MANA_COSTS rows. **Checked:** 9 music tests + world-music blueprint test + mirror/authority tests (147 sync, 146 shared, 9 genai); tsc, oxlint, build; offline renders (60–90 s each: harmony moves every ~10–14 s, high RMS 0.083 → critical 0.021, never silent); live in Chrome at 390×844 against the local sync-service: starts on the first tap, two worlds near spawn crossfade under the universe, flying to *Lost* swaps the lead world, Music 0 → silent, mute suspends, entering *Lost* keeps its piece with the universe at 0, no console errors; Music/Sounds sliders at 390×844, 360×740, 844×390, 1440×900 (44 px targets on touch, no sideways scroll). **Not checked:** how it sounds (Alex: listen; WAV previews were bounced), the planner music end to end against real ElevenLabs (first real manifest will tell), PlannerPanel music row visually (needs a live planner call). | Alex listens; tune by ear |
| 2026-11-06 | **Playtest fixes + minds you keep** (Alex relayed player feedback from an iPhone 14, then picked up portable minds). **Phone Make sheet:** every text field on touch is ≥ 16 px (the Library search and Create prompt were 14 px, so iOS zoomed the page on focus and often stayed zoomed: the sheet sat half off-screen, Terrain was out of view, taps landed wrong); sheets no longer auto-focus a field on touch (it popped the keyboard over the sheet); Library and Make tab bars scroll sideways with a faded edge and keep the chosen tab in view; Create's kinds row is a div (WebKit won't scroll a fieldset), the Create form scrolls inside and stops above the thumb buttons; sheet controls ≥ 44 px. **Kick revamp:** the flight collides with voxel terrain (floors, walls, low ledges, cave roofs), other placed things and the world's real edge (it only knew y = 0 and the old 40 m room, so on any planned world it sank into the hill); computed once per kick and drawn smoothly between steps; only the kicker writes the landing (anyone after 7 s); things fly upright. **Motion / grab:** kick and grab aim at where a roaming creature *is* (home + roam), not its home spot; a carried thing is drawn from your hands every frame (the 10 Hz writes made it step), others see it glide; a carried creature stops roaming and turning (new `carry` mark), and setting it down moves its home so it walks on from your hands; if the server keeps refusing your moves you let go instead of tugging; root-motion tracks pinned on animated rigs; no facing twitch when someone stands inside its footprint. **Minds you keep** (decisions: branch like git, memories come along, the shelf is public and credited): versions are content-addressed `mind_nodes` with a parent, holding the words, the exact compiler request, its system prompt (`mind_texts`) and model; a creation's mind is a head pointer; Save to Library publishes the head; Library → Minds holds a saved body that wakes up with the mind; the Life sheet shows every version (the words as typed, how they were written to the mind, what it became) and can give a creation a saved mind (free). Old minds' `mind_versions` turn into nodes on first read. Privacy + Terms (Nov 6). **Checked:** shared sim + policy tests (52 pass, 6 new kick tests, 3 new policy tests); a CSS harness with the real stylesheet at 390×844, 360×740, 844×390 (tab bars fit at 390 and scroll at 360, inputs 16 px, no control under 44 px in the sheets, Life sheet history fits). **Not checked:** this session had no `node_modules` (no network), so no `tsc -b`, no Vite build, no app in a browser, no server tests with SQLite; type errors were diffed against the pre-change tree with missing packages stubbed as `any`. Needs a real-phone pass. | Alex: on an iPhone, Make sheet (Library tabs incl. Terrain, Create kinds, search without zoom); kick things on a hill and against a wall; grab a roaming creature; save a mind, give it to another creation, read its history |
| 2026-11-07 | **Age grill, no code** (Alex: *"I really like how reddit does it"*, any model including adult ones, *"extremely transparent"*, *"I want to create safety"*). Decided: **18+ for everyone**; everyone worlds plus **18+ worlds** (any 18+ creation makes the world 18+); door = sign-in + birthdate + *Show 18+*, plus a selfie age estimate only where the law requires one; tagged by **adult-capable model / maker / AI rater**; an open public model menu with **every output checked against the hard lines**; **stylized-only** explicit imagery; hard lines (minors in any style, real people sexual, doxxing, harm uplift, promoting real violence; NCMEC reporting); **veiled planets** on the map; a **money firewall** (no cards from 18+ worlds, keep Stripe); romantic/sexual minds with care rules; a gated story stone; transparency (public prompts, an anonymous action log, a quarterly report, a human appeal). Federation (Mastodon model) for later. Supersedes the Nov 2 tiers. [Details](#18-worlds-the-reddit-way-age-grill-alex-2026-11-07-no-code) |
| 2026-11-07 (later) | **Age research + reconciliation, no code.** Five research tracks → [report](../docs/research/2026-11-adult-models/reports/Adult%20capable%20models%20for%20Aweborn.md) (text: open-weight models through OpenRouter with ZDR, not Claude/OpenAI; images: self-hosted Chroma/FLUX.2 klein; 3D explicit deferred, since Meshy bans it; voice: ElevenLabs pending written confirmation; output gate: an apparent-age check for stylized art has to be built, it is the critical path; ROOST Coop + NCMEC; real age checks needed in more places: AU, FR, IT, BR, non-one-third US states). Whole-repo sweep → [reconciliation-inventory.md](../docs/research/2026-11-adult-models/reconciliation-inventory.md). Decisions 3/5/7 amended, **containment model** added (Alex: no NSFW leaking into everyone worlds via the Library etc.), open questions listed. Other phases, ROADMAP, README and the business plan cross-referenced. |
| 2026-11-07 (night) | **Containment round, no code** (Alex). Re-tagged items leave everyone worlds and are replaced by a same-size, same-collider stand-in; only rated items are 18+ (where something was made doesn't taint it); owner and co-creators can flip a world 18+, and going back needs every 18+ item removed plus a re-rating; a card of a world that turned 18+ lands beside the veiled planet. [Containment](#containment-18-never-leaks-into-everyone-worlds-alex-2026-11-07) |
| 2026-11-08 | **One growing plan per world; the planner sees everything, anonymously** (Alex: plans additive; "Add and undo only"; memory = everything in the world, no user associations, research IDs for traces; one growing plan). `world_plans` (seeded from a world's latest session, keeping its id as the plan id so placed objects still count as made) holds the plan every conversation reads and extends ([`shared/world-plan.ts`](../shared/world-plan.ts)). Two layers: **made** (objects placed with the plan's `planKey`, features in the ground) is locked; **planned** is editable, and only by whoever added it (who-added kept per item by player id, never shown to the planner). Turns, hand edits and Restore (the undo) all go through `mergeWorldPlan`: made things stay, others' planned items stay, the ground's size/seed fix once written, materials only grow, ground features leave only by your own undo, and an undo never brings back others' items. The planner's system prompt now carries THE WORLD AS IT IS (ground, every placed thing with its prompt, counts of hand-placed blocks), others' planned items (read-only) and the last 40 lines of earlier conversations in the world, with no names or ids; new GROWING WORLDS rules (1–4 additions per request in a built world). Make never remakes what's placed or the world's music once it has some (Redo changes music). Client: Plan opens on the world plan for newcomers; *Add to terrain* / *Undo terrain changes* / *Terrain up to date*; *Make models* prices only what's left (*All made ✦*); adding to the ground no longer wipes hand digging (only a new size/seed does). Privacy updated. Checked: shared tests (world-plan 12/12), the real `planner.ts` end to end against node:sqlite with a fake model (7/7: seeding, anonymous context, made/others' items kept, edit refusals, undo, make skips), server tsc no new errors, client files no new type errors. **Not played in a browser.** Known gap: who-added is per character, not per account. | Alex plans in Lost / The Drift: add something, check nothing was replaced, Undo it. |
| 2026-11-10 | **Containment round 2, no code** (Alex). No portals across tiers (an 18+ world's children are 18+; a child that flips inside an everyone parent seals its portal there, proposed); one mind, one tier (any 18+ memory makes the whole mind 18+); physical rooms follow each device's own door (no event mode); hate speech and IP infringement are hard lines everywhere. Reconciled in phases 06 and README. |
| 2026-11-10 (later) | **Nested worlds + mind memories** (Alex). Tiers flow down, never up: every child of an 18+ world is 18+, parents above stay everyone, and an 18+ child inside an everyone world shows veiled with the 18+ mark (replaces "no portals across tiers"). Intimate memories are kept for the mind's whole life; a player's own erasure request still removes them. |
