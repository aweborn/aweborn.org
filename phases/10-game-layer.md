# Phase 10: The Game Layer (rules, boundaries, goals, teams, lobby, NPC players)

**Status:** `[ ]` Not Started. **Grill in progress, no code** (opened 2026-11-23).
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

### Q3 ⬜ How are rules written in v1?
- **Options:**
  - **Halo 3 style:** parameters and templates (mode, teams, score to win, time limit, player traits like speed, fly/no-fly, gravity);
  - **event wiring:** the When ▸ If ▸ Do triggers already designed in Phase 07;
  - **code.**
- **Rec:**
  - **v1:** templates plus parameters, written by the planner from words. A data block lives next to the blueprint.
  - **v2:** the When ▸ If ▸ Do cards over the same JSON.
  - **Never** user code in v1. Data rules are safe and deterministic, and research can analyze them. Halo 3 shows how far parameters go.
- **Sub-question:** which 5–6 starter templates? Phase 07 lists collect-N, race-to-zone, survive-T, find-the-NPC, build-contest and explore-all-zones. Add team modes like capture-the-flag, king of the hill, and a cooperative build-against-the-clock (good for team research)?

### Q4 ⬜ Boundaries, and people who aren't playing
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

### Q5 ⬜ The physical lobby
*(Partly answered by Q1: the lobby is a **special zone the game creator draws**, and it may hold everyone. Matched players **teleport** from the lobby to their spawns in a new instance. Still open: do players arrive in the world inside the lobby (is it the world's spawn when a game exists?), how queueing and team forming work in the zone, and minimum and maximum players.)*

### Q5b ⬜ Spectating from the lobby
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

### Q6 ⬜ What does matchmaking optimize for?
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

### Q7 ⬜ NPCs in the game
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

### Q8 ⬜ Joining mid-match, rounds, and the end of a match
- **Options** (Fortnite): late joiners spawn now, spectate, or wait for the next round. Then: how many rounds there are, team rotation, and what happens at the end (results board, rematch vote, back to the lobby).
- **Rec:**
  - Late joiners queue in the lobby for the next round.
  - A results board shows at the end, followed by a 20 s rematch vote, then everyone returns to the lobby.
  - Matches are short (5–10 min) by default, so the wait stays short.

### Q9 ⬜ Rewards
- **Options:** none (play for its own sake); awe/XP for playing; mana prizes.
- **Rec:**
  - A little **awe** for taking part.
  - No mana prizes in v1: mana is real money in the pool, and prizes invite farming.
  - Winners get a moment, not a payout.

### Q10 ⬜ Research record and consent
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

### Q11 ⬜ Offline and mesh play
- **Rec:** v1 matches need the server, because the referee is server-authoritative. Mesh play can come later by running the same deterministic rule step on a host phone (as flight already does).

### Q12 ⬜ Budgets and limits
- **Rec:**
  - Complexity caps from Phase 07 (rules, zones, spawned objects, players per match), not a Forge-style money budget.
  - Building a game is free.
  - Only generated assets cost mana, as today.
  - Max players per match is sized to the 100-bots-under-50%-of-a-core bar (AGENTS.md).

### Q13 ⬜ Ownership and credit
*(Also carries the open sub-question from Q2: can a ruleset and its arena be saved to the Library and reused in other worlds, credited to their makers like minds? **Rec: yes.**)*
- **Rec:** the creator keeps credit, and the ruleset is open like the code (no Blizzard-style claim). Forks keep the credit chain, as minds do.

## Decisions

| Date | Decision |
|------|----------|
| 2026-11-23 | Scope set by Alex (Goal above). **One game per world** for now. Research on custom games done first. Feature docs live in the repo, so any chat or agent can continue without Claude Code. |
| 2026-11-23 | **Q2: who starts a match.** Automatic by default: players queue in the lobby, and when the minimum set by the creators is met a short countdown starts the match (so a game works while its creators are offline). A creator or co-creator who is present can **start early or hold the queue** (organized sessions, card events, studies). |
| 2026-11-23 | **Q10b: the 18+ opt-in is the research filter.** Alex: *"Nvm on Nov 20. Let's make it as simple as possible. If they 18+ opt-in, they are automatically research candidates. Disclosed, no consent form."* <br>• **Supersedes** the Nov 20 idea of a separate, revocable research opt-in. <br>• Matches [RESEARCH.md](../RESEARCH.md) rule 1 as written (*disclosed, no consent form*). <br>• Everything is still recorded for everyone (Q10a). Research analyses use the traces of players who have opted into 18+. **Confirmed by Alex (2026-11-23):** players who haven't opted into 18+ are still recorded for replays, but appear in research as anonymous stand-ins. <br>• Before it ships: Privacy and Terms say this plainly at the 18+ door (opting in also makes your play research data), and a lawyer pass plus the university partner's IRB confirm it before anything is published. |
| 2026-11-23 | **Q10a: record and replay every match, for everyone, forever.** Alex: *"I want to record and replay every match for everyone."* *"We need everything. In research, the first step is filtering out the data we cannot use."* <br>• Replays are **linked to the character**: a character can look at all of its replays. <br>• Every record is linked **character → research ID** (the existing `research_identity` mapping). <br>• **Replays stay forever.** Alex: *"They are essentially a character's assets in my eyes."* This replaces the 90-day suggestion. <br>• Publishing replays to social media is a **separate future phase and grill** ("Social Publication"). <br>• Which records research may *use* is the filter question, Q10b. |
| 2026-11-23 | **Q1c: a fixed, authored arena.** Each match copies the arena as the creators set it up, not the live region with visitors' clutter. **The world creator and all co-creators can set up the game** (arena, boundary, lobby, rules). |
| 2026-11-23 | **Q1b: the instance lifecycle (accepted the recommendations).**<br>• The creators set up a **play space**, and each new instance copies what that play space was set up to hold. <br>• **Nothing is saved back** into the world after a match: the instance was only a copy for the match. <br>• **Hard rule:** researchers can trace every player's interactions and the world's by **replaying the telemetry** of any match. Alex: *"the entire point of Aweborn is to have players discover their awe in a shared world. We need games and ways to force interesting behavior to observe, measure, and study success versus loss."* <br>• An instance is **discarded when all its players have left**. That's how others do it too: Roblox reserved servers only run while someone is in them, and Popup room instances persist as long as one attendee is present. Add a maximum match length and an idle timeout so an instance can't live forever. <br>• When its last player leaves, an instance leaves the spectator panel, or stays a while as a "finished x ago" row (suggested: that row opens the replay). <br>• The original region of the live world stays open while matches run. Running instances keep their snapshot when the creator edits the arena; the next match uses the new version and records which one. Follow-ups: Q1c, Q10a. |
| 2026-11-23 | **Q1: matches run in instances.** Alex: *"the match runs in a boundaried instance of a part of the world which the boundary is laid by the game creator."* <br>• Players entering the world start in the **game lobby**, a special zone the game creator makes (the game creator *"can be bound to the world creator and its co-creators"*). <br>• The lobby may hold everyone. Matched players **teleport** from the lobby to their starting spots in a new **boundaried instance** of the game. <br>• Players in the lobby can **spectate any in-progress instance** and switch between them. <br>• So one world hosts **multiple instances of its one game at once**: "one game per world" means one ruleset, not one match. <br>• This is the Roblox reserved-server pattern (lobby → private copy), scoped to a region of the world rather than a whole place. Follow-ups: Q1b, Q5b; Q2, Q4 and Q5 updated. |

## Open questions not yet in the queue

- **Social Publication (a future phase, its own grill):** characters browsing their replays and publishing them to social platforms; consent of the other players shown in a replay.
- How the game layer meets 18+ containment: a game in an 18+ world is 18+, and NPC players follow their mind's tier.
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
