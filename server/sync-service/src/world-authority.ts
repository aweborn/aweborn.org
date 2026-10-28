import * as Y from "yjs";
import {
  GUARDED_WORLD_MAPS,
  judgeMapChange,
  judgeObjectChange,
  sameValue,
  type GuardedWorldMap,
  type Rec,
  type WorldActor,
} from "../../../shared/world-policy.js";
import { TERRAIN_EDITS_MAP, TERRAIN_EDIT_LIMITS, parseEditKey, validEditValue } from "../../../shared/terrain-edits.js";

/**
 * Server-side world write authority (Rough Draft M1, 2026-10-27).
 *
 * Clients still send raw Yjs updates (`world-update`, 0x04). Refusing an update
 * whole would break the sender's causal history (every later edit of theirs
 * would wait on the missing one forever), so instead we **apply it, then
 * revert** whatever the actor wasn't allowed to change, in a server
 * transaction that every client (the sender included) receives: the object
 * snaps back. This is ROADMAP's "client-side prediction with server
 * reconciliation", done per field. Phase 09 9F later replaces raw updates with
 * typed intents.
 *
 * The authority keeps a plain mirror of the last *accepted* state of
 * `objects`, `meta`, `physics` and `terrain`, refreshed lazily for whatever
 * changed (tracked from `afterTransaction`), so each check is O(changed).
 */

/** Origin of revert transactions (never a socket, so broadcasts reach everyone). */
export const AUTHORITY_ORIGIN = "authority";

export interface ApplyResult {
  reverted: number;
  /** Object ids / map keys that were reverted (for logs). */
  details: string[];
}

const plain = (v: unknown): unknown => (v instanceof Y.AbstractType ? (v as Y.AbstractType<unknown>).toJSON() : v);

export class WorldAuthority {
  private readonly objectsType: Y.Map<unknown>;
  private readonly mapTypes = new Map<unknown, GuardedWorldMap>();
  private objects = new Map<string, Rec>();
  private maps = new Map<GuardedWorldMap, Rec>();
  private dirtyObjects = new Set<string>();
  private dirtyMaps = new Set<GuardedWorldMap>();
  // Terrain edits (M5d): a big sparse map, so it's mirrored and judged per key, never whole
  private readonly editsType: Y.Map<unknown>;
  private edits = new Map<string, unknown>();
  private dirtyEdits = new Set<string>();

  constructor(private readonly doc: Y.Doc) {
    this.objectsType = doc.getMap("objects");
    for (const name of GUARDED_WORLD_MAPS) this.mapTypes.set(doc.getMap(name), name);
    this.objectsType.forEach((v, id) => {
      const rec = plain(v);
      if (rec && typeof rec === "object") this.objects.set(id, rec as Rec);
    });
    for (const name of GUARDED_WORLD_MAPS) this.maps.set(name, doc.getMap(name).toJSON() as Rec);
    this.editsType = doc.getMap(TERRAIN_EDITS_MAP);
    this.editsType.forEach((v, k) => this.edits.set(k, v));
    doc.on("afterTransaction", this.track);
  }

  destroy(): void {
    this.doc.off("afterTransaction", this.track);
  }

  private track = (tr: Y.Transaction): void => {
    tr.changed.forEach((keys, type) => {
      if ((type as unknown) === this.objectsType) {
        keys.forEach((k) => k && this.dirtyObjects.add(k));
        return;
      }
      if ((type as unknown) === this.editsType) {
        keys.forEach((k) => k && this.dirtyEdits.add(k));
        return;
      }
      const item = (type as unknown as { _item?: { parent?: unknown; parentSub?: string | null } | null })._item;
      if (item && item.parent === this.objectsType && item.parentSub) {
        this.dirtyObjects.add(item.parentSub);
        return;
      }
      const name = this.mapTypes.get(type);
      if (name) this.dirtyMaps.add(name);
    });
  };

  private currentObject(id: string): Rec | undefined {
    const v = plain(this.objectsType.get(id));
    return v && typeof v === "object" ? (v as Rec) : undefined;
  }

