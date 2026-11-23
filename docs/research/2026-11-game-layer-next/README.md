# After the rough draft: 2D arenas, saved instanced runs, and why keep games open

**Status:** design notes, 2026-11-23. Written while the Phase 10 rough draft was being built, from a question Alex asked:

> *"Can we leave notes or research about how we would support 2D arenas? And how do we make instanced saved matches for players? Like, imagine people make a cool World-of-Warcraft style dungeon with creeps and crawlies and players choose characters who they level up and stuff inside the game. Does that make sense? And why I would want to support such an open style?"*

Nothing here is decided or built. It says what each idea would need on top of what [Phase 10](../../../phases/10-game-layer.md) has, where it collides with decisions Alex already made, and a suggested order. The references to other platforms are from general knowledge and from [the custom-games research](../2026-11-custom-games/README.md); nothing new was looked up for this note, so treat platform details as things to verify before relying on them. Each section ends with the questions a grill would ask.

## Short answers

- **Does the dungeon idea make sense?** Yes, and it is closer than it looks. A match's whole state is already plain data that survives being saved and loaded mid-match, so "save the run and come back" is mostly storage and a resume button. What is really new is three things: state that belongs to a **character inside a game** (levels, gear), **hostile NPCs** with something like health, and **parties** that come back together.
- **2D arenas** can mean three different things. The cheap one (a top-down or side-on view of the same world) needs almost nothing from the server. The expensive one (grid and turn-based games) needs a second kind of rule step.
- **Why stay open?** Because the research needs many kinds of teamwork, not one, and a small non-profit can't build them all. But "open" should keep meaning what Q3 decided: open through **data** (templates, settings, cards), never through user code.

## 1. 2D arenas

Three meanings, cheapest first.

### 1a. A 2D view of the same world (recommended first)

The arena is still a box in the 3D world. The game says "this is played top-down" or "side-on", and three things change on the client:
- **The camera** is fixed above (or beside) the arena instead of behind the player.
- **Movement is held to a plane.** The interior sim already takes per-match modifiers (`InteriorMods`: speed, gravity, jetpack, wall). Add a plane lock: top-down = no jump or jetpack; side-on = no movement along one horizontal axis.
- **Controls** map to the plane (the move stick is the whole control; the look stick is free for aiming or does nothing).

What does **not** change: the referee (it already works on x, y, z and zone boxes), the record, NPCs (they already walk on a plane), spectating, and replays (the replay mini-map is already a top-down 2D drawing of the arena). The game record gains one setting, something like `view: "3d" | "top" | "side"`.

Why this one first:
- It is a small client change with no new server code.
- Top-down games read well on a portrait phone and are easy to watch as a hologram.
- It makes matches much cheaper to run on one phone as referee, which is what offline games ([Phase 06](../../../phases/06-offline-mesh.md)) need.
- It suits the places Alex is planning for card machines: an arcade wants games you understand in three seconds from above.

### 1b. A flat game on a surface inside the world

A board, a table, a wall: a flat play surface that characters stand around, with pieces that are match items. Still the same referee and record; the "arena" is thin and the pieces are the players' tokens rather than their bodies. This needs **indirect control** (a player moves a token, not their character), which the draft doesn't have: today a slot *is* a body. It is the natural home for card and board games, and for the trading cards.

### 1c. True grid or turn-based games

Chess-like, tile-based, or turn-based games don't fit a referee that samples positions ten times a second. They want a second kind of rule step: **discrete moves** validated by the server (the Phase 09 "typed intents" direction). The record gets simpler (a list of moves), and replays are exact by construction. This is a new engine beside the current one, sharing the lobby, matchmaker, recording store and Library.

**Questions for a grill:** Which of the three does Alex mean by "2D"? Is the 2D view a creator's choice per game, or can a viewer choose it for any match? Should a top-down match still show bodies in the 3D arena to people in the lobby (it would: same data)? Do 2D games count as "phone tapping" he wants to avoid, or is a shared 2D game in a physical place exactly the point?

## 2. Instanced, saved runs (the dungeon)

