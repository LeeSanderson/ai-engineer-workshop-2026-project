import { sql, eq, and, isNotNull, asc, desc } from "drizzle-orm";
import { db } from "~/db";
import {
  pointsEvents,
  PointsEventKind,
  users,
  lessonProgress,
  LessonProgressStatus,
  quizAttempts,
  enrollments,
} from "~/db/schema";
import { resolveLevel, type ResolvedLevel } from "./levelResolver";
import {
  computeStreak,
  toCalendarDate,
  type StreakResult,
} from "./streakCalculator";

// ─── Points Service ───
// Coordinator module orchestrating the points_events table.
// Idempotency is enforced at the DB level via the unique COALESCE index;
// award functions use INSERT OR IGNORE semantics — a duplicate is a silent no-op.

const LESSON_COMPLETE_POINTS = 10;
const QUIZ_PASS_POINTS = 25;
const QUIZ_PERFECT_POINTS = 15;
const COURSE_COMPLETE_POINTS = 100;
const STREAK_DAY_POINTS = 5;

function getUserTimezone(userId: number): string {
  const row = db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row?.timezone ?? "UTC";
}

// FiredPointsEvent describes an event that was actually written in this
// transaction (i.e. not silently no-op'd by the unique-index conflict).
// streakDayNumber is the current streak day count *after* this event lands,
// and is only set on streak_day events.
export interface FiredPointsEvent {
  kind: PointsEventKind;
  points: number;
  streakDayNumber?: number;
}

function computeCurrentStreakDayNumber(
  userId: number,
  timezone: string
): number {
  const eventRows = db
    .select({
      timestamp: pointsEvents.createdAt,
      kind: pointsEvents.kind,
      isBackfill: pointsEvents.isBackfill,
      streakDate: pointsEvents.streakDate,
    })
    .from(pointsEvents)
    .where(eq(pointsEvents.userId, userId))
    .all();
  return computeStreak(eventRows, timezone).currentStreak;
}

export function awardPointsForLessonComplete(
  userId: number,
  lessonId: number
): FiredPointsEvent[] {
  const timezone = getUserTimezone(userId);
  const streakDate = toCalendarDate(new Date().toISOString(), timezone);

  const fired: FiredPointsEvent[] = [];
  db.transaction((tx) => {
    const lessonInserted = tx
      .insert(pointsEvents)
      .values({
        userId,
        kind: PointsEventKind.LessonComplete,
        points: LESSON_COMPLETE_POINTS,
        lessonId,
      })
      .onConflictDoNothing()
      .returning()
      .all();
    if (lessonInserted.length > 0) {
      fired.push({
        kind: PointsEventKind.LessonComplete,
        points: LESSON_COMPLETE_POINTS,
      });
    }

    const streakInserted = tx
      .insert(pointsEvents)
      .values({
        userId,
        kind: PointsEventKind.StreakDay,
        points: STREAK_DAY_POINTS,
        streakDate,
      })
      .onConflictDoNothing()
      .returning()
      .all();
    if (streakInserted.length > 0) {
      fired.push({
        kind: PointsEventKind.StreakDay,
        points: STREAK_DAY_POINTS,
      });
    }
  });

  const streakEntry = fired.find((e) => e.kind === PointsEventKind.StreakDay);
  if (streakEntry) {
    streakEntry.streakDayNumber = computeCurrentStreakDayNumber(
      userId,
      timezone
    );
  }

  return fired;
}

export interface QuizAttemptForPoints {
  quizId: number;
  score: number;
  passed: boolean;
}

export function awardPointsForQuizAttempt(
  userId: number,
  attempt: QuizAttemptForPoints
): FiredPointsEvent[] {
  if (!attempt.passed) return [];

  const timezone = getUserTimezone(userId);
  const streakDate = toCalendarDate(new Date().toISOString(), timezone);

  const fired: FiredPointsEvent[] = [];
  db.transaction((tx) => {
    const passInserted = tx
      .insert(pointsEvents)
      .values({
        userId,
        kind: PointsEventKind.QuizPass,
        points: QUIZ_PASS_POINTS,
        quizId: attempt.quizId,
      })
      .onConflictDoNothing()
      .returning()
      .all();
    if (passInserted.length > 0) {
      fired.push({
        kind: PointsEventKind.QuizPass,
        points: QUIZ_PASS_POINTS,
      });
    }

    if (attempt.score >= 1) {
      const perfectInserted = tx
        .insert(pointsEvents)
        .values({
          userId,
          kind: PointsEventKind.QuizPerfect,
          points: QUIZ_PERFECT_POINTS,
          quizId: attempt.quizId,
        })
        .onConflictDoNothing()
        .returning()
        .all();
      if (perfectInserted.length > 0) {
        fired.push({
          kind: PointsEventKind.QuizPerfect,
          points: QUIZ_PERFECT_POINTS,
        });
      }
    }

    const streakInserted = tx
      .insert(pointsEvents)
      .values({
        userId,
        kind: PointsEventKind.StreakDay,
        points: STREAK_DAY_POINTS,
        streakDate,
      })
      .onConflictDoNothing()
      .returning()
      .all();
    if (streakInserted.length > 0) {
      fired.push({
        kind: PointsEventKind.StreakDay,
        points: STREAK_DAY_POINTS,
      });
    }
  });

  const streakEntry = fired.find((e) => e.kind === PointsEventKind.StreakDay);
  if (streakEntry) {
    streakEntry.streakDayNumber = computeCurrentStreakDayNumber(
      userId,
      timezone
    );
  }

  return fired;
}

