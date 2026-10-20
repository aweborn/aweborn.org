import * as Y from "yjs";

type Id = { client: number; clock: number };
interface Struct {
  id: Id;
  length: number;
  parent?: unknown;
  origin?: Id | null;
  rightOrigin?: Id | null;
}

/**
 * Does a client's CRDT update try to write or delete anything in the world's
 * chat log? Chat is server-written only (so every line carries the sender the
 * server saw, after cleaning, filtering and rate limiting), so such updates
 * are refused whole.
 *
 * An inserted item names its parent outright only when it has no neighbours;
 * otherwise the parent is implied by the item it sits next to (its origin), so
 * we follow origins, first through the update itself, then through the doc.
 */
export function touchesChat(doc: Y.Doc, update: Uint8Array): boolean {
  const { structs, ds } = Y.decodeUpdate(update);
  const chat = doc.getArray("chat");
  const local = structs as unknown as Struct[];

  const lookup = (id: Id): Struct | null => {
    const inUpdate = local.find((s) => s.id.client === id.client && s.id.clock <= id.clock && id.clock < s.id.clock + s.length);
    if (inUpdate) return inUpdate;
    try {
      return Y.getItem(doc.store, Y.createID(id.client, id.clock)) as unknown as Struct;
    } catch {
      return null;
    }
  };

  const inChat = (s: Struct, depth: number): boolean => {
    if (depth > 64) return false;
    const p = s.parent;
    if (typeof p === "string") return p === "chat";
    if (p === chat) return true;
    if (p instanceof Y.AbstractType) return false;
    const next = p && typeof p === "object" ? (p as Id) : (s.origin ?? s.rightOrigin ?? null);
    const found = next ? lookup(next) : null;
    return found ? inChat(found, depth + 1) : false;
  };

  for (const s of local) {
    if (typeof s.length === "number" && "origin" in s && inChat(s, 0)) return true;
  }
  for (let it = chat._start; it; it = it.right) {
    const ranges = ds.clients.get(it.id.client);
    if (ranges?.some((r) => r.clock < it.id.clock + it.length && it.id.clock < r.clock + r.len)) return true;
  }
  return false;
}