### What the draft has today

- A match is short (rounds of minutes), runs in an **instance** (a private partition of the arena), and is **discarded** when it ends. Nothing is saved back into the world (Q1b).
- Its state (`MatchState`) is plain JSON, and the referee is deterministic. A test already checks that a match saved to JSON mid-way and loaded again finishes identically.
- NPC players exist, but only as stand-ins for players: they score points, they don't fight.
- The only numbers a game can keep are three match-wide counters for rule cards.
- Parties exist in a small way: "stay together" links and "play again together".

### What a dungeon needs, piece by piece

| Need | What it means | How far the draft is |
|------|---------------|----------------------|
| **A saved run** | The party leaves, the instance's state is kept, they come back to it | Close. Store the state and the record so far under a run id; "resume" starts a new segment of the same record. New: a `runs` table, a "Continue" row in the lobby, a rule for who may resume (the same party, or anyone the party invites) |
| **Checkpoints** | Coming back puts you at the last safe point, not mid-fight | Small. A zone kind `checkpoint`; the save is taken when the party reaches one |
| **Character state inside a game** | Level, class, gear that a character keeps between runs of *this* game | New. A "sheet" per (game, character): a few numbers and tags the creator defines, within limits. The referee reads it at the start and writes it at checkpoints |
| **Per-player counters in rules** | "When this player defeats a creep ▸ add 10 XP to this player" | Small. The cards have three match-wide counters; add per-player ones and a few new events |
| **Hostile NPCs ("creeps")** | NPCs that oppose the party: guard a room, chase, wear players down | Medium. NPC movement exists (guard, chase). New: something like health or stamina, contact or ability rules, spawn points and waves |
| **Abilities and roles** | Tank, healer, damage: different things each character can do | New, and the biggest design job. Likely a small fixed set of abilities a creator assigns to classes, not free-form |
| **Rooms and progression** | Doors that open when a room is cleared, a boss, an end | Small with cards: "when all creeps in zone A are down ▸ open gate B". Needs gates as match items |
| **Loot** | Things found in a run that change the sheet | Follows from sheets and per-player counters |
| **Party finder** | Groups that form on purpose and return together | Small. Links already keep people together; a named party that persists is the next step |
| **Lockouts, difficulty** | Limits on repeating; harder versions | Later; settings on the game |

### Where it collides with decisions already made

Each of these needs Alex's answer before building.
- **"Nothing is saved back" (Q1b).** Still true for the *world*: the dungeon's arena stays as the creators made it. What gets saved belongs to the **party and their characters**, not the world. That reading keeps the decision, but it should be said out loud.
- **"Nobody dies" (Q4).** A dungeon without danger is a walk. Options: being overwhelmed sends you back to the last checkpoint (the existing "return to spawn", which is what many games call death anyway); or stamina that runs out and needs a teammate to restore, which makes people need each other and is better for team research.
- **Awe is not farmed (Q9).** In-game levels must stay separate from awe: a character's dungeon level belongs to that game; awe belongs to Aweborn. Otherwise a creator can build an awe farm. Awe for finishing a run, with the existing daily cap, is consistent.
- **Every match recorded forever (Q10a).** A four-hour run is far more data than a five-minute race. Rough size at ten samples a second: four players for one hour is about 144,000 samples; as the JSON the draft stores, a few megabytes; a compact binary form with only changed positions would be around a tenth of that. Fine for a prototype, worth compacting before dungeons are common. Old referee versions must also stay runnable for replays, and dungeons will change the referee often.
- **One game per world.** A dungeon is one game. A world with a dungeon and a race arena needs the "one game" rule relaxed, which Alex already called "for now".
- **No user code (Q3).** Abilities, creeps and loot tables are exactly where creators will want scripting. Holding the line means a richer set of cards and a fixed menu of abilities.
- **Movement is trusted from the client today.** Tolerable in a race among friends; in a game with levels and loot, people will cheat for progress. Server authority over interior movement (Phase 09) should come before character progression matters.
- **Characters who "level up".** Aweborn characters already have awe levels and an account can hold several characters. "Choosing a character for the dungeon" could mean picking one of your Aweborn characters, or picking a **class** inside the game for the character you are. The second is simpler and keeps identity (and research ids) clean.

