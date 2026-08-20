# Phase 5 — Polish, Scale & World Building

> **Parent:** [MASTER_PLAN.md](./MASTER_PLAN.md)
> **Status:** 🔴 Not Started
> **Goal:** World interior building tools, physics, anti-cheat, performance optimization, and launch readiness.
> **Prerequisites:** Phases 2, 3, and 4 substantially complete

---

## Phase Summary

This is the integration and polish phase. All the infrastructure from previous phases comes together into the final experience. Players can build inside worlds, objects have physics, the server validates everything, voice chat works, and the whole thing performs well at scale.

---

## Milestones

### M5.1 — World Building Tools
**Status:** 🔴 Not Started
**Effort:** 3-4 sessions
**Dependencies:** Phase 1 (M1.3 — World CRDTs), Phase 2 (M2.5 — world entry)

#### What
- Object placement UI inside world interiors
- Basic primitives: cube, sphere, ramp, cylinder, wedge
- Material/color picker
- Grab, move, rotate, scale objects
- All changes sync via the world's `Y.Map("objects")` CRDT

#### Acceptance Criteria
- [ ] Player can place primitives in a world interior
- [ ] Objects appear for all players in the world in real time
- [ ] Objects can be moved, rotated, scaled
- [ ] Material/color picker works
- [ ] Mana cost applied (if world is solidified) or free (if Ghost)

#### Tasks
```
- [ ] Create src/components/world/BuildToolbar.tsx — object placement UI
- [ ] Primitive generators: cube, sphere, ramp, cylinder, wedge
- [ ] Grab/move/rotate/scale interaction system
- [ ] Material picker: basic colors and textures
- [ ] CRDT write: each placement writes to Y.Map("objects")
- [ ] CRDT read: render all objects from CRDT state
- [ ] Mana cost integration: check solidified state, deduct if needed
- [ ] Undo/redo via CRDT (Yjs UndoManager)
```

---

### M5.2 — Per-World Physics
**Status:** 🔴 Not Started
**Effort:** 1-2 sessions
**Dependencies:** M5.1

#### What
- Each world reads physics params from its `Y.Map("physics")` CRDT
- Configurable: gravity (X/Y/Z), friction, bounce, air resistance, water level
- Client-side physics simulation using the CRDT parameters
- World creators can change physics rules (costs mana in solidified worlds)

#### Acceptance Criteria
- [ ] Different worlds have different gravity (e.g., Earth, Moon, zero-G)
- [ ] Changing physics params in CRDT updates simulation for all players
- [ ] Player avatar responds to world-specific gravity
- [ ] Physics param changes cost mana in solidified worlds

#### Tasks
```
- [ ] Integrate lightweight physics engine (cannon-es or rapier-wasm)
- [ ] Read physics params from Y.Map("physics") on world entry
- [ ] Apply params to physics engine configuration
- [ ] World settings UI: sliders for gravity, friction, etc.
- [ ] Mana cost check for physics modifications
```

---

### M5.3 — Event-Sourced Interactive Physics
**Status:** 🔴 Not Started
**Effort:** 2 sessions
**Dependencies:** M5.2

#### What
Objects that players can push/kick, with deterministic replay across clients:

1. At rest: stored in CRDT with position
2. Player kicks: velocity vector written to CRDT
3. All clients simulate same trajectory from same initial conditions
4. Object settles: activating client writes final position

#### Acceptance Criteria
- [ ] Pushing an object sends it flying for all players
- [ ] All clients see approximately the same trajectory
- [ ] Object resting position is canonical (written by activating client)
- [ ] Chain reactions work (object A hits B → B activates)

#### Tasks
```
- [ ] Object state machine: resting ↔ active
- [ ] On kick: write velocity vector + activatedBy to CRDT
- [ ] Simulation: all clients run deterministic physics from CRDT initial conditions
- [ ] On settle: activating client writes final rest position to CRDT
- [ ] Chain reaction: collision detection triggers new activation events
```

---

### M5.4 — Server Validation & Anti-Cheat
**Status:** 🔴 Not Started
**Effort:** 2 sessions
**Dependencies:** M5.1, Phase 3 (M3.1 — mana validation)

#### What
Client-side prediction with server reconciliation:

- Client validates locally and renders immediately
- Server runs authoritative check
- If server rejects → client reverts (rubberbanding)
- Validates: object placements, mana draws, player positions, physics

#### Acceptance Criteria
- [ ] Tampered object placements are rejected and reverted
- [ ] Invalid mana draws are denied with "universe needs more energy" message
- [ ] Impossible player positions are corrected (rubberbanding)
- [ ] Legitimate actions feel instant (no perceived lag from validation)

#### Tasks
```
- [ ] Server: validate CRDT writes against rules (bounds, permissions, mana)
- [ ] Server: position validation at 0.5-2Hz (simple bounds/physics check)
- [ ] Client: prediction/reconciliation — render optimistically, handle rejections
- [ ] Rejection UX: gentle revert animation, not jarring
- [ ] Mana denial UX: "The universe needs more energy" message
```

---

### M5.5 — Spatial Sectoring & Performance
**Status:** 🔴 Not Started
**Effort:** 2-3 sessions
**Dependencies:** Phase 2 (M2.1 — LOD), Phase 1 (M1.1 — rooms)

#### What
- Universe chunked into 3D sectors for scalability
- Players only subscribe to nearby sectors
- `InstancedMesh` for distant worlds (single draw call for thousands)
- Memory management: unload distant sector data
- Performance profiling and optimization pass

