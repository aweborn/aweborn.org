/**
 * Card sets (Rough Draft M6d; ROADMAP World Index "Collector view").
 *
 *   public GET    /card-sets                 → { sets: CardSet[] }  (small; cached 5 min)
 *   admin  GET    /api/admin/card-sets       → { sets }
 *          POST   /api/admin/card-sets       { id, name, worldIds[] } → upsert
 *          DELETE /api/admin/card-sets/:id
 *
 * A set is an ordered list of worlds Aweborn curates. The World Index groups
 * your cards by set with "n / total discovered"; the print tool puts the set
 * name and number on the card. The Origin Set (just the portal) is seeded.
 *
 * Sets are public (anyone can fetch the list, like the world lookup) and only
 * hold world ids, never player data.
 */
import type Database from "better-sqlite3";
import { CARD_SET_LIMITS, ORIGIN_SET_ID, isCardSetId, parseCardSet, type CardSet } from "../../../shared/cards.js";
import { ORIGIN_WORLD_ID, isWorldId } from "../../../shared/crdt-schema.js";

type Fail = { ok: false; status: number; error: string; message?: string };

export class CardSets {
  private cache: CardSet[] | null = null;

  constructor(
    private readonly db: Database.Database,
    /** True if the world is in the universe now (admins can't add worlds that don't exist). */
    private readonly worldExists: (id: string) => boolean,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS card_sets (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, world_ids TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    const t = this.now();
    db.prepare("INSERT OR IGNORE INTO card_sets (id, name, world_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(ORIGIN_SET_ID, "Origin Set", JSON.stringify([ORIGIN_WORLD_ID]), t, t);
  }

  /** Every set, oldest first (the Origin Set leads). */
  list(): CardSet[] {
    if (this.cache) return this.cache;
    const rows = this.db.prepare("SELECT id, name, world_ids FROM card_sets ORDER BY id != ?, created_at, id LIMIT ?")
      .all(ORIGIN_SET_ID, CARD_SET_LIMITS.maxSets) as { id: string; name: string; world_ids: string }[];
    this.cache = rows.map((r) => {
      let worldIds: string[] = [];
      try {
        const v = JSON.parse(r.world_ids) as unknown;
        if (Array.isArray(v)) worldIds = v.filter((x): x is string => typeof x === "string");
      } catch { /* a broken row lists no worlds */ }
      return { id: r.id, name: r.name, worldIds };
    });
    return this.cache;
  }

  upsert(body: unknown): { ok: true; set: CardSet } | Fail {
    const p = parseCardSet(body, isWorldId);
    if (!p.ok) return { ok: false, status: 400, error: "bad_set", message: p.message };
    const missing = p.set.worldIds.find((id) => !this.worldExists(id));
    if (missing) return { ok: false, status: 404, error: "no_world", message: `not in the universe: ${missing}` };
    const exists = this.db.prepare("SELECT 1 FROM card_sets WHERE id = ?").get(p.set.id);
    const count = (this.db.prepare("SELECT COUNT(*) AS n FROM card_sets").get() as { n: number }).n;
    if (!exists && count >= CARD_SET_LIMITS.maxSets) return { ok: false, status: 409, error: "too_many_sets" };
    const t = this.now();
    this.db.prepare(`INSERT INTO card_sets (id, name, world_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, world_ids = excluded.world_ids, updated_at = excluded.updated_at`)
      .run(p.set.id, p.set.name, JSON.stringify(p.set.worldIds), t, t);
    this.cache = null;
    return { ok: true, set: p.set };
  }

  remove(id: string): { ok: true } | Fail {
    if (!isCardSetId(id)) return { ok: false, status: 400, error: "bad_set" };
    if (id === ORIGIN_SET_ID) return { ok: false, status: 409, error: "origin_set", message: "The Origin Set stays." };
    const n = this.db.prepare("DELETE FROM card_sets WHERE id = ?").run(id).changes;
    this.cache = null;
    return n ? { ok: true } : { ok: false, status: 404, error: "no_set" };
  }
}
