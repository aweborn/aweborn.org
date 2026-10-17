# Phase 04: Navigation & Controls

**Status:** `[x]` Complete† (warp sign-off, on-device touch, and physical gamepad verification deferred)
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
- `[x]` Remap controls per ROADMAP spec (action map only):
  - V=jump, W/E=look, Q/R=move, A/F=strafe, S=backward, Space=crouch, K=sprint
  - ⚠️ *The InputManager context switch exists, but **player movement inside world interiors is not implemented** (Alex, Aug 24: "we haven't even setup movement in the inner worlds"). Moved to [Phase 07 → Interior Movement & Physics](./07-genai-creation.md#interior-movement--physics).*
- `[x]` Press Escape or fly to world boundary → exit world
- `[x]` Transition animation (zoom in → dissolve → world interior)
- `[x]` Broadcast presence change (`inWorld: worldId`) — *via custom presence messages, not Yjs awareness*

### Touch Input (Mobile)
- `[x]` Create `src/systems/TouchInputAdapter.ts`
- `[x]` Left thumb virtual joystick → yaw/pitch (analog since 2026-10-16)
- `[x]` Right thumb zone hold → V (thrust)
- `[~]` ~~Two-finger tap → Space (brake)~~ → replaced by a BRAKE button (2026-10-16; it blocked steer + thrust)
- `[~]` Tap on world → N (interact): *never built*; ENTER button instead (2026-10-16)
- `[~]` Long-press on locked target → K (warp): *never built*; LOCK + hold-WARP buttons instead (2026-10-16)
- `[ ]` Swipe gestures right side → U/I/O/P (mod slots): *never built*

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

### Polish (Aug 22–24, 2026 — added after initial completion)
- `[x]` FPS monitor on HUD
- `[x]` HUD keymap mirrors physical keyboard layout; keys light up on press
- `[x]` Flight feel retuned for control: more immediate response, ~100ms settle at end of key press, gravity wells kept
- `[x]` "Where is home" indicator (`PortalBeacon.tsx`)
- `[x]` 3D-aware radar minimap (`RadarMinimap.tsx`), real-time updates. *Camera-synchronized radar was attempted and reverted (dropped 120 → 30–70 fps); radar must never cost frame rate.*
- `[x]` LOD Close threshold raised; landmark islands removed (see Phase 03)
- `[x]` Cross-browser player presence via sync-service WebSocket relay (msg `0x09`)
- `[x]` CRDT dev panel shown in production as a temporary world list (until the World Index, Phase 08)
- `[x]` Stripe donation flow switched back from sandbox to live

### Mobile Play Optimization (side item, opened 2026-10-16; not the priority)

First real on-device playtest (Alex, 2026-10-16). It felt "reeeeally clunky". What he reported, and what the code shows:

| # | Symptom (Alex) | Root cause in `src/systems/TouchInputAdapter.ts` |
|---|----------------|--------------------------------------------------|
| 1 | Tapping almost never works | A window-level `touchstart` listener (`passive: false`) calls `preventDefault()` on every touch in the left 40% and right 40% of the screen. That cancels the browser's synthesized `click`, so buttons in those zones (incl. the DRIVE/NEUTRAL toggle at top-left, HUD chips) never fire. It doesn't check whether the touch started on UI. |
| 2 | Only one finger at a time, so you can't steer and thrust together | When a 2nd finger lands, `e.touches.length >= 2` sets **brake** and `continue`s, so the thrust finger is never registered. "Two-finger tap = brake" collides with "left steers + right thrusts". |
| 3 | No way to toggle Drive/Neutral (no G key, tap broken) | Follows from #1: the toggle button sits inside the left zone. |
| 4 | Left stick too small and jittery; small moves don't turn the camera slowly | 60 px max travel and 80 px base, and the stick is **digital**: it sets `yawLeft/Right`, `pitchUp/Down` booleans past a 15% deadzone, so any deflection = full turn rate. `FlightController` only reads booleans (`actions.yawLeft` → `+= turnRate`). There's no analog axis in `InputManager` (the gamepad adapter's "analog" sticks have the same limit). |

Also: the Touch Input checklist above marks tap-on-world → N, long-press → K and swipe → U/I/O/P as done, but none of them exist in the adapter. Treat them as **not built**.

**Plan** (each step testable on a phone over the LAN dev server):
- `[x]` **M1. Stop eating taps.** Pointer Events; only touches whose target is inside `.canvas-container` drive flight, and the adapter never calls `preventDefault` on them (`touch-action: none` on the canvas already blocks scroll/zoom). Buttons and HUD chips get their own touches.
- `[x]` **M2. True multi-touch.** Each finger tracked by `pointerId`: stick, thrust and any button at once. "Two-finger = brake" dropped; BRAKE is a hold button.
- `[x]` **M3. Analog steering.** `InputManager.setAxis/getAxis` (`yaw`, `pitch`, per source `touch`/`gamepad`, cleared with the action state) + exported `shapeAxis(value, deadzone, exponent)`. `FlightController` turn rate = (keys ±1 + axis), clamped. Gamepad left stick now feeds it too. Thrust stays digital (hold).
- `[x]` **M4. Bigger, steadier stick.** Radius = 16% of the short screen side (56–80 px, so 112–160 px across), deadzone 10%, curve exponent 1.8, floating origin that follows the thumb past the rim, exponential smoothing (τ 50 ms) in a rAF loop, no CSS transition. Released = instant stop, like a key.
- `[x]` **M5. On-screen action buttons.** Right-thumb cluster: DRIVE/NEUTRAL pill on top, then ENTER (N), LOCK (J), WARP (hold K), BRAKE (hold Space). EXIT (Escape) appears inside worlds; the flight controls hide there and behind modals. Taps hold the action ≥ 90 ms so edge-triggered actions never miss a frame. World Index uses its existing HUD chip (now tappable).
- `[x]` **M5b. Pull back to brake** (Alex's request, 2026-10-16). The thrust thumb anchors where it lands; dragging it ≥ 36 px down swaps thrust for brake, and coming back above 24 px resumes thrust (hysteresis). The ring blends orange → deep red as you pull (`--pull` 0–1), then glows steady dark red while braking. It works alongside the BRAKE button: neither one releases a brake the other is still holding.
- `[x]` **M6. Phone basics.** `html.touch-ui`: no overscroll, text selection (except inputs), long-press callout, tap flash or double-tap zoom; iOS `gesturestart` blocked; safe-area insets on the overlay. Keyboard map, HUD G-label and key-letter mod slots hidden on touch. Activation is now `(pointer: coarse)`, so touchscreen laptops keep the desktop UI.
- `[ ]` **M7. On-device sign-off** (iOS Safari + Android Chrome). Clears the deferred "touch controls work on mobile" criterion below.

**How it was tested (2026-10-16):** headless Chrome in phone emulation (844×390, `hasTouch`, `isMobile`) driven by Playwright, with simultaneous touch points sent over CDP `Input.dispatchTouchEvent` and the live `inputManager` / `flightController` singletons read via `import('/src/systems/…')` from the Vite dev server. Results: a small stick move gives yaw 0.036 (slow turn), a large one 0.83 / pitch 0.55; steer + thrust together gives 12 u/s; pressing DRIVE with both thumbs down flips to NEUTRAL without dropping either; BRAKE + thrust together both register; lifting all fingers zeroes everything; tapping the World Index chip in the left zone opens it (it was swallowed before). No page errors. Gotchas: the dev-only Multiplayer Dev panel covers the right half in dev builds (toggle with `` ` ``); CDP `touchEnd` lifts every finger. Script: `brain/11ca687c-…/scratch/touchtest/touch-test.mjs` (not in the repo).

## Acceptance Criteria

- [x] Player can fly smoothly through the universe with keyboard (WASD+QR+V) *(verified in-browser by Alex, Aug 22–24)*
- [x] Drift feels natural — releasing thrust coasts, brake decelerates *(retuned Aug 22 per Alex's feedback)*
- [x] Gravity wells pull the player toward active worlds *(verified; remote players' positions update under gravity after Aug 24 fix)*
- [ ] Warp mechanic works: lock → charge → leap with visual/audio feedback *(built Aug 21; explicit sign-off not recorded — verify)*
- [x] Can enter/exit worlds with N key — *universe-side entry/exit verified; interior movement not implemented (→ Phase 07)*
- [ ] Touch controls work on mobile (virtual joystick + gestures) *(built; on-device verification deferred)*
- [ ] Gamepad auto-detected and functional *(built; physical controller verification deferred)*
- [x] Camera follows smoothly with adjustable distance

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
| `src/components/RadarMinimap.tsx` | NEW | 3D radar (polish) |
| `src/components/PortalBeacon.tsx` | NEW | Home indicator (polish) |
| `src/hooks/usePresence.ts` | MODIFY | WebSocket relay presence (polish) |
| `server/sync-service/src/rooms.ts` | MODIFY | `relayPresence` (polish) |
| `src/App.tsx` | MODIFY | CRDT overlay in production (polish) |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| 2026-08-21 | Session 1: Built InputManager (keyboard→action map with context switching), FlightController (6DOF with inertia/drift/brake/speed cap), CameraController (spring-damped 3rd-person with 4 presets + lock/free/look-behind), GravitySystem (inverse-square from CRDT worlds + Portal + orbit capture + slingshot), PlayerOrb (local player with comet trail). Replaced OrbitControls in Scene.tsx with full flight pipeline. Added HUD speed bar, mode indicator, controls hints, crosshair. TS + Vite build clean. | Session 2: Warp mechanic (lock-on + charge + leap), gravity field lines visual, transition animation for world entry |
| 2026-08-21 | Sessions 2-3: Built WarpSystem (lock-on targeting, charge/leap with cubic ease, residual velocity arrival), WarpEffect (charge streaks, leap flash, arrival particles), WorldTransition (CSS-based white flash overlay on enter/exit), GravityFieldLines (CatmullRom splines near worlds), TouchInputAdapter (left joystick + right thrust + two-finger brake), GamepadInputAdapter (full Gamepad API with analog sticks/triggers), StarModSlots (trail/aura/shape/emote with sessionStorage persistence), updated PlayerOrb with mod-driven shape/trail/aura switching, updated HUD with lock indicator + warp charge ring + mod slot display. TS + Vite build clean. | Phase 04 complete → Phase 05 (Mana Economy) |
| 2026-08-22 | Polish: FPS monitor; diagnosed CI deploy (Node 20 vs `camera-controls` requiring Node 22); HUD keymap in keyboard layout with live key highlighting; flight retuned for control (~100ms settle); home indicator. | Continue polish |
| 2026-08-23 | Polish: raised LOD Close threshold so worlds render in full when in view; removed landmark islands. | — |
| 2026-08-24 | Polish: CRDT dev panel in prod (temporary world list); Stripe back to live; radar rebuilt for 3D + real-time (camera-sync attempt reverted for perf); cross-browser presence via WebSocket relay; remote positions under gravity fixed; CI unused-var fixes. Deployed. | Phase 05 |
| 2026-10-03 | Plan reconciliation: acceptance criteria checked per verified sessions; interior movement gap moved to Phase 07. | Touch/gamepad device verification still deferred |
| 2026-10-10 | Landed Alex's unfinished slingshot work (approach drag, slingshot exit impulse + `SlingshotArc` visual, orb pulse, touch DRIVE/NEUTRAL toggle, fixed 60Hz physics substeps). Fixed the "can't escape the well" bug: the slingshot boost was multiplying the *inward* pull up to ~21×, and with `G=10` near-body gravity (~62 u/s² at the Portal) beat max thrust (10 u/s²). Gravity is now capped at `MAX_GRAVITY_ACCEL = 8` (below thrust), per body and in total. Added `scripts/sim/gravity-escape.ts` (headless escape + flyby checks; all pass). | Playtest slingshot feel in NEUTRAL; tune `SLINGSHOT_IMPULSE_MULTIPLIER` / `G`; wire `slingshotEvent` to mana (Phase 05) |
| 2026-10-16 | Alex's first on-device touch playtest: taps rarely work, one finger only (can't steer + thrust), no way to toggle Drive/Neutral, left stick small and jittery. Diagnosed in `TouchInputAdapter.ts` (window-level `preventDefault` eats clicks; 2nd finger becomes brake; digital stick with no analog path). Found tap/long-press/swipe gestures marked done but never built. Wrote the **Mobile Play Optimization** plan (M1–M7). No code yet. | Side item, not the priority: start at M1 when Alex picks it up |
| 2026-10-16 | **Built M1–M6** (same evening, Alex: "please implement"). `TouchInputAdapter.ts` rewritten on Pointer Events (canvas-only claiming, per-finger tracking, floating analog stick with smoothing, thrust ring, button cluster, world EXIT, hide behind modals). `InputManager` analog axes + `shapeAxis`; `FlightController` scales turn rate; gamepad stick analog too. `index.css` touch overlay + phone basics. Verified with Playwright multi-touch emulation (numbers in the plan above). `tsc -b` + oxlint clean. | **M7:** Alex plays on his phone (LAN dev server `http://<mac-ip>:5174` or after deploy). Tune stick radius / curve / smoothing by feel. Portrait layout not yet checked. |
| 2026-10-16 | Alex tried it on his phone over LAN: "holy cow! That was so cool!" Asked for full screen. Added a **fullscreen button** (top-right, under FPS): Fullscreen API + landscape lock where supported (Android Chrome, iPad). **iPhone Safari has no page fullscreen**, so there the button explains *Share → Add to Home Screen*; launching from the home screen opens with no browser UI (`apple-mobile-web-app-capable`, status bar `black-translucent`, manifest `display: fullscreen` + `display_override`). Button hidden when already installed. `viewport-fit=cover` so the game fills notched screens; `.hud-overlay` now insets by `env(safe-area-inset-*)`. Tested: tap enters fullscreen, label flips to "Exit full screen"; earlier multi-touch checks unchanged. | Alex: try the fullscreen button / Add to Home Screen on his phone; check notch + portrait |
| 2026-10-16 | Committed + deployed M1–M6 + fullscreen (`5ea9152`). Alex: "the donate menu just doesn't fit in landscape". The **donation modal** now caps at the screen height and scrolls inside it; on short landscape screens the amount step goes two columns (title + blurb left, amounts + Continue right) and fits in about 285 px. **Pull back to brake** on the thrust thumb (M5b) with an orange → dark-red ring. Tested with Playwright: thrust → brake at 40 px, still braking at 30 px, thrust again at 20 px, all clear on lift; no page errors. `tsc` clean. | Commit + deploy; Alex tries brake-by-pull on his phone (tune `BRAKE_PULL_PX` by feel); M7 sign-off |
| 2026-10-16 | **Portrait fix** (portrait-only rules under `html.touch-ui`). Fixed overlaps: the lock-on target pill now sits below the top row (it was covering World Index / UNIVERSE); the radar shrinks to 112 px; STEER hint sits above the radar; THRUST hint moved to the right, above the button cluster (it was on the left, over STEER). **Removed the gold "Support Our Mission — Donate Now" banner** (Alex: tacky). Page, Open Graph and Twitter titles changed from "Aweborn — Support Our Mission" to "Aweborn — Explore the Cosmos" (descriptions trimmed to match; the Terms wording is unchanged). The desktop "Click the glowing portal" hint is hidden on touch. The Portal still opens donations. Checked at 390×844 and 360×740: no overlaps, no page errors; `tsc -b` clean. | Commit + deploy; Alex checks portrait on his phone; M7 sign-off |