#### Acceptance Criteria
- [ ] 10,000+ worlds render at 60fps on mid-range hardware
- [ ] Sector subscription automatically updates as player moves
- [ ] Memory usage stays bounded regardless of universe size
- [ ] No frame drops during sector transitions

#### Tasks
```
- [ ] Define sector grid (size, coordinate mapping)
- [ ] Dynamic sector subscription based on player position
- [ ] InstancedMesh rendering for far-range worlds
- [ ] Memory management: LRU cache for sector CRDT data
- [ ] Performance profiling: Chrome DevTools, GPU timing
- [ ] Optimization pass: identify and fix bottlenecks
```

---

### M5.6 — Object Removal Governance
**Status:** 🔴 Not Started
**Effort:** 1 session
**Dependencies:** M5.1

#### What
3-tier permission model from ROADMAP.md:
1. **Creator:** Ultimate power over their world
2. **Placer:** Can delete/move objects they placed
3. **Co-Creator:** Granted by world creator, can delete/move anything

#### Acceptance Criteria
- [ ] World creator can delete any object in their world
- [ ] Players can only delete objects they placed (unless Co-Creator)
- [ ] World creator can grant/revoke Co-Creator status
- [ ] Server enforces permissions on CRDT writes

#### Tasks
```
- [ ] Add permissions map to World CRDT: Y.Map("permissions")
- [ ] Permission check on object delete/move operations
- [ ] Co-Creator management UI for world creators
- [ ] Server-side permission enforcement
```

---

### M5.7 — Star Customization & Emotes
**Status:** 🔴 Not Started
**Effort:** 1-2 sessions
**Dependencies:** Phase 2 (M2.3 — right-hand controls), Phase 3 (M3.6 — donor cosmetics)

#### What
- Trail styles: comet, sparkle, ribbon, helix
- Aura effects: glow, pulse, rings, flame
- Star shapes: sphere, crystal, spiral, spike, jellyfish
- Emotes: wave, SOS, beacon, celebration burst
- Donor-exclusive variants

#### Acceptance Criteria
- [ ] Players can customize their star appearance
- [ ] Customizations visible to other players
- [ ] Donor-exclusive options locked for free players
- [ ] Emotes trigger visible effects

#### Tasks
```
- [ ] Trail renderer: multiple trail styles as shader options
- [ ] Aura renderer: multiple aura effects
- [ ] Star shape variants: geometry swaps
- [ ] Emote effects: particle bursts, visual signals
- [ ] Persistence: save customization to player profile
- [ ] Donor gating: check lifetime donations for exclusive options
```

---

### M5.8 — Voice & Chat
**Status:** 🔴 Not Started
**Effort:** 2 sessions
**Dependencies:** Phase 4 (M4.2 — WebRTC), Phase 1 (M1.3 — World CRDTs)

#### What
- WebRTC voice channels (push-to-talk via . key)
- In-world text chat via `Y.Array("chat")` CRDT
- Quick chat wheel (M key) with preset messages

#### Acceptance Criteria
- [ ] Push-to-talk voice works between players in the same world
- [ ] Text chat messages sync via CRDT and appear in-world
- [ ] Quick chat wheel shows preset options
- [ ] Voice spatial: volume attenuates with distance (optional)

#### Tasks
```
- [ ] WebRTC audio: getUserMedia + RTCPeerConnection audio tracks
- [ ] Push-to-talk: . key → transmit, release → stop
- [ ] Text chat: write to Y.Array("chat"), render as overlay
- [ ] Quick chat wheel UI: hold M → radial menu → release on option
- [ ] Spatial audio: attenuate volume by distance (Web Audio API panner)
```

---

### M5.9 — Launch Prep
**Status:** 🔴 Not Started
**Effort:** 2-3 sessions
**Dependencies:** All above

#### What
- New player onboarding flow
- SEO optimization (meta tags, Open Graph, structured data)
- Performance budget enforcement
- Error monitoring (Sentry or similar)
- Final documentation pass

#### Acceptance Criteria
- [ ] New player experience is intuitive (onboarding covers controls, creation, donation)
- [ ] Lighthouse score ≥ 90 for performance
- [ ] Error monitoring catches and reports client-side errors
- [ ] All documentation is current and accurate

#### Tasks
```
- [ ] Onboarding flow: first-time player tutorial (non-intrusive, optional)
- [ ] SEO: meta tags, OG images, structured data for social sharing
- [ ] Performance budget: bundle size limits, FPS targets
- [ ] Error monitoring: integrate Sentry or equivalent
- [ ] Documentation: update HANDOFF.md, README.md, all phase plans
- [ ] Lightsail VPS provisioning for production (if not done earlier)
- [ ] CI/CD: deploy server alongside frontend
```

---

## Phase Completion Criteria

1. ✅ World building tools — place, move, rotate, scale objects
2. ✅ Per-world physics — configurable gravity, friction, etc.
3. ✅ Event-sourced physics — deterministic interactive objects
4. ✅ Server validation — anti-cheat, mana enforcement, rubberbanding
5. ✅ Performance — 10K+ worlds at 60fps
6. ✅ Permissions — 3-tier object governance
7. ✅ Cosmetics — star customization, donor exclusives
8. ✅ Voice/chat — push-to-talk, text chat, quick wheel
9. ✅ Launch-ready — onboarding, SEO, monitoring, docs

**Then:** Update MASTER_PLAN.md status to 🟢. Ship it. 🚀

---

*Last updated: 2026-08-20*
