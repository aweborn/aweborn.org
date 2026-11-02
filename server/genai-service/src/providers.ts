/**
 * Generation providers (Phase 07). Swappable: the mana cost comes from the
 * cost table (MANA_COSTS.md), not from which provider ran.
 *
 * - meshy: Meshy text-to-3D, preview mode (untextured mesh, fastest/cheapest)
 * - stub:  no key configured; returns a sample GLB after a short fake wait,
 *          so the whole loop (mana, jobs, client) can be built and tested
 */
import { writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { isMediaKind, mediaProvider } from "./media.js";
import { animateProvider } from "./rig.js";
import { streamToFile } from "./download.js";

export interface ProviderJob {
  id: string;
  prompt: string;
  /** Provider task id if one was already started (resume after restart). */
  providerTask: string | null;
  /** Per-kind options (media: seconds, loop). */
  params?: Record<string, unknown>;
  assetDir: string;
  onTask(task: string): void;
  onProgress(percent: number): void;
  archive(entry: Record<string, unknown>): void;
}

export interface ProviderResult {
  /** Content-addressed file name in assetDir (sha256.glb). */
  asset: string;
  costUsd: number;
}

export interface Provider {
  name: string;
  generate(job: ProviderJob): Promise<ProviderResult>;
}

/** Meshy preview ≈ 20 credits × $0.02 (MANA_COSTS.md prices credits at $0.02). */
export const MESHY_PREVIEW_USD = 0.4;
/** Texture refine: 10 credits × $0.02. */
const MESHY_REFINE_USD = 0.2;

const MESHY_KEY = process.env.MESHY_API_KEY ?? "";
const MESHY_BASE = "https://api.meshy.ai/openapi/v2/text-to-3d";
const POLL_MS = 4000;
/**
 * Per stage (preview, then refine each get their own clock). Meshy's refine
 * alone took ~12 min on prod (haze tree, 2026-11-01) and an overall 10 min
 * budget failed a model Meshy then finished and billed.
 */
const TIMEOUT_MS = 20 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Download a GLB and store it under its sha256 (dedupes identical files), streamed to disk (download.ts). */
async function storeGlb(url: string, assetDir: string): Promise<{ file: string; bytes: number }> {
  return streamToFile(url, assetDir, "glb");
}

/**
 * Originals above this get their web copy from Meshy instead of from our box: the
 * optimizer decodes a model many times over in memory (library.ts skips files above
 * 30 MB), so a 313 MB tree would otherwise reach players at full size.
 */
const WEB_SOURCE_OVER_BYTES = 30 * 1024 * 1024;
/** Triangles in the web copy (matches optimize.ts MAX_TRIANGLES). */
const WEB_POLYCOUNT = 120_000;

/**
 * "Optimize while streaming" (Alex, 2026-11-01): mesh simplification needs the whole
 * mesh, so it can't run on a byte stream; instead Meshy does it on their side.
 * Remesh the finished model to ~120k triangles, stream that small file down, and keep
 * it as the source of the web copy (`websrc/<original>.glb`). The original is kept too.
 * Best effort: on any failure the original stays the only copy (as before).
 */
async function webSourceFromMeshy(job: ProviderJob, refineTask: string, original: string): Promise<number> {
  const headers = { Authorization: `Bearer ${MESHY_KEY}`, "Content-Type": "application/json" };
  try {
    const body = { input_task_id: refineTask, target_formats: ["glb"], topology: "triangle", target_polycount: WEB_POLYCOUNT };
    job.archive({ call: "meshy.remesh-web", request: body });
    const r = await fetch("https://api.meshy.ai/openapi/v1/remesh", { method: "POST", headers, body: JSON.stringify(body) });
    const rj = (await r.json().catch(() => ({}))) as { result?: string; message?: string };
    job.archive({ call: "meshy.remesh-web", status: r.status, response: rj });
    if (!r.ok || !rj.result) return 0;
    const started = Date.now();
    for (;;) {
      if (Date.now() - started > TIMEOUT_MS) return 0;
      await sleep(POLL_MS);
      const res = await fetch(`https://api.meshy.ai/openapi/v1/remesh/${rj.result}`, { headers });
      if (!res.ok) continue;
      const t = (await res.json()) as { status: string; model_urls?: { glb?: string }; consumed_credits?: number };
      if (t.status === "FAILED" || t.status === "CANCELED") return 0;
      if (t.status !== "SUCCEEDED" || !t.model_urls?.glb) continue;
      mkdirSync(join(job.assetDir, "websrc"), { recursive: true });
      const got = await streamToFile(t.model_urls.glb, join(job.assetDir, "websrc"), "glb", 200 * 1024 * 1024);
      // Named after the original so the optimizer finds it (optimize.ts webSourcePath)
      renameSync(join(job.assetDir, "websrc", got.file), join(job.assetDir, "websrc", original));
      job.archive({ call: "meshy.remesh-web.stored", original, bytes: got.bytes, credits: t.consumed_credits ?? null });
      return (t.consumed_credits ?? 5) * 0.02;
    }
  } catch (err) {
    job.archive({ call: "meshy.remesh-web", error: (err as Error).message });
    return 0;
  }
}

/** Best-effort preview image, stored beside the model as <sha>.png (library thumbnail). */
async function storeThumb(url: string | undefined, glbName: string, assetDir: string): Promise<void> {
  if (!url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const path = join(assetDir, glbName.replace(/\.glb$/, ".png"));
    if (!existsSync(path)) writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  } catch {
    /* thumbnails are optional */
  }
}

const meshy: Provider = {
  name: "meshy",
  async generate(job) {
    const headers = { Authorization: `Bearer ${MESHY_KEY}`, "Content-Type": "application/json" };
    let task = job.providerTask;
    let refining = false;
    /** The finished preview a refine came from (`refine:<refine>:<preview>`; older rows have none). */
    let preview: string | null = null;
    if (task?.startsWith("refine:")) {
      refining = true;
      const [refine, from] = task.slice(7).split(":");
      task = refine;
      preview = from || null;
    }
    if (!task) {
      // A creature meant to come alive is made in an A-pose: arms clear of the body rig cleanly
      // (arms-down models rig, but raised-arm clips stretch the skin; Lost colossus, 2026-11-01)
      const pose = job.params?.pose === "a-pose" ? { pose_mode: "a-pose" } : {};
      const body = { mode: "preview", prompt: job.prompt, ...pose };
      job.archive({ call: "meshy.create", request: body });
      const res = await fetch(MESHY_BASE, { method: "POST", headers, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { result?: string; message?: string };
      job.archive({ call: "meshy.create", status: res.status, response: json });
      if (!res.ok || !json.result) throw new Error(`meshy create failed: ${res.status} ${json.message ?? ""}`.trim());
      task = json.result;
      job.onTask(task);
    }
    let started = Date.now();
    for (;;) {
      if (Date.now() - started > TIMEOUT_MS) throw new Error(`meshy ${refining ? "refine" : "preview"} timed out`);
      await sleep(POLL_MS);
      const res = await fetch(`${MESHY_BASE}/${task}`, { headers });
      if (!res.ok) continue; // transient; keep polling until timeout
      const t = (await res.json()) as {
        status: string; progress?: number; model_urls?: { glb?: string }; thumbnail_url?: string;
        task_error?: { message?: string };
      };
      // Preview is the first half of the bar, texturing the second
      job.onProgress(refining ? 50 + (t.progress ?? 0) / 2 : (t.progress ?? 0) / 2);
      if (t.status === "SUCCEEDED" && !refining) {
        // Shape done; now texture it (colour + PBR materials)
        job.archive({ call: "meshy.result", task, response: t });
        const body = { mode: "refine", preview_task_id: task, enable_pbr: true };
        job.archive({ call: "meshy.refine", request: body });
        const r = await fetch(MESHY_BASE, { method: "POST", headers, body: JSON.stringify(body) });
        const rj = (await r.json().catch(() => ({}))) as { result?: string; message?: string };
        job.archive({ call: "meshy.refine", status: r.status, response: rj });
        if (!r.ok || !rj.result) throw new Error(`meshy refine failed: ${r.status} ${rj.message ?? ""}`.trim());
        preview = task;
        task = rj.result;
        refining = true;
        started = Date.now(); // the texture pass gets its own clock
        job.onTask(`refine:${task}:${preview}`);
        continue;
      }
      if (t.status === "SUCCEEDED") {
        job.archive({ call: "meshy.result", task, response: t });
        if (!t.model_urls?.glb) throw new Error("meshy returned no glb");
        const { file: asset, bytes } = await storeGlb(t.model_urls.glb, job.assetDir);
        job.archive({ call: "meshy.stored", asset, bytes });
        await storeThumb(t.thumbnail_url, asset, job.assetDir);
        // A huge original gets its (small) web copy remeshed by Meshy, not by our box
        const extra = bytes > WEB_SOURCE_OVER_BYTES && MESHY_KEY ? await webSourceFromMeshy(job, task, asset) : 0;
        return { asset, costUsd: MESHY_PREVIEW_USD + MESHY_REFINE_USD + (extra || 0) };
      }
      if (t.status === "FAILED" || t.status === "CANCELED") {
        job.archive({ call: "meshy.result", task, response: t });
        // A failed texture pass retries from the finished shape (retry.ts), not from scratch
        throw Object.assign(new Error(`meshy ${t.status.toLowerCase()}: ${t.task_error?.message ?? ""}`.trim()), {
          resumeTask: refining ? preview : null,
        });
      }
    }
  },
};

const SAMPLE_GLB = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb";

const stub: Provider = {
  name: "stub",
  async generate(job) {
    job.archive({ call: "stub.create", request: { prompt: job.prompt } });
    for (let p = 0; p <= 100; p += 25) {
      job.onProgress(p);
      await sleep(800);
    }
    return { asset: (await storeGlb(SAMPLE_GLB, job.assetDir)).file, costUsd: 0 };
  },
};

export function providerFor(kind: string): Provider {
  if (isMediaKind(kind)) return mediaProvider(kind);
  if (kind === "animate") return animateProvider();
  if (kind !== "model") throw new Error(`unsupported kind: ${kind}`);
  return MESHY_KEY ? meshy : stub;
}
