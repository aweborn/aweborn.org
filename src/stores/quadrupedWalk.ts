import * as THREE from 'three'
import { findBodyPlan, partOf, type BodyPlan } from '@aweborn/shared/quadruped'
import type { PreparedModelPart } from './modelShapes'

/**
 * Four-legged walking on a still model (Phase 07 Life & minds, shared/quadruped.ts).
 *
 * Once per asset: find the body plan in the decimated mesh and tag every vertex
 * of every LOD with its part (`aPart`: body, a leg, the head). Per creature: a
 * clone of the baked Lambert material whose vertex shader swings each leg about
 * its hip (a trot) and nods the head about the neck, from a few uniforms the
 * creature updates each frame. No skeleton, no provider, works offline.
 */

const plans = new Map<string, BodyPlan | null>()

/** The body plan for an asset's prepared parts (null = no four legs found), tagging the geometry once. */
export function quadrupedPlan(asset: string, parts: PreparedModelPart[]): BodyPlan | null {
  if (plans.has(asset)) return plans.get(asset)!
  const pts: number[] = []
  for (const p of parts) {
    const a = p.lod0.attributes.position
    const step = Math.max(1, Math.floor(a.count / 40_000))
    for (let i = 0; i < a.count; i += step) pts.push(a.getX(i), a.getY(i), a.getZ(i))
  }
  const plan = findBodyPlan(pts)
  plans.set(asset, plan)
  if (!plan) return null
  for (const p of parts) {
    for (const g of [p.lod0, p.lod1, p.lod2]) {
      if (g.getAttribute('aPart')) continue
      const a = g.attributes.position
      const ids = new Float32Array(a.count)
      for (let i = 0; i < a.count; i++) ids[i] = partOf(plan, a.getX(i), a.getY(i), a.getZ(i))
      g.setAttribute('aPart', new THREE.BufferAttribute(ids, 1))
    }
  }
  return plan
}

export interface LegUniforms {
  uLegA: { value: THREE.Vector4 }
  uHeadA: { value: number }
}

/** A per-creature copy of a part's material that walks on the plan's legs. Shares textures. */
export function walkingMaterial(base: THREE.Material, plan: BodyPlan, u: LegUniforms): THREE.Material {
  const m = base.clone()
  const along = (l: number, t: number, y: number) => (plan.axis === 'x' ? new THREE.Vector3(l, y, t) : new THREE.Vector3(t, y, l))
  const hips = plan.hips.map(([l, t]) => along(l, t, plan.legTop))
  const neck = along(plan.neck[0], plan.centre[1], plan.neck[1])
  const long = plan.axis === 'x' ? new THREE.Vector3(plan.front, 0, 0) : new THREE.Vector3(0, 0, plan.front)
  const blend = Math.max(1e-3, (plan.legTop - plan.floor) * 0.25)
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uLegA: u.uLegA,
      uHeadA: u.uHeadA,
      uHip0: { value: hips[0] },
      uHip1: { value: hips[1] },
      uHip2: { value: hips[2] },
      uHip3: { value: hips[3] },
      uNeck: { value: neck },
      uLong: { value: long },
      uBlend: { value: blend },
    })
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aPart;
uniform vec4 uLegA;
uniform float uHeadA;
uniform vec3 uHip0, uHip1, uHip2, uHip3, uNeck, uLong;
uniform float uBlend;
vec3 swingAbout(vec3 p, vec3 pivot, float a, float w) {
  vec3 d = p - pivot;
  float dl = dot(d, uLong), dy = d.y;
  float c = cos(a), s = sin(a);
  return p + uLong * ((dl * c - dy * s) - dl) * w + vec3(0.0, (dl * s + dy * c) - dy, 0.0) * w;
}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
int qPart = int(aPart + 0.5);
if (qPart >= 1 && qPart <= 4) {
  vec3 hip = qPart == 1 ? uHip0 : qPart == 2 ? uHip1 : qPart == 3 ? uHip2 : uHip3;
  float a = qPart == 1 ? uLegA.x : qPart == 2 ? uLegA.y : qPart == 3 ? uLegA.z : uLegA.w;
  transformed = swingAbout(transformed, hip, a, clamp((hip.y - transformed.y) / uBlend, 0.0, 1.0));
} else if (qPart == 5) {
  transformed = swingAbout(transformed, uNeck, uHeadA, 1.0);
}`,
      )
  }
  m.customProgramCacheKey = () => `quadruped-walk:${base.customProgramCacheKey?.() ?? ''}`
  return m
}

