/**
 * Output gate (2026-11-10, Phase 07 "Gaps before 18+"): check what generation
 * *produced*, not only what was asked for, before anyone else can see it.
 *
 * genai catalogues every finished file as `unrated`, and unrated files stay off
 * the public Library shelves. This rates them:
 *   - pictures: the image itself (vision check)
 *   - models:   Meshy's preview render (<sha>.png); without one, the words it was made from
 *   - sounds, music, voices: the words (an audio check would need a transcript; not yet)
 * A pass rates the file `everyone`; a hard-line hit rates it `blocked` (genai then never
 * serves it again). If the check can't run, the file stays `unrated` and is tried again.
 *
 * Two callers: the maker's own status poll (creations.ts), so a blocked file never
 * reaches their world, and a background sweep that rates everything else, including
 * the Library from before this existed.
 */
import { checkCreation, checkImage, type SafetyVerdict } from "./safety.js";

const GENAI_URL = process.env.GENAI_URL ?? "http://genai-service:3001";
/** genai /llm takes images up to 600k characters as a data URL. */
const MAX_DATA_URL = 590_000;

export type GateResult = "everyone" | "blocked" | "unavailable";
export interface GateAsset { sha: string; file: string; kind: string; prompt: string }

type Fetcher = (url: string) => Promise<Response | null>;
let fetcher: Fetcher = (url) => fetch(url).catch(() => null);
/** Tests swap genai. */
export function setGateFetchForTests(fn: Fetcher | null) {
  fetcher = fn ?? ((url) => fetch(url).catch(() => null));
}

const MIME: Record<string, string> = { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" };

async function dataUrlOf(file: string): Promise<string | null | "too_big"> {
  const res = await fetcher(`${GENAI_URL}/assets/${file}`);
  if (!res || !res.ok) return null;
  const mime = MIME[file.split(".").pop() ?? ""] ?? "image/png";
  const url = `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  return url.length > MAX_DATA_URL ? "too_big" : url;
}

function verdictToResult(v: SafetyVerdict): GateResult {
  if (v.ok) return "everyone";
  return v.category === "unavailable" ? "unavailable" : "blocked";
}

/** Check one finished file and record the rating with genai. */
export async function rateOutput(asset: GateAsset, playerId: string | null): Promise<GateResult> {
  const ref = `out:${asset.sha.slice(0, 12)}`;
  let result: GateResult;
  if (asset.kind === "image") {
    const url = await dataUrlOf(asset.file);
    result = url === null || url === "too_big" ? "unavailable" : verdictToResult(await checkImage(playerId, "out:image", url, ref));
  } else if (asset.kind === "model") {
    const url = await dataUrlOf(`${asset.sha}.png`);
    if (url === null) result = verdictToResult(await checkCreation(playerId, "out:model-words", [asset.prompt], ref));
    else if (url === "too_big") result = "unavailable";
    else result = verdictToResult(await checkImage(playerId, "out:model", url, ref));
  } else {
    result = verdictToResult(await checkCreation(playerId, `out:${asset.kind}-words`, [asset.prompt], ref));
  }
  if (result === "unavailable") return result;
  const res = await fetcher2(`${GENAI_URL}/library/${asset.sha}/rating`, { rating: result });
  if (!res?.ok) return "unavailable";
  const body = (await res.json().catch(() => ({}))) as { rating?: string };
  // Only ever raised: a file already blocked (or adult, later) stays that way
  return body.rating === "everyone" ? "everyone" : body.rating ? "blocked" : "unavailable";
}

type Poster = (url: string, body: unknown) => Promise<Response | null>;
let fetcher2: Poster = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
export function setGatePostForTests(fn: Poster | null) {
  fetcher2 = fn ?? ((url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null));
}

/** One sweep: rate a small batch of unrated files (index.ts runs it every minute). */
export async function sweepUnrated(batch = 5): Promise<{ rated: number; blocked: number; waiting: number }> {
  const res = await fetcher(`${GENAI_URL}/library/unrated?limit=${batch}`);
  if (!res?.ok) return { rated: 0, blocked: 0, waiting: 0 };
  const { assets } = (await res.json()) as { assets: (GateAsset & { thumb: number })[] };
  let rated = 0, blocked = 0, waiting = 0;
  for (const a of assets) {
    const r = await rateOutput(a, null);
    if (r === "everyone") rated++;
    else if (r === "blocked") blocked++;
    else waiting++;
  }
  return { rated, blocked, waiting };
}
