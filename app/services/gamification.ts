import { sql, eq, and, isNotNull, asc, desc, inArray } from "drizzle-orm";
import { db } from "~/db";
import {
  pointsEvents,
  PointsEventKind,
  users,
  UserRole,
  lessonProgress,
  LessonProgressStatus,
  quizAttempts,
  enrollments,
  modules,
  lessons,
  dismissedStreakBanners,
} from "~/db/schema";
import { LEVELS, resolveLevel } from "./levelResolver";
import {
  computeStreak,
  toCalendarDate,
  type StreakEvent,
} from "./streakCalculator";

// ─── Gamification ───
// Single deepened module that owns every read and write of the gamification
// state: points_events, dismissed_streak_banners, the lesson→course completion
// cascade, and all view-model assembly. Routes and other services should never
// touch points/level/streak primitives directly.

// ─── Constants ───

const LESSON_COMPLETE_POINTS = 10;
const QUIZ_PASS_POINTS = 25;
const QUIZ_PERFECT_POINTS = 15;
const COURSE_COMPLETE_POINTS = 100;
const STREAK_DAY_POINTS = 5;

const RECENT_EVENTS_LIMIT = 8;

const STREAK_MILESTONES: ReadonlySet<number> = new Set([7, 30, 100, 365]);

// ─── Public types ───

export interface FiredPointsEvent {
  kind: PointsEventKind;
  points: number;
  streakDayNumber?: number;
}

export interface LevelCrossed {
  index: number;
  name: string;
}

export interface GamificationSignals {
  fired: FiredPointsEvent[];
  levelCrossed: LevelCrossed | null;
  streakMilestone: number | null;
  totalPointsAfter: number;
}

export interface SidebarGamification {
  totalPoints: number;
  levelName: string;
  currentStreak: number;
  activeToday: boolean;
}

export interface DashboardRecentEvent {
  kind: PointsEventKind;
  points: number;
  createdAt: string;
}

export interface DashboardGamification {
  totalPoints: number;
  levelName: string;
  nextLevelName: string | null;
  pointsIntoLevel: number;
  levelSpan: number | null;
  pointsToNextLevel: number | null;
  currentStreak: number;
  longestStreak: number;
  activeToday: boolean;
  recentEvents: ReadonlyArray<DashboardRecentEvent>;
}

export interface StreakBanner {
  previousStreakLength: number;
  lastActiveDate: string;
}

// ─── Internal helpers ───

function getUserTimezone(userId: number): string {
  const row = db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row?.timezone ?? "UTC";
}

