# Playtest log

Alex's notes from playing on a phone, kept here so any session can pick them up.
Newest first. Each item: what happened, where, what the code says about why, and a fix
idea. Status: ⬜ open · 🟡 in progress · ✅ fixed (with commit).

Earlier playtest rounds are in the Phase 07 session log (2026-11-02, 2026-11-06).

## 2026-11-08 · Android Chrome, 360 × 808 (portrait), world *Lost*, planning *The Drift*

1. ⬜ **The Plan sheet spills over the thumb controls.** With the blueprint closed,
   the sheet holds the title row, 4 reply chips on 2 rows, the blueprint summary,
   3 making rows (2 lines each), Terrain + Make models, and the *Say more…* input.
   That's about 550 px of content in a sheet about 400 px tall (touch: top 60 px,
   bottom 296 px). Every row is `flex: none` and `.planner` doesn't scroll, so the
   making rows, both buttons and the input render below the sheet's background,
   on top of KICK, JUMP and both sticks. The input sits under the MOVE stick and
   can't be read. This breaks AGENTS.md portrait rule 5. The 2026-11-06 fix made
   Create scroll above the thumbs, but not Plan.
   *Fix idea:* make the middle (chips, card, makings) the sheet's one scroll area
   (`flex: 1 1 auto; min-height: 0; overflow-y: auto`), with the actions and the
   input pinned at the sheet's bottom. Check at 360 × 740, 390 × 844 and
   844 × 390 with 3+ makings and the card both open and closed.
   (`src/index.css`, `html.touch-ui .planner` and `.planner-*`.)
   *Second screenshot (21:08):* with the reply chips gone it's still too tall. The
   *Say more…* input sits below the sheet, under KICK and JUMP.

2. ⬜ **2 of 3 models failed with no reason:** "The making didn't take. Nothing
   was drawn." for *sky shrine* and *drifting stones* (*hanging roots* was made).
   That text is a catch-all: `failureMessage()` in
   `server/sync-service/src/creations.ts` only special-cases rigging errors and
   drops the real error from genai-service (`j.error`). So neither the player nor
   we know if it was Meshy, a timeout, a safety refusal or retries running out.
   There's no way to retry a failed row either; it's just text.
   *Next:* look these jobs up in the prod genai-service logs to find the actual
   cause. Then show a short reason and a **Retry** button on each failed row, and
   keep the full error with the job.

3. ⬜ **Failure text is too long for a phone row.** It wraps to two lines (the
   state is capped at 60% of the row), which makes each row taller and feeds #1.
   *Fix idea:* on touch, "Didn't take · Retry"; put the reason under the item name.

4. ⬜ **The world pill overlaps the sheet's top edge.** The "Lost · ✦368 · 60 in
   flight · hold to leave" pill hangs a few px over the Plan sheet's border. Minor.

5. ⬜ **"Terrain: creator only" isn't quite right.** Builders can shape terrain too
   (`useOwnsCurrentWorld` counts them). With the builders branch
   (`builders-ask-to-build`), it should read "creator & builders", and could offer
   *Ask to build*. (`src/components/PlannerPanel.tsx`.)

6. ⬜ **Couldn't find how to ask for builder access.** Expected: the builders
   feature is only on the `builders-ask-to-build` branch, which isn't deployed yet.
   Once it's live: World Index → tap the world → *Build here → Ask to build* (worlds
   you've been inside), or Make → 🌱 Portal. Retest after it ships.

**Question for Alex:** with two items failed, what did *Make models ≈320 mana* do
when you tapped it? Did it try the failed ones again?
