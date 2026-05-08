import { sql, eq } from "drizzle-orm";
import { db } from "~/db";
import { pointsEvents, PointsEventKind } from "~/db/schema";
import { resolveLevel, type ResolvedLevel } from "./levelResolver";

// ─── Points Service ───
// Coordinator module orchestrating the points_events table.
// Idempotency is enforced at the DB level via the unique COALESCE index;
// award functions use INSERT OR IGNORE semantics — a duplicate is a silent no-op.

const LESSON_COMPLETE_POINTS = 10;
const QUIZ_PASS_POINTS = 25;
const QUIZ_PERFECT_POINTS = 15;
const COURSE_COMPLETE_POINTS = 100;

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

export interface QuizAttemptForPoints {
  quizId: number;
  score: number;
  passed: boolean;
}

export function awardPointsForQuizAttempt(
  userId: number,
  attempt: QuizAttemptForPoints
) {
  if (!attempt.passed) return;

  db.insert(pointsEvents)
    .values({
      userId,
      kind: PointsEventKind.QuizPass,
      points: QUIZ_PASS_POINTS,
      quizId: attempt.quizId,
    })
    .onConflictDoNothing()
    .run();

  if (attempt.score >= 1) {
    db.insert(pointsEvents)
      .values({
        userId,
        kind: PointsEventKind.QuizPerfect,
        points: QUIZ_PERFECT_POINTS,
        quizId: attempt.quizId,
      })
      .onConflictDoNothing()
      .run();
  }
}

export function awardPointsForCourseComplete(userId: number, courseId: number) {
  db.insert(pointsEvents)
    .values({
      userId,
      kind: PointsEventKind.CourseComplete,
      points: COURSE_COMPLETE_POINTS,
      courseId,
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
