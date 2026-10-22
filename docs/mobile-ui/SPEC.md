# Aweborn: mobile UI spec (grill, 2026-10-21)

Prototype: [`public/proto/mobile-ui.html`](../../public/proto/mobile-ui.html) (live at aweborn.org/proto/mobile-ui.html). Mockups: [space](./mock-space-portrait.jpg), [world](./mock-world-portrait.jpg) (generated, mood only; the spec wins).

Portrait phone (390 × 844) first. One layout to learn: **the same positions mean the same things in space and in a world.**

## The layout at a glance

```
┌──────────────────────────────────────┐
│ [Radar]                [Place · ✦mana]│  ← top: info only
│  (world: radar hidden)  tap = account │
│                         hold = Leave  │
│                         (worlds only) │
│                                      │
│              3D world                │
│                                      │
│  chat line (faded)                   │
│  chat line (faded)        [DRIVE]    │  ← mode pill (space only)
│                     [ ENTER / KICK ] │  ← contextual (only when actionable)
│                     [ WARP ] (locked)│
│   ( stick )                ( THRUST )│  ← thumbs
│              🗺  💬  🧱  •••          │  ← dock (between thumbs)
└──────────────────────────────────────┘
```

| Zone | Space | World |
| --- | --- | --- |
| **Left thumb** | Floating stick = steer (yaw / pitch) | Floating stick = move (walk / strafe); edge of stick = sprint |
| **Right side (drag)** | Drag = look / orbit camera | Drag = look |
| **Right thumb button** | **THRUST** (hold; slide down on it = brake) | **JUMP** (tap); hold in the air = jetpack |
| **Contextual button** (above thumb) | ENTER (near a world) | KICK / PICK UP (near object) · SET DOWN (holding) |
| **Second button** | WARP (hold to charge), only while locked on | Held-item strip ⟲ ⟳ − + while holding |
| **Mode pill** | DRIVE / NEUTRAL | — |
| **Two fingers** | Pinch = camera zoom (close ↔ far) | Pinch = zoom · while holding: twist = rotate, pinch = scale |
| **Top-left** | Radar (tap = expand, tap blip = lock on) | Hidden |
| **Top-right** | Place + mana pill → Account / Mana | Same; **hold 0.6 s = Leave world** (ring fills) |
| **Dock** | 🗺 World Index · 💬 Chat · ••• More | 🗺 World Index · 💬 Chat · 🧱 Make · ••• More |

## Every ability → its touch control → what it opens

### Movement & camera
| Ability (key) | Touch | Notes |
| --- | --- | --- |
| Thrust / reverse (W/S) | THRUST button hold; slide down = brake | Replaces "right half = thrust" |
| Steer yaw/pitch/roll (Q/E/R/F, A/D) | Left stick | Roll: auto-orient handles it |
| Brake (Space) | Slide down on THRUST | No separate BRAKE button |
| Warp (K) | WARP hold button, appears only when locked on | Also "Warp here" in World Index |
| Drive / Neutral (G) | Mode pill | |
| Auto-orient (T) | Always on for touch | Dropped |
| Camera 1/2/3 | Pinch zoom | |
| Cinematic, Lock behind, Free look, Look behind (4/Z/X/C) | — | Dropped on touch |
| Walk / strafe (world) | Left stick | |
| Turn / look (world) | Right-side drag | |
| Jump (Space) / jetpack | JUMP tap / hold in air | |
| Sprint (K) | Push stick to its edge | |
| Leave world (Esc) | Fly up past the sky **or** hold place pill | Fly-out = diegetic way |

### Interact
| Ability | Touch | Opens |
| --- | --- | --- |
| Enter world (N) | Contextual ENTER | World transition |
| Kick (N, world) | Contextual KICK | — |
| Pick up / set down (G, world) | Contextual PICK UP / SET DOWN | Held-item strip |
| Rotate / grow / shrink held (Z/X/=/−) | Strip ⟲ ⟳ − + · twist / pinch | — |
| Lock on (J) | Tap planet or radar blip | Target chip (replaces LOCK button) |
| Chat (Enter) | Dock 💬 | Input pinned above keyboard + half-sheet log; last 3 lines float faded above dock |

### Panels
| Panel (key) | Touch entry | Form on phone |
| --- | --- | --- |
| World Index (M) | Dock 🗺 | Bottom sheet |
| Library (B) + Create (C) + Planner (P) | Dock 🧱 **Make** (world only) | One half-height sheet, tabs: Blocks · Shapes · Made \| Create · Plan; guests see the mana seal on Create/Plan; picking an item puts it in hand and closes the sheet |
| Account / Mana tracker | Place pill tap | Bottom sheet |
| Scan (L), Trail/Aura/Shape/Emote (U/I/O/P) | ••• More → **Me** | |
| Display settings, FPS overlay | ••• More → **Settings** | (gear + FPS leave the HUD) |
| Fullscreen | Auto-prompt once on first touch, then ••• More | Add to Home Screen nudge after a card tap |
| Keys & controls (H) | ••• More → Controls (touch legend) | |
| Donate / Give | ••• More | |

## Landscape & desktop
- **Landscape:** same pieces (stick bottom-left, THRUST/JUMP bottom-right, dock bottom-center); sheets become right-side panels ≤ 50% width.
- **Desktop:** keyboard + mouse; same dock with `<kbd>` hints; no stick / thrust button.

## Layout debt this resolves
- Jump and forward both on the right thumb → move on left stick, jump on right button.
- Steer zone over radar (landscape) → steer is a floating stick in the lower-left only.
- Origin target chip over World Index chip → World Index moves to the dock; target chip sits above the contextual button.
- Top bar tight at 390 px → top holds only radar + one pill.

## Open (not decided yet)
- Where the target chip and arrival toasts sit exactly (proposal: centered, just under the top bar).
- Fly-out ceiling height and the transition animation.
- Onboarding hints (Step 5) point at: stick, THRUST, ENTER.
