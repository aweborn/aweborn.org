/**
 * Progression (Rough Draft M3, 2026-10-27): awe = the character's experience.
 *
 * Phase 05 "Experience & Levels" + "Awe → Experience": a level is a mix of
 * mana channeled into creations and breadth of skills (Alex, 2026-10-14);
 * awe events grant XP and **never** move the high-water line (Alex,
 * 2026-10-27, a deviation from ROADMAP logged in Phase 05).
 *
 * Chapters are the beginner ladder, warp last (2026-10-14):
 *   1 First light   fly + steer
 *   2 Pilot         drive mode, brake, approach a world
 *   3 Visitor       enter + leave a world
 *   4 Builder       place + move/arrange objects
 *   5 Maker         every maker tool once (today: make an object, shape
 *                   terrain, plant a world; M5 adds texture, sound, music…)
 *   6 Explorer      master every skill (3 uses), visit N, sight M, fly 5,000 u,
 *                   one flight ≥ 1,000 u from Origin
 *   7 Warp          K-warp + "Warp here" unlocked
 *
 * Numbers are the agent's defaults (Alex: "defaults approved"); tune after
 * playtests. Pure functions so client and server agree.
 */

export const SKILLS = [
  "move", "steer", "drive", "brake", "approach",
  "enter", "leave",
  "place", "arrange",
  "mesh", "terrain", "world",
] as const;
export type Skill = (typeof SKILLS)[number];

export const SKILL_LABELS: Record<Skill, string> = {
  move: "Fly (thrust)",
  steer: "Steer",
  drive: "Switch flight mode",
  brake: "Brake",
  approach: "Fly close to a world",
  enter: "Enter a world",
  leave: "Leave a world",
  place: "Place something",
  arrange: "Pick up and move something",
  mesh: "Make an object from thought",
  terrain: "Shape a world's terrain",
  world: "Plant a world",
};

/** Skills the server sees for itself; the rest are reported by the client (cheap checks now, Phase 09 later). */
export const SERVER_SKILLS: readonly Skill[] = ["enter", "mesh", "world"];
export const CLIENT_SKILLS: readonly Skill[] = SKILLS.filter((s) => !SERVER_SKILLS.includes(s));

export const CHAPTERS = [
  { n: 1, name: "First light", skills: ["move", "steer"] as Skill[] },
  { n: 2, name: "Pilot", skills: ["drive", "brake", "approach"] as Skill[] },
  { n: 3, name: "Visitor", skills: ["enter", "leave"] as Skill[] },
  { n: 4, name: "Builder", skills: ["place", "arrange"] as Skill[] },
  { n: 5, name: "Maker", skills: ["mesh", "terrain", "world"] as Skill[] },
  { n: 6, name: "Explorer", skills: [] as Skill[] },
  { n: 7, name: "Warp", skills: [] as Skill[] },
] as const;

export const WARP_CHAPTER = 7;

/** What reaching a chapter opens up (Journey panel; enforced by caps, the leash and the warp gate). Chapters 1–4 only teach. */
export const CHAPTER_UNLOCKS: Partial<Record<number, string>> = {
  5: "Make with mana: 600 a day",
  6: "Fly beyond the Frontier · 1,000 mana a day",
  7: "Warp anywhere · fly without limits · more mana every level",
};

/** Chapter 6 (Alex, 2026-10-14 evening). */
export const EXPLORER = {
  visits: 10,
  sightings: 30,
  distance: 5000,
  farthest: 1000,
} as const;

/** "Mastered" = used successfully this many times (usage alone). Planting is limited per day, so once is enough. */
export function masteryUses(skill: Skill): number {
  return skill === "world" ? 1 : 3;
}

export const XP = {
  skillFirst: 20,
  skillMastered: 40,
  chapter: 100,
  firstVisit: 40,
  sighting: 8,
  /** Another player's first visit to a world you made. */
  reaction: 15,
  /** Per creation: round(k · √mana settled), concave so burning the pool isn't a shortcut. */
  creationK: 10,
  /** Creation XP per rolling day. */
  creationDailyMax: 400,
  /** Every 1,000 u flown. */
  distanceStep: 1000,
  distance: 25,
} as const;

/** XP needed to reach level n (level 1 = 0). */
export function xpForLevel(n: number): number {
  return n <= 1 ? 0 : Math.round(60 * (n - 1) ** 1.7);
}

