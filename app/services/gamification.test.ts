import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { eq, and } from "drizzle-orm";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  onLessonCompleted,
  onQuizAttempted,
  onCourseCompleted,
  getSidebarGamification,
  getDashboardGamification,
  getStreakBanner,
  dismissStreakBanner,
  backfill,
} from "./gamification";
import { enrollUser, findEnrollment } from "./enrollmentService";

function createLesson(courseId: number = base.course.id) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson", position: 1 })
    .returning()
    .get();
}

function createLessonsInModule(courseId: number, count: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  const out: { id: number }[] = [];
  for (let i = 0; i < count; i++) {
    const lesson = testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
      .returning()
      .get();
    out.push(lesson);
  }
  return out;
}

function createQuiz() {
  const lesson = createLesson();
  return testDb
    .insert(schema.quizzes)
    .values({ lessonId: lesson.id, title: "Quiz", passingScore: 0.7 })
    .returning()
    .get();
}

function eventsOfKind(userId: number, kind: schema.PointsEventKind) {
  return testDb
    .select()
    .from(schema.pointsEvents)
    .where(
      and(
        eq(schema.pointsEvents.userId, userId),
        eq(schema.pointsEvents.kind, kind)
      )
    )
    .all();
}

describe("gamification module — public surface", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("onLessonCompleted", () => {
    it("writes lesson_complete + streak_day events and returns matching signals", () => {
      const lesson = createLesson();

      const signals = onLessonCompleted(base.user.id, lesson.id);

      expect(signals.fired.map((e) => e.kind).sort()).toEqual(
        [
          schema.PointsEventKind.LessonComplete,
          schema.PointsEventKind.StreakDay,
        ].sort()
      );
      expect(signals.totalPointsAfter).toBe(15); // 10 lesson + 5 streak
      expect(signals.levelCrossed).toBeNull();
      expect(signals.streakMilestone).toBeNull();
    });

    it("is idempotent — repeating returns fired: [] and the same totals", () => {
      const lesson = createLesson();

      onLessonCompleted(base.user.id, lesson.id);
      const second = onLessonCompleted(base.user.id, lesson.id);

      expect(second.fired).toEqual([]);
      expect(second.levelCrossed).toBeNull();
      expect(second.streakMilestone).toBeNull();
      expect(second.totalPointsAfter).toBe(15);

      const lessonEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.LessonComplete
      );
      expect(lessonEvents).toHaveLength(1);
    });

    it("returns levelCrossed with name when total crosses a level threshold", () => {
      // Backfill 49 pts so 49 + 10 + 5 = 64 crosses Level 2 (Learner, threshold 50)
      testDb
        .insert(schema.pointsEvents)
        .values({
          userId: base.user.id,
          kind: schema.PointsEventKind.LessonComplete,
          points: 49,
          isBackfill: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        })
        .run();

      const lesson = createLesson();
      const signals = onLessonCompleted(base.user.id, lesson.id);

      expect(signals.levelCrossed).toEqual({ index: 2, name: "Learner" });
    });

    it("returns streakMilestone = 7 on the 7th consecutive day", () => {
      vi.useFakeTimers();
      const lessons = createLessonsInModule(base.course.id, 7);
      const days = [
        "2026-05-08T10:00:00Z",
        "2026-05-09T10:00:00Z",
        "2026-05-10T10:00:00Z",
        "2026-05-11T10:00:00Z",
        "2026-05-12T10:00:00Z",
        "2026-05-13T10:00:00Z",
        "2026-05-14T10:00:00Z",
      ];
      let last: ReturnType<typeof onLessonCompleted> | undefined;
      for (let i = 0; i < days.length; i++) {
        vi.setSystemTime(new Date(days[i]));
        last = onLessonCompleted(base.user.id, lessons[i].id);
      }
      expect(last!.streakMilestone).toBe(7);
    });

    it("cascade: when the lesson is the last unfinished lesson of an enrolled course, course_complete fires in the same call", () => {
      const lessons = createLessonsInModule(base.course.id, 2);
      enrollUser(base.user.id, base.course.id, false, false);

      onLessonCompleted(base.user.id, lessons[0].id);
      const signals = onLessonCompleted(base.user.id, lessons[1].id);

      const kinds = signals.fired.map((e) => e.kind);
      expect(kinds).toContain(schema.PointsEventKind.LessonComplete);
      expect(kinds).toContain(schema.PointsEventKind.CourseComplete);

      const enrollment = findEnrollment(base.user.id, base.course.id);
      expect(enrollment!.completedAt).not.toBeNull();

      // Level crossing reflects the combined delta (10 + 5 + 100 = 115 → Level 3 Student at 150 not reached; but 0 → 130 cross past Newcomer 0 / Learner 50).
      // After lesson 1: 15 pts (Newcomer). After lesson 2 + course: 15 + 10 + 100 = 125 → still Learner (50–150). Level 2 (Learner) crossed.
      expect(signals.levelCrossed).toEqual({ index: 2, name: "Learner" });
    });

    it("cascade is suppressed when the enrollment is already completed", () => {
      const lessons = createLessonsInModule(base.course.id, 1);
      enrollUser(base.user.id, base.course.id, false, false);
      // Manually mark enrollment as already completed
      testDb
        .update(schema.enrollments)
        .set({ completedAt: "2026-01-01T00:00:00.000Z" })
        .where(
          and(
            eq(schema.enrollments.userId, base.user.id),
            eq(schema.enrollments.courseId, base.course.id)
          )
        )
        .run();

      const signals = onLessonCompleted(base.user.id, lessons[0].id);

      const courseEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.CourseComplete
      );
      expect(courseEvents).toHaveLength(0);
      expect(signals.fired.find(
        (e) => e.kind === schema.PointsEventKind.CourseComplete
      )).toBeUndefined();
    });

    it("cascade does not fire when the user is not enrolled (even though all lessons are done)", () => {
      const lessons = createLessonsInModule(base.course.id, 1);
      // NOT enrolled

      const signals = onLessonCompleted(base.user.id, lessons[0].id);

      expect(signals.fired.find(
        (e) => e.kind === schema.PointsEventKind.CourseComplete
      )).toBeUndefined();
      const enrollment = findEnrollment(base.user.id, base.course.id);
      expect(enrollment).toBeUndefined();
    });
  });

  describe("onQuizAttempted", () => {
    it("writes quiz_pass + streak_day on a passing non-perfect attempt", () => {
      const quiz = createQuiz();
      const signals = onQuizAttempted(base.user.id, quiz.id, 0.8, true);

      expect(signals.fired.map((e) => e.kind).sort()).toEqual(
        [
          schema.PointsEventKind.QuizPass,
          schema.PointsEventKind.StreakDay,
        ].sort()
      );
      expect(signals.totalPointsAfter).toBe(30);
    });

    it("writes quiz_pass + quiz_perfect + streak_day on a perfect first pass", () => {
      const quiz = createQuiz();
      const signals = onQuizAttempted(base.user.id, quiz.id, 1.0, true);

      expect(signals.fired.map((e) => e.kind).sort()).toEqual(
        [
          schema.PointsEventKind.QuizPass,
          schema.PointsEventKind.QuizPerfect,
          schema.PointsEventKind.StreakDay,
        ].sort()
      );
      expect(signals.totalPointsAfter).toBe(45);
    });

    it("returns fired: [] for a failing attempt", () => {
      const quiz = createQuiz();
      const signals = onQuizAttempted(base.user.id, quiz.id, 0.5, false);

      expect(signals.fired).toEqual([]);
      expect(signals.totalPointsAfter).toBe(0);
      const events = testDb.select().from(schema.pointsEvents).all();
      expect(events).toHaveLength(0);
    });

    it("is idempotent — second pass at same score writes nothing new", () => {
      const quiz = createQuiz();
      onQuizAttempted(base.user.id, quiz.id, 0.8, true);
      const second = onQuizAttempted(base.user.id, quiz.id, 0.8, true);

      expect(second.fired).toEqual([]);
      expect(second.totalPointsAfter).toBe(30);
    });

    it("a later perfect after a prior non-perfect pass adds only quiz_perfect", () => {
      const quiz = createQuiz();
      onQuizAttempted(base.user.id, quiz.id, 0.8, true);
      const second = onQuizAttempted(base.user.id, quiz.id, 1.0, true);

      expect(second.fired.map((e) => e.kind)).toEqual([
        schema.PointsEventKind.QuizPerfect,
      ]);
    });
  });

  describe("onCourseCompleted (direct admin path)", () => {
    it("sets completedAt on the enrollment and awards course_complete once", () => {
      enrollUser(base.user.id, base.course.id, false, false);
      const signals = onCourseCompleted(base.user.id, base.course.id);

      const enrollment = findEnrollment(base.user.id, base.course.id);
      expect(enrollment!.completedAt).not.toBeNull();

      expect(signals.fired.map((e) => e.kind)).toEqual([
        schema.PointsEventKind.CourseComplete,
      ]);
      expect(signals.totalPointsAfter).toBe(100);

      const second = onCourseCompleted(base.user.id, base.course.id);
      expect(second.fired).toEqual([]);
    });
  });

  describe("getSidebarGamification", () => {
    it("returns null for a non-student", () => {
      const result = getSidebarGamification(base.instructor.id);
      expect(result).toBeNull();
    });

    it("returns null for a missing user", () => {
      const result = getSidebarGamification(99999);
      expect(result).toBeNull();
    });

    it("returns totalPoints, levelName, currentStreak, activeToday for a student", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-14T10:00:00Z"));
      const lesson = createLesson();
      onLessonCompleted(base.user.id, lesson.id);

      const result = getSidebarGamification(base.user.id);
      expect(result).toEqual({
        totalPoints: 15,
        levelName: "Newcomer",
        currentStreak: 1,
        activeToday: true,
      });
    });

    it("activeToday is false when the last activity was yesterday", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-13T10:00:00Z"));
      onLessonCompleted(base.user.id, createLesson().id);

      vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));
      const result = getSidebarGamification(base.user.id);
      expect(result?.activeToday).toBe(false);
      expect(result?.currentStreak).toBe(1);
    });
  });

  describe("getDashboardGamification", () => {
    it("returns null for a non-student", () => {
      const result = getDashboardGamification(base.instructor.id);
      expect(result).toBeNull();
    });

    it("returns the full dashboard view-model for a student with no activity", () => {
      const result = getDashboardGamification(base.user.id);
      expect(result).toEqual({
        totalPoints: 0,
        levelName: "Newcomer",
        nextLevelName: "Learner",
        pointsIntoLevel: 0,
        levelSpan: 50,
        pointsToNextLevel: 50,
        currentStreak: 0,
        longestStreak: 0,
        activeToday: false,
        recentEvents: [],
      });
    });

    it("returns the dashboard view-model with computed next-level fields", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-14T10:00:00Z"));
      // Drive total to ~55 → Level 2 (Learner, threshold 50, next Student at 150)
      const lessons = createLessonsInModule(base.course.id, 5);
      for (const l of lessons) {
        onLessonCompleted(base.user.id, l.id);
      }
      // 5 × 10 + 5 (one streak_day) = 55 pts

      const result = getDashboardGamification(base.user.id);
      expect(result?.totalPoints).toBe(55);
      expect(result?.levelName).toBe("Learner");
      expect(result?.nextLevelName).toBe("Student");
      expect(result?.pointsIntoLevel).toBe(5);
      expect(result?.levelSpan).toBe(100);
      expect(result?.pointsToNextLevel).toBe(95);
      expect(result?.currentStreak).toBe(1);
      expect(result?.activeToday).toBe(true);
      expect(result?.recentEvents.length).toBeGreaterThan(0);
    });

    it("nextLevelName/levelSpan/pointsToNextLevel are null at Grandmaster", () => {
      // Direct backfill of 8000+ pts
      testDb
        .insert(schema.pointsEvents)
        .values({
          userId: base.user.id,
          kind: schema.PointsEventKind.LessonComplete,
          points: 8100,
          isBackfill: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        })
        .run();

      const result = getDashboardGamification(base.user.id);
      expect(result?.levelName).toBe("Grandmaster");
      expect(result?.nextLevelName).toBeNull();
      expect(result?.levelSpan).toBeNull();
      expect(result?.pointsToNextLevel).toBeNull();
    });

    it("recentEvents is newest-first and respects an internal cap", () => {
      vi.useFakeTimers();
      const lessons = createLessonsInModule(base.course.id, 10);
      const baseDate = new Date("2026-05-01T10:00:00Z").getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      for (let i = 0; i < lessons.length; i++) {
        vi.setSystemTime(new Date(baseDate + i * dayMs));
        onLessonCompleted(base.user.id, lessons[i].id);
      }

      const result = getDashboardGamification(base.user.id);
      // newest-first by createdAt
      for (let i = 1; i < (result?.recentEvents.length ?? 0); i++) {
        expect(
          result!.recentEvents[i - 1].createdAt >=
            result!.recentEvents[i].createdAt
        ).toBe(true);
      }
    });
  });

  describe("getStreakBanner", () => {
    it("returns null for a non-student", () => {
      const result = getStreakBanner(base.instructor.id);
      expect(result).toBeNull();
    });

    it("returns banner data for a broken ≥7-day streak", () => {
      vi.useFakeTimers();
      const start = new Date("2026-04-29T10:00:00Z").getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      for (let i = 0; i < 12; i++) {
        vi.setSystemTime(new Date(start + i * dayMs));
        onLessonCompleted(base.user.id, createLesson().id);
      }

      vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));
      const banner = getStreakBanner(base.user.id);

      expect(banner).toEqual({
        previousStreakLength: 12,
        lastActiveDate: "2026-05-10",
      });
    });

    it("returns null after dismissStreakBanner for that lastActiveDate", () => {
      vi.useFakeTimers();
      const start = new Date("2026-04-29T10:00:00Z").getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      for (let i = 0; i < 12; i++) {
        vi.setSystemTime(new Date(start + i * dayMs));
        onLessonCompleted(base.user.id, createLesson().id);
      }
      dismissStreakBanner(base.user.id, "2026-05-10");

      vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));
      const banner = getStreakBanner(base.user.id);
      expect(banner).toBeNull();
    });
  });

  describe("backfill", () => {
    it("backfill({ userId }) re-derives points_events from lessonProgress / quizAttempts / enrollments without duplicates", () => {
      const lesson = createLesson();
      const quiz = createQuiz();
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: base.user.id,
          lessonId: lesson.id,
          status: schema.LessonProgressStatus.Completed,
          completedAt: "2026-04-01T10:00:00.000Z",
        })
        .run();
      testDb
        .insert(schema.quizAttempts)
        .values({
          userId: base.user.id,
          quizId: quiz.id,
          score: 1.0,
          passed: true,
          attemptedAt: "2026-04-02T10:00:00.000Z",
        })
        .run();
      testDb
        .insert(schema.enrollments)
        .values({
          userId: base.user.id,
          courseId: base.course.id,
          enrolledAt: "2026-03-01T10:00:00.000Z",
          completedAt: "2026-04-03T10:00:00.000Z",
        })
        .run();

      backfill({ userId: base.user.id });
      backfill({ userId: base.user.id }); // idempotent

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();
      // 1 lesson + 1 quiz_pass + 1 quiz_perfect + 1 course_complete = 4 events, no streak_day
      expect(events).toHaveLength(4);
      const kinds = events.map((e) => e.kind).sort();
      expect(kinds).toEqual(
        [
          schema.PointsEventKind.LessonComplete,
          schema.PointsEventKind.QuizPass,
          schema.PointsEventKind.QuizPerfect,
          schema.PointsEventKind.CourseComplete,
        ].sort()
      );
    });

    it("backfill() with no userId walks every user", () => {
      const otherUser = testDb
        .insert(schema.users)
        .values({
          name: "Other",
          email: "other@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();
      const lesson = createLesson();
      testDb
        .insert(schema.lessonProgress)
        .values([
          {
            userId: base.user.id,
            lessonId: lesson.id,
            status: schema.LessonProgressStatus.Completed,
            completedAt: "2026-04-01T10:00:00.000Z",
          },
          {
            userId: otherUser.id,
            lessonId: lesson.id,
            status: schema.LessonProgressStatus.Completed,
            completedAt: "2026-04-01T10:00:00.000Z",
          },
        ])
        .run();

      backfill();

      const baseEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.LessonComplete
      );
      const otherEvents = eventsOfKind(
        otherUser.id,
        schema.PointsEventKind.LessonComplete
      );
      expect(baseEvents).toHaveLength(1);
      expect(otherEvents).toHaveLength(1);
    });
  });

  describe("dismissStreakBanner", () => {
    it("is idempotent — duplicate calls do not throw and do not produce extra rows", () => {
      dismissStreakBanner(base.user.id, "2026-05-10");
      dismissStreakBanner(base.user.id, "2026-05-10");

      const rows = testDb
        .select()
        .from(schema.dismissedStreakBanners)
        .where(eq(schema.dismissedStreakBanners.userId, base.user.id))
        .all();
      expect(rows).toHaveLength(1);
    });
  });
});
