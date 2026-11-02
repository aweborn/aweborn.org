/**
 * Animate a generated model (Phase 07 → Life & minds, 2026-11-01).
 *
 * One job turns a still model into an animated one, all on Meshy:
 *
 *   1. remesh   to ~30k triangles (rigging refuses > 380k; Meshy refines are ~1.5M)
 *   2. rig      humanoid / biped skeleton (24 bones, Mixamo-style names); 422 = not a biped
 *   3. animate  `action_ids` from the animation library → ONE GLB: mesh + skeleton + one
 *               clip per action, in the order asked (measured 2026-11-01 on the Lost colossus)
 *   4. rename   the clips to their roles (idle, walk, talk, emote) so the client and the
 *               library never need Meshy's action names; the original name stays in extras
 *
 * Resumable like text-to-3D: the provider task is stored as `remesh:<id>`, `rig:<id>` or
 * `anim:<id>`. Meshy deletes task files after 3 days, so the result is downloaded and
 * kept (content-addressed) the moment it's ready. Cost = the credits Meshy reports
 * (`consumed_credits`) × $0.02; failed tasks are refunded by Meshy.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import type { Provider, ProviderJob } from "./providers.js";
import { CDN_URL } from "./library.js";
import { streamToFile } from "./download.js";

const MESHY_KEY = process.env.MESHY_API_KEY ?? "";
const API = "https://api.meshy.ai/openapi/v1";
const USD_PER_CREDIT = 0.02;
const POLL_MS = 4000;
const STEP_TIMEOUT_MS = 10 * 60 * 1000;

/** Clip roles in the order the gait lists its actions (shared/life.ts ANIM_ROLES). */
export const ROLES = ["idle", "walk", "talk", "emote"] as const;

export interface AnimateParams {
  /** The still model to animate: `<sha>.glb` in the asset library. */
  source: string;
  /** Library action ids, one per role (shared/life.ts GAITS). */
  actions: number[];
  /** How tall the creature is meant to be (Meshy scales the skeleton to it). */
  heightM: number;
}

export function cleanAnimateParams(p: unknown): AnimateParams | null {
  if (!p || typeof p !== "object") return null;
  const r = p as Record<string, unknown>;
  if (typeof r.source !== "string" || !/^[a-f0-9]{64}\.glb$/.test(r.source)) return null;
  const actions = Array.isArray(r.actions) ? r.actions.filter((a): a is number => Number.isInteger(a) && a >= 0 && a < 5000) : [];
  if (actions.length !== ROLES.length || new Set(actions).size !== actions.length) return null;
  const h = typeof r.heightM === "number" && Number.isFinite(r.heightM) ? Math.max(0.5, Math.min(40, r.heightM)) : 1.8;
  return { source: r.source, actions, heightM: Math.round(h * 10) / 10 };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface MeshyTask {
  status: string; progress?: number; consumed_credits?: number;
  task_error?: { message?: string } | null;
  result?: { rigged_character_glb_url?: string; animation_glb_url?: string };
  model_urls?: { glb?: string };
}

/** A Meshy API error, with the HTTP status (422 from rigging = not a humanoid). */
export class MeshyError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function create(job: ProviderJob, path: string, body: Record<string, unknown>): Promise<string> {
  job.archive({ call: `meshy.${path}`, request: { ...body, model_url: typeof body.model_url === "string" ? body.model_url.slice(0, 120) : undefined } });
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MESHY_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { result?: string; message?: string };
  job.archive({ call: `meshy.${path}`, status: res.status, response: json });
  if (!res.ok || !json.result) throw new MeshyError(`meshy ${path} ${res.status}: ${json.message ?? ""}`.trim(), res.status);
  return json.result;
}

async function waitFor(job: ProviderJob, path: string, id: string, from: number, to: number): Promise<MeshyTask> {
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > STEP_TIMEOUT_MS) throw new Error(`meshy ${path} timed out`);
    await sleep(POLL_MS);
    const res = await fetch(`${API}/${path}/${id}`, { headers: { Authorization: `Bearer ${MESHY_KEY}` } });
    if (!res.ok) continue; // transient; keep polling until the timeout
    const t = (await res.json()) as MeshyTask;
    job.onProgress(from + ((to - from) * (t.progress ?? 0)) / 100);
    if (t.status === "SUCCEEDED") {
      job.archive({ call: `meshy.${path}.result`, task: id, credits: t.consumed_credits ?? null });
      return t;
    }
    if (t.status === "FAILED" || t.status === "CANCELED") {
      job.archive({ call: `meshy.${path}.result`, task: id, response: t });
      throw new Error(`meshy ${path} ${t.status.toLowerCase()}: ${t.task_error?.message ?? ""}`.trim());
    }
  }
}

