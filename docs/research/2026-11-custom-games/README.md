# Research: player-made games inside a world (2026-11-23)

Alex, 2026-11-23: *"the 'game' engine part of aweborn which enables better research because players will be enabled to apply rules, constraints, and other fundamental components of games. They will be able to place 'boundaries' of the space. Create goals and rules. Matchmaking, a physical matchmaking lobby for players waiting to be matched on teams and placed in the game. We also want NPCs and non-player characters to be able to make and have play in the 'game' being built by players within a world. For now, only one game per world."* He asked for research on Halo 3 custom games, Roblox and others, and the tradeoffs those games faced, before the grill.

**This research feeds the grill and design in [Phase 10: the game layer](../../../phases/10-game-layer.md).** Decisions are recorded there, not here.

## What was already in the repo (this research builds on it)

- [Phase 07 → Rules, goals & constraints (design, 2026-11-01)](../../../phases/07-genai-creation.md#rules-goals--constraints-design-2026-11-01):
  - rules are data, not code;
  - a closed event → condition → action vocabulary;
  - server-authoritative and deterministic;
  - budgets of ≤ 64 rules, ≤ 256 actions per tick and cascade depth ≤ 4;
  - one goal per world, and 5–6 templates.
  
  **Designed, not built.**
- [harness-and-rules.md](../2026-11-life-and-minds/harness-and-rules.md): Fortnite devices, Horizon Code Blocks, Rec Room Circuits, VGDL, LLM → rules (LLMGG).
- [npc-brains.md](../2026-11-life-and-minds/npc-brains.md) and the shipped minds: NPCs are cosmetic. A mind can't grant items, mana or progress (the *Where Winds Meet* lesson: chat must never grant game state).
- [`shared/world-policy.ts`](../../../shared/world-policy.ts): the creator, co-creators (builders) and placers edit; everyone else may place and kick. The sync-service reverts edits that break the policy.
- Standing rules ([Phase 07 → Stateful worlds and portable creations](../../../phases/07-genai-creation.md#stateful-worlds-and-portable-creations-alex-2026-11-02)): worlds are **stateful like real life**, and every creation can **come back to life in other worlds**.
- [ROADMAP.md](../../../ROADMAP.md) → *Emergent Social Behavior* says: *"Without building friend lists, chat lobbies, or matchmaking, social behavior emerges naturally."* A matchmaking lobby is a deliberate **deviation**, logged in Phase 10. Don't edit ROADMAP.md.
- [RESEARCH.md](../../../RESEARCH.md): MatchRank. **Match → observe → re-match** beats predicting the perfect team once. Research is opt-in, and only for players who have also opted into 18+.

This report covers what the earlier research did not: how custom-game **sessions** work (lobbies, matchmaking, teams, boundaries, rounds, bots), and what those mean for research.

## 1. Halo 3 to Halo Infinite: Forge and Custom Games

- **The map and the mode are separate files.** Forge edits the *map variant*; the custom-game menu edits the *gametype variant*. You pair them in the lobby, so one map serves many modes. Halo: Reach added **gametype labels**, so an object spawns only in a given mode (FFA only, team only, KOTH hill, and so on).
- **Halo 3 had no scripting, only parameters:**
  - each mode's options: score to win, team play, rounds, friendly fire, force even teams;
  - **player traits**: speed, gravity, damage, shields and weapons;
  - respawn settings;
  - traits for a custom power-up.
  
  The community made whole new games from settings alone (Infection variants, Grifball, rocket baseball with gravity-hammer bats). **Parameters plus good base modes go a very long way.**
- **Budgets.** Every Forge object cost money from a budget for the map, and each item type had a cap. Players complained about it for years ("spent 19k of 30k, can't place anything more"). The budget grew from about 1,600 objects in Halo 5 to thousands in Infinite.
- **Boundaries are volumes, with two strengths.**
  - A *safe* boundary defines the play space: you die outside it. A *kill* boundary kills you inside it.
  - **Soft** versions give a 10-second countdown to get back; **hard** versions kill at once.
  - Common practice: soft safe zones define the playable area, soft kill zones mark places you'd rather players avoid (rooftops), and hard kill zones catch falls.
  - Infinite adds a shrinking zone.
- **Infinite added a node-graph "Script Brain", bots and AI units.**
  - Bots walk a **nav mesh**. Forge generates it automatically, and creators patch it with nav objects.
  - A working nav mesh is **required for bot backfill** in matchmaking.
  - There is **no aerial nav mesh**, so AI never pilots the flying vehicles.
  - Map "baking" (nav mesh, lighting) runs on Halo's servers, so Forge needs to be online.
- **Lesson for Aweborn:**
  - start with parameters and templates;
  - keep the mode as its own portable record;
  - make boundaries and bots first-class objects.
  
  Flying and voxel terrain make bots harder for Aweborn than for Halo.

## 2. Roblox: full code, reserved servers and lobby places

- **Lobbies are physical.** The common pattern is pads or elevators in a lobby *place*:
  1. stepping on a pad joins a queue;
  2. when the queue fills (or a timer runs out), the server calls `ReserveServer`;
  3. it teleports that group into a **fresh, private copy** of the game place, passing party and team data along.
  
  Doors, BedWars and battle royales work this way. Roblox's battle-royale template ships separate Lobby, Queue and Gameplay places, and runs each round through intermission → competition → cleanup and reset.
- **The tradeoff: queues split the player count.** Experienced developers warn against queue-based designs on Roblox and favor games anyone can join at any time; teleports have broken in production. Rec Room had the same problem: subrooms for each mode split 15 players into groups too small to start.
- **Server authority was learned the hard way.** Before 2018, changes made on a player's client replicated to everyone, so exploiters could delete maps and kill players. Roblox made FilteringEnabled mandatory and removed "Experimental Mode". Many old games broke, but the platform became safe. Aweborn already reverts client edits on the server, and the game layer has to work the same way.
- **Matchmaking moved from do-it-yourself to the platform.** Custom Matchmaking (2025) lets an experience weight the signals that match players to servers.

## 3. Fortnite Creative / UEFN

- **Island settings are the mode:**
  - team count, team size and max players;
  - privacy: public, private or the party's choice;
  - **join in progress**: spawn, spectate or next round;
  - **team rotation** every N rounds;
  - auto start.
- **Logic** is devices wired by *direct event binding* (event → function), with Verse code for advanced logic.
- **Known problems:** friends who queued together weren't guaranteed the same team until a 2023 matchmaking update, and join-in-progress is still a recurring bug report.

## 4. Other platforms

- **Warcraft III World Editor → DotA:** a trigger editor (event, condition, action) created whole genres. Later, Reforged's EULA claimed **Blizzard owns every custom game**, and creators resented it. Who owns a player-made game is a decision to make early.
- **Rec Room** (Circuits, rooms and subrooms) announced on 2026-03-31 that it would shut down on 2026-06-01, leaving creators' rooms without a platform. This supports Aweborn's "creations come back to life anywhere" rule, open code and federation.
- **VRChat:** creators ask for sub-instances, so a small group can play apart from an 80-person social lobby. It's the same lobby-vs-match split.
- **The coherence SDK** names the pattern: a persistent **World**, short-lived **Rooms** (dungeon instances), and **Lobbies** for forming groups.

## 5. Games as research instruments

- **Empirica** (MIT, Almaatouq et al., 2021): an open-source virtual lab for multiplayer experiments in the browser.
  - It handles batching participants, launching games and storing data.
  - Designs are parameterized, with "flexible defaults".
  - Aweborn's game layer plus matchmaking would be, in effect, *Empirica inside a 3D world*: teams are treatment groups, rule parameters are conditions, and a match is a trial.
- **Overcooked-AI** (Carroll et al., NeurIPS 2019): AI trained by self-play coordinates poorly with humans. Collaboration needs models of how people actually play, and the game is now a standard benchmark. NPC teammates in Aweborn would make a natural human-AI teaming testbed, with AI disclosure (already a platform rule).
- **What research needs from the engine:**
  - rules as **machine-readable data**, so conditions are known exactly;
  - **deterministic replay** (flight traces already work this way);
  - **logged random assignment**, kept separate from matching for skill or fun;
  - a match record: who played, teams, the rule version, the seed, outcomes and chat;
  - consent before any of it counts as research.

## 6. Tradeoffs across platforms

| Decision | Options (who chose them) | Tension |
|---|---|---|
| Where a match runs | in the live world (Halo Forge: play while editing) · a fresh copy (a Roblox reserved server) · a game layer over the live world | Aweborn's "stateful like real life" rule vs. a clean reset every round |
| How rules are written | parameters + templates (Halo 3) · event wiring (Fortnite, WC3, Rec Room) · code (Roblox, Verse) | Easy to use and safe vs. powerful. Data rules can be analyzed for research; code can't |
| Lobby | a physical lobby in the same world · a separate lobby place · menus | A physical lobby feels great but splits a small player count (Roblox, Rec Room) |
| Filling matches | wait for humans · bot backfill (Halo Infinite) · NPC teammates | Bots need navigation; NPC players confound research unless tagged |
| Joining mid-match | spawn · spectate · next round (Fortnite) | A drop-in persistent world vs. fair matches |
| Teams | random · by skill · parties kept together · rotated each round | Fun and fairness vs. random assignment for research vs. MatchRank |
| Budgets | money per object (Forge) · counts per type · complexity caps | Forge's budget frustrated players for years; Aweborn already has mana |
| Ownership | the platform owns it (Blizzard) · the creator owns it, under an open license | Trust and portability |

## Sources

- Forge (Wikipedia): https://en.wikipedia.org/wiki/Forge_(level_editor)
- Halo 3 Forge + custom games: https://www.cheathappens.com/features/halo3/halo3_forge_theater.asp · https://www.halopedia.org/Custom_game · https://shacknews.com/article/49126/forging-your-own-games-in
- Reach gametype labels: https://www.halopedia.org/Forge_Labels
- Reach boundaries: https://archive.forgehub.com/posts/1258208 · https://archive.forgehub.com/wiki/halo-reach-forge-spawning · https://forgingreach.blogspot.com/2011/06/safe-zones-and-kill-zones.html
- Infinite Forge, bots, nav mesh: https://support.halowaypoint.com/hc/en-us/articles/10581874119828 · https://the-scripters-guild-1.gitbook.io/tsg-forge-wiki/forge/nav-mesh · https://sg.news.yahoo.com/hands-halo-infinite-forge-ai-160000143.html
- Roblox reserved servers: https://create.roblox.com/docs/projects/teleport-private-servers · https://devforum.roblox.com/t/reserved-servers/104922
- Roblox lobby / queue patterns: https://devforum.roblox.com/t/how-do-servers-work/2184570 · https://devforum.roblox.com/t/teleport-players-to-a-pre-made-place-or-start-the-round-in-the-current-game/476946 · https://create.roblox.com/docs/resources/battle-royale/installation-and-setup · https://create.roblox.com/docs/education/battle-royale-series/project-setup
- Roblox FilteringEnabled: https://devforum.roblox.com/t/filteringenabled-property-is-being-deprecated/1203582
- Roblox Custom Matchmaking: https://devforum.roblox.com/t/custom-matchmaking-is-now-available-to-all-experiences-on-roblox/4051419
- Fortnite mode settings: https://dev.epicgames.com/documentation/en-us/fortnite/mode-settings-in-fortnite-creative · https://www.fortnite.com/news/fortnite-ecosystem-v26-20-update
- Rec Room subrooms: https://forum.rec.net/t/room-player-counter-chips/5642 · shutdown: https://sacra.com/c/rec-room/
- VRChat sub-instances: https://feedback.vrchat.com/udon/p/sub-instance-system-for-isolated-small-group-gameplay
- coherence worlds / rooms / lobbies: https://docs.coherence.io/1.2/overview/rooms-and-worlds
- WC3 ownership: https://www.gamedeveloper.com/game-platforms/blizzard-automatically-owns-any-and-all-i-warcraft-3-reforged-i-custom-games
- Empirica: https://arxiv.org/abs/2006.11398
- Overcooked-AI: https://arxiv.org/abs/1910.05789
