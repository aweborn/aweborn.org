# Phase 04: Navigation & Controls

**Status:** `[x]` Complete
**Depends on:** [Phase 03: Universe Rendering & LOD](./03-universe-rendering.md)
**ROADMAP reference:** [Navigation & Interaction](../ROADMAP.md#navigation--interaction)
**Estimated sessions:** 3-4

## Goal

Implement the keyboard-first cockpit control scheme where **left hand navigates, right hand acts**. The player flies through the universe as a glowing orb, can lock onto worlds, warp across distances, and enter/exit worlds. Touch and gamepad inputs translate to the same keyboard layout. Movement should feel fluid and satisfying — doing nothing should be beautiful (passive drift).

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Input source of truth | Keyboard layout | All other inputs translate to keyboard actions |
| Flight model | 6DOF with inertia/drift | Space feels like space — no instant stop |
| Physics approach | Client-side (no server physics for movement) | Latency-free, server validates at low freq |
| Camera | Third-person follow with adjustable distance | 4 zoom levels (1-4 keys) |
| Gravity wells | Inverse-square attraction: `G * worldMass / d²` | Social gravity = physical gravity |

## Tasks

### Input System
- `[x]` Create `src/systems/InputManager.ts` — unified input handler
- `[x]` Keyboard event capture (keydown/keyup → action map)
- `[x]` Define action map matching ROADMAP spec:
  - Left hand: V=thrust, Space=brake, W/E=pitch, Q/R=yaw, A/F=roll, S=reverse, etc.
  - Right hand: N=interact, U/I/O/P=mod slots, J=lock-on, K=warp, L=scan, etc.
- `[x]` Action state object (pressed/released/held) updated each frame
- `[x]` Context switching: universe controls ↔ world interior controls (same keys, different actions)

### Flight Model
- `[x]` Create `src/systems/FlightController.ts`
- `[x]` 6DOF movement: thrust, pitch, yaw, roll with acceleration/deceleration curves
- `[x]` Inertia: releasing thrust → gradual slowdown (drift state)
- `[x]` Brake: active deceleration
- `[x]` Reverse thrust: for fine positioning
- `[x]` Lateral strafe (D key)
- `[x]` Speed cap with smooth clamping
- `[x]` Integrate with R3F render loop (useFrame)

### Camera System
- `[x]` Create `src/systems/CameraController.ts`
- `[x]` Third-person follow camera with spring damping
- `[x]` 4 distance presets (keys 1-4): close, medium, far, cinematic
- `[x]` Lock camera behind (Z key) — snap to velocity vector
- `[x]` Free-look toggle (X key) — decouple camera from movement
- `[x]` Look behind (C key, hold)
- `[x]` Auto-orient (T key) — snap to galactic "up"

### Gravity Wells & Passive Drift
- `[x]` Create `src/systems/GravitySystem.ts`
- `[x]` Calculate attraction for each world: `G * worldMass / distance²`
- `[x]` `worldMass = f(playerCount, objectCount, age)`
- `[x]` Aweborn Portal has strongest pull (fixed high mass)
- `[x]` Visual: faint curved field lines near worlds (GravityFieldLines.tsx)
- `[x]` Captured orbit: auto-settle into gentle orbit when velocity is low enough
- `[x]` Gravitational slingshot: high-velocity pass → speed boost + dramatic path curve

### Warp Mechanic
- `[x]` Lock-on system (J key): target nearest world/player, cycle with repeated taps
- `[x]` Target indicator UI (arrow/dot showing locked target direction + distance)
- `[x]` Warp charge (K key hold):
  - Visual: star compresses, light bends inward, stars streak
  - Audio: rising pitch
  - Charge meter (1-3 seconds)
- `[x]` Warp release (K key release):
  - Visual: light-speed blur, stars become lines → bright flash at destination
  - Audio: satisfying crack
- `[x]` Arrive near target in gravity well with residual velocity

### Context Switching (Universe → World Interior)
- `[x]` Press N while orbiting → enter world
- `[x]` Remap controls per ROADMAP spec:
  - V=jump, W/E=look, Q/R=move, A/F=strafe, S=backward, Space=crouch, K=sprint
- `[x]` Press Escape or fly to world boundary → exit world
- `[x]` Transition animation (zoom in → dissolve → world interior)
- `[x]` Broadcast presence change via awareness protocol (`inWorld: worldId`)

### Touch Input (Mobile)
- `[x]` Create `src/systems/TouchInputAdapter.ts`
- `[x]` Left thumb virtual joystick → Q/R/W/E (steering)
- `[x]` Right thumb zone hold → V (thrust)
- `[x]` Two-finger tap → Space (brake)
- `[x]` Tap on world → N (interact)
- `[x]` Long-press on locked target → K (warp)
- `[x]` Swipe gestures right side → U/I/O/P (mod slots)

### Gamepad Support
- `[x]` Create `src/systems/GamepadInputAdapter.ts`
- `[x]` Gamepad API (`navigator.getGamepads()`) auto-detection
- `[x]` Mapping per ROADMAP spec (left stick=steer, RT=thrust, LT=brake, etc.)
- `[x]` Analog pressure for thrust/brake

### Star Mod Slots (Cosmetic)
- `[x]` U=Trail (comet, sparkle, ribbon, helix, none) — cycle on tap
- `[x]` I=Aura (glow, pulse, rings, flame, none)
- `[x]` O=Shape (sphere, crystal, spiral, spike, jellyfish)
- `[x]` P=Emote/Signal (wave, SOS, beacon, celebration burst)
- `[ ]` Hold = quick-select radial (rendered in-game, not UI menu) — deferred

## Acceptance Criteria

- [ ] Player can fly smoothly through the universe with keyboard (WASD+QR+V)
- [ ] Drift feels natural — releasing thrust coasts, brake decelerates
- [ ] Gravity wells pull the player toward active worlds
- [ ] Warp mechanic works: lock → charge → leap with visual/audio feedback
- [ ] Can enter/exit worlds with N key — controls remap correctly
- [ ] Touch controls work on mobile (virtual joystick + gestures)
- [ ] Gamepad auto-detected and functional
- [ ] Camera follows smoothly with adjustable distance

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/systems/InputManager.ts` | NEW | Unified input → action mapping |
| `src/systems/FlightController.ts` | NEW | 6DOF flight physics |
| `src/systems/CameraController.ts` | NEW | Third-person camera with presets |
| `src/systems/GravitySystem.ts` | NEW | Gravity wells, drift, slingshot |
| `src/systems/WarpSystem.ts` | NEW | Lock-on + warp charge/leap |
| `src/systems/TouchInputAdapter.ts` | NEW | Mobile touch → keyboard translation |
| `src/systems/GamepadInputAdapter.ts` | NEW | Gamepad → keyboard translation |
| `src/components/HUD.tsx` | MODIFY | Add target indicator, warp charge UI |
| `src/components/Scene.tsx` | MODIFY | Integrate flight controller, camera |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| 2026-08-21 | Session 1: Built InputManager (keyboard→action map with context switching), FlightController (6DOF with inertia/drift/brake/speed cap), CameraController (spring-damped 3rd-person with 4 presets + lock/free/look-behind), GravitySystem (inverse-square from CRDT worlds + Portal + orbit capture + slingshot), PlayerOrb (local player with comet trail). Replaced OrbitControls in Scene.tsx with full flight pipeline. Added HUD speed bar, mode indicator, controls hints, crosshair. TS + Vite build clean. | Session 2: Warp mechanic (lock-on + charge + leap), gravity field lines visual, transition animation for world entry |
| 2026-08-21 | Sessions 2-3: Built WarpSystem (lock-on targeting, charge/leap with cubic ease, residual velocity arrival), WarpEffect (charge streaks, leap flash, arrival particles), WorldTransition (CSS-based white flash overlay on enter/exit), GravityFieldLines (CatmullRom splines near worlds), TouchInputAdapter (left joystick + right thrust + two-finger brake), GamepadInputAdapter (full Gamepad API with analog sticks/triggers), StarModSlots (trail/aura/shape/emote with sessionStorage persistence), updated PlayerOrb with mod-driven shape/trail/aura switching, updated HUD with lock indicator + warp charge ring + mod slot display. TS + Vite build clean. | Phase 04 complete → Phase 05 (Mana Economy) |
