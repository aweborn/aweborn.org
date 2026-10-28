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
- 📱 **30-second look on your phone** (M1): in one of your worlds, open 🧱 Make → 🌱 Portal and check the new **Builders** card (with your wife in the world, tap *Make builder*). The API is verified; my test browser couldn't keep a signed-in session locally, so I couldn't screenshot the card itself. *(Now that real-tap puppeteer checks work locally, I can screenshot it myself next time I touch it.)*
- 🧑 **Authority rules** (M1): shipped the approved plan's stricter rules (objects: placer/creator/builders; terrain, sky, physics, world settings: creator + builders). Phase 09 log from earlier the same day recorded a looser baseline (object actions open to everyone; terrain open to any signed-in explorer). Which do you want?
- 🎧 **Listen to the universe** (M2): on aweborn.org, tap once, then try `awebornAudio.wave()`, `.creationDone()`, `.reveal()`, `.setBand('low')` in the console (or make something / warp). I could only check levels on a meter, not taste. Too loud, too droney, wrong mood? Tell me what to change.
- 🧑 **Unsaved players can't reach warp** (M3): chapter 5's steps (make an object, shape terrain, plant a world) all need a saved player, so an anonymous player stops at Maker: no warp, leashed to the Frontier (~100 u today). Card / link arrivals are never gated. Is "save your player to go further" the funnel you want, or should anonymous players get a lighter chapter 5?
- 🧑 **Existing players start at Maker** (M3): everyone who had a character before M3 got chapter 5 (Maker caps, unchanged), so they're leashed to the Frontier until they make an object, shape terrain and plant a world, then finish chapter 6. Including you. OK, or seed you (and testers) higher?
- 🧑 **XP numbers** (M3, defaults): level n needs 60·(n−1)^1.7 awe and ⌊(n−1)/3⌋ mastered skills; first visit 40 (×2 with company), sighting 8, someone visiting your world 15, skill first use 20 / mastered 40, chapter 100, creation 10·√mana (≤ 400 a day), 25 per 1,000 u flown. Tune after a playtest.

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
| M1 | Event trust & safety: **world write authority** (placer / creator / co-creators; terrain+sky creator-only; guests can't delete others'), character names, chat mute/block/report, planner + Make safety check | ✅ (authority rules: Alex to confirm stricter vs. earlier baseline) |
| M2 | Audio engine (procedural): pool-level ambience, wave sweep + hum, creation exhale, discovery chime, UI ticks, mute in More | ✅ (sounds tuned by ear on headless meters only: Alex to listen) |
| M3 | Awe = XP: awe events → XP, levels (curve + skill breadth), `base(level)` caps, chapter ladder, warp gate at ch. 7 (cards/links never gated), beginner cradle, levels UI, Privacy | ✅ (numbers are defaults; 3 questions queued) |
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
| 2026-10-27 | **M1 authority shipped** (`103c0ef`): server reverts forbidden world edits (revert, don't refuse; one `"authority"` transaction). Co-creators via `POST /api/player/world/policy {coCreators}`. Grab only picks up what you may edit; Shape terrain is creator-only. Terms updated. **Verified on prod** with `scripts/verify/world-authority.mjs` (guest rename + delete both reverted). | Character names |
| 2026-10-27 | **M1 names shipped.** `shared/names.ts` (2–20 chars, letters/numbers/space `_-.'`, profanity + reserved words refused); `character.name/nameAt`; `POST /api/player/character/name` (1 rename / 10 s); public `GET /players/names?ids=` (≤ 50, cached 60 s). Client: batched `nameStore`, chat shows names, name row in the account panel (New player tab + saved players), name tags over named avatars. Privacy updated. Checked 390×844, 360×740, 844×390, 1440×900; API checked with curl (the local test browser had no session cookie, so the in-browser save showed the new "session ended" message). 63 shared + 53 sync tests. | Builders UI (co-creator toggles), then mute/block/report |
| 2026-10-27 | **M1 builders UI.** Creator-only *Builders* card in the 🌱 Portal sheet (desktop Y, touch Make → Portal): players here now + existing builders ("· away"), by name, toggle → `POST /api/player/world/policy {coCreators}`; the list syncs back through the world. Anonymous refusal now says "Sign in to change who may build in your world." API checked locally with curl (guest ids stripped, anonymous refused). Card not screenshotted (local browser session), queued for a phone look. | Chat mute/block/report |
| 2026-10-27 | **M1 mute/report shipped** (`537541d`). Tap a name in the open chat log → Mute/Unmute or Report (reason + note; evidence = server's own copy of their lines there in the last hour). Mutes sync for signed-in players. `/admin-reports.html` (`MANA_ADMIN_TOKEN`). Also repaired Terms mojibake I introduced in `103c0ef` (27 double-encoded sequences; prod verified clean). Verified with **real taps via puppeteer-core + system Chrome** (agent scratch script, not in the repo; the browser subagent had faked its DOM earlier, so it's no longer trusted for UI checks) at 390×844, 360×740, 844×390, 1440×900; server rows confirmed. | Safety check |
| 2026-10-27 | **M1 safety check → M1 ✅.** `safety.ts`: blocklist + cached Haiku classifier (≈1 s, ≈$0.00007, booked as reserve→settle); fails open if the classifier is down. Make: 422 + original suggestion + "Use this idea". Planner: checks the blueprint (not the player's words), refuses in the planner's voice with the suggestion as a chip. Manifest + reworded redo checked too. Blocks in `safety_flag`, "Blocked prompts" admin tab. Privacy updated. 8/8 live grading; Make refusal real-tap checked at 390×844 + 1440×900. 63 shared + 61 sync tests. Noticed (not fixed, pre-existing): at 390×844 the world pill overlaps the Make tabs. | M2 audio (procedural) |
| 2026-10-27 | **M2 audio → ✅.** Server publishes `mana.level` = creative ÷ max(3,000, 30-day creation draw) ([`shared/mana-level.ts`](../shared/mana-level.ts); bands critical <5 %, low <30 %, medium <80 %, high). Client [`src/audio/`](../src/audio/): all-synthesized WebAudio (no files). Ambience follows the band (warm full hum → gentle hum → near-silence + distant tones → silence); wave = 30→80 Hz sweep + whoosh, then an A-major hum; creation inhale on submit, exhale on arrival (thinner when low, strained whisper when critical; terrain shaping counts); sighting bell, reveal arpeggio; warp charge + crack; approach hum near worlds in space; faint UI ticks. Silent until the first tap; suspended while muted or the tab is hidden. Mute + volume in ••• More → Settings (touch) and the gear panel (desktop), device-local (`aweborn.audio`; Privacy already covers local settings). Console: `awebornAudio.wave()` etc. Real-tap puppeteer at 390×844, 360×740, 844×390, 1440×900: context starts on the first tap, ambience RMS ≈ 0.085, mute suspends + persists, every sound moves the meter, hidden tab suspends, no console errors. **Not verified: how it sounds** (headless, meters only). 65 shared + 62 sync tests. | M3 awe = XP + levels |
| 2026-10-27 | **M3 awe = XP + levels → ✅** (M3a `bae89c2`; M3b/c this push). Levels, chapters, skills and explorer goals in `shared/progress.ts`; server `Progress` records XP (never high-water); caps follow real level/chapter. Client: Your journey dialog (Level chip on desktop, ••• More row on touch), progress toast (`popover=manual`), skill reports from flight/placing/terrain, soft beginner leash, warp gated at chapter 7 with a notice (lock-on still works; World Index "Warp here" disabled with a hint). Real-tap check (fresh anonymous player → chapter 2, journey open/close, warp denial) at 390×844, 360×740, 844×390, 1440×900; no console errors. Known: the toast briefly overlaps the onboarding hint card on phones (auto-dismisses in 5.5 s). 67 shared + 68 sync tests, lint baseline. | M4 living sky |