/** Breadth gate: level n needs this many mastered skills. */
export function masteredForLevel(n: number): number {
  return Math.max(0, Math.floor((n - 1) / 3));
}

/** Level from XP and breadth (XP keeps counting while the gate holds). */
export function levelFor(xp: number, mastered: number): number {
  let n = 1;
  while (n < 500 && xp >= xpForLevel(n + 1) && mastered >= masteredForLevel(n + 1)) n++;
  return n;
}

export function creationXp(mana: number): number {
  return mana > 0 ? Math.max(1, Math.round(XP.creationK * Math.sqrt(mana))) : 0;
}

export interface ProgressStats {
  /** Skill → successful uses. */
  skills: Partial<Record<Skill, number>>;
  visits: number;
  sightings: number;
  /** Total distance flown (u), warp leaps excluded. */
  distance: number;
  /** Farthest flight from Origin (u). */
  farthest: number;
}

export function emptyStats(): ProgressStats {
  return { skills: {}, visits: 0, sightings: 0, distance: 0, farthest: 0 };
}

export function masteredCount(stats: ProgressStats): number {
  return SKILLS.filter((s) => (stats.skills[s] ?? 0) >= masteryUses(s)).length;
}

/** Explorer thresholds shrink with a sparse universe, so nobody is locked out (2026-10-14 safety valve). */
export function explorerTargets(worldsInFrontier: number) {
  const w = Math.max(1, worldsInFrontier);
  return {
    visits: Math.min(EXPLORER.visits, w),
    sightings: Math.min(EXPLORER.sightings, w),
    distance: EXPLORER.distance,
    farthest: EXPLORER.farthest,
  };
}

/** One step of a chapter's checklist. */
export interface ChapterStep {
  id: string;
  label: string;
  have: number;
  need: number;
}

/** What chapter `n` asks for, with progress. */
export function chapterSteps(n: number, stats: ProgressStats, worldsInFrontier: number): ChapterStep[] {
  const ch = CHAPTERS[n - 1];
  if (!ch) return [];
  if (n <= 5) {
    return ch.skills.map((s) => ({ id: s, label: SKILL_LABELS[s], have: Math.min(1, stats.skills[s] ?? 0), need: 1 }));
  }
  if (n === 6) {
    const t = explorerTargets(worldsInFrontier);
    return [
      { id: "mastery", label: "Master every skill (use each 3×)", have: masteredCount(stats), need: SKILLS.length },
      { id: "visits", label: "Visit worlds", have: Math.min(stats.visits, t.visits), need: t.visits },
      { id: "sightings", label: "Sight worlds", have: Math.min(stats.sightings, t.sightings), need: t.sightings },
      { id: "distance", label: "Fly in total (u)", have: Math.min(Math.floor(stats.distance), t.distance), need: t.distance },
      { id: "farthest", label: "Fly far from Origin (u)", have: Math.min(Math.floor(stats.farthest), t.farthest), need: t.farthest },
    ];
  }
  return [];
}

/** The chapter a character is in: the first one whose steps aren't all done (7 = warp unlocked). */
export function chapterFor(stats: ProgressStats, worldsInFrontier: number, floor = 1): number {
  let n = Math.max(1, Math.min(WARP_CHAPTER, floor));
  while (n < WARP_CHAPTER && chapterSteps(n, stats, worldsInFrontier).every((s) => s.have >= s.need)) n++;
  return n;
}

/** What players see (GET /api/player/progress). */
export interface ProgressView {
  xp: number;
  level: number;
  /** XP at the start of this level and at the next one. */
  levelXp: number;
  nextLevelXp: number;
  /** Mastered skills the next level needs (breadth gate), and how many you have. */
  nextLevelMastered: number;
  mastered: number;
  chapter: number;
  chapterName: string;
  steps: ChapterStep[];
  warpUnlocked: boolean;
  stats: ProgressStats;
}

export function progressView(xp: number, stats: ProgressStats, chapter: number, worldsInFrontier: number): ProgressView {
  const mastered = masteredCount(stats);
  const level = levelFor(xp, mastered);
  return {
    xp,
    level,
    levelXp: xpForLevel(level),
    nextLevelXp: xpForLevel(level + 1),
    nextLevelMastered: masteredForLevel(level + 1),
    mastered,
    chapter,
    chapterName: CHAPTERS[chapter - 1]?.name ?? "",
    steps: chapterSteps(chapter, stats, worldsInFrontier),
    warpUnlocked: chapter >= WARP_CHAPTER,
    stats,
  };
}
