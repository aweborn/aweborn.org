/**
 * Minds you can keep and bring back (Alex, 2026-11-06): a mind is saved to the Library
 * and given to any creation in any world, and its whole history shows how it was written.
 *
 * Storage is like git (decided 2026-11-06):
 *   - every version of a mind is a **node**, stored once and named by the hash of what it
 *     holds (the words, the exact request the persona compiler got, the compiler's system
 *     prompt and model at the time, the persona that came out, who and when), pointing at
 *     the version it grew from;
 *   - a creation's mind is a pointer to its newest node (its **head**);
 *   - saving to the Library publishes a head; giving a saved mind to a creation points the
 *     creation at that same node, and what it learns from then on grows its own branch.
 *     Nothing is copied, nothing anyone else made changes, and every branch can trace back
 *     to where it came from.
 *   - a saved mind **brings its memories** (Alex): the few facts it kept about players come
 *     along. They are only ever used when that same player talks to it.
 *   - the Library is public, like made models: its creator is credited and the words that
 *     built it (every version, everyone who grew it) can be read.
 */
import type { Persona } from "./life.js";
import type { ObjectLife } from "./life.js";

/** One version of a mind, as the history shows it (newest first in MindHistory). */
export interface MindVersion {
  id: string;
  parent: string | null;
  /** grow: words compiled into it · import: a version written before histories were kept in full */
  kind: "grow" | "import";
  /** Who wrote it: their character's name. */
  by: string;
  /** The words the player typed, exactly. */
  prompt: string;
  /** Exactly what the persona compiler was sent for these words (null before 2026-11-06). */
  request: string | null;
  /** Key into MindHistory.systems: the compiler's instructions at the time. */
  system: string | null;
  /** The model that wrote it (OpenRouter id). */
  model: string | null;
  /** What the mind became. */
  persona: Persona;
  at: number;
  /** The world it was written in (its name now), if it still exists. */
  world: string | null;
  /** Written on this very creation (false: on another one this mind branched from). */
  here: boolean;
}

export interface MindHistory {
  head: string | null;
  versions: MindVersion[];
  /** Compiler instructions by key, each sent once. */
  systems: Record<string, string>;
  /** Where this creation's mind came from when it was given a saved one. */
  origin?: { libraryId: string; name: string; savedBy: string; at: number };
  /** Its newest version is in the Library (that entry's id). */
  saved?: string;
}

/** A saved mind on the Library's Minds shelf. */
export interface LibraryMind {
  id: string;
  name: string;
  epithet: string;
  greeting: string;
  voice: string;
  /** Character name of whoever saved it. */
  savedBy: string;
  savedAt: number;
  /** How many versions led to it. */
  versions: number;
  /** The body it was saved with (placing it from the shelf brings this body). */
  body: { asset: string; stillAsset?: string; life?: ObjectLife | null; scale: [number, number, number]; prompt?: string };
  /** The viewer saved it (may remove it from the shelf). */
  mine?: boolean;
}

export const MIND_LIBRARY_LIMITS = {
  /** Versions walked back through a lineage. */
  lineage: 200,
  /** Facts about players a saved mind brings with it. */
  memories: 600,
  /** Shelf page size. */
  page: 60,
} as const;
