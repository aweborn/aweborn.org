# The sandbox rig

Runs the real sync-service and the real frontend on a machine that can't install the
native packages (tsx's esbuild, better-sqlite3, Vite's bundler): for example a Linux
sandbox that holds only a Mac's `node_modules`. Written 2026-11-23 to check Phase 10.
On a normal machine you don't need it: `npm run dev` plus `npm run dev` in
`server/sync-service` is the real thing, and the walkthrough scripts work against that
too (set `CHROME` if Chrome isn't found).

| File | What it does |
|------|--------------|
| `hooks.mjs` | Node resolve hooks: `./x.js` → `./x.ts` (what tsx does) and `better-sqlite3` → `sqlite-shim.mjs` |
| `sqlite-shim.mjs` | A stand-in for better-sqlite3 over Node's own `node:sqlite` (only what the service uses) |
| `web.mjs` | Serves the frontend without a bundler: transpiles each `src/` and `shared/` file on request with the TypeScript compiler and points bare imports at Vite's pre-bundled dependencies in `node_modules/.vite/deps` (left by any earlier `npm run dev`). No hot reload: reload the page |
| `up.sh` | Starts both with a fresh database. `RIG_N=<0-9>` runs separate copies side by side (frontend 5173+10N, sync 1234+10N, files in `/tmp/rig<N>`). `up.sh stop` stops that copy |
| `browser.mjs` | Headless Chrome with software WebGL, plus helpers: a saved player, plant a world, enter it, stand somewhere, read a store |

Tests without tsx:
```
T="node --no-warnings --experimental-transform-types --import $PWD/scripts/verify/rig/hooks.mjs --test"
$T shared/*.test.ts shared/sim/*.test.ts
(cd server/sync-service && $T src/*.test.ts)
```

Walkthroughs (each prints what it checked and writes screenshots to `/tmp/rig<N>/`):

| Script | Covers |
|--------|--------|
| `check-game-tab.mjs` | Slice 1: mark arena, zones, lobby; save; outlines |
| `check-game-setup.mjs` | The Game tab's sections, NPC roster, rule cards, Library (faked routes), four screen sizes |
| `check-match-server.mjs` | Three players over raw sockets: queue, ready check, host start, instance partition, watcher, race, awe, record verifies, lists, Library. Run with the `--import hooks.mjs` flags above |
| `check-play.mjs` / `check-view.mjs` | The play and view layers against a faked server, four screen sizes |
| `check-play-live.mjs` | One player and NPCs through a whole race against the real server |
| `check-view-live.mjs` | Tune in, fly in, result, replay against the real server |
| `check-match-e2e.mjs` | **Three people in three browser contexts** (owner, a saved player, a guest): set-up, arrival, ring, ready check, spawns, each sees the other, the lobby doesn't, the owner tunes in (bodies, hologram), out of bounds and back, the goal, results, record verifies, play again together, a decline, the NPC vote, replays from Finished and Mine, the mini-map from another world. Passed at all four sizes |
| `check-match-more.mjs` | Play against from the chat name sheet; Hold / Release / Start now; a closed tab → an NPC takes the slot → Rejoin; Leave. Phone size |
| `check-templates-live.mjs` | One match each of collect, capture the flag, king of the hill, survive, build together and a two-card rules game with NPCs; every record verifies. Phone size |
| `check-library-live.mjs` | The Library against the real routes: save, list, bring into a second world, bring again, another creator brings it, credits. Phone size |
| `check-door.mjs` | The 18+ switch in the player panel against the real server: a guest is refused, the research note at the switch, on / off / on with one tap each, no date of birth or other entry. Four screen sizes. Run it against the real frontend (`npm run dev`) or the rig |
| `check-adult-worlds.mjs` | 18+ worlds against the real server and app, with two saved players (switch on, switch off) and a guest: who can make one, the veil (no name, colour or music in anyone else's universe), every way in shut (the app, a raw socket, ten routes), tiers flowing down, no cards, the plant sheet at four sizes, and the switch turned off while inside |
| `check-arena-copy.mjs` | A running match keeps its own arena: the owner changes the stage and digs mid-match, the player's view doesn't change, the next match gets the new arena, the first record keeps the old one |
| `check-delete-player.mjs` | Delete my player: a saved player with two characters, a world, chat, a match and the 18+ switch deletes; checks the promises through the API, the other player's screen and the database |
| `match-kit.mjs` | Shared helpers for the live scripts |

`check-match-server.mjs` assumes a fresh database (run `up.sh` first). The e2e has the
owner hold the queue around its decline step, because software Chrome at desktop size
can't act inside a ready check in time.

Limits: Chrome renders in software here (5 to 10 frames a second), so the scripts wait
on store state, not on time; fonts, Stripe and Google sign-in can't load (no network).