### A sensible order

1. **Saved runs** for the templates that exist (long "build together" or "survive" sessions): prove save, resume and the party coming back. No combat needed.
2. **Per-player counters and sheets**: a character's numbers in a game, written at the end of a match. Useful for every template (personal bests, ranks).
3. **Hostile NPCs with stamina** and checkpoints: the first real dungeon room.
4. **Gates, waves, a boss; classes and a small ability set.**
5. Party finder, difficulty, lockouts.

**Questions for a grill:** Is the save the party's, each player's, or the creator's (a persistent shared dungeon everyone chips away at)? Can a run continue with a different party? What happens to a sheet when the creator changes the game's version? Does stamina replace "nobody dies", or sit beside it? Are classes a creator's invention or a fixed Aweborn set? Do sheets travel with a game through the Library (same game in another world = same character progress)?

## 3. Why support such an open style (and where to stop)

### Reasons that fit Aweborn specifically

- **The research needs different kinds of teamwork.** A race, a build against the clock, holding a hill and clearing a dungeon ask different things of a team: speed, planning, coordination under pressure, roles, recovering from failure. Research on groups has long sorted tasks into kinds for this reason (for example McGrath's task circumplex: generating, choosing, negotiating, executing). One game type would study one corner. If MatchRank is to say which people make a good team *in general*, it has to see the same people across several kinds of task.
- **Persistent parties are the richest data there is.** A dungeon group that returns week after week is a team with a history: who stays, who leaves, how roles settle, whether they get better together. Five-minute matches with reshuffled strangers can't show that. This is the strongest research reason for saved runs in particular.
- **Creators supply the variety a small non-profit can't.** Alex works on this part-time. The platforms in the custom-games research grew their best-known modes from players, not from the studio (the lineage usually cited is Warcraft III custom maps leading to a whole genre). Open tools are how a small team gets many games.
- **One record for everything.** Because every game, whatever its kind, runs through one referee and one record format, a race and a dungeon produce comparable data: same roster, same team-formation log, same event stream. Openness at the level of *rules* does not have to mean chaos at the level of *data*.
- **Reasons to come back.** A character who has a history in a game, and a party waiting, is a reason to open Aweborn tomorrow that a one-off match isn't. That also serves the cards: a card that takes you to *your* dungeon run means more than one that takes you to a place.
- **It matches what Aweborn says it is.** "For everyone", worlds made by players, awe discovered together. A fixed menu of games made by Aweborn would be the odd part.

### Costs, plainly

- **Every new kind of game makes the referee bigger**, and old versions have to stay runnable forever for replays. Six templates and cards are already about 850 lines.
- **Comparability drops as variety rises.** A thousand different dungeons with ten runs each tell research less than ten games with a thousand runs. The Library helps (popular games get reused and are versioned), and Aweborn could keep a few "reference games" it studies closely.
- **More to moderate.** Anything a creator can name, write or draw is a moderation surface. The draft avoided it with fixed lists (NPC names, announcements). Abilities and loot will push on that.
- **Balance and exploits become Aweborn's problem** once progress persists: farming, boosting, cheating.
- **Scope.** A dungeon system is a product in itself. It can swallow the months that the research, the board, the cards and funding also need.

### Where to hold the line

- **Open through data, not code** (Q3 as decided): templates, settings, cards, a menu of abilities. It keeps games safe to run, deterministic, analysable and replayable.
- **Rules decide outcomes, never a language model** (Q7 as decided).
- **Everything recorded the same way**, whatever the game.
- **Grow the menu from what creators actually try to build**, one primitive at a time, rather than designing a general engine first.

**Questions for a grill:** Which matters more in the next six months: more kinds of games, or more play of a few? Would Aweborn curate "reference games" for research? Is there a kind of game Alex does *not* want on Aweborn?
