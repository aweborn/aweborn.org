# REPORT: Animating Meshy GLBs in three.js/R3F (checked against live docs on 2026-11-01)

## 1. Meshy Rigging + Animation API (verified from docs.meshy.ai)
**Rigging**: https://docs.meshy.ai/en/api/rigging
- `POST https://api.meshy.ai/openapi/v1/rigging` → `{ "result": "<rigTaskId>" }`
- Body: `input_task_id` (your refine task id) OR `model_url` (public GLB URL ≤400 MB, or data URI ≤100 MB; no Draco if >100 MB). If you send both, Meshy uses `input_task_id`. `height_meters` (default 1.7). `texture_image_url` is DEPRECATED: if you send it, you lose the PBR maps.
- Limits: **textured humanoid (biped) only**, ≤380,000 triangles (otherwise 400; run Remesh first with target_polycount ≤300k). For `model_url`, the character must face **+Z**. 422 = pose estimation failed (not humanoid). Untextured, non-humanoid and unclear-limb assets are explicitly unsupported. The docs give no T/A-pose requirement, but limbs need to be clearly separated.
- Poll with `GET /openapi/v1/rigging/:id`, or stream with SSE at `GET /openapi/v1/rigging/:id/stream`. Status is one of PENDING | IN_PROGRESS | SUCCEEDED | FAILED | CANCELED; `progress` runs 0–100. Webhooks also exist.
- Result: `result.rigged_character_glb_url`, `rigged_character_fbx_url`, and `result.basic_animations.{walking_glb_url, walking_fbx_url, walking_armature_glb_url, running_glb_url, running_fbx_url, running_armature_glb_url}`. So you get a free walk and run with every rig.
- **Cost: 5 credits.** Failed tasks are refunded.

**Animation**: https://docs.meshy.ai/en/api/animation
- `POST /openapi/v1/animations` with `rig_task_id` (must be SUCCEEDED) plus exactly ONE of:
  - `action_id` (int)
  - `action_ids` (1–10 unique ints): returns **one GLB with one named clip per action**, in the order you list them. This is the right shape for a state machine.
  - `motion_task_id`: a Text-to-Motion clip. Biped rigs only, so quadruped rigs are rejected. Text-to-Motion costs 10 credits (prime) or 3 (swift), clips are 2–10 s, and its files are kept only 3 days.
- Optional `post_process: { operation_type: "change_fps", fps: 24|30|60 }`.
- Result: `animation_glb_url`, `animation_fbx_url`, `processed_usdz_url`, `processed_armature_fbx_url`, `processed_animation_fps_fbx_url`. GET, stream and DELETE work the same as for rigging.
- **Cost: 3 credits per action.**

**Library**: `GET /openapi/v1/animations/library` is free and unpaged. Filters: `?category=WalkAndRun|BodyMovements|DailyActions|Fighting|Dancing`, `&search=`, `&sub_category=`, `&action_ids=`. Each entry has action_id, name, key, category, sub_category and a preview_url GIF. Browsable reference: https://docs.meshy.ai/en/api/animation-library. About 697 actions (ids 0–696, with gaps), and many have `_inplace` variants.
- Ids that suit a colossus:
  - Idle: 0 Idle, 11/12 Idle_02/03, 243–254 Idle_3..14, 336 Long_Breathe_and_Look_Around
  - Walk: **119 Slow_Orc_Walk / 669 Slow_Orc_Walk_inplace**, **112 Monster_Walk**, 113/650 Mummy_Stagger(_inplace), 551/611 Carry_Heavy_Object_Walk(_inplace), 30 Casual_Walk
  - Run: 14, 15, 16
  - Roar/taunt: **386 Zombie_Scream**, **88 Chest_Pound_Taunt**, 51 Shouting_Angrily
  - Attack/stomp: **127 Charged_Ground_Slam**, **128 Heavy_Hammer_Swing**, 255–257 Angry_Ground_Stomp, 382 Jump_and_Slam_Back_Down, 4 Attack
  - Hit/death: 7 BeHit_FlyUp, 8 Dead
- Re-validate cached ids against `?action_ids=` from time to time, because retired ids disappear.

**Retention (critical)**: API assets are deleted after **3 days**, and the signed URLs expire at `expires_at`. Download the rig GLB and clip GLBs to your own storage straight away. After expiry, `rig_task_id` returns 404 for new animations, so plan to request every action you'll need while the rig is still alive, or re-rig later for +5 credits.

**Pricing**: https://docs.meshy.ai/en/api/pricing. The API needs a paid plan (402 on free). Pro is about $20/mo for 1,000 credits, roughly $0.02/credit (third-party sources; please confirm). Example colossus bundle: rig 5 + `action_ids` [idle, slow walk, roar, slam] 4×3 = **17 credits, about $0.34**, on top of preview (20 credits with meshy-7.1) and refine (10).

