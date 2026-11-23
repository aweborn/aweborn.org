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

### Q1 ⏳ Where does a match run? (asked 2026-11-23)
- (a) In the **live world**: the world is the arena, and everything a match changes stays changed.
- (b) In a **fresh copy for each match** (a Roblox reserved server): clean resets, but it breaks "stateful like real life" and splits a small player count.
- (c) A **game layer over the live world**:
  - The world itself never resets.
  - The match has its own server-written state (teams, scores, timer, round, and things it spawns, tagged `game`), and only that resets between rounds.
  - While a match runs, edits inside the boundary are locked.
- **Rec: (c).** It keeps the stateful rule, keeps everyone in one place at low traffic, and gives research a clean record of each match.
- **Also asked:** does "one game per world" mean one ruleset per world *and* one match running at a time? **Rec: both, for now.**

### Q2 ⬜ Who may author and start the world's game?
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
- **Rec:** the creator keeps credit, and the ruleset is open like the code (no Blizzard-style claim). Forks keep the credit chain, as minds do.

## Decisions

| Date | Decision |
|------|----------|
| 2026-11-23 | Scope set by Alex (Goal above). **One game per world** for now. Research on custom games done first. Feature docs live in the repo, so any chat or agent can continue without Claude Code. |

## Open questions not yet in the queue

- How the game layer meets 18+ containment: a game in an 18+ world is 18+, and NPC players follow their mind's tier.
- A spectator camera on phones (portrait first).
- Interaction with kick, grab and the current `world-policy.ts` rights during a match.

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| 2026-11-23 | **Opened.** Alex asked to grill him on the game layer after deep research. Wrote [the research](../docs/research/2026-11-custom-games/README.md) (Halo 3 → Infinite, Roblox, Fortnite, WC3, Rec Room, VRChat, Empirica, Overcooked-AI, a tradeoff table) and this phase with the 13-question grill queue and recommended answers. Asked Q1. Alex: put these feature docs in the repo so another chat can carry on. | Alex answers Q1, then continue down the queue |
