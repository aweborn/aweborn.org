# Phase 2 — Universe Visual Design & Navigation

> **Parent:** [MASTER_PLAN.md](./MASTER_PLAN.md)
> **Status:** 🔴 Not Started
> **Goal:** Transform the existing cosmic scene into a navigable universe with keyboard-first flight controls.
> **Prerequisites:** Phase 1 complete (Universe CRDT, player presence)

---

## Phase Summary

The current `Environment.tsx` renders a beautiful but static cosmic scene. This phase transforms it into a navigable, infinite-feeling universe where each sun is a real world, the player flies through space with keyboard controls, and gravity wells create emergent traversal patterns.

---

## Milestones

### M2.1 — LOD Rendering System
**Status:** 🔴 Not Started
**Effort:** 2 sessions
**Dependencies:** Phase 1 (M1.2 — Universe CRDT provides world list)

#### What
Implement the 4-tier Level of Detail system from ROADMAP.md:

| Distance | Rendering | Data |
|----------|-----------|------|
| Close (<100 units) | Full 3D sun with glow, particles, player count | Full metadata |
| Medium (100–1000) | Simple billboard sprite with color tint | Position + color |
| Far (1000+) | Single point in `InstancedMesh` / `THREE.Points` | Batched |
| Very far | Part of static starfield texture | Not individually tracked |

#### Acceptance Criteria
- [ ] Worlds transition smoothly between LOD tiers as camera moves
- [ ] 1000+ worlds render at 60fps using instanced rendering for distant worlds
- [ ] Close-up worlds show full detail (glow, particles, player count badge)
- [ ] No pop-in — transitions use opacity cross-fade

#### Tasks
```
- [ ] Create src/components/universe/WorldLOD.tsx — LOD switching component
- [ ] Implement close-range renderer (full 3D sun with post-processing)
- [ ] Implement mid-range renderer (billboard sprite)
- [ ] Implement far-range renderer (InstancedMesh points)
- [ ] LOD distance thresholds configurable via constants
- [ ] Cross-fade transitions between LOD tiers
- [ ] Performance test: render 5000 worlds, verify 60fps
```

---

### M2.2 — Keyboard Navigation (Left Hand — "The Helm")
**Status:** 🔴 Not Started
**Effort:** 1-2 sessions
**Dependencies:** None (pure input system, can be developed independently)

#### What
Implement the left-hand flight controls from ROADMAP.md:

**Core:** V (thrust), W/E (pitch), Q/R (yaw), Space (brake/drift)
**Extended:** A/F (roll), S (reverse), D (strafe)
**Advanced:** Z (lock camera), X (free-look), C (look behind), T (auto-orient), 1-4 (camera distance)

#### Acceptance Criteria
- [ ] Player star moves smoothly with analog-feel controls (not snappy digital)
- [ ] Thrust (V) accelerates in facing direction with inertia
- [ ] Brake (Space tap) toggles drift mode; hold = active brake
- [ ] Pitch/yaw/roll feel natural and responsive
- [ ] Camera follows player with configurable distance (1-4 keys)
- [ ] All 17 left-hand keys mapped per ROADMAP spec

#### Tasks
```
- [ ] Create src/systems/FlightController.ts — physics-based movement
- [ ] Implement 6DOF movement: thrust, pitch, yaw, roll, strafe, reverse
- [ ] Add inertia/drag model (velocity persists, slowly decays)
- [ ] Brake/drift toggle logic
- [ ] Camera follow system with 4 distance presets
- [ ] Free-look toggle (X key) — decouple camera from movement
- [ ] Auto-orient (T key) — snap to galactic "up"
- [ ] Key state manager (track held/released for analog-like behavior)
- [ ] Verify: fly freely through 3D space, feels good
```

---

### M2.3 — Right-Hand Controls (The Console)
**Status:** 🔴 Not Started
**Effort:** 2 sessions
**Dependencies:** M2.2, Phase 1 (M1.2 for lock-on targets)

#### What
Implement right-hand controls from ROADMAP.md:

**Core:** N (interact/enter world)
**Star Mods:** U/I/O/P (trail, aura, shape, emote — cycle on tap, radial on hold)
**Systems:** J (lock-on), K (warp charge/release), L (scan/info), ; (map/compass)
**Communication:** M (chat wheel), , (ping), . (voice toggle)

#### Acceptance Criteria
- [ ] N key enters/exits worlds when in range
- [ ] J key locks onto nearest world, repeated taps cycle targets
- [ ] K key charges warp (visual: star compresses, stars streak) and releases (visual: light-speed blur)
- [ ] L key shows world info overlay on hold
- [ ] Star mods cycle through options on tap

