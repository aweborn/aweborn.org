# Phase 10: The Game Layer (rules, boundaries, goals, teams, lobby, NPC players)

**Status:** `[~]` In progress. Grill closed 2026-11-23. **All seven slices exist as a rough draft on the local branch `phase-10-slice-1`** (written 2026-11-23, nothing pushed): real matches run end to end in a sandbox with real browsers. Not load-tested, not played by a person, public pages not lawyer-reviewed. See [Start here](#start-here-handoff-for-the-next-chat-2026-11-23).
**Whiteboard** (the player's loop and the build order on one board): https://claude.ai/artifact/MLb7vRPPaCspVNUXH1mora
**Depends on:**
- [Phase 07](./07-genai-creation.md): [rules, goals & constraints design](./07-genai-creation.md#rules-goals--constraints-design-2026-11-01), minds/NPCs, the planner/Studio
- [Phase 09](./09-authoritative-flight.md): deterministic `shared/sim`, server-authoritative intents (`shared/actions.ts`)
- [`shared/world-policy.ts`](../shared/world-policy.ts): who may edit what

**Feeds:** the research mission ([RESEARCH.md](../RESEARCH.md): MatchRank, match → observe → re-match) and [Phase 05](./05-mana-economy.md) (any awe/mana rewards).
**Research:** [docs/research/2026-11-custom-games](../docs/research/2026-11-custom-games/README.md). Halo 3 to Infinite Forge and custom games, Roblox, Fortnite, Warcraft III, Rec Room, VRChat, Empirica, Overcooked-AI, plus a tradeoff table.
**ROADMAP deviation (to log, don't edit ROADMAP.md):** the *Emergent Social Behavior* section says no matchmaking or lobbies. Alex now wants a physical matchmaking lobby. Recorded here as a deliberate change (2026-11-23).

## Goal (Alex, 2026-11-23)

> *"The 'game' engine part of aweborn which enables better research because players will be enabled to apply rules, constraints, and other fundamental components of games. They will be able to place 'boundaries' of the space. Create goals and rules. Matchmaking, a physical matchmaking lobby for players waiting to be matched on teams and placed in the game. We also want NPCs and non-player characters to be able to make and have play in the 'game' being built by players within a world. For now, only one game per world."*

In short, players turn a world into a game:
- **Boundaries:** the play space and places to avoid.
- **Rules and constraints:** what players can and can't do in the game.
- **A goal:** how a team wins or loses.
- **Teams.**
- **A physical lobby:** players wait there, get matched onto teams and are placed into the game.
- **NPCs:** they can help build the game and can play in it.

Because every rule, team assignment and outcome is data, each match is also a well-described trial for the research.

## Start here: handoff for the next chat (2026-11-23)

> **Update, 2026-11-23 (evening): slices 1 to 7 are written as a rough draft.** Alex asked for everything implemented with gaps filled by reasonable assumptions before he looks. What exists, how it was checked and what it assumes: [The rough draft as built](#the-rough-draft-of-slices-2-to-7-as-built-2026-11-23). What to do next, in order:
> 1. **Alex plays it** (nobody has, only scripts): `scripts/verify/rig/README.md` says how to run it locally; on a normal machine `npm run dev` + the sync-service is enough.
> 2. Run `npm run lint` and `npm run build` (they could not be run in the sandbox that wrote this) and fix what they say.
> 3. Go through [Assumptions to confirm with Alex](#assumptions-to-confirm-with-alex) and [Known gaps](#known-gaps-in-the-rough-draft).
> 4. **Do not push `main` until the lawyer pass** on Privacy, Terms and RESEARCH.md ([review note](../docs/legal/2026-11-game-layer-pages.md)): pushing is the deploy, and this branch starts recording matches. The pages are already rewritten on the branch so that code and pages ship together.
> 5. Load-test instances on a throwaway box (`scripts/loadtest/`), never prod.

**Slice 1 was: the game record and setup tools.** The scope below is kept as written for the record. Read, in this order: [The design in one page](#the-design-in-one-page-from-the-decisions-below-2026-11-23), the **v1 build order** section below it, the Decisions table, then [AGENTS.md](../AGENTS.md) (ship working things by pushing to `main`; portrait phone first; no O(n²) fan-out).

### What slice 1 delivers
A creator or co-creator can turn their world into a game *on paper*: pick a template and settings, mark the arena, its zones and the lobby, and see them in the world. No matches run yet (slice 2).

1. **`shared/game.ts` (new) + tests:** the game record as plain data, with a `parseGame` that validates, clamps and repairs, in the style of `parseDraft` in [`shared/blueprint.ts`](../shared/blueprint.ts). Suggested shape (a starting point, not decided):
   - `version` (a number that goes up with every change; matches will record it);
   - `template`: `race | collect | capture-the-flag | king-of-the-hill | survive | build-together` (only `race` has to be playable in slice 2);
   - `settings`: teams (count), players `min`/`max`, `rounds`, `roundSeconds` (default one round, 300 to 600 s), `scoreToWin`, player traits (`speedMul`, `gravityMul`, `fly`), `edge: soft | wall | instant` with `edgeSeconds` (default 10);
   - `arena`: a box (`at`, `size`) in world coordinates: the stage;
   - `zones`: `spawn` (one per team), `keep-out`, `goal`, each a box with an id and, where it applies, a team;
   - `lobby`: a box, a `ring` position inside it, and an arrival point;
   - `npcRoster`: empty for now (slice 6).
   - Limits come from [Phase 07](./07-genai-creation.md#rules-goals--constraints-design-2026-11-01) (≤ 64 rules, and so on); add zone and player caps to a `GAME_LIMITS` constant.
2. **Where it is stored:** decide and log it. Options: a `game` key in the World Y.Doc's `meta` (syncs to everyone for free; add it to the guarded keys in [`shared/world-policy.ts`](../shared/world-policy.ts) so only the creator and co-creators can write it), or a server table like `world_plans` in [`planner.ts`](../server/sync-service/src/planner.ts) with a server-written copy in the doc. The second fits Phase 09's direction (the server is the sole writer) and keeps a version history, which replays need forever.
3. **Authority:** only the world's creator and co-creators may write the game ([`world-authority.ts`](../server/sync-service/src/world-authority.ts) and its tests). Add the new actions to [`shared/actions.ts`](../shared/actions.ts) (for example `game.set`, tier `world_creator`); its drift test will tell you if you forget.
4. **The stage:** inside the arena box in the live world, only the creator and co-creators may place, edit or kick (Q5b). Enforce it in `world-policy.ts`.
5. **Client:** a *Game* tab for owners (bottom sheet on phones) to pick the template and settings and to place the arena, zones and lobby by standing where they should go; translucent outlines in the world for owners (arena, zones, lobby, ring). Arrival in the lobby when a world has a game (`InteriorController` reset / `computeArrivalPose`).
6. **Docs:** session log row here, the active-phase note in [README.md](./README.md), and [HANDOFF.md](../HANDOFF.md) if files or services change. Slice 1 collects no new data about players, so the public pages don't change yet.

### Slice 1 as built (2026-11-23)

| What | Where |
|------|-------|
| The game record: types, `GAME_LIMITS`, `parseGame` (validates, clamps, repairs), `gameMissing` (what a match still needs), `stageOf` | [`shared/game.ts`](../shared/game.ts), 14 tests in `shared/game.test.ts` |
| Storage: tables `world_games` (current) and `world_game_versions` (every version, never deleted), plus a server-written copy in the world doc's `meta.game` | [`server/sync-service/src/game.ts`](../server/sync-service/src/game.ts) (4 tests), `rooms.ts` (`setWorldGame`, `syncWorldGame`) |
| Saving: `POST /api/player/world/game { worldId, game \| null }`, creator and builders only; action `game.set` in the catalog | `index.ts`, [`shared/actions.ts`](../shared/actions.ts) |
| `meta.game` is server-only: not even the creator writes it through the world doc | `SERVER_ONLY_META_KEYS` in [`shared/world-policy.ts`](../shared/world-policy.ts) |
| The stage: inside the arena box only the creator and builders place, edit, kick or remove | `breaksStage` / `judgeObjectChange(…, stage)` in `world-policy.ts`, read by `world-authority.ts` (tests in both) |
| The 🎯 Game tab (owners): template, arena, zones, lobby, ring, arrival point, rules, a "before a match can start" checklist, Save, Remove | `src/components/GamePanel.tsx` + `.css`, `src/lib/game.ts`, `MakeTabs.tsx`, `sheetStore.ts` |
| Outlines in the world for owners (arena, zones by team color, lobby, ring, arrival) | `src/components/GameOutlines.tsx` in `WorldInterior.tsx` |
| Arrival in the lobby, facing the arena, for anyone entering fresh (not when returning to a saved spot) | `InteriorController.arriveAt` / `freshArrival`, `Scene.tsx` |

Choices made while building (change them freely):
- **A box is the middle of its floor (`at`) plus `size`** (width, height, depth), in world coordinates. "Stand where it should go" gives `at` directly. The arena's floor is marked 1 m below the creator's feet so things resting on the ground count as on the stage.
- **A game can be saved half-finished** (no arena or lobby yet). `gameMissing(game)` lists what a match still needs; slice 2 must refuse to start a match while it is not empty.
- **Zones live inside the arena:** `parseGame` moves and shrinks them to fit, and drops them if there is no arena. One spawn per team. Keep-outs carry their own return (`ret`: countdown or straight back).
- **A lobby that overlaps the arena is kept with a warning** and listed by `gameMissing` (a box above the arena's ceiling is fine: the theater box).
- **Defaults:** 2 teams (1 for survive and build together), 2 to 8 players, one 7-minute round, soft edge with a 10 s countdown, jetpack on. **Caps:** 32 players per match (to be raised or lowered after the instance load test), 8 teams, 32 zones, 9 rounds, rounds of 1 to 30 minutes.
- **A thing already in the air from a kick may land on the stage.** Refusing the landing would leave it hanging in flight for everyone. Owners can remove it, and matches copy the authored arena, not the live stage. Slice 2 decides what "the arena as the creators set it up" means for objects (suggested: everything on the stage when a version is saved, snapshotted into that version).
- **Each version stores which character saved it** (`saved_by`), for the credit chain games carry to the Library (Q13). It is the same kind of fact as `placedBy` on an object, about creators' own work, so the public pages did not change.

Not done in slice 1:
- The client does not yet stop a non-owner from *trying* to place or kick on the stage; the server puts it back (the thing snaps back). Grabbing is already filtered (`canEditHere`).
- Nobody but owners sees anything of the game in the world (no lobby look, no ring for players): that arrives with slices 3 and 4.
- Arrival in the lobby happens when you enter a world from space or by link. Stepping through a portal *inside* a world into a child world that has a game was not looked at (the interior isn't reset there today); check it with the screen pass.
- No keyboard shortcut for the Game tab on desktop (a 🎯 pill above ✧ Plan opens it).
- The planner cannot fill in a game from words yet (Q3 says it should be able to).

### The rough draft of slices 2 to 7, as built (2026-11-23)

Built in one session by parallel agents against a shared contract, then merged and run together. Each piece has a doc comment at the top of its file saying what it does and assumes.

**How a match works in this draft**
- **Movement stays on the player's device** (the interior sim, as everywhere in worlds today). The server reads each player's position from presence and runs the **referee** on those samples ten times a second. When Phase 09 puts interior movement under server authority, samples become inputs and nothing else changes.
- **The referee** ([`shared/match-referee.ts`](../shared/match-referee.ts)) is one deterministic step for all six templates, the edge, keep-out zones, rounds and the When ▸ If ▸ Do cards. No clock, no random source: time is ticks, randomness is seeded.
- **The record** is the setup (the whole game version, roster, how teams were formed) plus every tick's samples, control inputs, events and the result. Feeding it back through the referee reproduces every event and the result (`verifyRecord`); playing the samples back shows the match. That is the hard rule.
- **An instance is a partition, not a copy of geometry.** Players in a match stay at the arena's real coordinates in presence group `<worldId>#<matchId>`: the live world doesn't see them and they don't see it. The stage's objects are the scenery (owners-only since slice 1). Flags, pickups and pieces are match state drawn by the client, never world objects. Nothing is saved back.
- **Watching** is receiving that match's snapshots. The same drawing serves the view from the lobby, the hologram, the ghost camera, NPC bodies and replays.
- **The server decides everything** (pool, teams, ready check, start, score, end); the client asks and draws. One socket message type, `match` (0x13), JSON both ways ([`shared/match-protocol.ts`](../shared/match-protocol.ts)).

| Slice | What | Where |
|-------|------|-------|
| 2 | Referee, records, replay verification | `shared/match.ts` (contract), `shared/match-referee.ts` (63 tests) |
| 2 | Recording store: `matches`, `match_frames`, `match_players` (kept forever; erasure turns a player into a stand-in) | `server/sync-service/src/match-store.ts` |
| 2, 3 | The match host: lobby pool, ready check, instances, ticking, drops and rejoin, results, "play again together", links, awe | `server/sync-service/src/matches.ts`; presence groups in `rooms.ts`; wiring and routes in `index.ts` |
| 3 | The matchmaker (random with a logged seed, headcount balanced, stay-together units, play-against links) and NPC fill | `shared/matchmaker.ts` |
| 2, 3 | The player's side: ring and label for everyone, lobby chip and sheet, ready check, match HUD, edge warning, match traits and the wall, results, Play with / against | `src/lib/matchPlay.ts`, `src/components/match/{LobbyChip,MatchLayer,MatchWorld,MatchHud,PlayLinks}.tsx`; `mods` in `shared/sim/interior.ts` |
| 4 | Spectating: the 👁 chip (Live / Finished / Mine), bodies in the arena, the hologram, the watching strip, the ghost camera, replays with a scrub bar, a 2D mini-map when you're in another world | `src/lib/matchView.ts`, `src/components/match/{WatchChip,WatchLayer,WatchWorld,GhostCamera}.ts(x)` |
| 5 | The other five templates (collect, capture the flag, king of the hill, survive, build together) | in the referee; awe in `progress.ts` (`match`) |
| 6 | NPC players: auto / fetch / chase / guard / follow, levels 1 to 5; roster and policy in the game record; NPC fill, "play now with NPCs", group vote, holding a dropped slot; a host line in chat | `shared/npc.ts` (28 tests), `shared/game.ts`, the host |
| 7 | The game Library: save a world's game (with the stage's objects), bring it into another world, credits | `server/sync-service/src/game-library.ts` |
| 7 | When ▸ If ▸ Do cards: types and limits in the record, evaluated by the referee, edited in the Game tab | `shared/game.ts`, `src/components/game/GameCards.tsx` |
| 1+ | The Game tab in sections: Game · Places · Rules · NPCs · Cards · Library | `src/components/GamePanel.tsx`, `src/components/game/*` |
| – | **The 18+ door** (added 2026-11-23, after the rough draft): a saved player's *Show 18+* toggle (no birthdate; Alex, 2026-11-24); being behind it is the research filter (Q10b). Each match stamps who was behind it at the start; `researchCopy` is the only form a record leaves in for research | `server/sync-service/src/age-door.ts` (4 tests), `research_ok` and `researchCopy` in `match-store.ts`, `researchCandidate` in the match host, `src/components/AdultDoor.tsx`, `src/lib/door.ts`, `scripts/verify/rig/check-door.mjs` |
| – | Public pages rewritten for recording, replays, erasure, NPCs, the Library | `public/privacy.html`, `public/terms.html`, `RESEARCH.md`, [`docs/legal/2026-11-game-layer-pages.md`](../docs/legal/2026-11-game-layer-pages.md) |
| – | A rig that runs the real server and app where native packages can't be installed, with scripted walkthroughs | [`scripts/verify/rig/`](../scripts/verify/rig/README.md) |

New HTTP routes: `GET /api/match/world`, `GET /api/player/replays`, `GET /api/match/record`, `GET` and `POST /api/player/game-library`, `POST /api/player/game-library/bring`. New tables: `world_games`, `world_game_versions`, `matches`, `match_frames`, `match_players`, `game_library`, `game_library_versions`, plus a per-character daily count for awe from matches. Added with the 18+ door: `POST /api/player/door`, `door` in `GET /api/player/me`, the table `age_door`, and the column `match_players.research_ok`.

#### Assumptions to confirm with Alex

Made to fill gaps; each is a constant or a small function, easy to change.
- **Records hold positions, not inputs** (see above). A replay is exact about what the referee saw, at ten samples a second.
- **Positions are trusted from the client** during a match, as they are everywhere inside worlds today. A cheater could teleport to the goal. Server authority over interior movement (Phase 09) closes this.
- **The arena is not snapshotted per match.** Running matches see the live stage; if a creator edits it mid-match, players see the edit (Q1b says running instances keep their snapshot). The Library does snapshot the stage's objects when a game is saved there.
- **Numbers:** ready check 15 s; pool waits 3 s for more players once the minimum is met; an NPC takes a dropped slot after 8 s; a match with no human online ends after 15 s; results choice 20 s; finished matches stay in the lobby list 30 min; a match is capped at 2 h; 32 players per match.
- **Awe:** 30 per finished match, a quarter (8) when no other human played, at most 300 a day per character from matches, winners get nothing extra.
- **Links:** made from the chat name sheet (Play with / Play against), the other accepts in the lobby sheet; they last while both stay in the world.
- **An NPC's level** sets speed (60% to 100% of walking), reaction time (1.2 s to 0.2 s) and how often it picks a poor target (30% to never). An NPC holding a dropped slot plays "auto" at level 3.
- **NPC names and announcements come from fixed lists**, and rule cards have no free text, because there is no moderation path for text typed into a game.
- **Template details:** race needs a goal zone; collect spawns 6 to 24 pickups that reappear; capture the flag uses each team's goal zone as its base (else its spawn); king of the hill scores a point per second held alone; survive uses "score to win" as lives and scores survivors at the end; build together delivers pieces to the goal zone and nobody wins on time. With several teams a match ends early once the leader can't be caught.
- **Replays can be opened by anyone with a session who has the id**; the world's recent matches are listed in its lobby. The record holds character names and player ids (research ids are stored beside them for research copies).
- **The 18+ research filter is in the code (2026-11-23; made a plain toggle 2026-11-24), with these choices made to fill gaps:**
  - The switch lives in the saved player's panel (guests can't open it). **It is a toggle: no date of birth, no form** (Alex, 2026-11-24). Stored: on or off, and when it last changed.
  - **A real age check only where a state's or country's law requires one** ([Phase 07](./07-genai-creation.md#18-worlds-the-reddit-way-age-grill-alex-2026-11-07-no-code) decision 3). Not built: it needs a vendor and a way to know where the player is.
  - **A match counts for a player only if they were behind the door when it began.** Opening the door later doesn't reach back.
  - **Turning the switch off takes the player's earlier matches out of research too** (a research copy needs the stamp *and* the door still open). This is the cautious reading of the lawyer's question 5; it is one line in `researchCopy`'s caller to change.
  - The door belongs to the account, so all of a person's characters share it.
  - Nothing exports research copies yet: `researchCopy` is a function with tests, no route.
- **One ready check per world at a time.**

#### Known gaps in the rough draft

- **Nobody has played it.** Only scripts in headless, software-rendered Chrome.
- `npm run lint` and `npm run build` were never run.
- **No load test** of instances; the referee and snapshots are O(players in the match) per tick, lobby updates are coalesced to once a second per world.
- **Erasure is wired but unreachable:** `forgetPlayer` now rewrites match records to a stand-in, and that is tested, but no route deletes a player today. The same missing route should call `forgetDoor(accountId)` (age-door.ts) so the 18+ choice goes with the account.
- **No in-game notice** beyond one line on the ready-check card ("Matches are recorded and can be replayed"); Privacy promises players are told before new recording starts. The 18+ switch does carry its own notice (research is disclosed where the choice is made).
- NPCs walk on one flat height (no climbing to raised goals), and stand still when keep-out zones leave no route.
- A player can't be held at spawn by the server during the countdown; the client holds them.
- Reloading mid-match puts you back on your spawn.
- The planner cannot fill in a game from words yet (Q3); the host NPC only posts fixed lines; NPCs don't build (Q7's third role).
- "Mine" (a character's replays) is only reachable in worlds that have a game.
- No sounds for any of it.
- The ready-check card covers the dock in landscape while it shows; the hologram sits partly behind the watching strip there; the "Level 2" awe banner covers the chips row for a few seconds after sign-in.
- **The 3D canvas dies if drei's cloud texture can't load from its CDN** (found in the sandbox, which has no network). That is a risk in production too: bundle the asset.
- One-team games (survive, build together) with "players to start" at 1 begin a solo ready check at once, so "Play now with NPCs" is never offered; they need a minimum of 2 to get NPCs.
- With the same number of NPCs from each team on the hill, king of the hill stays a tie (the team with more players on it holds it); NPCs don't yet step off to contest.
- Build together's score strip shows a bare number, not progress against the target.
- Written but never exercised by any script: the notice when a non-builder places on the stage; ghost flight ignoring kick, grab and place; a player offline for longer than the grace period without reloading.

#### What the integration pass found (so the next person knows where it was fragile)

Running everything together with several real browsers turned up bugs no single piece had: the same-network mesh (Play nearby) leaked players across instances, so the lobby saw match players (presence now carries the instance and clients drop other instances); a lone lobby watcher kept ghosts of departed players; king of the hill never scored when both teams stood on the hill; entering a world from another world never reset the interior (no lobby arrival, and the "emerge in front of the portal" spot was never applied: that one predates Phase 10); a socket blip mid-match teleported the player back to spawn; an NPC proposal could not be answered inside the ready check (the first proposal now adds 8 s once); NPCs won a short race before a person had moved (they now wait 2 to 6 s by level, and the ready check is 15 s, not 10).

### Before slice 2 (matches + recording), not before slice 1
- **The public pages must be rewritten in the same push** as recording: Privacy, Terms and [RESEARCH.md](../RESEARCH.md) (every match recorded for everyone and kept forever; the 18+ opt-in makes a player a research candidate; erasure turns a player into an anonymous stand-in). **Lawyer pass first.** Draft them early so slice 2 isn't blocked.
- Decide how much of Phase 09's typed intents (9F) the rule step needs.
- Load-test instances with `scripts/loadtest/bots.mjs` on a throwaway box, never prod.

### Checks to run
`npx tsc -b`, `npm run lint`, the shared tests, `npm test` in `server/sync-service`, `npm run build`; UI at 390×844, 360×740, 844×390 and 1440×900. Say plainly which checks could not be run.

### Still to ask Alex (small, as they come up)
How a link between two characters is made; what an NPC's "level" means; the grace period before an NPC takes a dropped player's slot. Offline games and Social Publication are separate future grills.

## How to continue this phase (any agent or chat)

1. Read this file, then the [research](../docs/research/2026-11-custom-games/README.md), then [Phase 07 → Rules, goals & constraints](./07-genai-creation.md#rules-goals--constraints-design-2026-11-01).
2. **Grill Alex one question at a time** from the queue below. Lead with the recommended answer and the tradeoff, keep the question short, and let him answer in a few words (he's often on his phone).
3. Record each answer in **Decisions** (date, his words where useful), mark the question done, and add a session log row. If an answer changes a later question, rewrite that question.
4. Push doc updates to `main` (AGENTS.md: doc updates ship). Build nothing until Alex closes the grill and approves a v1 slice.
5. If a decision touches data collection, players' rights or money, the public pages (Terms, Privacy, giving) move in the same change as the code (Session Protocol in [README.md](./README.md)).

## Grill queue

Each question gives the options, the recommendation (`Rec`), and why. Questions marked ⏳ have been asked and are waiting for an answer; ⬜ are not asked yet.

### Q1 ✅ Where does a match run? (answered 2026-11-23, see Decisions)
**Answer:** in an **instance**: a boundaried part of the world, copied for each match. Many instances can run at once in one world. The original options are kept below for history.
- (a) In the **live world**: the world is the arena, and everything a match changes stays changed.
- (b) In a **fresh copy for each match** (a Roblox reserved server): clean resets, but it breaks "stateful like real life" and splits a small player count.
- (c) A **game layer over the live world**:
  - The world itself never resets.
  - The match has its own server-written state (teams, scores, timer, round, and things it spawns, tagged `game`), and only that resets between rounds.
  - While a match runs, edits inside the boundary are locked.
- **Rec: (c).** It keeps the stateful rule, keeps everyone in one place at low traffic, and gives research a clean record of each match.
- **Also asked:** does "one game per world" mean one ruleset per world *and* one match running at a time? **Rec: both, for now.**

### Q1b ✅ What is copied into an instance, and what survives when it ends? (answered 2026-11-23, see Decisions)
**Answer:** an instance copies what the play space was set up to hold. Nothing from the match is saved back into the world. Every match is fully traceable by replaying its telemetry (a **hard rule**). An instance is discarded when its last player leaves. Original options below for history.
- **What's copied:** the boundaried region's terrain and objects, taken as a snapshot when the match starts.
- **While the match runs, the original region:**
  - (a) stays part of the live world, open to everyone; or
  - (b) is closed while any instance runs.
- **When the match ends, changes made inside the instance:**
  - (a) are **thrown away**; the instance was a copy;
  - (b) **merge back** into the world (the winners' builds stay), which risks conflicts with edits in the live world;
  - (c) are thrown away, but the creator can choose to promote a match's final state into the world.
- **Rec:**
  - The original region stays live and open (a).
  - Instance changes are **thrown away** (a), so every match starts from the same arena. That's fair, and it's a clean trial for research.
  - "Stateful like real life" is kept through the **match record**: results, replay and chat stay with the world, shown on a results board in the lobby.
- **Sub-question:** when the creator edits the arena region, do running instances keep their snapshot? **Rec: yes.** The next match picks up the new version, and each match records which version it used.

### Q1c ✅ Is the arena an authored template or a snapshot of the live region? (answered 2026-11-23, see Decisions)
**Answer:** a fixed, authored arena. The world creator and all co-creators can set it up. Original options below for history.
*(New from Q1b: Alex said the play space copies "anything it was intended to have".)* In the live world, anyone may place things and kick them around (`world-policy.ts`), so the region can fill up with visitors' clutter.
- **(a) Snapshot of the live region** at match start, clutter included.
- **(b) Authored template:** only what the game creator(s) placed for the game (terrain plus objects tagged for the game), versioned like a blueprint. The live region can look like the arena, or be somewhere else entirely.
- **Rec: (b).** Every match starts from the same, intended arena; research gets a fixed condition (the arena version); and visitors can't break the game by dropping things into the region. Like Halo's map variant, the arena is its own record and can travel to other worlds.

### Q10a ✅ The hard rule (every match fully traceable) vs. research opt-in (answered 2026-11-23, see Decisions)
**Answer:** record and replay every match for everyone, linked to characters and research IDs, kept forever. Which records research may *use* is Q10b. Original options below for history.
*(Raised by Q1b. Two of Alex's rules pull against each other.)*
- **Every match must be fully traceable** by telemetry replay (2026-11-23).
- **People are researched only if they opt in,** and only players who have opted into 18+ may opt into research (2026-11-20, open item in [README.md](./README.md) → "Age restriction hardening").
- [RESEARCH.md](../RESEARCH.md) still says *"disclosed, no consent form"* and pseudonymous.

Options:
- **(a)** Only research-opted-in players may join games.
- **(b)** Record and replay **every** match for everyone, as part of the game (replays, the results board, settling disputes, anti-cheat, like flight telemetry today), disclosed in Privacy. A match counts as **research data only if every human in it opted in**. Matchmaking can prefer grouping opted-in players so research matches happen often.
- **(c)** Record everyone, and use opted-in players' traces for research while reducing everyone else to anonymous "other player" traces.
- **Rec: (b).** The replay is a game feature for everyone, and research stays clean and consented. Team research needs whole teams, so a mixed match is simply left out.
- **Sub-question:** how long are replays kept? Flight samples are kept 14 days today. **Rec:** game replays 90 days; research matches for as long as the study needs, under research IDs.

### Q10b ✅ Which recorded matches may research use? (answered 2026-11-23, see Decisions)
**Answer:** the 18+ opt-in is the filter. A player who has opted into 18+ is automatically a research candidate. Disclosed, no consent form. No separate research opt-in. Original options below for history.
*(From Q10a. Alex: "We need everything. In research, the first step is filtering out the data we cannot use.")* Everything is recorded and linked. This question is only about the **filter** applied before analysis, and whether the Nov 20 decision (studied only if opted in, and only behind the 18+ opt-in) still stands as that filter.
- **(a) The opt-in is the filter.** Every record carries each player's research ID. An analysis includes a player's trace only if that player has opted in. In a mixed match, players who haven't opted in appear as anonymous stand-ins ("other player"), so the match is still usable.
- **(b) No filter by consent:** all recorded play is research data, disclosed in Privacy (what RESEARCH.md rule 1 says today: "disclosed, no consent form"). This reverses the Nov 20 decision.
- **(c)** (a) now, with the consent record stored per player with dates, so the filter can be changed later without re-collecting anything.
- **Rec: (c).** Collect everything once; the consent flag and its dates decide use. A lawyer and the university partner's IRB confirm the filter before anything is published.

**Constraints that come with "forever" and "linked" (to design, not to ask):**
- **Erasure still works.** Today `forgetPlayer` deletes the `research_identity` row, so remaining records can't be tied to the player ([`research.ts`](../server/sync-service/src/research.ts)). Replays follow the same rule: the replay stays (it's also the other players' asset), and the erased player becomes an anonymous stand-in in it.
- **A replay holds several people.** One character publishing a replay shows the others. That goes to the Social Publication grill.
- **Replays must stay playable forever.** A replay is the seed, the arena version, the ruleset version and every player's inputs. So old `shared/sim` versions, arena versions and ruleset versions have to be kept and runnable (or each replay also stores periodic state snapshots). Inputs are small, so storage cost is low.
- **Privacy and Terms** are rewritten before any recording ships, with RESEARCH.md, in the same change.

### Q2 ✅ Who may author and start the world's game? (answered 2026-11-23, see Decisions)
**Answer:** the world creator and co-creators set it up (Q1c). Matches start automatically when enough players queue, and a creator or co-creator who is present can start early or hold the queue. **Still open (moved to Q13):** saving a ruleset and arena to the Library for reuse in other worlds.
*(Partly answered by Q1c: the **world creator and all co-creators** set up the game. Still open: who may **start** a match.)*
*(Partly answered by Q1: Alex named a **game creator** role, "which can be bound to the world creator and its co-creators". Still to settle: may anyone who isn't an owner author a world's game, or is the game creator always the world creator or a co-creator? And who starts a match?)*
- **Options:**
  - creator and builders only (like terrain);
  - anyone, with the creator approving;
  - anyone may *propose* a game, and the creator sets which one is live.
- **Rec:** the creator and builders author it, and **anyone in the world can start a match** from the lobby once the minimum player count is met. Authoring stays with the owners, the way `world-policy.ts` already treats terrain and meta.
- **Sub-question:** can a game's ruleset be saved to the Library and reused in other worlds (the portable-creations rule)? **Rec: yes.** It's a versioned, credited record, like minds.

### Q3 ✅ How are rules written in v1? (answered 2026-11-23, see Decisions)
**Answer:** templates and settings first (v1), then When ▸ If ▸ Do cards over the same data. No user code. **Confirmed 2026-11-23:** the six starter templates.
- **Options:**
  - **Halo 3 style:** parameters and templates (mode, teams, score to win, time limit, player traits like speed, fly/no-fly, gravity);
  - **event wiring:** the When ▸ If ▸ Do triggers already designed in Phase 07;
  - **code.**
- **Rec:**
  - **v1:** templates plus parameters, written by the planner from words. A data block lives next to the blueprint.
  - **v2:** the When ▸ If ▸ Do cards over the same JSON.
  - **Never** user code in v1. Data rules are safe and deterministic, and research can analyze them. Halo 3 shows how far parameters go.
- **Sub-question:** which 5–6 starter templates? Phase 07 lists collect-N, race-to-zone, survive-T, find-the-NPC, build-contest and explore-all-zones. Add team modes like capture-the-flag, king of the hill, and a cooperative build-against-the-clock (good for team research)?

### Q4 ✅ Boundaries, and people who aren't playing (answered 2026-11-23, see Decisions)
**Answer:** a soft edge by default (a countdown, then a return to the team spawn), with a solid wall or an instant return as per-game choices; spawn, keep-out and goal zones inside the arena.
*(Changed by Q1: people who aren't playing never enter an instance. They roam the live world or watch from the lobby, so the "passersby inside the boundary" problem goes away. Still open: how the boundary's edge behaves for players **inside** an instance, plus keep-out, spawn and base zones.)*
- **Boundary kinds** (Halo Reach model):
  - a **play area** with a soft edge: a countdown, then a return to spawn rather than "death";
  - **keep-out zones**, soft and hard;
  - spawn and team-base zones.
- **Not playing:** what happens to someone flying through or standing inside the boundary during a match?
  - **Option 1:** they become a spectator. They're ghosted, can't touch game objects, and can watch.
  - **Option 2:** they're gently moved out.
  - **Option 3:** the boundary is closed to non-players.
- **Rec:** spectators are ghosted and can watch from anywhere. They can't touch game objects or players. No "death" in Aweborn: going out of bounds means a soft return to the team spawn (fits the gentle tone).

### Q5 ✅ The physical lobby (answered 2026-11-23, see Decisions)
**Answer:** the pool + matchmaker proposal below is accepted as the starting design, with two kinds of links between characters: *stay together* and *play against each other*.
**Decided:** players arrive in the lobby when they enter a world that has a game; the creators set the minimum and maximum players per match.
**Open (Alex, 2026-11-23):** a single ring that people walk in and out of doesn't by itself make determinate groups, and doesn't obviously allow intelligent matchmaking. Keep it physical-first.

**Proposal put to Alex: the ring is a pool, and the server is the matchmaker.**
1. **The ring means "I'm available".** Standing in it puts you in the **pool**. It does not put you in a particular match.
2. **The matchmaker picks.** The server looks at the pool and chooses who plays together and on which team. This is one replaceable function (a *matching policy*): v1 is random with a logged seed; MatchRank (match → observe → re-match, using who has played with whom and how it went) replaces it later without changing the lobby.
3. **Match found, shown physically.** Each chosen player gets their team's color (a glow or beam on their character, visible to the whole lobby) and a short ready countdown (about 10 s).
4. **Lock.** Stepping out of the ring during the countdown declines; the matchmaker fills the slot from the pool. At zero the roster locks: this is the determinate set, recorded with the seed and the policy version. Those players teleport to their spawns.
5. **Everyone else stays in the pool** for the next match. With 11 people waiting and a 4-player game, two matches form and 3 keep waiting.
- **Tradeoff:** the longer the matchmaker waits, the more people it can choose from and the better the match, but the longer the wait. The creators' minimum and a maximum wait time bound it.
- **Alternative:** one pad per match (Roblox elevators): players choose their own group. Determinate, but no intelligent matching and no random assignment for research.
- **Open sub-question:** playing with a friend. Rec: later, a "stay together" link between two characters that the matchmaker respects (and logs, since it's not a random assignment).
*(Partly answered by Q1: the lobby is a **special zone the game creator draws**, and it may hold everyone. Matched players **teleport** from the lobby to their spawns in a new instance. Still open: do players arrive in the world inside the lobby (is it the world's spawn when a game exists?), how queueing and team forming work in the zone, and minimum and maximum players.)*

### Q5b ✅ Spectating from the lobby (answered 2026-11-23, see Decisions)
**Answers to the two follow-ups:** the lobby **always** has a hologram of the tuned match, and is also placed to overlook the arena; the arena's footprint is a **stage** (option a). The follow-ups are kept below for history.
**Waiting on Alex:**
1. **Reading of the hologram:** it plays inside the lobby when the lobby does *not* overlook the arena (the creators put it somewhere else, or the view is blocked). Confirm.
2. **The arena's footprint in the live world.** Q1b said the original region stays open while matches run. But from the box, each viewer now sees their tuned match there. Options: (a) the footprint is a **stage**: nobody plays or builds in it in the live world except the creators editing the arena; viewers see their tuned match in it, or the empty arena when none is running; walking into it makes you a ghost spectator. (b) It stays an ordinary open part of the world, and the tuned match is drawn over it only for people in the lobby. **Rec: (a).** One place, one meaning; no visitors' clutter mixed into the view. This would amend Q1b.
*(New from Q1: anyone in the lobby can pick an in-progress instance and watch it, and switch between instances.)* Questions:
- **How it's shown:**
  - (a) a window or hologram in the lobby showing the instance;
  - (b) the spectator's camera moves into the instance as a ghost, while their body stays in the lobby;
  - (c) both.
- Can spectators chat with players?
- Do players see who's watching?
- **Rec:**
  - (b) first: a ghost camera, free-fly inside the boundary or following a player. It works in portrait and costs one presence feed.
  - Spectator chat stays in the lobby, so players aren't distracted. Players see a "👁 N watching" count.
  - **Server cost:** a spectator subscribes to **one instance at a time** and gets its batched presence (the same nearest-30 batching as `rooms.ts`).
- **Where:**
  - a lobby area inside the world near spawn (Roblox-style pads, or a gate);
  - a lobby object the creator places;
  - the story stone area.
- **Mechanics:** step onto a team pad, or onto one "queue" pad with automatic team assignment. There's a ready check, a countdown, a minimum and maximum number of players, and a timer that starts the match with whoever is there.
- **Rec:** the creator places a **lobby object**. A default one is placed beside the story stone. People step into a ring to queue, the server forms teams, and a short countdown places them at their team spawns. One lobby per world, matching one game per world.

### Q6 ✅ What does matchmaking optimize for? (answered 2026-11-23, see Decisions)
**Answer:** reshuffle by default with a "play again together" choice; v1 balances headcount only; skill data much later.
*(Mostly settled by Q5: a replaceable matching policy, random with a logged seed in v1, MatchRank later, links respected and logged. Left: whether teams reshuffle or persist between matches.)*
- **Options:**
  - fun and fairness: balanced skill, parties kept together;
  - **random assignment** (clean research);
  - **MatchRank**: match → observe → re-match.
- **Rec:**
  - **By default:** keep parties together and balance team sizes, with random assignment otherwise.
  - **Logged:** the seed and assignment for every match.
  - **Research:** teams only become research data for players who have opted into research (and therefore 18+).
  - **Later:** MatchRank re-matching as an opt-in "teams that grow" mode.
- **Sub-question:** do teams persist across rounds and matches (re-match), or reshuffle every match?

### Q7 ✅ NPCs in the game (answered 2026-11-23, see Decisions)
**Follow-up answered:** all three together (creators set the roster; "play now with NPCs"; a group must all agree).
**Waiting on Alex: who picks the NPCs when a match has several human strangers?** In Smash Bros the people choosing are on one couch. Here the matchmaker groups strangers.
- **(a)** The creators define the **NPC roster** for the game (which NPCs may play, which levels). Players choose from it per match.
- **(b) Play now with NPCs:** a player waiting in the pool can choose to start right away with NPCs filling the other slots, instead of waiting for people. A lone player can always play. Good at low traffic.
- **(c) In a group:** during the ready countdown any matched player can propose NPCs for the empty slots (which NPC, which level); it goes ahead only if everyone in the match agrees. Default: no NPCs.
- **Rec: all three together.** Creators bound the choices, a lone player is never stuck, and nobody in a group gets NPCs they didn't agree to.
- **Roles:**
  - a **referee or host** that announces the game and explains the rules;
  - an **opponent or teammate** that plays;
  - a **builder** that helps author the game through the planner.
- **Body:** players fly and walk on voxels, and there's no aerial nav mesh problem to copy from Halo.
- **Mind:** the mind is an LLM. It stays cosmetic (it can talk, but can't decide outcomes).
- **Rec:**
  - **v1:** NPCs as hosts plus simple deterministic players (`shared/sim`, behavior-tree states like chase, guard, fetch, follow) on walk-only paths.
  - **Bot backfill:** off by default. NPCs that play are **always tagged** in the match record and labeled in-world as AI.
  - **Outcomes:** a rule, never the LLM, decides scores and wins (the Where Winds Meet lesson).
  - **Later:** LLM-steered teammates, useful for human-AI teaming research.

### Q8 ✅ Joining mid-match, rounds, and the end of a match (answered 2026-11-23, see Decisions)
**End-of-match flow, confirmed by Alex:** results screen (winner, each team's score) → each team gets "play again together" → players teleport back to the lobby, and the match shows in the spectator panel as "finished x ago", opening its replay. A player can leave for the lobby at any time.
*(Settled already: latecomers wait in the pool, since a roster locks at the ready check; an instance is discarded when its last player leaves. Asked: rounds and length, a player dropping out mid-match, and the end-of-match flow.)*
- **Options** (Fortnite): late joiners spawn now, spectate, or wait for the next round. Then: how many rounds there are, team rotation, and what happens at the end (results board, rematch vote, back to the lobby).
- **Rec:**
  - Late joiners queue in the lobby for the next round.
  - A results board shows at the end, followed by a 20 s rematch vote, then everyone returns to the lobby.
  - Matches are short (5–10 min) by default, so the wait stays short.

### Q9 ✅ Rewards (answered 2026-11-23, see Decisions)
**Answer:** awe, no mana prizes.
- **Options:** none (play for its own sake); awe/XP for playing; mana prizes.
- **Rec:**
  - A little **awe** for taking part.
  - No mana prizes in v1: mana is real money in the pool, and prizes invite farming.
  - Winners get a moment, not a payout.

### Q10 ✅ Research record and consent (settled by Q1b, Q10a and Q10b; see Decisions)
*(The list below is the proposed content of the match record, for the build. Consent is settled: record everyone, the 18+ opt-in is the research filter.)*
- **The match record:**
  - world, game version and seed;
  - who played, as research IDs only for players who opted in, and as anonymous counts for everyone else;
  - teams and how they were formed;
  - the event log (zone enters, goal progress) and the outcome;
  - chat, which is already archived;
  - **whether each participant was human or NPC.**
- **Rec:**
  - Every match is replayable.
  - Only opted-in players' records are research data.
  - Privacy is updated before any of it ships.

### Q11 ✅ Offline and mesh play (answered 2026-11-23, see Decisions)
**Answer:** v1 matches need the server. Alex wants offline games; they get their own grill.
- **Rec:** v1 matches need the server, because the referee is server-authoritative. Mesh play can come later by running the same deterministic rule step on a host phone (as flight already does).

### Q12 ✅ Budgets and limits (answered 2026-11-23, see Decisions)
**Answer:** agreed with every bullet.
- **Rec:**
  - Complexity caps from Phase 07 (rules, zones, spawned objects, players per match), not a Forge-style money budget.
  - Building a game is free.
  - Only generated assets cost mana, as today.
  - Max players per match is sized to the 100-bots-under-50%-of-a-core bar (AGENTS.md).

### Q13 ✅ Ownership and credit (answered 2026-11-23, see Decisions)
**Answer:** creators keep the credit; games are saveable to the Library and come back to life in other worlds, versioned and credited like minds.
*(Also carries the open sub-question from Q2: can a ruleset and its arena be saved to the Library and reused in other worlds, credited to their makers like minds? **Rec: yes.**)*
- **Rec:** the creator keeps credit, and the ruleset is open like the code (no Blizzard-style claim). Forks keep the credit chain, as minds do.

## Decisions

| Date | Decision |
|------|----------|
| 2026-11-23 | **Rough-draft decisions for slices 2 to 7 (made by the builder; Alex: *"filled all gaps with reasonable assumptions"*).** Listed under [Assumptions to confirm with Alex](#assumptions-to-confirm-with-alex): records hold sampled positions and the referee re-runs over them; an instance is a presence partition at the arena's real coordinates; the arena is not snapshotted per match; awe 30 / 8 / 300 a day; fixed lists instead of free text; the numbers for the ready check, drops and results. None of these is Alex's decision yet. |
| 2026-11-23 | **Where the game is stored (decided while building slice 1; Alex left it to the builder).** A server table with every version kept forever (`world_games`, `world_game_versions`), and a server-written copy in the world doc (`meta.game`) so every client gets it through the world sync. Clients never write it. Chosen over a client-written doc key because replays need every old version forever, and because it follows Phase 09 (the server is the only writer). |
| 2026-11-23 | Scope set by Alex (Goal above). **One game per world** for now. Research on custom games done first. Feature docs live in the repo, so any chat or agent can continue without Claude Code. |
| 2026-11-23 | **Q11: offline games are wanted, in their own grill.** v1 matches need the server (referee, matchmaker, recorder). Alex: *"I really want those offline games! Maybe it's a separate grill altogether."* Logged as a future grill tied to [Phase 06](./06-offline-mesh.md): one phone acts as referee with the same deterministic rule code, and the record syncs to the server afterwards. |
| 2026-11-23 | **Q12: limits.** Building a game is free; only AI-generated assets cost mana, as today. Complexity caps (rules, zones, spawned objects) use the Phase 07 limits, not a Forge-style object budget. Players per match are capped to what the server handles comfortably (AGENTS.md bar: 100 bots under ~50% of one core). |
| 2026-11-23 | **Q13: ownership and travel.** The creators keep the credit; Aweborn makes no ownership claim. A game (rules, arena, NPC roster) can be **saved to the Library and brought to life in other worlds**, **versioned and credited the same way as minds**. |
| 2026-11-23 | **Starter templates confirmed** (*"good for now"*): race, collect, capture the flag, king of the hill, survive, build together against the clock. |
| 2026-11-23 | **Q9: rewards are awe, not mana.** Alex chose (b). <br>• Everyone who finishes a match earns some **awe**; winners get little or no extra, so nobody is pushed away from games they might lose. <br>• **No mana prizes in v1:** mana is real money from the shared pool, and prizes invite farming. <br>• Limits against farming awe: none or much less for matches played only against NPCs, and a daily cap per character on awe from matches. <br>• Winners get a moment: names on the results board in the lobby, and the replay to keep. |
| 2026-11-23 | **Q8 (part 3): the end of a match.** Confirmed by Alex: a results screen (winner, each team's score) → each team gets "play again together" → players teleport back to the lobby, and the match shows in the spectator panel as "finished x ago", opening its replay. A player can leave for the lobby at any time. |
| 2026-11-23 | **Q8 (parts 1 and 2): match length and drop-outs.** <br>• **Length:** the creators set the number of rounds and the time limit; the default is one round of 5 to 10 minutes. <br>• **A player who drops out can come back for as long as the match runs.** Alex: *"whenever the drop-out returns, it can replace the NPC again if it's the same match… the window would be the rest of the match."* No fixed 60-second window. <br>• While they're away, **an NPC from the creators' roster holds their slot** if the creators allowed that for the game; otherwise the team plays short-handed. When the character returns to Aweborn and the match is still running, they may re-enter and take the slot back. <br>• The match record notes every moment a human was replaced by an NPC and every return, so research can cut the match at those points. <br>• To design: a short grace period before the NPC steps in (signal blips), and the "your match is still running, rejoin?" prompt on return. |
| 2026-11-23 | **Q7 follow-up: who picks the NPCs.** Alex agreed with all three: <br>• **The creators set the NPC roster** for their game: which NPCs may play and at which levels. Players choose from it. <br>• **"Play now with NPCs":** a player waiting in the pool can start right away with NPCs in the other slots, so a lone player is never stuck. <br>• **A group has to agree:** during the ready countdown any matched player can propose NPCs for the empty slots; they join only if everyone in the match agrees. Default: none. |
| 2026-11-23 | **Q7: NPCs host, play and build; players can fill empty slots with NPCs.** <br>• Alex: all three roles are important: **host** (explains rules, announces, calls results), **player** (joins a team and plays) and **builder** (helps set up the game through the planner). <br>• **Filling empty slots with NPCs is an option, per match** (replaces the "no automatic filling" recommendation). Alex: *"that's how super smash bros does it. The players themselves choose what NPCs will or will not play, their level, and their NPC model/behavior."* <br>• So an NPC player has three things players choose: **which NPC** (its model and character), **its level** (how well it plays) and **its behavior**. <br>• Accepted from the recommendation: NPC players start with fixed, deterministic behaviors (chase, guard, fetch, follow), walking only at first; **a rule, never the language model, decides scores and wins**; every NPC is **labeled as AI** in the world and **tagged in the match record** with its identity, level and behavior version, so research can separate human play from NPC play. <br>• To design: what "level" means for a behavior (reaction time, accuracy, speed, how often it makes mistakes). |
| 2026-11-23 | **Q6: between matches, reshuffle by default, with "play again together".** <br>• After a match everyone returns to the pool and the server forms new teams (rotation finds better combinations: Salehi & Bernstein, *Hive*, 2018, cited in [RESEARCH.md](../RESEARCH.md)). <br>• Each team is offered **"play again together"**. If every member picks it, the team re-enters the pool as a unit; it works like a stay-together link and is **logged** (a team choosing to stay together is itself data). <br>• **v1 balances headcount only** (7 players → 4 against 3). Alex: *"player skill data can come way later."* |
| 2026-11-23 | **Q5b follow-ups: always a hologram; the arena's footprint is a stage.** <br>• Alex: *"It would be cool if the lobby always had a hologram of the match they were tuned into. As well as the lobby being strategically placed to view the match."* So the lobby has **both**: the overlook and a hologram, always. <br>• **The arena's spot in the live world is a stage (amends Q1b's "the original region stays open").** Nobody plays or builds there in the live world except the creators editing the arena. Viewers see their tuned match in it, or the empty arena when no match is running. Walking into it makes you a ghost spectator. |
| 2026-11-23 | **Q5b: spectating. The lobby is a theater box over the arena.** Alex: *"The lobby should almost be a box in a theater or arena where players who aren't playing or waiting to play, or just hanging out in the lobby could almost oversee the arena where the match they're tuned into plays below."* <br>• The lobby sits **near the arena**, overlooking it. Each person in the lobby is **tuned into one match**, and that match plays in the arena below for them. Two people in the same lobby can watch different matches. <br>• **Ghost camera too:** a spectator can fly freely inside the match or follow a player; players can't see or touch them. <br>• **A hologram** of the tuned match also plays in the lobby, in place of the overlook (reading to confirm: for lobbies that don't overlook the arena). <br>• Accepted from the recommendation: spectator chat stays in the lobby; players see a "👁 N watching" count without names. <br>• **Technical note:** the server sends a spectator one match at a time; the client draws that match's state in the arena's place. The same view serves replays. |
| 2026-11-23 | **Q5: the lobby queue is a pool, and the server is the matchmaker.** Alex: *"this should be a good start."* <br>• The ring means "I'm available"; the server picks who plays together and on which team (a replaceable matching policy: random with a logged seed in v1, MatchRank later). <br>• "Match found" is shown physically (team color on the character, a ~10 s ready countdown); stepping out declines and the slot is refilled; at zero the roster locks, is recorded, and the players teleport. Everyone else stays in the pool. <br>• **Links between two characters (Alex):** **stay together** (same match, same team) and **play against each other** (same match, different teams). The matchmaker respects links and **logs them**, since a linked pairing is not the matchmaker's own assignment. <br>• To design: how a link is made (suggested: tap a character in the lobby → *Play with* / *Play against*, and the other accepts), links among more than two characters, and games without teams (both links then just mean "same match"). |
| 2026-11-23 | **Q5 (part): arriving and match size.** Players **arrive in the lobby** when they enter a world that has a game; the rest of the world is open from there. **The creators set the minimum and maximum players** per match. The lobby stays **physical-first**. How queueing forms determinate groups and allows intelligent matchmaking is still open (proposal under Q5). |
| 2026-11-23 | **Q4: the arena's edge and zones.** Alex: *"that's spot on."* <br>• **Default: a soft edge.** Crossing the boundary starts a short countdown (Halo used 10 s); a player who doesn't come back returns to their team's spawn. The creator can instead pick a **solid wall** or an **instant return** per game. <br>• **Nobody "dies"** in Aweborn: out of bounds means a return to spawn. <br>• **Zones the creators place inside the arena:** spawn zones (one per team), keep-out zones (the same soft or instant return), and goal zones used by the templates (finish line, flag base, hill). |
| 2026-11-23 | **Q3: how rules are written.** Alex agreed with the recommendation: **v1 is templates plus settings** (Halo 3 style: team count, score to win, time limit, player traits such as speed, gravity and whether flying is allowed), which the planner can fill in from plain words. **Then When ▸ If ▸ Do cards** (the Phase 07 trigger design) over the same data. **No user code.** <br>• Starter templates (**confirmed by Alex 2026-11-23**, *"good for now"*): race, collect, capture the flag, king of the hill, survive, build together against the clock (cooperative; the most useful for team research). |
| 2026-11-23 | **Q2: who starts a match.** Automatic by default: players queue in the lobby, and when the minimum set by the creators is met a short countdown starts the match (so a game works while its creators are offline). A creator or co-creator who is present can **start early or hold the queue** (organized sessions, card events, studies). |
| 2026-11-23 | **Q10b: the 18+ opt-in is the research filter.** Alex: *"Nvm on Nov 20. Let's make it as simple as possible. If they 18+ opt-in, they are automatically research candidates. Disclosed, no consent form."* <br>• **Supersedes** the Nov 20 idea of a separate, revocable research opt-in. <br>• Matches [RESEARCH.md](../RESEARCH.md) rule 1 as written (*disclosed, no consent form*). <br>• Everything is still recorded for everyone (Q10a). Research analyses use the traces of players who have opted into 18+. **Confirmed by Alex (2026-11-23):** players who haven't opted into 18+ are still recorded for replays, but appear in research as anonymous stand-ins. <br>• Before it ships: Privacy and Terms say this plainly at the 18+ door (opting in also makes your play research data), and a lawyer pass plus the university partner's IRB confirm it before anything is published. |
| 2026-11-23 | **Q10a: record and replay every match, for everyone, forever.** Alex: *"I want to record and replay every match for everyone."* *"We need everything. In research, the first step is filtering out the data we cannot use."* <br>• Replays are **linked to the character**: a character can look at all of its replays. <br>• Every record is linked **character → research ID** (the existing `research_identity` mapping). <br>• **Replays stay forever.** Alex: *"They are essentially a character's assets in my eyes."* This replaces the 90-day suggestion. <br>• Publishing replays to social media is a **separate future phase and grill** ("Social Publication"). <br>• Which records research may *use* is the filter question, Q10b. |
| 2026-11-23 | **Q1c: a fixed, authored arena.** Each match copies the arena as the creators set it up, not the live region with visitors' clutter. **The world creator and all co-creators can set up the game** (arena, boundary, lobby, rules). |
| 2026-11-23 | **Q1b: the instance lifecycle (accepted the recommendations).**<br>• The creators set up a **play space**, and each new instance copies what that play space was set up to hold. <br>• **Nothing is saved back** into the world after a match: the instance was only a copy for the match. <br>• **Hard rule:** researchers can trace every player's interactions and the world's by **replaying the telemetry** of any match. Alex: *"the entire point of Aweborn is to have players discover their awe in a shared world. We need games and ways to force interesting behavior to observe, measure, and study success versus loss."* <br>• An instance is **discarded when all its players have left**. That's how others do it too: Roblox reserved servers only run while someone is in them, and Popup room instances persist as long as one attendee is present. Add a maximum match length and an idle timeout so an instance can't live forever. <br>• When its last player leaves, an instance leaves the spectator panel, or stays a while as a "finished x ago" row (suggested: that row opens the replay). <br>• ~~The original region of the live world stays open while matches run.~~ *(Amended the same day by Q5b: the arena's footprint is a stage.)* Running instances keep their snapshot when the creator edits the arena; the next match uses the new version and records which one. Follow-ups: Q1c, Q10a. |
| 2026-11-23 | **Q1: matches run in instances.** Alex: *"the match runs in a boundaried instance of a part of the world which the boundary is laid by the game creator."* <br>• Players entering the world start in the **game lobby**, a special zone the game creator makes (the game creator *"can be bound to the world creator and its co-creators"*). <br>• The lobby may hold everyone. Matched players **teleport** from the lobby to their starting spots in a new **boundaried instance** of the game. <br>• Players in the lobby can **spectate any in-progress instance** and switch between them. <br>• So one world hosts **multiple instances of its one game at once**: "one game per world" means one ruleset, not one match. <br>• This is the Roblox reserved-server pattern (lobby → private copy), scoped to a region of the world rather than a whole place. Follow-ups: Q1b, Q5b; Q2, Q4 and Q5 updated. |

## The design in one page (from the decisions below, 2026-11-23)

- **One game per world,** set up by the world's creator and co-creators: a fixed **arena**, its **boundary and zones** (spawn, keep-out, goal), a **lobby**, the **rules** and an **NPC roster**.
- **Rules** are a template plus settings in v1 (six templates), then When ▸ If ▸ Do cards over the same data. No user code.
- **The lobby** is a theater box overlooking the arena. Players arrive there. It always shows a hologram of the match each person is tuned into.
- **Queueing:** standing in the ring puts you in a pool. The server's matchmaker picks groups and teams (random with a logged seed, headcount balanced), respecting *stay together* and *play against* links. A physical ready check locks the roster, and the players teleport in.
- **A match runs in an instance:** a copy of the arena. Many can run at once. Nothing is saved back to the world. The arena's spot in the live world is a stage.
- **The edge** is soft by default: a countdown, then a return to the team spawn. Nobody dies.
- **Matches start automatically;** a creator who is present can start early or hold the queue. Default length: one round of 5 to 10 minutes.
- **NPCs** host, play and build. Players may fill empty slots with NPCs from the creators' roster (a lone player can always play; a group must all agree). An NPC holds a dropped player's slot until they return. Rules, never a language model, decide outcomes. NPCs are always labeled and tagged.
- **Spectating:** from the box, by hologram, or with a ghost camera. Chat stays in the lobby.
- **The end:** results → "play again together" → back to the lobby; teams reshuffle by default.
- **Hard rule: every match is recorded and fully replayable,** for everyone, forever, linked to each character and research ID. Replays are a character's assets.
- **Research** uses the traces of players who opted into 18+ (disclosed, no consent form); others appear as anonymous stand-ins.
- **Rewards:** awe for finishing. No mana prizes.
- **Games travel:** saved to the Library, versioned and credited like minds.

## v1 build order (approved by Alex 2026-11-23: *"let's create the handoff for the next chat to start implementing"*; nothing is built yet)

Each slice ends in something Alex can try on prod. Public pages move with slice 2.

1. **The game record and setup tools.** The data for a game (template + settings, arena, boundary, zones, lobby zone), kept beside the blueprint and validated like it. Creators and co-creators draw the arena, zones and lobby. The arena's spot becomes a stage.
2. **Instances, one template, and recording.** The server runs a match in an instance with a deterministic rule step (`shared/`), starting with **race**: teleport in, soft edge, goal zone, results, back to the lobby. **No match runs unrecorded:** the record and its replay ship in this slice, with Privacy, Terms and RESEARCH.md rewritten in the same push (lawyer pass first).
3. **The lobby pool and matchmaker.** The ring, the random headcount-balanced matchmaker with a logged seed, the ready check, several instances at once, "play again together", and the two links.
4. **Spectating.** The spectator panel ("finished x ago" rows opening replays), the ghost camera, the view from the box, the hologram.
5. **The other five templates, and awe** for finishing (with the farming limits).
6. **NPCs:** hosts first, then roster players with levels, "play now with NPCs", group agreement, and holding a dropped player's slot.
7. **Travel and cards:** save a game to the Library (versioned, credited), then the When ▸ If ▸ Do editor.

**Checks before building:** how much of Phase 09's typed intents (9F) the rule step needs first; load-test instances with `scripts/loadtest/bots.mjs`; portrait-phone design for the lobby, ready check and spectator camera (AGENTS.md).

## Open questions not yet in the queue

- **Offline games (its own grill, with [Phase 06](./06-offline-mesh.md)):** Alex wants matches to work without a network.
- **Details left to design:** how a link is made and links among more than two characters; what an NPC's "level" means; the grace period before an NPC takes a dropped slot and the rejoin prompt; keeping old sim, arena and ruleset versions runnable so replays play forever; erasure (a deleted player becomes an anonymous stand-in in replays).

- **2D arenas, saved instanced runs (dungeons with character progress), and why keep games open** (asked by Alex 2026-11-23 while the rough draft was being built): design notes, nothing decided, in [docs/research/2026-11-game-layer-next](../docs/research/2026-11-game-layer-next/README.md). Each is a future grill. The notes list where they collide with decisions above ("nothing is saved back", "nobody dies", awe, one game per world).
- **Social Publication (a future phase, its own grill):** characters browsing their replays and publishing them to social platforms; consent of the other players shown in a replay.
- How the game layer meets 18+ containment: a game in an 18+ world is 18+, and NPC players follow their mind's tier. *(2026-11-24: an 18+ world's lobby, matches, replays and match lists are shut outside the 18+ door, and its game can't be saved to the shared Library until the Library has tiers. See [Phase 07 → Built 2026-11-24](./07-genai-creation.md#built-2026-11-24-the-tier-the-veil-and-the-door-branch-age-18plus-opt-in-not-deployed).)*
- A spectator camera on phones (portrait first).
- Interaction with kick, grab and the current `world-policy.ts` rights during a match.

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| 2026-11-23 | **Opened.** Alex asked to grill him on the game layer after deep research. Wrote [the research](../docs/research/2026-11-custom-games/README.md) (Halo 3 → Infinite, Roblox, Fortnite, WC3, Rec Room, VRChat, Empirica, Overcooked-AI, a tradeoff table) and this phase with the 13-question grill queue and recommended answers. Asked Q1. Alex: put these feature docs in the repo so another chat can carry on. | Alex answers Q1, then continue down the queue |
| 2026-11-23 | **Q1 answered:** instances of a boundaried region drawn by the game creator; a lobby zone; matched players teleport in; lobby spectators pick any running instance. Logged in Decisions; added Q1b (what an instance copies and what survives) and Q5b (spectating); updated Q2, Q4, Q5. Asked Q1b. | Alex answers Q1b |
| 2026-11-23 | **Q1b answered** (lifecycle, the hard rule of full telemetry replay, discard when empty, a "finished x ago" row). Added Q1c (authored template vs. live snapshot) and Q10a (the hard rule vs. research opt-in). Asked Q10a. | Alex answers Q10a, then Q1c |
| 2026-11-23 | **Q1c and Q10a answered** (fixed arena set up by creator + co-creators; every match recorded and replayable for everyone, linked to characters and research IDs, kept forever; Social Publication is a future phase). Added Q10b (which records research may use) with the constraints that "forever" brings (erasure, versioned sim, public pages). Asked Q10b. | Alex answers Q10b, then Q2 (who starts a match) |
| 2026-11-23 | **Q10b answered:** the 18+ opt-in makes a player a research candidate; disclosed, no consent form; the Nov 20 separate research opt-in is dropped. Updated the open item in README.md. Asked Q2 (who starts a match). | Alex answers Q2 |
| 2026-11-23 | **Q2 answered** (automatic start with a creator override); the mixed-match assumption under Q10b confirmed. The Library sub-question moved to Q13. Asked Q3 (how rules are written). | Alex answers Q3 |
| 2026-11-23 | **Q3 answered** (templates + settings, then When ▸ If ▸ Do cards, no code). The six starter templates are proposed but not confirmed. Asked Q4 (the boundary edge inside an instance). | Alex answers Q4; confirm the template list |
| 2026-11-23 | **Q4 answered** (soft edge by default, wall or instant return per game; spawn, keep-out and goal zones). Asked Q5 (the lobby). | Alex answers Q5; the template list is still unconfirmed |
| 2026-11-23 | **Q5 partly answered** (arrive in the lobby; creators set min/max). Alex questioned how a walk-in ring makes determinate groups or intelligent matches. Proposed: the ring is an availability pool, the server matchmaker picks groups and teams, a physical "match found" ready check locks the roster. | Alex reacts to the pool + matchmaker proposal |
| 2026-11-23 | **Q5 answered:** pool + matchmaker accepted; added *stay together* and *play against each other* links. Asked Q5b (spectating). | Alex answers Q5b; the template list is still unconfirmed |
| 2026-11-23 | **Q5b mostly answered:** the lobby is a theater box overlooking the arena; each viewer sees their tuned match below; ghost camera; a hologram in the lobby. Asked two follow-ups (the hologram reading; the arena footprint as a stage, which would amend Q1b). | Alex answers the two Q5b follow-ups |
| 2026-11-23 | **Q5b closed:** the lobby always shows a hologram and overlooks the arena; the arena footprint is a stage (Q1b amended). Asked Q6 (what is left of matchmaking: reshuffle or keep teams between matches). | Alex answers Q6; the template list is still unconfirmed |
| 2026-11-23 | **Q6 answered** (reshuffle by default, "play again together", headcount balance only). Asked Q7 (NPCs in the game). | Alex answers Q7; the template list is still unconfirmed |
| 2026-11-23 | **Q7 mostly answered:** all three NPC roles matter; players may fill empty slots with NPCs they choose (which NPC, level, behavior), Smash Bros style. Asked who picks when the match is a group of strangers. | Alex answers the Q7 follow-up |
| 2026-11-23 | **Q7 closed** (creator roster, "play now with NPCs", group agreement). Asked Q8 (rounds, a player dropping out, the end of a match). | Alex answers Q8; the template list is still unconfirmed |
| 2026-11-23 | **Q8 parts 1 and 2 answered** (creators set rounds and time, default 5 to 10 min; a drop-out may return any time while the match runs, an NPC holding the slot meanwhile). The end-of-match flow is proposed, not confirmed. Asked Q9 (rewards). | Alex answers Q9 and confirms the end-of-match flow and the template list |
| 2026-11-23 | **Q8 closed** (end-of-match flow confirmed) and **Q9 answered** (awe, no mana prizes). Q10 marked settled by Q1b/Q10a/Q10b. Asked the last three together (Q11 offline, Q12 limits, Q13 ownership and the Library) plus the template list. | Alex answers Q11–Q13 and the template list; then close the grill and propose a v1 slice |
| 2026-11-23 | **Grill closed.** Q11 (offline games wanted, own grill), Q12 (limits) and Q13 (credit, Library, versioned like minds) answered; six templates confirmed. Wrote "The design in one page" and a proposed 7-slice v1 build order. | Alex approves or changes the build order; then slice 1 |
| 2026-11-23 | **Build order approved; handoff written.** Alex asked for a whiteboard ([link](https://claude.ai/artifact/MLb7vRPPaCspVNUXH1mora)) and a handoff so the next chat starts implementing. Added "Start here" with slice 1's scope, file pointers and the slice 2 blockers. | Next chat: slice 1 (the game record and setup tools) |
| 2026-11-23 | **Slice 1 written: the game record and setup tools.** See [Slice 1 as built](#slice-1-as-built-2026-11-23). `shared/game.ts` (record, limits, `parseGame`), server storage with version history and `POST /api/player/world/game`, `meta.game` server-only, the stage rule in `world-policy.ts` and the authority, the 🎯 Game tab, owner outlines, arrival in the lobby. **Checked:** `tsc -b` (app) and `tsc --noEmit` (sync-service) clean; 188 shared tests and 169 sync-service tests pass (22 new). **Not checked:** `npm run lint` and `npm run build` (the session's Linux sandbox had only the Mac builds of oxlint and Vite's bundler), and **no screen check at any size**: the Game tab, the outlines and the lobby arrival have never been seen running. Tests ran through Node's own TypeScript support with a small `.js` → `.ts` resolver instead of `tsx` (same reason). Committed on a local branch, `phase-10-slice-1`, **not merged or pushed**, because AGENTS.md wants UI checked first and pushing `main` is the deploy. | Screen check at the four sizes, lint, build, then push. Then slice 2 (public pages + lawyer pass first) |
| 2026-11-23 | **Slices 2 to 7 written as a rough draft** (Alex: *"I don't want to touch the game until you've implemented everything and filled all gaps with reasonable assumptions… fan out subagents"*). A shared contract first (`shared/match.ts`, `match-protocol.ts`, the socket message, the client store, mount points), then seven agents in parallel (referee, NPCs, server, play, view, Game tab, public pages), merged and run together by an integration pass. Slice 1 was screen-checked first (phone and desktop) in a new sandbox rig (`scripts/verify/rig/`) that runs the real sync-service and frontend without native packages. **Checked:** both typechecks; 293 shared and 206 sync-service tests; scripted walkthroughs in real (headless) browsers, listed in the rig's README. **Not checked:** lint, build, any human play, load. | Alex plays it; lawyer pass on the public pages before any push; then tune the assumptions |
| 2026-11-23 | **The 18+ door built** (Alex, in a separate chat: *"implement the age restriction work in the game now because it's blocking the Game layer build"*), on the branch `age-18plus-opt-in`, on top of the rough draft. Server: `age-door.ts`, `POST /api/player/door`, `door` in `/me`, `research_ok` stamped at match start, `researchCopy`. App: the switch in the saved player's panel with the research disclosure and a date of birth. Privacy, Terms and RESEARCH.md no longer say "that choice isn't in the game yet"; the legal note has an addendum. **Checked:** both typechecks; 293 shared and 218 sync-service tests (214 after the date of birth was removed, 218 with 18+ worlds); `check-door.mjs` in headless Chrome against the real server at all four sizes (screenshots looked at for phone, small phone and landscape). **Also run:** `npm run build` (passes) and `npm run lint` (no errors; none of its warnings are in the new files). **Not checked:** a person using it, the rest of the rig's walkthroughs after this change. **Not decided here:** whether under-18s may play at all (README → "Age restriction hardening", point 1). | Alex confirms the choices under "Assumptions to confirm"; the lawyer pass now covers the door too |
| 2026-11-24 | **The 18+ door made a plain toggle** (Alex: *"I don't want an age entry or anything like that, just a toggle switch is fine"*; and no "18+ worlds aren't open yet" asides in the game or the policies). Removed the date of birth, the under-18 refusal and its 24-hour hold from `age-door.ts`, the route, `AdultDoor.tsx`, Privacy, Terms and RESEARCH.md. Recorded Alex's three changes to the Nov 7 age grill in [Phase 07](./07-genai-creation.md#changed-2026-11-24-alex-read-these-before-the-list-below): for everyone; a toggle; a world's tier is set at creation and never changes. **Checked:** both typechecks; 293 shared and 214 sync-service tests; `check-door.mjs` at all four sizes. | The 18+ worlds build (world toggle at creation, veiled worlds, containment) |
| 2026-11-24 | **18+ worlds: the tier, the veil and the door** (Alex: *"the goal here was to implement all the age restriction stuff… worlds being created should just have a toggle and you can't switch it after a world is created… only 18+ opted-in players can create 18+ worlds and edit/view them"*). Built on `age-18plus-opt-in`; the table of what exists, the choices made and what is not built are in [Phase 07](./07-genai-creation.md#built-2026-11-24-the-tier-the-veil-and-the-door-branch-age-18plus-opt-in-not-deployed). Touches the game layer in three places: match messages and `/api/match/*` follow the door, replays from 18+ worlds are filtered, and `POST /api/player/game-library` refuses an 18+ world. New socket message `world-closed` (0x14). **Checked:** both typechecks; shared and sync-service tests; build; lint; `check-adult-worlds.mjs` (70 checks, two saved players and a guest, the plant sheet at four sizes), `check-door.mjs`, `check-match-server.mjs`. **Not checked:** a person using it; the other rig walkthroughs; a load test (the guard adds one map lookup per request, `mayEnter` one per world message). | Alex confirms the choices in Phase 07; then the rater and the creation tags, which need the legal items first |
