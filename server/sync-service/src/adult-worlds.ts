/**
 * 18+ worlds: their real names (Phase 07 → "18+ worlds", decision 8, veiled worlds).
 *
 * The universe doc goes to every client, and is cached offline, so an 18+ world's entry
 * there holds no real name (`ADULT_WORLD_NAME`) and no music. The real name lives here
 * and in the world's own doc, and is given only to players behind the 18+ door
 * (`GET /api/player/adult-worlds`). Because a world's tier is fixed when it is made
 * (Alex, 2026-11-24), the name never has to be pulled back out of anything shared.
 *
 * Pure SQL over the minimal db interface, so tests run on node:sqlite.
 */
import type { SqlDb } from "./build-requests.js";

export class AdultWorlds {
  constructor(private readonly db: SqlDb) {
    db.exec("CREATE TABLE IF NOT EXISTS adult_world_names (world_id TEXT PRIMARY KEY, name TEXT NOT NULL);");
  }

  setName(worldId: string, name: string): void {
    this.db.prepare("INSERT INTO adult_world_names (world_id, name) VALUES (?, ?) ON CONFLICT(world_id) DO UPDATE SET name = excluded.name").run(worldId, name);
  }

  name(worldId: string): string | undefined {
    return (this.db.prepare("SELECT name FROM adult_world_names WHERE world_id = ?").get(worldId) as { name: string } | undefined)?.name;
  }

  /** Every 18+ world's real name, by world id. */
  names(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.db.prepare("SELECT world_id, name FROM adult_world_names").all() as { world_id: string; name: string }[]) out[r.world_id] = r.name;
    return out;
  }
}