#### Tasks
```
- [ ] Create src/systems/InteractionController.ts — right-hand input handling
- [ ] Implement lock-on system (J) — find nearest world, visual indicator
- [ ] Implement warp mechanic (K) — charge timer, visual/audio feedback, teleport
- [ ] Implement scan/info overlay (L) — HUD display of world metadata
- [ ] Implement star mod cycling (U/I/O/P) — visual feedback per mod
- [ ] Map/compass toggle (;) — heading indicators
- [ ] N key — proximity check, world entry trigger
- [ ] Communication stubs (M, comma, period) — wired up in Phase 5
```

---

### M2.4 — Gravity Wells & Passive Drift
**Status:** 🔴 Not Started
**Effort:** 1-2 sessions
**Dependencies:** M2.2, Phase 1 (M1.4 — player presence for world mass)

#### What
Implement the gravity system from ROADMAP.md:

- Gravity strength: `attraction = G * worldMass / distance²` where `worldMass = f(playerCount, objectCount, age)`
- Deep space: slow drift/deceleration
- Approaching a well: trajectory bends, field lines appear, audio hum
- Captured orbit: gentle orbit around world
- Slingshot: high-velocity pass curves path, speed boost

#### Acceptance Criteria
- [ ] Player trajectory bends near active worlds
- [ ] Popular worlds (high playerCount) pull harder
- [ ] Orbital capture works — release thrust near a world and gently orbit
- [ ] Slingshot mechanic works — high-speed pass gives speed boost
- [ ] Aweborn Portal at origin has the strongest gravity

#### Tasks
```
- [ ] Create src/systems/GravitySystem.ts — N-body-lite simulation
- [ ] Calculate world mass from CRDT metadata (playerCount, objectCount)
- [ ] Apply gravitational force to player velocity each frame
- [ ] Orbital capture detection and gentle orbit path
- [ ] Slingshot detection and velocity boost
- [ ] Visual: faint curved field lines near gravity wells
- [ ] Audio: warm hum that grows with proximity
- [ ] Aweborn Portal special case: strongest gravity, always at origin
```

---

### M2.5 — World Entry/Exit (Context Switch)
**Status:** 🔴 Not Started
**Effort:** 1-2 sessions
**Dependencies:** M2.2, Phase 1 (M1.3 — World CRDTs)

#### What
Implement the universe ↔ world interior transition from ROADMAP.md:

- Press N while orbiting → transition animation → world interior loads
- Controls remap: V=jump, W/E=look, Q/R=move, etc.
- Visual: player star merges into sun (enter), spark ejects from sun (exit)
- World interior is a separate 3D scene (or scene overlay)

#### Acceptance Criteria
- [ ] Pressing N near a world triggers entry animation
- [ ] Controls remap per ROADMAP spec (V=jump, Q/R=move, etc.)
- [ ] World interior renders the world's CRDT objects
- [ ] Pressing N (or Escape) exits back to universe view
- [ ] Other players see your star merge into/eject from the sun

#### Tasks
```
- [ ] Create src/components/world/WorldInterior.tsx — world interior renderer
- [ ] Entry animation: player star → sun absorption visual
- [ ] Exit animation: spark ejection from sun
- [ ] Control remapping system (universe mode ↔ world mode)
- [ ] Scene management: load world interior, unload universe detail (keep skybox)
- [ ] Broadcast enter/exit events via awareness protocol
```

---

### M2.6 — Input Translation Layers
**Status:** 🔴 Not Started
**Effort:** 1-2 sessions
**Dependencies:** M2.2, M2.3

#### What
Map keyboard controls to other input methods:
- **Gamepad:** Left stick = steer, RT = thrust, LT = brake, etc.
- **Touch:** Left thumb joystick = steer, right zone = thrust, tap = interact
- **(Optional) Eye tracking:** WebGazer.js gaze = steer direction

#### Acceptance Criteria
- [ ] Gamepad detected via Gamepad API, controls mapped per ROADMAP
- [ ] Touch controls render virtual joystick on mobile
- [ ] All input methods produce the same internal events as keyboard
- [ ] Input method auto-detected, seamless switching

#### Tasks
```
- [ ] Create src/systems/InputManager.ts — abstract input layer
- [ ] Gamepad adapter: Gamepad API → internal events
- [ ] Touch adapter: virtual joystick overlay → internal events
- [ ] Eye tracking adapter: WebGazer.js → steer events (optional/experimental)
- [ ] Auto-detection: keyboard vs gamepad vs touch
```

---

## Phase Completion Criteria

1. ✅ LOD rendering — thousands of worlds at 60fps
2. ✅ Full keyboard flight — 6DOF movement, feels great
3. ✅ Right-hand controls — lock-on, warp, scan, world entry
4. ✅ Gravity wells — trajectory bending, orbital capture, slingshots
5. ✅ World entry/exit — seamless context switch with control remapping
6. ✅ At least one alternative input method (gamepad or touch)

**Then:** Update MASTER_PLAN.md status to 🟢.

---

*Last updated: 2026-08-20*
