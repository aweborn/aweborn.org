# Mana Costs

> What it costs the universe to manifest things. **Mana = compute:** each generation draws its real provider cost × `K` from the creative share, no markup (`K = 100`, so **1 mana = $0.01**). See the [Phase 05 formula](./phases/05-mana-economy.md#the-mana-pool-formula) and [Phase 07](./phases/07-genai-creation.md#research-api-costs--mana-formula).
>
> **Prices checked 2026-10-14 from public list prices. They change often: re-verify each provider at integration time and whenever a bill looks off.** The estimate is what we reserve; the provider's actual charge is what we draw.

## The formula

```text
estimate(request) = Σ provider list price of every call the request makes × K
                  + orchestration (the LLM call that turns a prompt into a plan)
actual(request)   = what the providers actually billed for those calls × K
failure           → nothing drawn
```

Provider-agnostic: the table below is keyed by **what the player makes**, so we can swap a provider by changing one row.

## Per-item costs

| Player makes | Default provider (alt) | Unit | Provider cost | **Mana** |
|---|---|---|---|---|
| **World planner** (turns a prompt into a plan: what to make, where, the mood) | **Claude Opus 5.5** ($4 / $20 per M tokens) (Gemini 3.1 Pro $2 / $12) | ~4k tokens in, 2k out | ≈ $0.056 | **5.6** |
| Text: lore, dialogue, backstory | Claude Opus 5.5 | ~1k tokens out | ≈ $0.02 | **2** |
| Small calls: one item's prompt, a name, a sign | Gemini 2.5 Flash ($0.30 / $2.50 per M tokens) | ~2k in, 500 out | ≈ $0.002 | **0.2** |
| Image: texture, painting, decal (1K) | Gemini 3.1 Flash Image ($60 / M output tokens) | 1 image, ~1,120 tokens | $0.067 | **7** |
| Image, small (512) | same | 1 image, ~747 tokens | $0.045 | **4.5** |
| **Terrain: voxel grid (default)** | in-browser, laid out by the world planner | — | $0 | **0** |
| Terrain piece: island, mesa, cliff, cave | Meshy-7 (full + texture) | 1 mesh | ≈ $0.60 | **60** |
| 3D object, quick (Lite + texture) | Meshy-6-Lite (15 credits) | 1 model | ≈ $0.30 | **30** |
| 3D object / character (full + texture) | Meshy-7 (30 credits; 8K: 35) | 1 model | ≈ $0.60 | **60** |
| Music loop | Lyria 2 on Vertex ($0.06 / 30 s) (ElevenLabs Music $0.15 / min) | 30 s | $0.06 | **6** |
| Sound effect | ElevenLabs SFX (≈ $0.12 / min) | ~5 s | ≈ $0.01 | **1** |
| Voice / narration | Gemini 2.5 Flash TTS ($10 / M audio tokens, ~25 tokens/s) (ElevenLabs $0.05–0.10 / min) | 1 min | ≈ $0.015 | **1.5** |

Meshy credits are bought on a subscription ($20 / month for 1,000 credits on Pro, about $0.02 per credit; bigger plans and packs bring it toward $0.012). We price at **$0.02** until our plan says otherwise.

**Model tiers (Alex, 2026-10-16):** the calls where quality shows (the world planner, lore) use a top model; tiny high-volume calls use Flash. Text is a small slice of any bundle, so the top model adds only ≈ 2–7% to a world. Images, 3D and audio come from specialist models (Meshy, Flash Image, Lyria, ElevenLabs): general LLMs like Claude don't make those.

**Terrain (Alex, 2026-10-16):** the default is a **voxel grid** (perfect grids feel good, Minecraft-like), free and in-browser, laid out by the planner. Meshy makes bounded terrain *pieces* (an island, a mesa, a cliff, a cave mouth) placed on the grid; it isn't built for large continuous landscapes.

## Bundles (what players actually do)

| Bundle | Contents | **Mana** | Dollars |
|---|---|---|---|
| **Maker tutorials** (chapter 5, every tool once) | 1 quick object (30), 1 texture (7), 30 s music (6), 1 SFX (1), 30 s voice (1), voxel terrain (0), a starter world (planner 5.6 + 1 quick object + 2 textures + 30 s music + lore 2 ≈ 58), small calls ×7 (1.4) | **≈ 104** | ≈ $1.04 per new player |
| **A whole new world** | planner (5.6), lore (2), voxel terrain (0), 5 full objects (300), 4 textures (28), 2 min music (24), 1 min ambience (12), 1 min voice (1.5), small calls ×12 (2.4) | **≈ 376** | ≈ $3.76 |
| **…with a Meshy terrain piece** | + 1 island / mesa (60) | **≈ 436** | ≈ $4.36 |
| **A character** | 1 full object (60), voice line (0.5), name + backstory (2) | **≈ 63** | ≈ $0.63 |

## What this means for the pool (founding gift)

$1,000 founding gift → 100,000 mana in the pool, **50,000 creative**. With `τ = 30` days the universe can spend **≈ 1,667 mana/day**:

- ≈ **16 new players/day** through the Maker tutorials, *or*
- ≈ **4.4 whole new worlds/day**, *or* any mix.

## Proposed personal caps (`base(level)`, `p_solo`)

Caps are per rolling 24 h (the per-minute window in the formula is just how the server meters it).

| Stage | `base` (mana / 24 h) | Why |
|---|---|---|
| Unsaved (anonymous) player | **0** | No gen AI until signed in: guests explore, enter worlds, place blocks and Library models freely. Making from thought draws on the shared pool (Alex, 2026-10-20; was 60 on 2026-10-19) |
| Chapters 1–4 (move … build) | **0** | Nothing generative yet; building and arranging are free |
| Chapter 5 (Maker tutorials) | **600** | A whole textured world (~9 models + planner turns) fits in a day (raised 2026-10-17 from 150) |
| Chapter 6–7 | **1,000** | Experimenting with every tool (raised from 250) |
| After warp, per level | **+50 per level, up to 2,500** | Levels come from channeled mana + breadth (raised from +25 / 1,000) |
| `p_solo` | **1,200** | A lone player can always make one whole new world per day (raised from 400) |

Solar ±10% applies on top. **Approved by Alex 2026-10-16** ("perfect"), raised 2026-10-17 and the guest row added 2026-10-19; implemented as `MANA_CAPS` / `baseCap()` in `shared/crdt-schema.ts` (the guest cap is applied by `ManaAdmission.capFor`).
