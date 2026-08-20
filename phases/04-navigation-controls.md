# Phase 04: Navigation & Controls

**Status:** `[ ]` Not Started
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
- `[ ]` Create `src/systems/InputManager.ts` — unified input handler
- `[ ]` Keyboard event capture (keydown/keyup → action map)
- `[ ]` Define action map matching ROADMAP spec:
  - Left hand: V=thrust, Space=brake, W/E=pitch, Q/R=yaw, A/F=roll, S=reverse, etc.
  - Right hand: N=interact, U/I/O/P=mod slots, J=lock-on, K=warp, L=scan, etc.
- `[ ]` Action state object (pressed/released/held) updated each frame
- `[ ]` Context switching: universe controls ↔ world interior controls (same keys, different actions)

### Flight Model
- `[ ]` Create `src/systems/FlightController.ts`
- `[ ]` 6DOF movement: thrust, pitch, yaw, roll with acceleration/deceleration curves
- `[ ]` Inertia: releasing thrust → gradual slowdown (drift state)
- `[ ]` Brake: active deceleration
- `[ ]` Reverse thrust: for fine positioning
- `[ ]` Lateral strafe (D key)
- `[ ]` Speed cap with smooth clamping
- `[ ]` Integrate with R3F render loop (useFrame)

### Camera System
- `[ ]` Create `src/systems/CameraController.ts`
- `[ ]` Third-person follow camera with spring damping
- `[ ]` 4 distance presets (keys 1-4): close, medium, far, cinematic
- `[ ]` Lock camera behind (Z key) — snap to velocity vector
- `[ ]` Free-look toggle (X key) — decouple camera from movement
- `[ ]` Look behind (C key, hold)
- `[ ]` Auto-orient (T key) — snap to galactic "up"

### Gravity Wells & Passive Drift
- `[ ]` Create `src/systems/GravitySystem.ts`
- `[ ]` Calculate attraction for each world: `G * worldMass / distance²`
- `[ ]` `worldMass = f(playerCount, objectCount, age)`
- `[ ]` Aweborn Portal has strongest pull (fixed high mass)
- `[ ]` Visual: faint curved field lines near worlds, warm audio hum
- `[ ]` Captured orbit: auto-settle into gentle orbit when velocity is low enough
- `[ ]` Gravitational slingshot: high-velocity pass → speed boost + dramatic path curve

### Warp Mechanic
- `[ ]` Lock-on system (J key): target nearest world/player, cycle with repeated taps
- `[ ]` Target indicator UI (arrow/dot showing locked target direction + distance)
- `[ ]` Warp charge (K key hold):
  - Visual: star compresses, light bends inward, stars streak
  - Audio: rising pitch
  - Charge meter (1-3 seconds)
- `[ ]` Warp release (K key release):
  - Visual: light-speed blur, stars become lines → bright flash at destination
  - Audio: satisfying crack
- `[ ]` Arrive near target in gravity well with residual velocity

### Context Switching (Universe → World Interior)
- `[ ]` Press N while orbiting → enter world
- `[ ]` Remap controls per ROADMAP spec:
  - V=jump, W/E=look, Q/R=move, A/F=strafe, S=backward, Space=crouch, K=sprint
- `[ ]` Press Escape or fly to world boundary → exit world
- `[ ]` Transition animation (zoom in → dissolve → world interior)
- `[ ]` Broadcast presence change via awareness protocol (`inWorld: worldId`)

### Touch Input (Mobile)
- `[ ]` Create `src/systems/TouchInputAdapter.ts`
- `[ ]` Left thumb virtual joystick → Q/R/W/E (steering)
- `[ ]` Right thumb zone hold → V (thrust)
- `[ ]` Two-finger tap → Space (brake)
- `[ ]` Tap on world → N (interact)
- `[ ]` Long-press on locked target → K (warp)
- `[ ]` Swipe gestures right side → U/I/O/P (mod slots)

### Gamepad Support
- `[ ]` Create `src/systems/GamepadInputAdapter.ts`
- `[ ]` Gamepad API (`navigator.getGamepads()`) auto-detection
- `[ ]` Mapping per ROADMAP spec (left stick=steer, RT=thrust, LT=brake, etc.)
- `[ ]` Analog pressure for thrust/brake

### Star Mod Slots (Cosmetic)
- `[ ]` U=Trail (comet, sparkle, ribbon, helix, none) — cycle on tap
- `[ ]` I=Aura (glow, pulse, rings, flame, none)
- `[ ]` O=Shape (sphere, crystal, spiral, spike, jellyfish)
- `[ ]` P=Emote/Signal (wave, SOS, beacon, celebration burst)
- `[ ]` Hold = quick-select radial (rendered in-game, not UI menu)

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
| — | — | — |
