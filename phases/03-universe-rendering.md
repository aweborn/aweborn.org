# Phase 03: Universe Rendering & LOD

**Status:** `[x]` Complete
**Depends on:** [Phase 02: Multiplayer Core](./02-multiplayer-core.md)
**ROADMAP reference:** [Universe Visual Design & World Building](../ROADMAP.md#universe-visual-design--world-building)
**Estimated sessions:** 3-4 (actual: 1)

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
- `[x]` Upgrade `UniverseWorlds.tsx` — subscribe to Universe CRDT → render worlds as 3D objects
- `[x]` World visual properties derived from CRDT data (color, size, glow, pulse)
- `[x]` Aweborn Portal at origin — brightest, largest sun with double rings
- `[x]` Custom glow shader (`worldGlow.ts`) — fresnel edge glow + animated pulse

### LOD System
- `[x]` **Close (< 5 units):** Full 3D mesh with custom shader, halo, ring, label, point light
- `[x]` **Medium (5-12 units):** Billboard sprite with color glow + pulsing scale
- `[x]` **Far (12+ units):** Batched THREE.Points — single draw call for thousands
- `[x]` LOD bucketing in main component based on camera distance

### Player-Star Rendering
- `[x]` Create `src/components/PlayerStars.tsx`
- `[x]` Render other players as glowing orbs (BroadcastChannel presence → positions)
- `[x]` Comet trails — per-vertex alpha fading particle trail
- `[x]` Smooth position interpolation (lerp toward latest broadcast)

### Ghost World Visual Treatment
- `[x]` Create `ghostShader.ts` — translucent noise shimmer + fresnel edge glow
- `[x]` Wireframe overlay on ghost worlds (icosahedron geometry)
- `[x]` Visual distinction: Ghost (translucent wireframe), Oasis (brighter core), Solid (full glow)
- `[x]` Ghost shader applied to non-solidified worlds in Close LOD

### Landmark Worlds (converted FloatingIslands)
- `[x]` Convert FloatingIslands from Environment.tsx into permanent landmark worlds
- `[x]` 5 landmarks: The Spire, Drift Rock, Deep Anchor, Far Beacon, Nebula's Eye
- `[x]` Crystal-topped rock aesthetics preserved with labels
- `[x]` Removed from Environment.tsx → rendered in UniverseWorlds.tsx

### World Interior View
- `[x]` Create `src/components/WorldInterior.tsx` — scene inside a world
- `[x]` Render objects from World CRDT (cube, sphere, cylinder, cone, torus)
- `[x]` Ground grid + sky dome colored by world palette
- `[x]` Scene switching in Scene.tsx: universe view ↔ world interior

### Performance
- `[x]` LOD-based rendering (far worlds → single Points draw call)
- `[x]` Additive blending + depthWrite:false for transparent elements
- `[x]` Shared billboard texture (canvas-generated, single allocation)
- [ ] Profile with Chrome DevTools — target 60fps with 1000+ visible worlds *(deferred — stress test)*

## Acceptance Criteria

- [x] Worlds from the CRDT render as visual suns in 3D space
- [x] LOD tiers implemented (Close/Medium/Far)
- [ ] 1000+ worlds render at 60fps on mid-range hardware *(deferred — stress test)*
- [x] Players appear as glowing orbs with trails
- [x] Ghost worlds are visually distinct (wireframe + glow)
- [x] World entry/exit switches between universe and interior view
- [x] Aweborn Portal at origin is the brightest star
- [x] Landmark worlds (converted FloatingIslands) visible with labels

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/components/UniverseWorlds.tsx` | REWRITE | LOD tiers (Close/Medium/Far), Aweborn Portal, Landmark Islands |
| `src/components/PlayerStars.tsx` | NEW | Player orbs with comet trails |
| `src/components/WorldInterior.tsx` | NEW | CRDT-driven 3D world interior with sky dome + grid |
| `src/components/Environment.tsx` | MODIFY | Removed FloatingIslands (promoted to landmarks) |
| `src/components/Scene.tsx` | MODIFY | Universe↔interior switching, PlayerStars integration |
| `src/components/CRDTDevOverlay.tsx` | MODIFY | Remove unused worldMeta variable |
| `src/shaders/worldGlow.ts` | NEW | Fresnel glow + halo shader for worlds |
| `src/shaders/ghostShader.ts` | NEW | Ghost world wireframe + shimmer shader |
| `src/stores/universeStore.ts` | MODIFY | Fix TS strict null assertions |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| 2026-08-20 | Built LOD rendering (Close/Medium/Far tiers), custom glow+ghost shaders, Aweborn Portal at origin, landmark islands (converted FloatingIslands per user request), PlayerStars with comet trails, WorldInterior with CRDT-driven 3D objects + sky dome + ground grid, Scene universe↔interior switching. TypeScript + Vite build pass clean. Visual verification: portal + landmarks + worlds visible, interior shows 3D objects with colored sky. | **Phase 03 COMPLETE** → Begin Phase 04 (Navigation & Controls) |
