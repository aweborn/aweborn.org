/**
 * Remove + Trash for library assets (Phase 07). Nothing is deleted on remove: the asset
 * moves to the trash (hidden from the library, files kept, placed copies keep working).
 * Only an admin can restore, or delete forever.
 *
 *   POST   /api/player/library/:sha/remove   the maker removes their own asset (session cookie)
 *   -- admin (Authorization: Bearer $MANA_ADMIN_TOKEN) --
 *   POST   /api/admin/library/:sha/remove    remove anyone's asset
 *   GET    /api/admin/trash                  everything in the trash
 *   POST   /api/admin/trash/:sha/restore
 *   DELETE /api/admin/trash/:sha             delete forever (row + files + bucket objects)
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";

const GENAI_URL = process.env.GENAI_URL ?? "http://genai-service:3001";
const SHA = /^[a-f0-9]{64}$/;

type Json = (status: number, body: unknown) => void;

/** Same pseudonym genai-service stores on each library row (library.ts addToLibrary). */
export function creatorHash(playerId: string): string {
  return createHash("sha256").update(playerId).digest("hex").slice(0, 6);
}

async function genai(path: string, method: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${GENAI_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res) return { status: 503, data: { error: "genai_unavailable" } };
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/** A maker removes one of their own assets. Anything without a maker (planner-made) is admin-only. */
export async function removeOwnAsset(playerId: string, sha: string, json: Json): Promise<void> {
  if (!SHA.test(sha)) return json(400, { error: "bad_request" });
  const r = await genai(`/library/${sha}/remove`, "POST", { by: `maker:${creatorHash(playerId)}`, onlyCreator: creatorHash(playerId) });
  if (r.status === 404) return json(404, { error: "not_yours_or_gone" });
  return json(r.status === 200 ? 200 : 503, r.status === 200 ? { ok: true } : { error: "genai_unavailable" });
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Any player whose browser rendered a missing Library thumbnail can share the PNG back
 * once so future visitors load `<sha>.png` directly instead of downloading the GLB.
 */
export async function uploadAssetThumb(sha: string, dataUrl: unknown, json: Json): Promise<void> {
  if (!SHA.test(sha) || typeof dataUrl !== "string") return json(400, { error: "bad_request" });
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  if (!b64 || b64.length > 220_000) return json(400, { error: "bad_png" });
  let head: Buffer;
  try {
    head = Buffer.from(b64.slice(0, 24), "base64");
  } catch {
    return json(400, { error: "bad_png" });
  }
  if (head.length < 8 || !head.subarray(0, 8).equals(PNG_MAGIC)) return json(400, { error: "bad_png" });
  const r = await genai(`/library/${sha}/thumb`, "POST", { pngBase64: b64 });
  if (r.status === 404) return json(404, { error: "not_found" });
  if (r.status === 400) return json(400, r.data);
  return json(r.status === 200 ? 200 : 503, r.status === 200 ? { ok: true } : { error: "genai_unavailable" });
}

/** Admin routes. Returns false if the path isn't ours. */
export function handleTrashAdmin(req: IncomingMessage, res: ServerResponse, path: string, token: string, cors: Record<string, string>): boolean {
  if (!path.startsWith("/api/admin/trash") && !path.startsWith("/api/admin/library/")) return false;
  const json: Json = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors });
    res.end(JSON.stringify(body));
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...cors,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return true;
  }
  void (async () => {
    if (!token) return json(503, { error: "admin_disabled" });
    const got = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    const want = Buffer.from(token);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return json(401, { error: "unauthorized" });

    let m: RegExpExecArray | null;
    if (path === "/api/admin/trash" && req.method === "GET") {
      const r = await genai("/trash", "GET");
      return json(r.status, r.data);
    }
    if ((m = /^\/api\/admin\/library\/([a-f0-9]{64})\/remove$/.exec(path)) && req.method === "POST") {
      const r = await genai(`/library/${m[1]}/remove`, "POST", { by: "admin" });
      return json(r.status, r.data);
    }
    if ((m = /^\/api\/admin\/trash\/([a-f0-9]{64})\/restore$/.exec(path)) && req.method === "POST") {
      const r = await genai(`/trash/${m[1]}/restore`, "POST");
      return json(r.status, r.data);
    }
    if ((m = /^\/api\/admin\/trash\/([a-f0-9]{64})$/.exec(path)) && req.method === "DELETE") {
      const r = await genai(`/trash/${m[1]}`, "DELETE");
      return json(r.status, r.data);
    }
    return json(404, { error: "not_found" });
  })().catch((err: unknown) => {
    console.error("[trash-api]", err);
    if (!res.headersSent) json(500, { error: "internal" });
  });
  return true;
}