function getUserTotalPoints(userId: number): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${pointsEvents.points}), 0)` })
    .from(pointsEvents)
    .where(eq(pointsEvents.userId, userId))
    .get();
  return row?.total ?? 0;
}

function detectLevelCrossed(
  prevTotal: number,
  newTotal: number
): LevelCrossed | null {
  const prev = resolveLevel(prevTotal);
  const next = resolveLevel(newTotal);
  if (next.index <= prev.index) return null;
  return { index: next.index, name: next.name };
}

function readUserEvents(userId: number): StreakEvent[] {
  return db
    .select({
      timestamp: pointsEvents.createdAt,
      kind: pointsEvents.kind,
      isBackfill: pointsEvents.isBackfill,
      streakDate: pointsEvents.streakDate,
    })
    .from(pointsEvents)
    .where(eq(pointsEvents.userId, userId))
    .all();
}

function detectStreakMilestone(
  fired: FiredPointsEvent[]
): number | null {
  const streakEv = fired.find((e) => e.kind === PointsEventKind.StreakDay);
  if (!streakEv?.streakDayNumber) return null;
  return STREAK_MILESTONES.has(streakEv.streakDayNumber)
    ? streakEv.streakDayNumber
    : null;
}

function annotateStreakDayNumber(
  userId: number,
  timezone: string,
  fired: FiredPointsEvent[]
): void {
  const streakEntry = fired.find((e) => e.kind === PointsEventKind.StreakDay);
  if (!streakEntry) return;
  const events = readUserEvents(userId);
  streakEntry.streakDayNumber = computeStreak(events, timezone).currentStreak;
}

function getCourseLessonIds(courseId: number): number[] {
  const courseModules = db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .all();
  if (courseModules.length === 0) return [];
  const moduleIds = courseModules.map((m) => m.id);
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .where(inArray(lessons.moduleId, moduleIds))
    .all()
    .map((l) => l.id);
}

function allCourseLessonsHaveCompleteEvent(
  userId: number,
  courseId: number
): boolean {
  const lessonIds = getCourseLessonIds(courseId);
  if (lessonIds.length === 0) return false;

  const completedRows = db
    .select({ lessonId: pointsEvents.lessonId })
    .from(pointsEvents)
    .where(
      and(
        eq(pointsEvents.userId, userId),
        eq(pointsEvents.kind, PointsEventKind.LessonComplete),
        inArray(pointsEvents.lessonId, lessonIds)
      )
    )
    .all();

  const completedSet = new Set<number>();
  for (const row of completedRows) {
    if (row.lessonId !== null) completedSet.add(row.lessonId);
  }
  return lessonIds.every((id) => completedSet.has(id));
}

// ─── Write-side internals: insert rows, no signal detection ───

function writeLessonAndStreakRows(
  userId: number,
  lessonId: number,
  timezone: string
): FiredPointsEvent[] {
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

  return fired;
}

function writeQuizRows(
  userId: number,
  quizId: number,
  score: number,
  passed: boolean,
  timezone: string
): FiredPointsEvent[] {
  if (!passed) return [];

  const streakDate = toCalendarDate(new Date().toISOString(), timezone);
  const fired: FiredPointsEvent[] = [];

  db.transaction((tx) => {
    const passInserted = tx
      .insert(pointsEvents)
      .values({
        userId,
        kind: PointsEventKind.QuizPass,
        points: QUIZ_PASS_POINTS,
        quizId,
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

    if (score >= 1) {
      const perfectInserted = tx
        .insert(pointsEvents)
        .values({
          userId,
          kind: PointsEventKind.QuizPerfect,
          points: QUIZ_PERFECT_POINTS,
          quizId,
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

  return fired;
}

function writeCourseCompleteRow(
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

function markEnrollmentCompleteRow(userId: number, courseId: number): void {
  db.update(enrollments)
    .set({ completedAt: new Date().toISOString() })
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.courseId, courseId),
        sql`${enrollments.completedAt} IS NULL`
      )
    )
    .run();
}

function maybeCascadeCourseComplete(
  userId: number,
  lessonId: number
): FiredPointsEvent[] {
  const row = db
    .select({ courseId: modules.courseId })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(lessons.id, lessonId))
    .get();
  if (!row) return [];

  const enrollment = db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.courseId, row.courseId)
      )
    )
    .get();
  if (!enrollment || enrollment.completedAt !== null) return [];

  if (!allCourseLessonsHaveCompleteEvent(userId, row.courseId)) return [];

  markEnrollmentCompleteRow(userId, row.courseId);
  return writeCourseCompleteRow(userId, row.courseId);
}

// ─── Public write-side ───

export function onLessonCompleted(
  userId: number,
  lessonId: number
): GamificationSignals {
  const timezone = getUserTimezone(userId);
  const prevTotal = getUserTotalPoints(userId);

  const lessonFired = writeLessonAndStreakRows(userId, lessonId, timezone);
  const cascadeFired = maybeCascadeCourseComplete(userId, lessonId);

  const fired = [...lessonFired, ...cascadeFired];
  annotateStreakDayNumber(userId, timezone, fired);

  const newTotal = getUserTotalPoints(userId);
  return {
    fired,
    levelCrossed: detectLevelCrossed(prevTotal, newTotal),
    streakMilestone: detectStreakMilestone(fired),
    totalPointsAfter: newTotal,
  };
}

export function onQuizAttempted(
  userId: number,
  quizId: number,
  score: number,
  passed: boolean
): GamificationSignals {
  const timezone = getUserTimezone(userId);
  const prevTotal = getUserTotalPoints(userId);

  const fired = writeQuizRows(userId, quizId, score, passed, timezone);
  annotateStreakDayNumber(userId, timezone, fired);

  const newTotal = getUserTotalPoints(userId);
  return {
    fired,
    levelCrossed: detectLevelCrossed(prevTotal, newTotal),
    streakMilestone: detectStreakMilestone(fired),
    totalPointsAfter: newTotal,
  };
}

export function onCourseCompleted(
  userId: number,
  courseId: number
): GamificationSignals {
  const prevTotal = getUserTotalPoints(userId);

  markEnrollmentCompleteRow(userId, courseId);
  const fired = writeCourseCompleteRow(userId, courseId);

  const newTotal = getUserTotalPoints(userId);
  return {
    fired,
    levelCrossed: detectLevelCrossed(prevTotal, newTotal),
    streakMilestone: null,
    totalPointsAfter: newTotal,
  };
}

// ─── Public read-side ───

function loadUserContext(userId: number): {
  timezone: string;
  isStudent: boolean;
} | null {
  const user = db
    .select({ role: users.role, timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user) return null;
  return {
    timezone: user.timezone ?? "UTC",
    isStudent: user.role === UserRole.Student,
  };
}

export function getSidebarGamification(
  userId: number
): SidebarGamification | null {
  const ctx = loadUserContext(userId);
  if (!ctx || !ctx.isStudent) return null;

  const totalPoints = getUserTotalPoints(userId);
  const level = resolveLevel(totalPoints);
  const events = readUserEvents(userId);
  const streak = computeStreak(events, ctx.timezone);
  const today = toCalendarDate(new Date().toISOString(), ctx.timezone);

  return {
    totalPoints,
    levelName: level.name,
    currentStreak: streak.currentStreak,
    activeToday: streak.lastActiveDate === today,
  };
}

export function getDashboardGamification(
  userId: number
): DashboardGamification | null {
  const ctx = loadUserContext(userId);
  if (!ctx || !ctx.isStudent) return null;

  const totalPoints = getUserTotalPoints(userId);
  const level = resolveLevel(totalPoints);
  const events = readUserEvents(userId);
  const streak = computeStreak(events, ctx.timezone);
  const today = toCalendarDate(new Date().toISOString(), ctx.timezone);

  const nextLevel =
    level.nextThreshold !== null
      ? (LEVELS.find((l) => l.threshold === level.nextThreshold) ?? null)
      : null;
  const levelSpan = nextLevel ? nextLevel.threshold - level.threshold : null;

  const recentEvents = db
    .select({
      kind: pointsEvents.kind,
      points: pointsEvents.points,
      createdAt: pointsEvents.createdAt,
    })
    .from(pointsEvents)
    .where(eq(pointsEvents.userId, userId))
    .orderBy(desc(pointsEvents.createdAt), desc(pointsEvents.id))
    .limit(RECENT_EVENTS_LIMIT)
    .all();

  return {
    totalPoints,
    levelName: level.name,
    nextLevelName: nextLevel?.name ?? null,
    pointsIntoLevel: level.pointsIntoLevel,
    levelSpan,
    pointsToNextLevel: level.pointsToNextLevel,
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    activeToday: streak.lastActiveDate === today,
    recentEvents,
  };
}

export function getStreakBanner(userId: number): StreakBanner | null {
  const ctx = loadUserContext(userId);
  if (!ctx || !ctx.isStudent) return null;

  const events = readUserEvents(userId);
  const streak = computeStreak(events, ctx.timezone);
  if (streak.currentStreak !== 0 || !streak.lastActiveDate) return null;

  const previousStreakLength = computeRunLengthEndingAt(
    events,
    ctx.timezone,
    streak.lastActiveDate
  );
  if (previousStreakLength < 7) return null;

  const dismissed = db
    .select()
    .from(dismissedStreakBanners)
    .where(
      and(
        eq(dismissedStreakBanners.userId, userId),
        eq(dismissedStreakBanners.lastActiveDate, streak.lastActiveDate)
      )
    )
    .get();
  if (dismissed) return null;

  return {
    previousStreakLength,
    lastActiveDate: streak.lastActiveDate,
  };
}

export function dismissStreakBanner(
  userId: number,
  lastActiveDate: string
): void {
  db.insert(dismissedStreakBanners)
    .values({ userId, lastActiveDate })
    .onConflictDoNothing()
    .run();
}

// ─── Backfill ───

function backfillUserPoints(userId: number): void {
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

export function backfill(opts: { userId?: number } = {}): void {
  if (opts.userId !== undefined) {
    backfillUserPoints(opts.userId);
    return;
  }
  const allUsers = db.select({ id: users.id }).from(users).all();
  for (const u of allUsers) {
    backfillUserPoints(u.id);
  }
}

// ─── Streak banner helper ───

function computeRunLengthEndingAt(
  events: StreakEvent[],
  timezone: string,
  endDate: string
): number {
  const QUALIFYING: ReadonlySet<string> = new Set([
    PointsEventKind.LessonComplete,
    PointsEventKind.QuizPass,
  ]);
  const dates = new Set<string>();
  for (const event of events) {
    if (event.isBackfill) continue;
    if (!QUALIFYING.has(event.kind)) continue;
    const date = event.streakDate ?? toCalendarDate(event.timestamp, timezone);
    dates.add(date);
  }

  if (!dates.has(endDate)) return 0;

  let length = 1;
  let cursor = endDate;
  while (true) {
    const prev = previousDate(cursor);
    if (!dates.has(prev)) break;
    length += 1;
    cursor = prev;
  }
  return length;
}

function previousDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
