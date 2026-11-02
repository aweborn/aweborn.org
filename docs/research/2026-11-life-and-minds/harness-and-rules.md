# Report: from a world-building harness to player-authored rules (aweborn)

I read `shared/blueprint.ts` first so the recommendations fit your current schema: BlueprintDraft has style, sky, voxel terrain with features, assets[] (kind, prompt, quality, at, size, rotationY), lore and physics. LIMITS caps assets at 24. The server adds the cost estimate, and parseDraft clamps and repairs what the planner returns. Search results came back through redirect links, so the URLs below are the papers' standard locations. I didn't open every one; check the arXiv IDs before you quote them.

## PART A: Agentic world-building harnesses

### A1. What the research and products do
- **Holodeck** (Yang et al., CVPR 2024, arxiv.org/abs/2312.09067). Separate modules handle floor and walls, doors and windows, object selection (retrieved from Objaverse) and layout. GPT-4 doesn't output coordinates. It outputs **relational constraints** (near, against a wall, in the middle, facing), and a solver turns those into positions.
- **LayoutGPT** (arxiv.org/abs/2305.15393). The LLM writes the layout as CSS-like structured text (boxes with sizes and positions), guided by a few examples.
- **SceneCraft** (ICML 2024, arxiv.org/abs/2403.01248). Steps: text → **scene graph** → Blender Python → render → **a vision model compares the screenshot to the constraints** → fix → repeat. An outer loop saves successful routines into a reusable skill library. It scales to about 100 assets.
- **3D-GPT** (arxiv.org/abs/2310.12945). A task-dispatch agent, a "conceptualization" agent and a modeling agent fill in **parameters of procedural generators** (Infinigen) instead of making meshes. **Infinigen Indoors** (arxiv.org/abs/2406.11824) adds a written constraint language plus a solver.
- **GALA3D** (arxiv.org/abs/2402.07207). An LLM proposes a rough layout, then layout-guided Gaussian splatting refines it. **WorldCraft** (2025, arxiv.org/abs/2502.15601) uses cooperating LLM agents: one coordinates, one places objects, one customises objects.
- **Text2World** (arxiv.org/abs/2502.13092). A benchmark where LLMs write *symbolic* world models in PDDL. It's relevant to rules (Part B) more than visuals.
- **Roblox Cube** (github.com/Roblox/cube, arxiv.org/abs/2503.15475). It generates shapes by predicting the next 3D token. Its "**4D generation**" splits an object into functional parts using *schemas* (car → body, wheels, seat) and attaches **behaviours**, so the result can be driven, not just looked at. Roblox Assistant has a **Planning mode**: it reads the project, proposes an editable plan, then acts. It also does procedural/parametric models.
- **Unity AI** (successor to Muse, 2025) is the same in-editor agent pattern: it calls engine tools rather than making assets end to end.
- **Genie 3** (deepmind.google/discover/blog/genie-3-a-new-frontier-for-world-models). Real-time 720p at 24fps, with "promptable world events" (change the weather, add objects mid-session). It isn't a fit for us:
  - the world is **pixels with no explicit state**, so there is nothing for your CRDT to merge or edit;
  - memory lasts a few minutes, physics is learned and approximate, and results aren't deterministic;
  - it is compute-heavy and in limited preview.
  - Possible later uses: concept previews, or "dream" moodboards that feed the planner. It can't replace the world state.

**Patterns all of these share:**
1. Plan first, then execute.
2. A typed middle layer: scene graph, relations or procedural parameters, never raw meshes.
3. The LLM produces relations, and **a deterministic solver** produces coordinates.
4. Specialists are called as typed tools.
5. A **render-and-critique** loop with a vision model.
6. Reusable skills or templates.
7. Retrieve existing assets before generating new ones, because generating is the expensive step.

