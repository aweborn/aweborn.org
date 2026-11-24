/**
 * Deleting a player, this service's part (sync-service erase-player.ts calls POST /forget).
 *
 * jobs.db holds the maker's player id in two forms: `jobs.creator` (the id itself) and
 * `library.creator` (a 6-hex pseudonym of it). When a player is deleted:
 *   - what they had removed from the Library (the private trash) is deleted forever
 *     (Privacy: "until you ask us to delete it with your player");
 *   - what is still on the shelves stays, because other players' worlds use it, and
 *     loses its maker;
 *   - their job history loses the player id. The prompt and the research id stay: that is
 *     the archive of AI requests the Privacy page says is kept under the research id.
 * Theirs = made by a job of theirs (the exact id), never matched by the 6-hex pseudonym,
 * which two players can share.
 *
 * Idempotent: a second call finds nothing.
 */
import type { DatabaseSync } from "node:sqlite";

export interface ForgetCounts { genai_jobs: number; genai_library: number; genai_trash: number }

export async function forgetMakers(
  db: DatabaseSync,
  playerIds: readonly string[],
  /** Delete one trashed asset forever (library.ts purgeAsset: row, files, bucket objects). */
  purge: (sha: string) => Promise<boolean>,
): Promise<ForgetCounts> {
  const ids = [...new Set(playerIds)].filter((id) => typeof id === "string" && id.length > 0 && id.length <= 80);
  const out: ForgetCounts = { genai_jobs: 0, genai_library: 0, genai_trash: 0 };
  if (ids.length === 0) return out;
  const marks = ids.map(() => "?").join(",");
  const theirs = `job_id IN (SELECT id FROM jobs WHERE creator IN (${marks}))`;
  const trash = db.prepare(`SELECT sha FROM library WHERE removed_at IS NOT NULL AND ${theirs}`).all(...ids) as { sha: string }[];
  for (const t of trash) if (await purge(t.sha)) out.genai_trash++;
  out.genai_library = Number(db.prepare(`UPDATE library SET creator = NULL WHERE creator IS NOT NULL AND ${theirs}`).run(...ids).changes);
  out.genai_jobs = Number(db.prepare(`UPDATE jobs SET creator = NULL WHERE creator IN (${marks})`).run(...ids).changes);
  return out;
}
