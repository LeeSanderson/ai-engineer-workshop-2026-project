// ─── Level Resolver ───
// Pure function module. No DB, no I/O.
// Maps a points total to the user's current level metadata.

export interface Level {
  index: number;
  name: string;
  threshold: number;
}

export const LEVELS: readonly Level[] = [
  { index: 1, name: "Newcomer", threshold: 0 },
  { index: 2, name: "Learner", threshold: 50 },
  { index: 3, name: "Student", threshold: 150 },
  { index: 4, name: "Practitioner", threshold: 350 },
  { index: 5, name: "Apprentice", threshold: 700 },
  { index: 6, name: "Specialist", threshold: 1200 },
  { index: 7, name: "Adept", threshold: 2000 },
  { index: 8, name: "Expert", threshold: 3200 },
  { index: 9, name: "Master", threshold: 5000 },
  { index: 10, name: "Grandmaster", threshold: 8000 },
] as const;

export interface ResolvedLevel {
  index: number;
  name: string;
  threshold: number;
  nextThreshold: number | null;
  pointsIntoLevel: number;
  pointsToNextLevel: number | null;
}

export function resolveLevel(points: number): ResolvedLevel {
  let currentIndex = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (points >= LEVELS[i].threshold) {
      currentIndex = i;
    }
  }

  const current = LEVELS[currentIndex];
  const next = LEVELS[currentIndex + 1] ?? null;

  return {
    index: current.index,
    name: current.name,
    threshold: current.threshold,
    nextThreshold: next?.threshold ?? null,
    pointsIntoLevel: points - current.threshold,
    pointsToNextLevel: next ? next.threshold - points : null,
  };
}