/** A public URL Meshy can fetch for the source model (the CDN copy), or a data URI (dev, ≤ 100 MB). */
function sourceUrl(assetDir: string, file: string): string {
  if (CDN_URL) return `${CDN_URL}/models/${file}`;
  const buf = readFileSync(join(assetDir, file));
  if (buf.length > 100 * 1024 * 1024) throw new Error("model too large to send without the CDN");
  return `data:model/gltf-binary;base64,${buf.toString("base64")}`;
}

/** Rename the clips to roles (in request order) and store the GLB content-addressed. */
export async function finishAnimatedGlb(raw: Uint8Array, assetDir: string): Promise<{ file: string; clips: string[] }> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(raw);
  const anims = doc.getRoot().listAnimations();
  if (!doc.getRoot().listSkins().length || anims.length === 0) throw new Error("animated model has no skeleton or clips");
  anims.forEach((a, i) => {
    const role = ROLES[i];
    if (!role) return;
    a.setExtras({ ...a.getExtras(), meshyName: a.getName() });
    a.setName(role);
  });
  const out = Buffer.from(await io.writeBinary(doc));
  const file = createHash("sha256").update(out).digest("hex") + ".glb";
  const path = join(assetDir, file);
  if (!existsSync(path)) writeFileSync(path, out);
  return { file, clips: anims.map((a) => a.getName()) };
}

export const meshyAnimate: Provider = {
  name: "meshy-animate",
  async generate(job) {
    const p = cleanAnimateParams(job.params);
    if (!p) throw new Error("bad animate params");
    let credits = 0;
    let [stage, id] = (job.providerTask ?? "").split(":") as [string, string | undefined];

    if (!id) {
      const body = { model_url: sourceUrl(job.assetDir, p.source), target_formats: ["glb"], topology: "triangle", target_polycount: 30_000 };
      id = await create(job, "remesh", body);
      stage = "remesh";
      job.onTask(`remesh:${id}`);
    }
    if (stage === "remesh") {
      const t = await waitFor(job, "remesh", id, 2, 40);
      credits += t.consumed_credits ?? 5;
      id = await create(job, "rigging", { input_task_id: id, height_meters: p.heightM });
      stage = "rig";
      job.onTask(`rig:${id}`);
    }
    if (stage === "rig") {
      const t = await waitFor(job, "rigging", id, 40, 60);
      credits += t.consumed_credits ?? 5;
      id = await create(job, "animations", { rig_task_id: id, action_ids: p.actions });
      stage = "anim";
      job.onTask(`anim:${id}`);
    }
    const t = await waitFor(job, "animations", id, 60, 95);
    credits += t.consumed_credits ?? 3 * p.actions.length;
    const url = t.result?.animation_glb_url;
    if (!url) throw new Error("meshy returned no animated glb");
    // Streamed to disk first (download.ts), then read: rigged models are remeshed to ~30k tris (~10 MB)
    const got = await streamToFile(url, job.assetDir, "glb", 200 * 1024 * 1024);
    const raw = join(job.assetDir, got.file);
    const { file, clips } = await finishAnimatedGlb(new Uint8Array(readFileSync(raw)), job.assetDir);
    if (got.file !== file) rmSync(raw, { force: true }); // keep only the renamed copy
    job.archive({ call: "animate.stored", file, clips, credits });
    return { asset: file, costUsd: Math.round(credits * USD_PER_CREDIT * 100) / 100 };
  },
};

/** No Meshy key (dev): copy the source with no skeleton → the client falls back to procedural life. */
export const stubAnimate: Provider = {
  name: "stub-animate",
  async generate(job) {
    const p = cleanAnimateParams(job.params);
    if (!p) throw new Error("bad animate params");
    job.archive({ call: "stub.animate", request: p });
    for (let k = 0; k <= 100; k += 25) {
      job.onProgress(k);
      await sleep(400);
    }
    throw new Error("animating needs the Meshy key (dev stub)");
  },
};

export const animateProvider = (): Provider => (MESHY_KEY ? meshyAnimate : stubAnimate);