**Skeleton naming**: humanoid rigs use a fixed ~24-bone template with Mixamo-style names but **without the `mixamorig` prefix**: Hips, Spine02, Spine01, Spine, neck/Head, head_end, headfront, Left/RightShoulder, Arm, ForeArm, Hand, UpLeg, Leg, Foot, ToeBase. This comes from community sources (medium confidence), so dump the bone names from the first rig to confirm. Because the template is shared, a clip from one Meshy rig usually plays on another by name. Rest proportions and Hips translation still differ between rigs, so use `SkeletonUtils.retargetClip` (or scale or strip the Hips position track). Mapping to Mixamo is a simple prefix rename. At 3 credits per action, buying clips per character from Meshy is more robust than retargeting on the client. Keep retargeting as the free path for extra clips.

**Quadrupeds**: the Meshy web app advertises "humanoid and quadruped" rigging, and the motion API error mentions quadruped rigs. However, the public rigging endpoint has no rig-type parameter and documents humanoid only. Treat API quadruped rigging as unavailable.

## 2. Non-humanoid alternatives
- **Tripo API** (https://platform.tripo3d.ai/docs/animation). From search results only; I couldn't load the docs directly, so verify.
  - Tasks go `animate_prerigcheck` → `animate_rig` → `animate_retarget`. `rig_type` is one of biped, quadruped, hexapod, octopod, avian, serpentine, aquatic, others.
  - Presets are `preset:idle|walk|run|jump|slash|shoot|hurt|fall|turn…` for bipeds, plus `preset:quadruped:walk`, `preset:hexapod:walk`, `preset:octopod:walk`, `preset:serpentine:march`, `preset:aquatic:march`. Supports `animate_in_place`. It accepts Tripo task ids, or an import step for external models.
  - Best paid option for creatures; the library is small.
- **Anything World** (https://anything.world). Rigs and animates quadrupeds, insects, birds and other animals by category, with an API/Python package. About 5 credits per rig or animate; plans run from about $30/mo for 100 credits. Good for animals, but slower and the output is less controllable.
- **Mixamo**: no public API (never had one), humanoid only, flaky in 2026. Not usable from a server pipeline.
- **Research/self-host** (needs a GPU server; non-commercial licenses may apply):
  - UniRig, SIGGRAPH 2025 (github.com/VAST-AI-Research/UniRig): any topology.
  - Puppeteer, NeurIPS 2025 (github.com/VAST-AI-Research/Puppeteer): rig, skin and animate.
  - MagicArticulate, CVPR 2025 (github.com/Seed3D/MagicArticulate).
  - RigNet (2020, older).
  - These give you a skeleton but no animation library; you'd still need procedural motion.
- **Procedural (free, works on ANY mesh, including static ones)**:
  - Transform-level idle: slow sine bob, sway and yaw on a parent group.
  - Vertex-shader "breathing": `onBeforeCompile` on the Lambert material, displacing along the normal with a height mask and a lava-pulse emissive.
  - Squash-and-stretch on movement.
  - For rigged models: procedural additions on top of clips, such as head look-at, spine lean and spring bones (e.g. @pixiv/three-vrm springbone or a custom verlet) for tails and tentacles.
  - Two-bone IK foot planting (`CCDIKSolver` in three/addons).

**Recommended tiers**:
- T0 "static" (default, free): no motion beyond optional transform idle.
- T1 "alive" (free, any mesh): transform idle plus vertex-shader breathing/pulse. Used automatically when rigging fails.
- T2 "animated humanoid" (Meshy rig + `action_ids`, about 17 credits).
- T3 "animated creature" (optional Tripo, rig_type quadruped etc.; or a UniRig self-host later).

Pipeline: when the player marks "animate", try Meshy rigging. On 422, fall back to T3 if enabled, otherwise T1. Always render T1 while the rig is pending.

## 3. three.js skeletal best practice (2026)
- Load with GLTFLoader (or R3F `useGLTF` + drei `useAnimations`). Instance with **`SkeletonUtils.clone`**; a plain `.clone()` breaks the skeleton binding. Use one `AnimationMixer` per instance.
- Switch clips with `action.reset().fadeIn(); prev.crossFadeTo(next, 0.4–0.8, true)`. Set `setLoop(LoopOnce)` and `clampWhenFinished` for roar/slam, and listen for the mixer's `finished` event.
- `SkeletonUtils.retargetClip(target, source, clip, {names, hip, useFirstFramePosition, preserveBoneMatrix})` handles mapping between rigs.
- **Root motion**: request the `_inplace` variants and drive world position from game logic (speed = stride length / clip duration × timeScale). For non-inplace clips, zero the X/Z of the Hips `.position` track.
- **Animation LOD**: skip `mixer.update` when off-screen (frustum check) and accumulate delta. Update at 60 Hz near, about 15–20 Hz mid, and freeze far away (or swap in the static LOD2).
- **Bone limits**: in WebGL2, three stores bone matrices in a texture (`boneTexture`), so the old uniform limit is gone, and Meshy's 24 bones are trivial anyway.
- **Crowds**: BatchedMesh and InstancedMesh don't skin. For many copies, use `@three.ez/instanced-mesh` (InstancedMesh2 with skinning, per-instance bone FPS; https://github.com/agargaro/instanced-mesh) or bake vertex-animation textures.

**Simplifying a SkinnedMesh (your meshopt LOD pipeline)**:
- `MeshoptSimplifier.simplify` and `simplifyWithAttributes` are **index-only**. They reuse the original vertices, so `skinIndex` and `skinWeight` survive exactly. Rebuild a compact buffer with `compactMesh` and copy **all** attributes, including skinIndex/skinWeight, through the remap. (README: https://github.com/zeux/meshoptimizer/tree/master/js)
- **Never use `simplifyWithUpdate`** on skinned meshes. It moves vertices and interpolates attributes, and joint indices can't be interpolated. **Avoid `simplifySloppy`** too.
- Weld first, but weld on position+UV+skin attributes (three's `mergeVertices` compares all attributes, which is fine). Don't drop skin attributes before welding.
- Optional: build a `vertex_lock` array marking vertices whose dominant joint differs from their neighbours (joint-boundary rings, especially knees and elbows) to protect deformation. Or pass the dominant-joint weight as an attribute to `simplifyWithAttributes`.
- gltf-transform: `weld()` + `simplify({simplifier: MeshoptSimplifier})` works on skinned primitives for the same index-only reason (JOINTS_0/WEIGHTS_0 are kept). Morph targets aren't considered by the error metric. https://gltf-transform.dev/modules/functions/functions/simplify
- Build each LOD as a **new SkinnedMesh** and call `lod.bind(sharedSkeleton, original.bindMatrix)`. Put them under a `THREE.LOD`, and drive all of them with one mixer on the root.
- Material swap: `MeshLambertMaterial` skins automatically (there has been no `skinning` flag since r129), so baking PBR → Lambert is fine.
- **Do not dispose the Skeleton or bones** when you dispose the original geometry/material. Disposing the bone texture or removing the bone nodes breaks every LOD.
- Bounding boxes: SkinnedMesh culling uses the bind-pose bounds. Call `computeBoundingSphere()` after posing, or set `frustumCulled=false` for huge colossi whose limbs swing outside the bind pose.
- Better still: reduce triangles **before rigging**. Run Meshy **Remesh** (5 credits, `target_polycount` e.g. 10–30k) and rig the result. That makes the rigged GLB your LOD0, and you only simplify for LOD1/LOD2.

## 4. Colossus gait
- Clips: Slow_Orc_Walk_inplace (669) or Monster_Walk (112); idle Long_Breathe (336); Zombie_Scream (386) or Chest_Pound (88) for menace; Charged_Ground_Slam (127).
- Set `action.timeScale` to about 0.5–0.7 and scale the model up. Locomotion speed must match stride × timeScale to avoid foot sliding. Perceived weight comes from a slow cycle plus a big scale.
- `post_process change_fps` doesn't change the speed of the motion; use timeScale.
- Footfalls: three has no animation events. Either:
  - (a) compute foot contacts once per clip: sample the LeftFoot/RightFoot world Y over the clip, find the minima, and store the normalized times. Then fire in the update loop when `action.time` crosses each one.
  - (b) at runtime, detect the foot bone's Y velocity changing from − to + while it's near the ground.
- On each contact: camera shake that decays with distance (trauma², Perlin), a positional audio thud (`PositionalAudio`, pitch-shifted low), a dust/ember burst, and an optional ground decal.
- Add a slow spine sway and head look-at toward the player as procedural extras on top of the clip.

## Per-object data to store
- `animMode`: static | alive | rigged
- `rigProvider`: meshy | tripo | none
- `rigTaskId`, `rigStatus`, `rigError` (code, e.g. 422)
- `remeshTaskId`, `rigHeightMeters`
- `riggedGlbKey`: your storage key, not a Meshy URL
- `animTaskIds[]`
- `clips: [{name, actionId, glbKey, inPlace, duration, footContacts[]}]`
- `clipRoles: {idle, walk, run, attack, roar}`
- `timeScale`, `speedMps`, `boneNames[]` (or a skeleton hash for retarget compatibility)
- `creditsSpent`, `rigExpiresAt`
- Runtime only (not persisted): current state and crossfade target.

## Risks
1. Meshy API rigging is humanoid-only, so lava blobs and quadrupeds fail with 422. A free procedural fallback is mandatory.
2. Assets are kept for 3 days: you lose files if you don't mirror them, and you can't add actions after the rig expires.
3. Decimating skinned meshes: weight artifacts at joints, broken bindings if you dispose the skeleton, culling of oversized poses.
4. Retargeting across rigs with different proportions causes foot sliding and Hips offset errors.
5. Action ids can be retired; refresh the library.
6. Tripo, Anything World and UniRig details come from search summaries; verify before building on them. Self-hosted research models may have non-commercial licenses and need GPUs.
7. Per-frame cost of many SkinnedMeshes on mobile, so animation LOD and update throttling are required.
8. Credit abuse: if players can trigger rigging, gate "animate" behind quota.

Unverified: Meshy bone names, the $/credit figure, and all Tripo/Anything World details. Everything else came from the live Meshy docs and the meshoptimizer README.
