# Phase 07: World Creation & Gen AI

**Status:** `[ ]` Not Started
**Depends on:** [Phase 01: Foundation & Infra](./01-foundation.md) (genai-service container), [Phase 05: Mana Economy](./05-mana-economy.md) (mana cost validation)
**ROADMAP reference:** [Open Design Questions — World Interiors](../ROADMAP.md#open-design-questions)
**Estimated sessions:** 5-7

## Goal

Players can create rich, AI-generated content inside worlds: 3D avatars/characters, objects, landscapes, textures, music, ambient sounds, voices, and text/lore — all via natural language prompts. Each generation costs mana pegged to real compute/API costs (+ ~7% margin). Editing and arranging existing objects is free and works offline.

This phase answers the ROADMAP's open question: **"What can players actually do inside a world?"**

## Design Philosophy

| Principle | Implementation |
|-----------|---------------|
| **Online = Create, Offline = Edit** | AI prompting requires network (costs real API calls). Arranging, moving, resizing, coloring existing objects is local-only and free. |
| **Mana = Real Cost** | Each generation type has a mana cost derived from the actual API cost + ~7% margin. The formula is abstracted (not tied to a specific model) so we can swap providers. |
| **Everything is a seam** | Each generation type is a separate endpoint in genai-service with a consistent interface. New modalities plug in without restructuring. |
| **Results live in the CRDT** | Generated assets are stored as URLs in the World CRDT. The asset files themselves go to object storage (S3 or Lightsail block storage). |

## Architecture: genai-service

```
genai-service (Node.js container on k3s VPS)
├── POST /generate/model      → Meshy AI (3D models, avatars, characters)
├── POST /generate/image      → [TBD provider] (textures, paintings, decals)
├── POST /generate/music      → [TBD provider] (ambient loops, soundtracks)
├── POST /generate/voice      → [TBD provider] (NPC voices, narration)
├── POST /generate/text       → [TBD provider] (lore, dialogue, signs, names)
├── POST /generate/terrain    → [TBD provider] (landscape heightmaps, biomes)
├── GET  /generate/status/:id → Poll generation status
├── GET  /generate/cost       → Current mana cost table
└── GET  /health              → Health check
```

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
  estimatedMana: number;   // Mana cost (pre-deducted)
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

## Tasks

### Research: API Costs & Mana Formula
- `[ ]` Research current pricing for each modality:
  - Meshy AI: cost per 3D model generation
  - Image generation: cost per image (DALL-E, Stability, etc.)
  - Music generation: cost per minute of audio
  - Voice generation: cost per minute of speech
  - Text generation: cost per 1K tokens
  - Terrain generation: cost per heightmap (if using AI, or procedural = free)
- `[ ]` Design abstract mana cost formula:
  - NOT tied to specific model/provider (so we can swap)
  - Based on observable output metrics where possible (e.g., complexity, duration, resolution)
  - Includes ~7% margin for non-profit sustainability
  - Document in a `MANA_COSTS.md` reference file
- `[ ]` Define cost tiers (rough starting point, to be tuned):
  ```
  Simple object (low-poly, basic shape):    100-500 mana
  Complex object (detailed, textured):      500-2,000 mana
  Character/avatar (full 3D model):         2,000-10,000 mana
  Texture/image (applied to object):        50-200 mana
  Music loop (30-60 seconds):               500-2,000 mana
  Voice clip (10-30 seconds):               200-1,000 mana
  Text/lore (paragraph):                    10-50 mana
  Terrain patch (landscape section):        1,000-5,000 mana
  ```

### genai-service: Core Framework
- `[ ]` Implement the consistent request/response interface above
- `[ ]` Request validation middleware
- `[ ]` Mana pre-check: call sync-service to validate mana balance before proxying to AI API
- `[ ]` Mana deduction flow: pre-deduct estimated mana → generate → adjust if actual differs
- `[ ]` Task queue: track in-progress generations (in-memory or Redis)
- `[ ]` Status polling endpoint (`GET /generate/status/:id`)
- `[ ]` Asset storage: upload completed assets to S3 or Lightsail object storage
- `[ ]` Cost table endpoint (`GET /generate/cost`) — returns current mana prices
- `[ ]` Rate limiting per player (prevent spam generation)
- `[ ]` Error handling: refund mana on generation failure

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
- `[ ]` **[SEAM]** Evaluate approach: AI-based vs procedural
  - Procedural (from seed + parameters) = free, offline-capable
  - AI-based (text-to-terrain) = costs mana
- `[ ]` Implement heightmap generation or terrain mesh generation
- `[ ]` Parameters: biome, scale, roughness, features
- `[ ]` Use cases: world landscape base, custom terrain patches

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
- [ ] MANA_COSTS.md documents the cost formula and current rates

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
| `MANA_COSTS.md` | NEW | Cost formula documentation |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| — | — | — |
