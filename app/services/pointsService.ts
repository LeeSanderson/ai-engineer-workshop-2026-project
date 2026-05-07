import { sql, eq } from "drizzle-orm";
import { db } from "~/db";
import { pointsEvents, PointsEventKind } from "~/db/schema";
import { resolveLevel, type ResolvedLevel } from "./levelResolver";

// ─── Points Service ───
// Coordinator module orchestrating the points_events table.
// Idempotency is enforced at the DB level via the unique COALESCE index;
// award functions use INSERT OR IGNORE semantics — a duplicate is a silent no-op.

const LESSON_COMPLETE_POINTS = 10;

export function awardPointsForLessonComplete(userId: number, lessonId: number) {
  db.insert(pointsEvents)
    .values({
      userId,
      kind: PointsEventKind.LessonComplete,
      points: LESSON_COMPLETE_POINTS,
      lessonId,
    })
    .onConflictDoNothing()
    .run();
}

export interface UserPoints {
  totalPoints: number;
  level: ResolvedLevel;
}

export function getUserPoints(userId: number): UserPoints {
  const result = db
    .select({ total: sql<number>`COALESCE(SUM(${pointsEvents.points}), 0)` })
    .from(pointsEvents)
    .where(eq(pointsEvents.userId, userId))
    .get();

  const totalPoints = result?.total ?? 0;

  return {
    totalPoints,
    level: resolveLevel(totalPoints),
  };
}
