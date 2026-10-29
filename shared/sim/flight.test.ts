/**
 * Tests for the shared deterministic flight step.
 *
 * The core check: `stepFlight` matches the pre-9A three.js flight (copied
 * below verbatim as `legacy*`, with its inputs injected instead of read from
 * singletons) on long random input logs. That is the "feels the same" proof
 * we can do without Alex's hands on the controls.
 *
 * Run: node --import tsx --test shared/sim/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  stepFlight, initialFlightState, newStepInfo, stateHash, quantizeAxis, IN, FLIGHT_DT,
  type FlightSimState, type InputFrame,
} from "./flight.js";
import { computeGravity, type SimWorld, type BodySource } from "./gravity.js";
import { FIXTURE_NOW, FIXTURE_WORLDS, FIXTURE_WORLD, rng, inputLog, goldenReplay, GOLDEN_REPLAY } from "./replay-fixture.js";
import { ORIGIN_POSITION, ORIGIN_WORLD_ID } from "../crdt-schema.js";

// ── Legacy reference (src/systems/GravitySystem.ts + FlightController.ts + Scene.tsx substep, pre-9A) ──

function legacyMass(w: BodySource, nowMs: number): number {
  const playerBoost = 1 + w.playerCount * 0.5;
  const ageBonus = Math.min(1 + (nowMs - w.createdAt) / (1000 * 60 * 60 * 24), 3);
  return 2.0 * playerBoost * ageBonus;
}

function legacyGravity(playerPos: THREE.Vector3, playerVel: THREE.Vector3, worlds: BodySource[], nowMs: number) {
  const toWorld = new THREE.Vector3(), force = new THREE.Vector3(), totalForce = new THREE.Vector3();
  let nearestId: string | null = null, nearestDistance = Infinity;
  let nearestWorldPosition: THREE.Vector3 | null = null;
  let slingshotEvent: { worldId: string; speed: number; boostFactor: number } | null = null;
  let approachDragFactor = 0;
  const bodies = [{ id: ORIGIN_WORLD_ID, position: new THREE.Vector3(ORIGIN_POSITION.x, ORIGIN_POSITION.y, ORIGIN_POSITION.z), mass: 25.0, world: false }];
  for (const w of worlds) {
    if (w.parentWorldId) continue;
    bodies.push({ id: w.id, position: new THREE.Vector3(w.resolvedPosition.x, w.resolvedPosition.y, w.resolvedPosition.z), mass: legacyMass(w, nowMs), world: true });
  }
  const speed = playerVel.length();
  for (const body of bodies) {
    toWorld.copy(body.position).sub(playerPos);
    const dist = Math.max(toWorld.length(), 2.0);
    if (dist < nearestDistance) { nearestDistance = dist; nearestId = body.id; nearestWorldPosition = body.position.clone(); }
    if (dist > 120.0) continue;
    const strength = Math.min(10.0 * body.mass / (dist * dist), 8.0);
    if (speed > 15.0 && dist < 15.0) {
      const velDir = playerVel.clone().normalize();
      const toBodyDir = toWorld.clone().normalize();
      const dot = Math.abs(velDir.dot(toBodyDir));
      if (dot < 0.5) {
        const proximity = 1.0 - dist / 15.0;
        const tangentiality = 1.0 - dot / 0.5;
        const speedFactor = Math.min(speed / 15.0, 20.0);
        slingshotEvent = { worldId: body.id, speed, boostFactor: 1.0 + speedFactor * proximity * (0.5 + tangentiality * 0.5) };
      }
    }
    if (body.world && speed < 2.0 && dist < 3.0 && dist > 0.8) {
      const tangent = new THREE.Vector3().crossVectors(toWorld, new THREE.Vector3(0, 1, 0)).normalize();
      totalForce.addScaledVector(tangent, strength * 0.3 * (1 - speed / 2.0));
    }
    force.copy(toWorld).normalize().multiplyScalar(strength);
    totalForce.add(force);
    if (dist < 12.0 && speed > 1.0) {
      const velDir = playerVel.clone().normalize();
      const toDir = toWorld.clone().normalize();
      const headOnDot = velDir.dot(toDir);
      if (headOnDot > 0.7) approachDragFactor = Math.max(approachDragFactor, (1 - dist / 12.0) * headOnDot * 0.4);
    }
  }
  if (totalForce.length() > 8.0) totalForce.setLength(8.0);
  return { force: totalForce.clone(), nearestId, nearestDistance, nearestWorldPosition, slingshotEvent, approachDragFactor };
}

interface Legacy {
  position: THREE.Vector3; velocity: THREE.Vector3; quaternion: THREE.Quaternion;
  dampen: number; dampenTarget: number; slingId: string | null;
}

/** One Scene.tsx substep + FlightController.update, with the slingshot impulse moved into the step (as 9A does). */
function legacyStep(L: Legacy, input: InputFrame, worlds: BodySource[], nowMs: number): void {
  const a = (bit: number) => (input.bits & bit) !== 0;
  const gravityEnabled = a(IN.neutral);
  const yawAxis = input.yaw / 127, pitchAxis = input.pitch / 127;
  const dt = Math.min(FLIGHT_DT, 0.05);
  const gr = legacyGravity(L.position, L.velocity, worlds, nowMs);
  if (gravityEnabled && gr.approachDragFactor > 0.01 && gr.nearestWorldPosition) {
    const toWorld = gr.nearestWorldPosition.clone().sub(L.position).normalize();
    const approachSpeed = L.velocity.dot(toWorld);
    if (approachSpeed > 0) L.velocity.addScaledVector(toWorld, -(approachSpeed * gr.approachDragFactor * FLIGHT_DT * 2.0));
  }
  if (gravityEnabled && gr.nearestDistance < 2.5 && !a(IN.thrust)) {
    if (L.velocity.length() < 0.5) { L.velocity.set(0, 0, 0); gr.force.set(0, 0, 0); }
  }
  L.dampenTarget = gr.slingshotEvent && gravityEnabled ? 1 : 0;
  // FlightController.update
  L.dampen += (L.dampenTarget - L.dampen) * Math.min(8.0 * dt, 1.0);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(L.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(L.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(L.quaternion);
  const dm = gravityEnabled ? 1.0 - L.dampen * 0.6 : 1.0;
  const turnRate = 2.5 * dm, rollRate = 2.8 * dm;
  const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
  const pitchIn = clamp1((a(IN.pitchUp) ? 1 : 0) - (a(IN.pitchDown) ? 1 : 0) + pitchAxis);
  const yawIn = clamp1((a(IN.yawRight) ? 1 : 0) - (a(IN.yawLeft) ? 1 : 0) + yawAxis);
  const tp = pitchIn * turnRate, ty = -yawIn * turnRate;
  let tr = 0;
  if (a(IN.rollLeft)) tr += rollRate;
  if (a(IN.rollRight)) tr -= rollRate;
  const av = new THREE.Vector3();
  if (Math.abs(tp) > 0.01 || Math.abs(ty) > 0.01 || Math.abs(tr) > 0.01) av.set(tp, ty, tr);
  if (av.lengthSq() > 0.0001) {
    const rotQ = new THREE.Quaternion();
    rotQ.setFromAxisAngle(right, av.x * dt); L.quaternion.premultiply(rotQ);
    rotQ.setFromAxisAngle(up, av.y * dt); L.quaternion.premultiply(rotQ);
    rotQ.setFromAxisAngle(forward, av.z * dt); L.quaternion.premultiply(rotQ);
    L.quaternion.normalize();
  }
  if (a(IN.autoOrient)) {
    const f = forward.clone();
    const idealRight = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    if (idealRight.lengthSq() >= 0.001) {
      const idealUp = new THREE.Vector3().crossVectors(idealRight, f).normalize();
      const m = new THREE.Matrix4().makeBasis(idealRight, idealUp, f.negate());
      const targetQ = new THREE.Quaternion().setFromRotationMatrix(m);
      L.quaternion.slerp(targetQ, 1 - Math.pow(0.05, dt));
      L.quaternion.normalize();
    }
  }
  const v = L.velocity;
  if (gravityEnabled) {
    if (a(IN.thrust)) v.addScaledVector(forward, 10.0 * dt);
    if (a(IN.reverse)) v.addScaledVector(forward, -5.0 * dt);
    if (a(IN.strafe)) v.addScaledVector(right, 6.0 * dt);
    if (a(IN.moveUp)) v.addScaledVector(up, 10.0 * dt);
    if (a(IN.moveDown)) v.addScaledVector(up, -10.0 * dt);
    if (a(IN.brake)) {
      const speed = v.length();
      if (speed > 0.1) v.multiplyScalar(1 - Math.min(20.0 * dt, speed) / speed);
      else v.set(0, 0, 0);
    }
    v.add(gr.force.clone().multiplyScalar(dt));
    v.multiplyScalar(Math.pow(1 - 0.15, dt));
    if (v.length() > 80.0) v.setLength(80.0);
  } else {
    v.set(0, 0, 0);
    if (a(IN.thrust)) v.copy(forward).multiplyScalar(12.0);
    if (a(IN.reverse)) v.copy(forward).multiplyScalar(-12.0);
    if (a(IN.strafe)) v.addScaledVector(right, 12.0);
    if (a(IN.moveUp)) v.addScaledVector(up, 12.0);
    if (a(IN.moveDown)) v.addScaledVector(up, -12.0);
    if (a(IN.brake)) v.set(0, 0, 0);
    if (v.length() > 60.0) v.setLength(60.0);
  }
  L.position.addScaledVector(v, dt);
  // Scene.tsx slingshot impulse (once per pass)
  if (gr.slingshotEvent && gravityEnabled) {
    if (L.slingId !== gr.slingshotEvent.worldId) {
      L.slingId = gr.slingshotEvent.worldId;
      const velDir = v.clone().normalize();
      v.addScaledVector(velDir, gr.slingshotEvent.speed * (gr.slingshotEvent.boostFactor - 1.0) * 0.1);
    }
  } else {
    L.slingId = null;
  }
}

// ── Fixtures (shared with the cross-engine harness) ──────────────────

const NOW = FIXTURE_NOW;
const WORLDS = FIXTURE_WORLDS;
const WORLD = FIXTURE_WORLD;

function runBoth(log: InputFrame[], start = initialFlightState()) {
  const s: FlightSimState = { ...start };
  const L: Legacy = {
    position: new THREE.Vector3(start.px, start.py, start.pz),
    velocity: new THREE.Vector3(start.vx, start.vy, start.vz),
    quaternion: new THREE.Quaternion(start.qx, start.qy, start.qz, start.qw),
    dampen: 0, dampenTarget: 0, slingId: null,
  };
  const info = newStepInfo();
  let maxPos = 0, maxQ = 0, slings = 0;
  for (const f of log) {
    stepFlight(s, f, WORLD, info);
    legacyStep(L, f, WORLDS, NOW);
    if (info.slingshotImpulse) slings++;
    maxPos = Math.max(maxPos, Math.abs(s.px - L.position.x), Math.abs(s.py - L.position.y), Math.abs(s.pz - L.position.z));
    maxQ = Math.max(maxQ, Math.abs(s.qx - L.quaternion.x), Math.abs(s.qy - L.quaternion.y), Math.abs(s.qz - L.quaternion.z), Math.abs(s.qw - L.quaternion.w));
  }
  return { s, L, maxPos, maxQ, slings };
}

// ── Tests ────────────────────────────────────────────────────────────

test("gravity matches the legacy GravitySystem bit for bit", () => {
  const r = rng(7);
  for (let i = 0; i < 2000; i++) {
    const p = new THREE.Vector3(r() * 80 - 40, r() * 20 - 10, r() * 80 + 10);
    const v = new THREE.Vector3(r() * 60 - 30, r() * 10 - 5, r() * 60 - 30).multiplyScalar(r() < 0.3 ? 0.03 : 1);
    const old = legacyGravity(p, v, WORLDS, NOW);
    const g = computeGravity(p.x, p.y, p.z, v.x, v.y, v.z, WORLD.bodies);
    assert.equal(g.fx, old.force.x); assert.equal(g.fy, old.force.y); assert.equal(g.fz, old.force.z);
    assert.equal(g.nearestDistance, old.nearestDistance);
    assert.equal(WORLD.bodies[g.nearest].id, old.nearestId);
    assert.equal(g.approachDrag, old.approachDragFactor);
    assert.equal(g.slingBody >= 0 ? WORLD.bodies[g.slingBody].id : null, old.slingshotEvent?.worldId ?? null);
    if (old.slingshotEvent) assert.equal(g.slingBoost, old.slingshotEvent.boostFactor);
  }
});

test("DRIVE with keys only matches legacy flight (≤ 1e-9 over 1 min)", () => {
  for (const seed of [1, 2, 3]) {
    const { maxPos, maxQ } = runBoth(inputLog(seed, 3600, false));
    assert.ok(maxPos < 1e-9, `seed ${seed}: position drift ${maxPos}`);
    assert.ok(maxQ < 1e-12, `seed ${seed}: quaternion drift ${maxQ}`);
  }
});

test("NEUTRAL with gravity, sticks, auto-orient matches legacy flight (≤ 1e-9 over 1 min; measured ~1e-12)", () => {
  let slings = 0;
  for (const seed of [11, 12, 13, 14]) {
    const r = runBoth(inputLog(seed, 3600, true, { axes: true, autoOrient: true }));
    slings += r.slings;
    assert.ok(r.maxPos < 1e-9, `seed ${seed}: position drift ${r.maxPos}`);
    assert.ok(r.maxQ < 1e-12, `seed ${seed}: quaternion drift ${r.maxQ}`);
  }
  // a fast pass by the near world exercises the slingshot path
  const pass = runBoth(Array.from({ length: 240 }, () => ({ bits: IN.neutral, yaw: 0, pitch: 0 })),
    { ...initialFlightState(14, 1, 70), vx: 0, vy: 0, vz: -40 });
  slings += pass.slings;
  assert.ok(pass.maxPos < 1e-9, `pass drift ${pass.maxPos}`);
  assert.ok(slings > 0, "no slingshot exercised");
});

test("same log twice → identical state hash; different log → different", () => {
  const log = inputLog(42, 1800, true, { axes: true, autoOrient: true });
  const a = initialFlightState(), b = initialFlightState(), c = initialFlightState();
  for (const f of log) { stepFlight(a, f, WORLD); stepFlight(b, f, WORLD); }
  const other = inputLog(43, 1800, true, { axes: true });
  for (const f of other) stepFlight(c, f, WORLD);
  assert.equal(stateHash(a), stateHash(b));
  assert.notEqual(stateHash(a), stateHash(c));
});

test("golden replay hash (the cross-engine harness must reproduce it)", () => {
  assert.equal(goldenReplay(), GOLDEN_REPLAY);
});

test("NEUTRAL thrust always escapes the Portal well", () => {
  const s = { ...initialFlightState(0, 0, 3) };
  // face away from Origin (+Z is behind at identity, so turn around 180° about Y)
  s.qy = 1; s.qw = 0;
  for (let i = 0; i < 600; i++) stepFlight(s, { bits: IN.neutral | IN.thrust, yaw: 0, pitch: 0 }, WORLD);
  assert.ok(Math.hypot(s.px, s.py, s.pz) > 20, `stuck at ${Math.hypot(s.px, s.py, s.pz)}`);
});

test("leash eases a beginner back and bleeds outward speed", () => {
  const world: SimWorld = { bodies: [], leashRadius: 100 };
  const s = { ...initialFlightState(0, 0, 130), vz: 30 };
  const info = stepFlight(s, { bits: IN.neutral, yaw: 0, pitch: 0 }, world);
  assert.equal(info.leashed, true);
  assert.ok(s.vz <= 1e-12, `outward speed kept: ${s.vz}`);
  for (let i = 0; i < 600; i++) stepFlight(s, { bits: IN.neutral, yaw: 0, pitch: 0 }, world);
  assert.ok(Math.abs(Math.hypot(s.px, s.py, s.pz) - 100) < 0.01);
});

test("quantizeAxis clamps and rounds to int8", () => {
  assert.equal(quantizeAxis(1), 127);
  assert.equal(quantizeAxis(-2), -127);
  assert.equal(quantizeAxis(0.5), 64);
  assert.equal(quantizeAxis(NaN), 0);
});