export function awardPointsForCourseComplete(
  userId: number,
  courseId: number
): FiredPointsEvent[] {
  const inserted = db
    .insert(pointsEvents)
    .values({
      userId,
      kind: PointsEventKind.CourseComplete,
      points: COURSE_COMPLETE_POINTS,
      courseId,
    })
    .onConflictDoNothing()
    .returning()
    .all();
  if (inserted.length === 0) return [];
  return [
    {
      kind: PointsEventKind.CourseComplete,
      points: COURSE_COMPLETE_POINTS,
    },
  ];
}

export function backfillUserPoints(userId: number): void {
  const completedLessons = db
    .select({
      lessonId: lessonProgress.lessonId,
      completedAt: lessonProgress.completedAt,
    })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    )
    .all();

  for (const row of completedLessons) {
    if (!row.completedAt) continue;
    db.insert(pointsEvents)
      .values({
        userId,
        kind: PointsEventKind.LessonComplete,
        points: LESSON_COMPLETE_POINTS,
        lessonId: row.lessonId,
        isBackfill: true,
        createdAt: row.completedAt,
      })
      .onConflictDoNothing()
      .run();
  }

  // Ordering by attemptedAt ASC ensures INSERT OR IGNORE keeps the earliest
  // passing attempt per (user, quiz) and the earliest 100% attempt per (user, quiz).
  const passingAttempts = db
    .select({
      quizId: quizAttempts.quizId,
      score: quizAttempts.score,
      attemptedAt: quizAttempts.attemptedAt,
    })
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.userId, userId), eq(quizAttempts.passed, true))
    )
    .orderBy(asc(quizAttempts.attemptedAt))
    .all();

  for (const row of passingAttempts) {
    db.insert(pointsEvents)
      .values({
        userId,
        kind: PointsEventKind.QuizPass,
        points: QUIZ_PASS_POINTS,
        quizId: row.quizId,
        isBackfill: true,
        createdAt: row.attemptedAt,
      })
      .onConflictDoNothing()
      .run();

    if (row.score >= 1) {
      db.insert(pointsEvents)
        .values({
          userId,
          kind: PointsEventKind.QuizPerfect,
          points: QUIZ_PERFECT_POINTS,
          quizId: row.quizId,
          isBackfill: true,
          createdAt: row.attemptedAt,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  const completedEnrollments = db
    .select({
      courseId: enrollments.courseId,
      completedAt: enrollments.completedAt,
    })
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), isNotNull(enrollments.completedAt))
    )
    .all();

  for (const row of completedEnrollments) {
    if (!row.completedAt) continue;
    db.insert(pointsEvents)
      .values({
        userId,
        kind: PointsEventKind.CourseComplete,
        points: COURSE_COMPLETE_POINTS,
        courseId: row.courseId,
        isBackfill: true,
        createdAt: row.completedAt,
      })
      .onConflictDoNothing()
      .run();
  }
}

export function backfillAllUsersPoints(): void {
  const allUsers = db.select({ id: users.id }).from(users).all();
  for (const user of allUsers) {
    backfillUserPoints(user.id);
  }
}

export interface UserPoints extends StreakResult {
  totalPoints: number;
  level: ResolvedLevel;
}

export interface RecentPointsEvent {
  kind: PointsEventKind;
  points: number;
  createdAt: string;
}

export function getRecentPointsEvents(
  userId: number,
  limit: number
): RecentPointsEvent[] {
  return db
    .select({
      kind: pointsEvents.kind,
      points: pointsEvents.points,
      createdAt: pointsEvents.createdAt,
    })
    .from(pointsEvents)
    .where(eq(pointsEvents.userId, userId))
    .orderBy(desc(pointsEvents.createdAt), desc(pointsEvents.id))
    .limit(limit)
    .all();
}

export function getUserPoints(userId: number): UserPoints {
  const totalRow = db
    .select({ total: sql<number>`COALESCE(SUM(${pointsEvents.points}), 0)` })
    .from(pointsEvents)
    .where(eq(pointsEvents.userId, userId))
    .get();

  const totalPoints = totalRow?.total ?? 0;

  const eventRows = db
    .select({
      timestamp: pointsEvents.createdAt,
      kind: pointsEvents.kind,
      isBackfill: pointsEvents.isBackfill,
      streakDate: pointsEvents.streakDate,
    })
    .from(pointsEvents)
    .where(eq(pointsEvents.userId, userId))
    .all();

  const timezone = getUserTimezone(userId);
  const streak = computeStreak(eventRows, timezone);

  return {
    totalPoints,
    level: resolveLevel(totalPoints),
    ...streak,
  };
}
