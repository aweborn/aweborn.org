# Phase 03: Universe Rendering & LOD

**Status:** `[ ]` Not Started
**Depends on:** [Phase 02: Multiplayer Core](./02-multiplayer-core.md)
**ROADMAP reference:** [Universe Visual Design & World Building](../ROADMAP.md#universe-visual-design--world-building)
**Estimated sessions:** 3-4

## Goal

Transform the decorative cosmic scene into a **data-driven universe** where every "star" is a real world from the CRDT. Implement LOD rendering so the universe can scale to thousands (eventually hundreds of thousands) of worlds without killing the frame rate. Players appear as glowing orbs drifting through space.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Close worlds (< 100 units) | Individual Three.js meshes with glow/particles | Rich detail for nearby worlds |
| Medium worlds (100-1000) | Billboard sprites with color tint | Low draw call cost, still identifiable |
| Far worlds (1000+) | `THREE.Points` / `InstancedMesh` | Thousands in one draw call |
| Very far worlds | Merged into static starfield | No individual tracking |
| Player rendering | Glowing orbs with comet trails | Matches ROADMAP visual spec |
| Ghost worlds | Wireframe shader + ethereal glow | Visually distinct from solid worlds |

## Tasks

### Data-Driven World Rendering
- `[ ]` Create `src/components/UniverseView.tsx` — replaces decorative starfield
- `[ ]` Subscribe to Universe CRDT → render world entries as 3D objects
- `[ ]` World visual properties derived from CRDT data:
  - Color → `color` field
  - Size → `f(playerCount, objectCount, age)`
  - Glow intensity → `f(playerCount, lastActive)`
  - Pulse rate → `f(activity level)`
- `[ ]` Aweborn Portal at origin — brightest, largest sun

### LOD System
- `[ ]` Create `src/components/WorldLOD.tsx` — LOD manager
- `[ ]` **Close (< 100 units):** Full 3D sun mesh with:
  - Glow shader (post-processing bloom)
  - Particle system (orbiting motes)
  - Player count badge (small orbiting dots)
  - Name label (on hover/scan)
- `[ ]` **Medium (100-1000):** Billboard sprite
  - Single quad with color tint from world data
  - Simplified glow (additive blending)
- `[ ]` **Far (1000+):** InstancedMesh / THREE.Points
  - Batched rendering — position + color per instance
  - Single draw call for thousands of worlds
- `[ ]` **Very far:** Blend into background starfield
- `[ ]` Smooth LOD transitions (no popping)

### Player-Star Rendering
- `[ ]` Create `src/components/PlayerStars.tsx`
- `[ ]` Render other players as glowing orbs (awareness data → positions)
- `[ ]` Comet trails — fading particle trail behind moving players
- `[ ]` Entry animation: player-star merges into world-sun (flash absorption)
- `[ ]` Exit animation: spark shoots out of world-sun
- `[ ]` Cluster visualization: orbiting stars around active worlds

### Ghost World Visual Treatment
- `[ ]` Create wireframe shader for Ghost worlds
- `[ ]` Translucent material with soft ethereal glow
- `[ ]` No collision, no particles — dreamlike quality
- `[ ]` Visual distinction between:
  - Ghost (unfunded, outside Frontier)
  - Oasis (Patron-funded bubble in Deep Dark)
  - Solid (inside Living Frontier)

### World Interior View
- `[ ]` Create `src/components/WorldInterior.tsx` — scene inside a world
- `[ ]` Render objects from World CRDT (Y.Map of objects)
- `[ ]` Basic object types: cube, sphere, ramp, platform
- `[ ]` Object materials and colors from CRDT data
- `[ ]` Transition animation: universe view → world interior (camera zoom + dissolve)

### Performance
- `[ ]` Frustum culling (don't render off-screen worlds)
- `[ ]` Distance-based update rates (close = every frame, far = every 10 frames)
- `[ ]` Object pooling for particle systems
- `[ ]` Profile with Chrome DevTools — target 60fps with 1000+ visible worlds

## Acceptance Criteria

- [ ] Worlds from the CRDT render as visual suns in 3D space
- [ ] LOD transitions are smooth — no visual popping
- [ ] 1000+ worlds render at 60fps on mid-range hardware
- [ ] Players appear as glowing orbs with trails
- [ ] Ghost worlds are visually distinct (wireframe + glow)
- [ ] World entry/exit animations play smoothly
- [ ] Aweborn Portal at origin is the brightest star

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/components/UniverseView.tsx` | NEW | Data-driven world rendering |
| `src/components/WorldLOD.tsx` | NEW | LOD manager |
| `src/components/PlayerStars.tsx` | NEW | Player orbs + trails |
| `src/components/WorldInterior.tsx` | NEW | World interior scene |
| `src/components/GhostShader.tsx` | NEW | Wireframe ghost effect |
| `src/components/Environment.tsx` | MODIFY | Integrate with UniverseView, keep ambient elements |
| `src/components/Scene.tsx` | MODIFY | Add UniverseView, WorldInterior, transition logic |
| `src/shaders/` | NEW | Custom shaders (glow, ghost, trail) |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| — | — | — |
