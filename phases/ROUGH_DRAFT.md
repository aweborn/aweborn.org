# Rough Draft GOAL: execution plan (approved by Alex 2026-10-27)

> **GOAL:** a rough draft of the whole game: every feature already discussed in ROADMAP + phase files, M0–M9 below.
> **Mode (Alex):** autonomous (`/goal`). Ship each milestone to prod when its checks pass (tsc, tests, portrait → desktop check per `AGENTS.md`, bots on hot paths). Queue anything needing a device 📱, an account 💳 or a taste call 🧑 in **Waiting on Alex** below instead of blocking.
> Prod has zero outside players yet (Alex, 2026-10-27: only Alex and his wife have played), so verifying against prod is fine. Still back up before migrations.

## Decisions (Alex, 2026-10-27)

| Topic | Decision |
|---|---|
| Scope | **Everything, M0–M9**, including WebRTC mesh (Phase 06) and server-authoritative flight (Phase 09) |
| Progression numbers | Agent proposes defaults from the phase docs, ships them, tune after playtests ("defaults approved") |
| **Awe = experience** | **Awe is the character's experience (XP). It is NOT linked to the high-water line / Frontier reach.** Only gifts move the high-water line. *Deviation from ROADMAP (Awe section, System Rules); ROADMAP not edited.* |
| Universe audio | **Procedural WebAudio synthesis** for the universe (ambience, wave, creation, discovery, UI) |
| Player audio (M5) | Players generate a world's global sound and **objects that play AI-generated audio** as positional sources |
| World write authority | Build now (M1); verify against prod |
| Refunds / disputes | Labeled **draw** in the ledger for now |
| Card price | **$9 per card** (≈ $1.50–2 production + shipping; surplus ≈ $5 → pool, α of it creative). Stripe product already exists in the dashboard |

## Waiting on Alex (queue; never blocks the run)

- 💳 Stripe **price ID** (`price_…`) for the $9 card product, live mode (M6)
- 💳 Provider keys as M5 reaches them: Gemini (image + TTS), Lyria (music); confirm OpenRouter covers text
- 📱 Physical card test matrix when the cards arrive (iOS/Android, locked screen, cases)
- 📱 Two-phone test for mesh (M7)
- 🧑 Studio design session (`/grill-me`) before M5's Studio part. Until then: build the generators + planner edits
- 🔑 **Backup cadence** (from M0): GitHub runs the hourly off-box backup only every ~3–5 h. Real fix = upload to S3 from inside the cluster, which needs a put-only IAM key as a k3s secret on the VPS (`AGENTS.md`: secrets → ask). OK to add one?

## Checks before shipping (copy-paste)

```bash
npx tsc -b && (cd server/sync-service && npx tsc --noEmit -p .) && npx oxlint
node --import ./server/sync-service/node_modules/tsx/dist/esm/index.mjs --test shared/*.test.ts shared/sim/*.test.ts
(cd server/sync-service && npm test)
```

## Milestones

Status: ⬜ not started · 🟡 in progress · ✅ shipped

| # | Milestone | Status |
|---|---|---|
| M0 | Housekeeping: phase checkboxes match code, chat key hint, drop `y-websocket`, MANA_COSTS caps, backup cadence | ✅ (backup cadence queued) |
| M1 | Event trust & safety: **world write authority** (placer / creator / co-creators; terrain+sky creator-only; guests can't delete others'), character names, chat mute/block/report, planner + Make safety check | ⬜ |
| M2 | Audio engine (procedural): pool-level ambience, wave sweep + hum, creation exhale, discovery chime, UI ticks, mute in More | ⬜ |
| M3 | Awe = XP: awe events → XP, levels (curve + skill breadth), `base(level)` caps, chapter ladder, warp gate at ch. 7 (cards/links never gated), beginner cradle, levels UI, Privacy | ⬜ |
| M4 | Living sky: solar cycle (visual + ±10% caps), pool-level visuals, shooting stars (Form 990 fields), opt-in donor name, shortfall + runway email, refunds as labeled draws | ⬜ |
| M5 | Creation breadth: planner direct edits + history, image/texture, music + world global sound, **audio-emitting objects**, voice, lore, smooth voxels, terrain editing, research-id archive + replay; Studio after the grill | ⬜ |
| M6 | Cards as commerce: card art from photo mode, batch print/encode tooling, in-game "Get this card" ($9 Stripe Checkout), orders + admin fulfillment + email, pool hook + swell beam, sets/progress, print moderation, event guide | ⬜ |
| M7 | Offline & mesh (Phase 06): connectivity HUD, IndexedDB, WebRTC peers, QR two-scan signaling, `/j#offer`, collision nudge | ⬜ |
| M8 | Authority (Phase 09): 9A shared flight sim → 9B online authority → 9C offline replay → 9D telemetry → full 9F intent catalog | ⬜ |
| M9 | Identity leftovers: QR device linking, one screen steers, Safari cookie proxy | ⬜ |

Full audit + per-milestone detail: written in the 2026-10-27 session (summarised above). Each milestone's work is logged in its phase file's session log (M1/M8 → Phase 09, M2–M4 → Phase 05, M5 → Phase 07, M6 → Phase 08, M7 → Phase 06, M9 → Phase 08 identity).

## Session log

| Date | What | Next |
|---|---|---|
| 2026-10-27 | Audit against code (phase checkboxes were stale; found that any socket could rewrite any world doc). Plan approved, decisions above. | M0, then M1 |
| 2026-10-27 | **M0 shipped.** Phase 06/07 checkboxes reconciled with code; chat button tooltip reads the real chat binding; unused `y-websocket` removed (client + sync-service + its `.d.ts`); MANA_COSTS caps were already current. Backup cadence queued (needs a VPS secret). tsc clean, 58 shared + 40 sync tests, lint 0 errors. | M1 world write authority |
