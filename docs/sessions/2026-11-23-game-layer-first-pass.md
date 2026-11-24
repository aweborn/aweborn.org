# 2026-11-23 to 24: the game layer's first pass

One long chat session with Alex (an AI agent doing the work, with helper agents in parallel). This file is the record of it. The design and its state are in [`phases/10-game-layer.md`](../../phases/10-game-layer.md).

## What Alex asked for, in order

1. *"Read `phases/10-game-layer.md` → Start here, and build slice 1."*
2. *"Spin up anything you need for local verification… I don't want to touch the game until you've implemented everything and filled all gaps with reasonable assumptions… fan out subagents."*
3. Notes on 2D arenas, saved instanced runs (a dungeon with characters who level up) and why to keep games open.
4. After reading the first report, decisions on its assumptions (Nov 24): a match keeps its own arena; positions should be checked by the server; merge the 18+ work; build "delete my player" with an are-you-sure step; awe is fine until playtesting.
5. *"I don't think it should delete the planner history… can't the chat and planner stuff be detached from the identifier? We don't want missing entries in the history of the creation of a world."*
6. A note to rethink world planning: the planner as a terraforming chat, objects through their own Create flow.
7. *"Document our session in the repo, and remember to keep notes in the repo… Others will eventually work on this project and it needs to stay tidy for everyone. Please push and deploy."*

## What was decided (all recorded in the phase files)

| Decision | Where |
|----------|-------|
| The game is stored in a server table with every version kept, with a server-written copy in the world doc | Phase 10 Decisions, 2026-11-23 |
| The rough draft's assumptions (sampled positions, instances as presence partitions, numbers for the ready check, drops, awe) | Phase 10 → "Assumptions to confirm with Alex" |
| A running match keeps its own copy of the arena; positions are checked by the host; deleting a player keeps chat and planner history, detached; publish everything together | Phase 10 Decisions, 2026-11-24 |
| The 18+ switch is a plain toggle; 18+ worlds are veiled and shut without it (decided and built in a separate chat the same day) | Phase 07 → "Changed 2026-11-24", "Built 2026-11-24" |
| **Pushed and deployed on 2026-11-24 at Alex's instruction, before the lawyer pass** on Privacy, Terms and RESEARCH.md. The lawyer's review note is the list of what to check | [`docs/legal/2026-11-game-layer-pages.md`](../legal/2026-11-game-layer-pages.md) |

Not decided, written down to grill later: 2D arenas, saved runs and open games ([notes](../research/2026-11-game-layer-next/README.md)); the terraforming planner ([Phase 07 note](../../phases/07-genai-creation.md#the-planner-becomes-the-terraformer-objects-get-their-own-flow-alex-2026-11-24-a-note-not-yet-grilled-or-built)).

## What was built

- **Phase 10, all seven slices, as a rough draft:** the game record and Game tab; the referee for six templates and When ▸ If ▸ Do cards; matches in instances; recording and replays; the lobby pool, matchmaker and ready check; spectating (hologram, ghost camera); NPC players; the game Library. Table of files: Phase 10 → "The rough draft of slices 2 to 7, as built" and [`HANDOFF.md`](../../HANDOFF.md).
- **After Alex's review:** each match's own arena copy and a server lock on the arena's ground; position checks; delete my player.
- **Public pages** rewritten for all of it.
- **A sandbox rig** ([`scripts/verify/rig/`](../../scripts/verify/rig/README.md)) that runs the real server and app where native packages can't be installed, with scripted walkthroughs.

## How it was built (useful if you do the same)

- Slice 1 by one agent. Then a **contract first** (`shared/match.ts`, `shared/match-protocol.ts`, the socket message, the client store, empty mount points), committed before anyone else started.
- Then seven agents in parallel, each in its own git worktree with a list of files it owned: referee, NPCs, server, the player's side, the watcher's side, the Game tab, the public pages. Each got the same written brief and its own copy of the rig.
- Then one integration agent on the merged tree, whose job was whole matches with several real browsers. It found the bugs no single piece had (the list is in Phase 10 → "What the integration pass found").
- After the review, two more agents in parallel (arena copy and position checks; delete my player).
- The working copy lived in the agent's cloud sandbox; work reached Alex's Mac as patches applied to the local branch `phase-10-slice-1`, then went to GitHub from the sandbox.

## How it was checked, and what never was

- Both typechecks; 305 shared and 243 sync-service tests; genai-service's 11.
- Scripted walkthroughs in headless Chrome against the real server: three people in one match at four screen sizes; every template with NPCs; drops and rejoin; replays; the Library; the arena copy; delete my player (the rig's README lists each script).
- **Never done:** a person playing it; `npm run lint`; a load test of many matches; the delete flow's passkey and Google confirmation; the genai-service's part of deleting a player against a running genai-service.
- `npm run build` was not run in the sandbox (the deploy workflow runs it).

## Open, for whoever picks this up

1. **Alex plays it** and tunes the assumptions (Phase 10 → "Assumptions to confirm with Alex", "Known gaps").
2. **The lawyer pass** on the public pages, which are already live.
3. Questions left for Alex from the delete-player work: keep or delete reports and safety flags about a deleted player; a world whose creator was deleted and has no builders; the Terms' licence wording.
4. Load-test instances on a throwaway box.
5. The grills listed above.
