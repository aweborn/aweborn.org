/**
 * How a world was made (Alex, 2026-11-02): the planner conversations that shaped a world
 * stay with it, readable by everyone who visits, like a plaque by the door. Anything
 * written in a world stays there.
 *
 *   GET /making-of?worldId=<id> → MakingOf   (public, sync-service making-of.ts)
 *
 * Built from the planner's own log (plan_sessions / plan_events), so it's the real history:
 * what the player said, what the planner answered, the hand edits, restores and manifests.
 * A request the safety check refused never appears (and wasn't part of the planner's
 * context either). Player words get the same cleaning + masking as world chat.
 */

export type MakingOfEntry =
  | { kind: "player"; at: number; text: string }
  | { kind: "planner"; at: number; text: string; chips: string[]; model: string; version: number }
  /** A hand edit, a restore, a remade item or a manifest: one short line. */
  | { kind: "note"; at: number; text: string; version?: number };

export interface MakingOfSession {
  id: string;
  /** An anonymous label for this world ("Maker 1", "Maker 2"…), never a name (Alex, 2026-11-10). */
  by: string;
  startedAt: number;
  /** Name the plan carried at the end of this conversation. */
  plan?: string;
  entries: MakingOfEntry[];
}

export interface MakingOf {
  worldId: string;
  /** Oldest first: the order the world was made in. */
  sessions: MakingOfSession[];
}

/** Bounds on what one response carries (a world's history can grow for years). */
export const MAKING_OF_LIMITS = { sessions: 60, entriesPerSession: 600, text: 1000 } as const;

export const hasMakingOf = (m: MakingOf | null | undefined): m is MakingOf =>
  !!m && m.sessions.some((s) => s.entries.some((e) => e.kind === "planner"));

