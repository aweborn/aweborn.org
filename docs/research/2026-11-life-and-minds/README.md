# Life & minds: research (2026-11-01)

Alex, 2026-11-01: *"create models as either animate or not … my giant lava monster in Lost should have a slow colossus movement and groaning sounds. Perhaps it's even intelligent and we give it a voice … player-created NPCs via prompt. The planner and creation studio should be a harness for creating a 3D virtual world. Eventually rules, goals and constraints."*

Four research passes (full reports in this folder) plus live spikes against the real APIs with our keys. This page is the synthesis: what the field does, what we measured, and what we chose.

| Report | Covers |
|---|---|
| [rigging-animation.md](./rigging-animation.md) | Meshy rigging + animation API, non-humanoid options, three.js skinning, skinned LODs, colossus gait |
| [audio.md](./audio.md) | ElevenLabs SFX / music / TTS / voice design, OpenRouter TTS, Web Audio practice, failure codes |
| [npc-brains.md](./npc-brains.md) | Generative Agents, Inworld, Convai, ACE, NEO; hybrid control; persona schema; safety; cost model |
| [harness-and-rules.md](./harness-and-rules.md) | Holodeck / SceneCraft / Roblox Cube; agent harness patterns (MCP); UGC logic (Fortnite, Horizon, Rec Room); ECA / VGDL; rules schema |

## What we measured (real calls, 2026-11-01)

| Spike | Result |
|---|---|
| Rig the Lost colossus (`6e9fca48…`, Meshy refine, 1.5 M triangles) | Rigging refuses > 380k tris → **remesh to 30k first** (5 credits, ~85 s) → **rig** (5 credits, ~20 s): 24-bone humanoid skeleton (`Hips, Spine02 … LeftFoot, RightToeBase`, Mixamo-style without the prefix) |
| Animation library | `GET /openapi/v1/animations/library`: 678 actions (WalkAndRun 176, BodyMovements 158, DailyActions 157, Fighting 154, Dancing 33); free |
| `action_ids: [336, 669, 386, 127]` | **One GLB** with mesh + skeleton + 4 named clips, in the order asked (12 credits, ~60 s). Idle (*Long_Breathe*) and slow walk (*Slow_Orc_Walk_inplace*) look great on the colossus; raised-arm clips (scream, slam) stretch the skin, because the model was made arms-down |
| Our pipeline on that GLB | Rename clips to roles + web optimize: **10.9 MB → 2.7 MB**, skin + clips kept |
| OpenRouter under our **zero-data-retention** setting | ✅ Claude Haiku 5.5 ($0.10 / $0.50 per M). ✅ **TTS `elevenlabs/eleven-v4-turbo`, all 21 premade voices**, $0.04 / 1k chars (69 chars = $0.00276). ❌ `gpt-audio(-mini)`, ❌ Lyria 3 music, ❌ Gemini TTS, ❌ MiniMax / Grok / Qwen TTS (ZDR) |
| Total spike spend | Meshy 22 credits (≈ $0.44) + a few cents of TTS |

## Decisions (what shipped)

1. **Three tiers of life** on any generated model (`PlacedObject.life`, `shared/life.ts`):
   - *still* (default)
   - *alive*: free, any mesh, offline. Breathing squash, sway, turns toward you, roams around home
   - *animated*: Meshy remesh → rig → 4 clips, one GLB, ≈ 22 credits = **50 mana hold**. Humanoid/biped only (Meshy's API has no quadruped rig); a 422 tells the player to use *alive* and nothing is drawn.
   Industry pattern: a tiered strategy with a free procedural fallback that works for any mesh (research §2).
2. **Movement is deterministic from the clock** (`roamPose`): every client walks a creature the same way with zero messages, the same idea as kicks. The server computes the same pose to know who is near a mind.
3. **Gaits** = four library actions per role (`idle, walk, talk, emote`): heavy / calm / lively / sneaky. *Heavy* is the colossus (pace 0.6). New creatures meant to come alive are generated in **A-pose** (`pose_mode`) so every clip rigs cleanly.
4. **Minds** follow the hybrid industry pattern (Inworld, ACE, NEO, Generative Agents lessons):
   - Body: deterministic and free.
   - Mind: an LLM, **event-driven only** (a player speaks near it or says its name). One structured reply per turn: `say, anim, face, remember`.
   - **Cosmetic actions only**: a mind can't grant items, mana, permissions or world edits. That's the Where Winds Meet lesson: jailbreaks get words, never loot.
   - Persona compiled once (Sonnet 5.5) from the creator's words into a Card-V3-like schema, with safety checks on the way in and out.
   - Replies use Haiku 5.5 (≈ $0.0005). Spoken lines use ElevenLabs v4 Turbo through OpenRouter (≈ $0.004).
   - The speaker pays for the reply. The greeting is spoken once at creation and replayed for free.
   - Player text is quoted as data, and stage directions are stripped. A fixed platform preamble covers AI disclosure, all-ages content, a crisis note (SB 243) and no romance framing.
   - Memory: the last 10 lines heard near it (shared) plus 6 facts per player.
5. **Speech rides the world chat log** (server-written, archived, reportable): `npc:<objectId>` lines carry `voice`, `anim` and `to`. No new socket message, no CRDT churn per step.
6. **Voice no longer waits on the ElevenLabs key**: Make → Voice and every mind use OpenRouter TTS with a voice picker.
   **Sound effects and music still need the key** (or Alex relaxing ZDR for Lyria, $0.04 per 30 s clip). The ElevenLabs calls are hardened anyway:
   - explicit `model_id` and `output_format`
   - instrumental unless vocals are asked for
   - parsed error codes (402 / 401 quota, 429 concurrency)
   - real per-second pricing
7. **Creature sounds are synthesized** until real SFX exist: formant groans, footfall thumps detected from the walk clip's foot bones, and giant voices played lower with a low-shelf boost.

## Not yet (and why)

- **Harness evolution**, from the harness report. Three pieces:
  - `entities[]` with components (model, life, persona, behavior), alongside `assets[]`
  - Holodeck-style relational placement solved deterministically
  - planner tools in MCP shape: list/reuse library assets, estimate, propose patch, generate
  The planner doesn't emit characters yet; the Life sheet is the per-object entry point. Next step after Alex's Studio `/grill-me`.
- **Rules, goals, constraints**: designed (ECA triggers + vars + zones + one goal + constraints, server-evaluated, no user code) in the [Phase 07 → Rules, goals & constraints](../../../phases/07-genai-creation.md#rules-goals--constraints-design-2026-11-01) section. Nothing is built: Alex said "eventually".
- **Designed (custom) voices**: ElevenLabs Voice Design needs the direct key. The premade 21 plus client pitch/size cover it until then.
- **Non-humanoid rigs**: Tripo (`rig_type` quadruped/serpentine…) or self-hosted UniRig, if *alive* isn't enough.
- **Real-time spoken conversation** (STT → LLM → TTS streaming): not for ambient NPCs, and ElevenAgents' per-minute billing doesn't fit a crowd. Text + voice lines first.