### A2. Agent harness patterns (2025–26)
- **MCP spec** (modelcontextprotocol.io/specification, revisions 2025-06-18 and 2025-11-25):
  - Each tool declares an `inputSchema` and an **`outputSchema`**, and returns `structuredContent`.
  - **Elicitation** lets a tool pause mid-call to ask the user for input or approval.
  - **Tool annotations:** `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.
  - The spec says clients SHOULD keep a human able to approve or deny tool calls.
- **Standard practices in production harnesses:**
  - Strict JSON-schema outputs.
  - A tool registry: name, schema, cost function, side-effect class.
  - A plan/act loop with a step budget.
  - **An approval gate showing the cost estimate** before paid calls.
  - **Idempotency keys**, e.g. hash(worldId, blueprintVersion, entityKey, prompt, quality), so a retry never pays Meshy twice.
  - A per-turn and per-world mana budget the agent can read.
  - Logs and traces for every call.
- You already have most of the foundations: server-side estimate, parse-then-repair validation, version bumps.

### A3. How the planner should evolve
**1. Assets become entities with components** (ECS-style, like Roblox's schema + behaviours). Keep `assets[]` for backward compatibility.
```json
"entities": [{
  "key": "old-ferryman",
  "tags": ["npc","quest-giver"],
  "transform": {"at":[120,2,88], "rotationY":1.5, "size":[1,2,1]},
  "place": {"rel":"near", "target":"dock", "dist":3, "facing":"dock"},
  "components": {
    "model":    {"asset":"ferryman-mesh"},
    "anim":     {"rig":"humanoid", "idle":"lean"},
    "voice":    {"asset":"ferryman-voice"},
    "persona":  {"name":"Oren", "bio":"…", "knows":["lore.river"]},
    "behavior": {"bt":"wander", "radius":6},
    "interact": {"prompt":"Talk", "event":"talk.ferryman"},
    "collider": "capsule",
    "spawner":  null
  }
}]
```
- `assets[]` stays the list of generation jobs (what costs money). `entities[]` refers to those jobs by key, so a single mesh can be reused across 10 trees.
- **`place` holds Holodeck-style relations:** near, on, against, around, in-zone, facing, avoid. A deterministic server-side solver resolves them against the voxel heightmap (snap to ground, keep spacing, avoid water and slopes). The planner stops guessing coordinates; explicit `at` remains available as an override.

**2. Typed planner tools (MCP-shaped, served internally):**

| Kind | Tools |
|---|---|
| read-only, free | `list_library_assets(query)` (reuse before generating), `get_world_summary()`, `sample_terrain(x,z)`, `estimate(draft)`, `validate(draft)` |
| state-changing, free | `propose_patch(jsonPatch)`: send diffs rather than whole drafts (better for CRDT and undo) |
| state-changing, paid | `generate_model / image / audio / text(…)` |
| verify | `render_preview(cameraPreset)` |

- Paid tools are marked non-idempotent unless they carry a key, and they require approval with the estimate whenever they exceed the per-turn auto-approve threshold.

**3. Verification, in order of cost:**
- (a) schema check plus clamping, which you already have;
- (b) deterministic checks: solver success, overlaps, everything reachable from spawn, entity and poly budgets;
- (c) optionally, render 2–4 low-res thumbnails of the ghost preview and ask a cheap vision model "does this match the brief? list fixes as patches." Cap it at 1–2 iterations within the turn budget.

## PART B: Player-authored rules, goals, constraints

### B1. How UGC platforms do logic
- **Fortnite Creative:** pre-built **devices** (trigger, timer, score manager, barrier, item granter, end-game). Numbered channels were replaced by **Direct Event Binding**: device A's *event* is wired to device B's *function* in an inspector. **UEFN Verse** covers advanced logic; Verse code `Subscribe`s to device events.
- **Horizon Worlds:** Code Blocks (Blockly-style, events like "player enters trigger") plus TypeScript components. The two can talk through events.
- **Rec Room Circuits V2:** node-and-wire chips with execution and data pins, synced across multiplayer. No text scripting.
- **Other examples** (well known; I didn't search each one):
  - Dreams and LittleBigPlanet: logic "gadgets" wired visually.
  - Mario Maker: **no explicit logic**; rules emerge from parts with fixed behaviours plus a "clear condition".
  - Minecraft: command blocks with selectors, and redstone.
  - Roblox: Luau running in a server-side sandbox.
  - Scratch: event-hat blocks, which is ECA in visual form.
  - Core/Crayta and Garry's Mod (Lua): text scripting with templates.
- **The lesson:** most players make most worlds with **pre-built behaviours + event→action wiring + a win condition**. Full scripting is for the top ~1%.

### B2. Formal approaches
- **ECA rules** (event, condition, action) are the common core of devices, Code Blocks and Scratch.
- **VGDL** (Schaul 2013; GVGAI) has SpriteSet, InteractionSet (collisions between object kinds → effect), TerminationSet (win/lose) and LevelMapping. That is very close to what we need.
- **Ludii** (ludii.games) builds games from high-level **ludemes**: short, composable descriptions.
- **Stanford GDL** is first-order logic: too low-level for us.
- **LLM → rules:** **LLMGG** (arxiv.org/abs/2404.08706) has GPT-4 write VGDL rules and levels together. Syntax errors and unplayable games are common, so you need a validator and repair loop. Grammar-constrained decoding helps. **Word2World** (arxiv.org/abs/2405.06686) uses multi-stage extraction plus playability checks.
- **Implication:** the LLM compiles natural language into a **closed vocabulary of JSON verbs** (rules as data in an ECS). It never writes code. Behaviour trees can also be stored as data later, for NPCs.

### B3. Safety and determinism
- **Server-authoritative evaluation:** clients only send intents.
- **No user code in v1.** The interpreter only knows whitelisted verbs, with no loops. Loops come from events plus a per-rule `cooldown`.
- **Budgets:**
  - per world: rules ≤ 64, actions per tick ≤ 256, timers ≤ 16, spawns per minute;
  - cascade depth ≤ 4: a rule's event can fire other rules at most 4 deep.
- **Deterministic:** fixed-tick evaluation, seeded PRNG per world, rules ordered by priority then id. Log the input events plus the seed for **replay**.
- **Rules versioned with the blueprint**, so CRDT edits to rules go through the same validate/clamp pass.
- **Content safety:** text actions (`say`, `show_message`) go through the same moderation as lore.
- **Later, if you need scripting:** QuickJS/WASM isolates with fuel/instruction metering (the Roblox/Horizon model).

### B4. Proposed `rules` block (inside BlueprintDraft)
```json
"rules": {
  "vars":  [{"id":"coins", "scope":"player", "init":0, "max":999},
            {"id":"gate_open", "scope":"world", "init":false}],
  "zones": [{"id":"finish", "shape":"box", "at":[300,2,300], "size":[6,4,6]}],
  "constraints": {
    "movement":   {"fly":false, "jump":true, "speedMul":1},
    "build":      {"enabled":true, "maxObjectsPerPlayer":10, "allowedKinds":["model"], "zones":["plaza"]},
    "combat":     {"pvp":false},
    "bounds":     {"respawnBelowY":-10},
    "players":    {"max":16},
    "lockedTags": ["scenery"]
  },
  "triggers": [{
    "id": "collect-coin",
    "on": {"event":"touch", "tag":"coin"},
    "if": [{"var":"coins", "op":"<", "value":10}],
    "do": [{"act":"add", "var":"coins", "value":1},
           {"act":"despawn", "target":"$other"},
           {"act":"sfx", "asset":"chime"}],
    "cooldownMs": 0, "once": false
  },{
    "id": "open-gate",
    "on": {"event":"var_changed", "var":"coins"},
    "if": [{"var":"coins", "op":">=", "value":10}],
    "do": [{"act":"set", "var":"gate_open", "value":true},
           {"act":"despawn", "target":"gate"},
           {"act":"say", "target":"old-ferryman", "text":"The way is open."}],
    "once": true
  }],
  "goals": [{
    "id": "reach-island", "scope": "player",
    "label": "Collect 10 coins and reach the island",
    "progress": {"var":"coins", "of":10},
    "win":  {"all":[{"var":"coins", "op":">=", "value":10}, {"inZone":"finish"}]},
    "lose": {"timerSec":300},
    "onWin": [{"act":"message", "text":"You crossed!"}, {"act":"end_round"}]
  }]
}
```
- **Event set:**
  - `start`, `player_join`, `enter_zone`, `exit_zone`, `touch` (tag), `interact` (entity or event key);
  - `timer` (every/after), `var_changed`, `goal_complete`, `player_died`.
- **Conditions:** comparisons on vars, `inZone`, `hasTag`, `all`/`any`/`not`.
- **Actions:**
  - vars: `set`, `add`;
  - entities: `spawn` (by asset or entity key), `despawn`, `move_to`, `toggle_visible`;
  - players: `teleport`, `respawn`, `give_item`;
  - feedback: `message`, `say` (NPC line), `sfx`, `music`;
  - rounds: `start_timer`, `end_round`.
- **Targets:** `$player` (the player who caused the event), `$other`, a key, or `tag:x`.
- **Validator:** every reference must resolve to a var, zone, entity, tag or asset; numbers are clamped; budgets enforced; the event graph gets a static cycle check; a "reachability" lint (is the win zone reachable from spawn?) uses the voxel map.

## Phased recommendation
1. **Phase 1:**
   - add `entities` + `place` relations with a server-side solver;
   - add `list_library_assets` (reuse) and idempotency keys on manifest jobs;
   - approval gate: auto-approve under a threshold, otherwise show the estimate.
2. **Phase 2:**
   - the planner sends JSON patches rather than full drafts, via the typed tools above;
   - deterministic verification (overlap, reachability, budget);
   - optional vision-model thumbnail critique, 1 iteration.
3. **Phase 3 (rules v1, smallest useful subset):**
   - `constraints` (movement.fly, build.maxObjectsPerPlayer, players.max, bounds);
   - `vars` (player/world numbers and booleans) and `zones`;
   - triggers on `enter_zone`, `touch`, `interact`, `timer`;
   - actions `set`, `add`, `message`, `despawn`, `spawn`, `teleport`, `sfx`;
   - **one goal per world** with progress/win/lose.
   - Ship 5–6 templates: collect-N, race-to-zone, survive-T, find-NPC, build-contest, explore-all-zones.
   - The planner fills these in from natural language, with the validator plus one repair loop (the LLMGG lesson).
4. **Phase 4:**
   - NPC personas plus behaviour trees as data (wander, follow, guard, talk);
   - more events (player_died, goal_complete) and round/team scopes;
   - replay logs;
   - a visual rule editor (cards like "When ▸ If ▸ Do", Fortnite-device style) that edits the same JSON.
5. **Phase 5 (only if demand appears):** a metered scripting sandbox (QuickJS/WASM) for advanced creators.

Your current approach of LLM proposes, deterministic code validates and clamps, server authoritative, cost shown up front already matches the field's best practice. Keep extending it rather than giving the LLM code execution.
