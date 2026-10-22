/**
 * Web-ready copies of generated models. Meshy's textured GLBs are 20–200 MB
 * (several 4K maps each), which decode to hundreds of MB of GPU memory per
 * model and crash the browser's WebGL context. The original is kept forever
 * (research + re-processing); this makes a small copy that the game loads:
 * textures capped at 1024 px as WebP, unused data pruned, duplicates merged.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

sharp.cache(false);
sharp.concurrency(1);

const TEXTURE_PX = 1024;
const MAX_TRIANGLES = 120_000; // a web-friendly budget per model (Meshy can return millions)

export function optPath(assetDir: string, file: string): string {
  return join(assetDir, "opt", file);
}

/** Make assetDir/opt/<file> if missing. Returns its path, or null if it couldn't be made. */
export async function ensureOptimized(assetDir: string, file: string): Promise<string | null> {
  const out = optPath(assetDir, file);
  if (existsSync(out)) return out;
  const src = join(assetDir, file);
  if (!existsSync(src)) return null;
  try {
    mkdirSync(join(assetDir, "opt"), { recursive: true });
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(src);
    await MeshoptSimplifier.ready;
    let tris = 0;
    for (const m of doc.getRoot().listMeshes()) {
      for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION")?.getCount() ?? 0) / 3;
    }
    const ratio = Math.min(1, MAX_TRIANGLES / Math.max(1, tris));
    await doc.transform(
      dedup(),
      ...(ratio < 1 ? [weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.02 })] : []),
      textureCompress({ encoder: sharp, targetFormat: "webp", resize: [TEXTURE_PX, TEXTURE_PX], quality: 85 }),
      prune(),
    );
    await io.write(out, doc);
    console.log(`[optimize] ${file.slice(0, 8)} ${(statSync(src).size / 1048576).toFixed(1)} MB → ${(statSync(out).size / 1048576).toFixed(1)} MB`);
    return out;
  } catch (err) {
    console.error(`[optimize] ${file} failed:`, (err as Error).message);
    return null;
  }
}

/**
 * Same as ensureOptimized, but in a child process and serialized one at a time.
 * Decoding + simplifying a 20+ MB model is seconds of synchronous JS and several
 * hundred MB of heap; running multiple child processes at once during an event
 * crowd manifest would OOM the VPS.
 */
let optChain: Promise<unknown> = Promise.resolve();

export function ensureOptimizedIsolated(assetDir: string, file: string): Promise<string | null> {
  const out = optPath(assetDir, file);
  if (existsSync(out)) return Promise.resolve(out);
  const next = optChain.then(
    () =>
      new Promise<string | null>((resolve) => {
        if (existsSync(out)) return resolve(out);
        const child = fork(fileURLToPath(import.meta.url), ["--optimize-child", assetDir, file], {
          execArgv: process.execArgv,
          execPath: process.execPath,
        });
        child.on("error", (err) => {
          console.error(`[optimize] ${file} child failed:`, err.message);
          resolve(null);
        });
        child.on("exit", () => resolve(existsSync(out) ? out : null));
      }),
  );
  optChain = next.catch(() => null);
  return next;
}

// Child-process entry point (see ensureOptimizedIsolated)
if (process.argv[2] === "--optimize-child") {
  const [, , , assetDir, file] = process.argv;
  ensureOptimized(assetDir, file).then(() => process.exit(0), () => process.exit(1));
}
