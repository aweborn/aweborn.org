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
| Orchestration (every AI request) | Gemini 2.5 Flash | ~2k tokens in, 500 out | ≈ $0.002 | **0.2** |
| Text: lore, signs, names, dialogue | Gemini 2.5 Flash ($0.30 / $2.50 per M tokens) | ~1k tokens out | ≈ $0.003 | **0.3** |
| Image: texture, painting, decal (1K) | Gemini 3.1 Flash Image ($60 / M output tokens) | 1 image, ~1,120 tokens | $0.067 | **7** |
| Image, small (512) | same | 1 image, ~747 tokens | $0.045 | **4.5** |
| Terrain: procedural | in-browser | — | $0 | **0** |
| Terrain: AI heightmap | Gemini Flash Image, 512 | 1 image | $0.045 | **4.5** |
| 3D object, quick (Lite + texture) | Meshy-6-Lite (15 credits) | 1 model | ≈ $0.30 | **30** |
| 3D object / character (full + texture) | Meshy-7 (30 credits; 8K: 35) | 1 model | ≈ $0.60 | **60** |
| Music loop | Lyria 2 on Vertex ($0.06 / 30 s) (ElevenLabs Music $0.15 / min) | 30 s | $0.06 | **6** |
| Sound effect | ElevenLabs SFX (≈ $0.12 / min) | ~5 s | ≈ $0.01 | **1** |
| Voice / narration | Gemini 2.5 Flash TTS ($10 / M audio tokens, ~25 tokens/s) (ElevenLabs $0.05–0.10 / min) | 1 min | ≈ $0.015 | **1.5** |

Meshy credits are bought on a subscription ($20 / month for 1,000 credits on Pro, about $0.02 per credit; bigger plans and packs bring it toward $0.012). We price at **$0.02** until our plan says otherwise.

## Bundles (what players actually do)

| Bundle | Contents | **Mana** | Dollars |
|---|---|---|---|
| **Maker tutorials** (chapter 5, every tool once) | 1 quick object (30), 1 texture (7), 30 s music (6), 1 SFX (1), 30 s voice (1), AI terrain (4.5), a starter world (1 quick object + 2 textures + 30 s music + lore ≈ 51), orchestration ×7 (1.4) | **≈ 102** | ≈ $1.02 per new player |
| **A whole new world** | 5 full objects (300), 4 textures (28), 2 min music (24), 1 min ambience (12), lore (0.3), 1 min voice (1.5), orchestration ×13 (2.6) | **≈ 368** | ≈ $3.70 |
| **A character** | 1 full object (60), voice line (0.5), name + backstory (0.3) | **≈ 61** | ≈ $0.61 |

## What this means for the pool (founding gift)

$1,000 founding gift → 100,000 mana in the pool, **50,000 creative**. With `τ = 30` days the universe can spend **≈ 1,667 mana/day**:

- ≈ **16 new players/day** through the Maker tutorials, *or*
- ≈ **4.5 whole new worlds/day**, *or* any mix.

## Proposed personal caps (`base(level)`, `p_solo`)

Caps are per rolling 24 h (the per-minute window in the formula is just how the server meters it).

| Stage | `base` (mana / 24 h) | Why |
|---|---|---|
| Chapters 1–4 (move … build) | **0** | Nothing generative yet; building and arranging are free |
| Chapter 5 (Maker tutorials) | **150** | Finish every tutorial in one sitting with room for a retry |
| Chapter 6–7 | **250** | Experimenting with every tool |
| After warp, per level | **+25 per level, up to 1,000** | Levels come from channeled mana + breadth |
| `p_solo` | **400** | A lone player can always make one whole new world per day |

Solar ±10% applies on top. *Proposal, pending Alex (2026-10-14).*
