/**
 * Generation providers (Phase 07). Swappable: the mana cost comes from the
 * cost table (MANA_COSTS.md), not from which provider ran.
 *
 * - meshy: Meshy text-to-3D, preview mode (untextured mesh, fastest/cheapest)
 * - stub:  no key configured; returns a sample GLB after a short fake wait,
 *          so the whole loop (mana, jobs, client) can be built and tested
 */
import { createHash } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ProviderJob {
  id: string;
  prompt: string;
  /** Provider task id if one was already started (resume after restart). */
  providerTask: string | null;
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

const MESHY_KEY = process.env.MESHY_API_KEY ?? "";
const MESHY_BASE = "https://api.meshy.ai/openapi/v2/text-to-3d";
const POLL_MS = 4000;
const TIMEOUT_MS = 10 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Download a GLB and store it under its sha256 (dedupes identical files). */
async function storeGlb(url: string, assetDir: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 50 * 1024 * 1024) throw new Error("asset too large");
  const name = createHash("sha256").update(buf).digest("hex") + ".glb";
  const path = join(assetDir, name);
  if (!existsSync(path)) writeFileSync(path, buf);
  return name;
}

const meshy: Provider = {
  name: "meshy",
  async generate(job) {
    const headers = { Authorization: `Bearer ${MESHY_KEY}`, "Content-Type": "application/json" };
    let task = job.providerTask;
    if (!task) {
      const body = { mode: "preview", prompt: job.prompt };
      job.archive({ call: "meshy.create", request: body });
      const res = await fetch(MESHY_BASE, { method: "POST", headers, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { result?: string; message?: string };
      job.archive({ call: "meshy.create", status: res.status, response: json });
      if (!res.ok || !json.result) throw new Error(`meshy create failed: ${res.status} ${json.message ?? ""}`.trim());
      task = json.result;
      job.onTask(task);
    }
    const started = Date.now();
    for (;;) {
      if (Date.now() - started > TIMEOUT_MS) throw new Error("meshy timed out");
      await sleep(POLL_MS);
      const res = await fetch(`${MESHY_BASE}/${task}`, { headers });
      if (!res.ok) continue; // transient; keep polling until timeout
      const t = (await res.json()) as {
        status: string; progress?: number; model_urls?: { glb?: string };
        task_error?: { message?: string };
      };
      job.onProgress(t.progress ?? 0);
      if (t.status === "SUCCEEDED") {
        job.archive({ call: "meshy.result", task, response: t });
        if (!t.model_urls?.glb) throw new Error("meshy returned no glb");
        return { asset: await storeGlb(t.model_urls.glb, job.assetDir), costUsd: MESHY_PREVIEW_USD };
      }
      if (t.status === "FAILED" || t.status === "CANCELED") {
        job.archive({ call: "meshy.result", task, response: t });
        throw new Error(`meshy ${t.status.toLowerCase()}: ${t.task_error?.message ?? ""}`.trim());
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
    return { asset: await storeGlb(SAMPLE_GLB, job.assetDir), costUsd: 0 };
  },
};

export function providerFor(kind: string): Provider {
  if (kind !== "model") throw new Error(`unsupported kind: ${kind}`);
  return MESHY_KEY ? meshy : stub;
}