  /** Accept everything changed since the last check (server-side writes) into the mirror. */
  private acceptDirty(): void {
    for (const id of this.dirtyObjects) {
      const cur = this.currentObject(id);
      if (cur) this.objects.set(id, cur);
      else this.objects.delete(id);
    }
    for (const name of this.dirtyMaps) this.maps.set(name, this.doc.getMap(name).toJSON() as Rec);
    for (const k of this.dirtyEdits) {
      const v = this.editsType.get(k);
      if (v === undefined) this.edits.delete(k);
      else this.edits.set(k, v);
    }
    this.dirtyObjects.clear();
    this.dirtyMaps.clear();
    this.dirtyEdits.clear();
  }

  /**
   * Apply a client's update as `actor`, then revert whatever it wasn't allowed
   * to change. `allowCreate` is asked once per legal new object (rate limit).
   */
  apply(update: Uint8Array, origin: unknown, actor: WorldActor, allowCreate: () => boolean = () => true): ApplyResult {
    this.acceptDirty();
    Y.applyUpdate(this.doc, update, origin);

    const objIds = [...this.dirtyObjects];
    const mapNames = [...this.dirtyMaps];
    const editKeys = [...this.dirtyEdits];
    this.dirtyObjects.clear();
    this.dirtyMaps.clear();
    this.dirtyEdits.clear();

    const fixes: Array<() => void> = [];
    const details: string[] = [];

    for (const id of objIds) {
      const before = this.objects.get(id);
      const after = this.currentObject(id);
      if (sameValue(before, after)) continue;
      let verdict = judgeObjectChange(actor, before, after);
      if (verdict === "ok" && before === undefined && !allowCreate()) verdict = "revert";
      if (verdict === "revert") {
        details.push(`object:${id}`);
        fixes.push(() => {
          if (before === undefined) this.objectsType.delete(id);
          else {
            const m = new Y.Map<unknown>();
            for (const [k, v] of Object.entries(before)) m.set(k, v);
            this.objectsType.set(id, m);
          }
        });
      }
    }

    for (const name of mapNames) {
      const before = this.maps.get(name) ?? {};
      const type = this.doc.getMap<unknown>(name);
      const after = type.toJSON() as Rec;
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const key of keys) {
        if (judgeMapChange(actor, name, key, before[key], after[key]) === "ok") continue;
        details.push(`${name}.${key}`);
        const prev = before[key];
        fixes.push(() => {
          if (prev === undefined) type.delete(key);
          else type.set(key, prev);
        });
      }
    }

    if (editKeys.length) {
      let size = this.edits.size;
      let writes = 0;
      let refused = 0;
      for (const key of editKeys) {
        const before = this.edits.get(key);
        const after = this.editsType.get(key);
        if (before === after) continue;
        let ok = actor.owner;
        if (ok && after !== undefined) {
          const isNew = before === undefined;
          ok = parseEditKey(key) !== null && validEditValue(after) &&
            ++writes <= TERRAIN_EDIT_LIMITS.maxPerUpdate && (!isNew || size < TERRAIN_EDIT_LIMITS.maxEdits);
          if (ok && isNew) size++;
        } else if (ok && after === undefined) size--;
        if (ok) continue;
        refused++;
        fixes.push(() => {
          if (before === undefined) this.editsType.delete(key);
          else this.editsType.set(key, before);
        });
      }
      if (refused) details.push(`${TERRAIN_EDITS_MAP} x${refused}`);
    }

    if (fixes.length) this.doc.transact(() => fixes.forEach((f) => f()), AUTHORITY_ORIGIN);

    // Whatever stands now is the accepted state.
    for (const id of objIds) this.dirtyObjects.add(id);
    for (const name of mapNames) this.dirtyMaps.add(name);
    for (const k of editKeys) this.dirtyEdits.add(k);
    this.acceptDirty();

    return { reverted: fixes.length, details };
  }
}

/** Sliding-window limiter for object creates, keyed by socket (or anything). */
export class CreateLimiter<K extends object> {
  private hits = new WeakMap<K, number[]>();
  constructor(private readonly max = 60, private readonly windowMs = 30_000) {}

  take(key: K, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }
}
