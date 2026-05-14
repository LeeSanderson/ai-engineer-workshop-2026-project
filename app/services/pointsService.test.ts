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
  awardPointsForLessonComplete,
  awardPointsForQuizAttempt,
  awardPointsForCourseComplete,
  getUserPoints,
} from "./pointsService";

function createLesson() {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 1 })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson", position: 1 })
    .returning()
    .get();
}

function createQuiz() {
  const lesson = createLesson();
  return testDb
    .insert(schema.quizzes)
    .values({ lessonId: lesson.id, title: "Quiz", passingScore: 0.7 })
    .returning()
    .get();
}

function setUserTimezone(userId: number, timezone: string) {
  testDb
    .update(schema.users)
    .set({ timezone })
    .where(eq(schema.users.id, userId))
    .run();
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

describe("pointsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("awardPointsForLessonComplete", () => {
    it("writes a lesson_complete event worth 10 points", () => {
      const lesson = createLesson();

      awardPointsForLessonComplete(base.user.id, lesson.id);

      const lessonEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.LessonComplete
      );

      expect(lessonEvents).toHaveLength(1);
      expect(lessonEvents[0].points).toBe(10);
      expect(lessonEvents[0].lessonId).toBe(lesson.id);
      expect(lessonEvents[0].isBackfill).toBe(false);
    });

    it("writes both lesson_complete and streak_day events in the same transaction", () => {
      const lesson = createLesson();

      awardPointsForLessonComplete(base.user.id, lesson.id);

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      const lessonEv = events.find(
        (e) => e.kind === schema.PointsEventKind.LessonComplete
      );
      const streakEv = events.find(
        (e) => e.kind === schema.PointsEventKind.StreakDay
      );

      expect(lessonEv).toBeDefined();
      expect(streakEv).toBeDefined();
      expect(streakEv?.points).toBe(5);
      expect(streakEv?.streakDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("is idempotent: a second call for the same (user, lesson) is a silent no-op", () => {
      const lesson = createLesson();

      awardPointsForLessonComplete(base.user.id, lesson.id);
      awardPointsForLessonComplete(base.user.id, lesson.id);

      const lessonEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.LessonComplete
      );

      expect(lessonEvents).toHaveLength(1);
    });

    it("same-day double lesson-complete writes only one streak_day event", () => {
      const l1 = createLesson();
      const l2 = createLesson();

      awardPointsForLessonComplete(base.user.id, l1.id);
      awardPointsForLessonComplete(base.user.id, l2.id);

      const streakEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.StreakDay
      );
      expect(streakEvents).toHaveLength(1);

      const lessonEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.LessonComplete
      );
      expect(lessonEvents).toHaveLength(2);
    });

    it("writes separate lesson events for different lessons", () => {
      const l1 = createLesson();
      const l2 = createLesson();

      awardPointsForLessonComplete(base.user.id, l1.id);
      awardPointsForLessonComplete(base.user.id, l2.id);

      const lessonEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.LessonComplete
      );

      expect(lessonEvents).toHaveLength(2);
    });

    it("user deletion cascades and removes their events", () => {
      const lesson = createLesson();
      awardPointsForLessonComplete(base.user.id, lesson.id);

      testDb.delete(schema.users).where(eq(schema.users.id, base.user.id)).run();

      const events = testDb.select().from(schema.pointsEvents).all();
      expect(events).toHaveLength(0);
    });

    it("lesson deletion sets the lesson_id to null but preserves the event and total", () => {
      const lesson = createLesson();
      awardPointsForLessonComplete(base.user.id, lesson.id);

      testDb.delete(schema.lessons).where(eq(schema.lessons.id, lesson.id)).run();

      const lessonEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.LessonComplete
      );

      expect(lessonEvents).toHaveLength(1);
      expect(lessonEvents[0].lessonId).toBeNull();
      expect(lessonEvents[0].points).toBe(10);
    });

    it("records the streak_day under the user's local calendar date", () => {
      setUserTimezone(base.user.id, "America/Los_Angeles");
      // 11:55pm Pacific on 2026-05-14 = 06:55 UTC on 2026-05-15
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-15T06:55:00Z"));

      const lesson = createLesson();
      awardPointsForLessonComplete(base.user.id, lesson.id);

      const streakEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.StreakDay
      );
      expect(streakEvents).toHaveLength(1);
      expect(streakEvents[0].streakDate).toBe("2026-05-14");
    });
  });

  describe("awardPointsForQuizAttempt", () => {
    it("writes a quiz_pass event worth 25 points on a passing attempt", () => {
      const quiz = createQuiz();

      awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 0.8,
        passed: true,
      });

      const passEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPass
      );
      expect(passEvents).toHaveLength(1);
      expect(passEvents[0].points).toBe(25);
      expect(passEvents[0].quizId).toBe(quiz.id);
    });

    it("writes both quiz_pass and quiz_perfect on a first 100% attempt", () => {
      const quiz = createQuiz();

      awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 1.0,
        passed: true,
      });

      const passEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPass
      );
      const perfectEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPerfect
      );

      expect(passEvents).toHaveLength(1);
      expect(perfectEvents).toHaveLength(1);
      expect(passEvents[0].points + perfectEvents[0].points).toBe(40);
    });

    it("writes a streak_day event alongside a passing quiz attempt", () => {
      const quiz = createQuiz();

      awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 0.8,
        passed: true,
      });

      const streakEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.StreakDay
      );
      expect(streakEvents).toHaveLength(1);
      expect(streakEvents[0].points).toBe(5);
    });

    it("writes no events on a failing attempt — no quiz_pass, no streak_day", () => {
      const quiz = createQuiz();

      awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 0.5,
        passed: false,
      });

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(0);
    });

    it("re-passing a quiz at <100% writes no additional quiz_pass event", () => {
      const quiz = createQuiz();

      awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 0.8,
        passed: true,
      });
      awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 0.9,
        passed: true,
      });

      const passEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPass
      );
      expect(passEvents).toHaveLength(1);
    });

    it("a later perfect score after a prior pass adds only the quiz_perfect event", () => {
      const quiz = createQuiz();

      awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 0.8,
        passed: true,
      });
      awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 1.0,
        passed: true,
      });

      const passEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPass
      );
      const perfectEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPerfect
      );
      expect(passEvents).toHaveLength(1);
      expect(perfectEvents).toHaveLength(1);
    });

    it("re-perfect-scoring is idempotent: only one quiz_perfect event ever", () => {
      const quiz = createQuiz();

      awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 1.0,
        passed: true,
      });
      awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 1.0,
        passed: true,
      });

      const passEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPass
      );
      const perfectEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPerfect
      );
      expect(passEvents).toHaveLength(1);
      expect(perfectEvents).toHaveLength(1);
    });

    it("different quizzes get independent events", () => {
      const q1 = createQuiz();
      const q2 = createQuiz();

      awardPointsForQuizAttempt(base.user.id, {
        quizId: q1.id,
        score: 1.0,
        passed: true,
      });
      awardPointsForQuizAttempt(base.user.id, {
        quizId: q2.id,
        score: 0.8,
        passed: true,
      });

      const passEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPass
      );
      const perfectEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPerfect
      );

      expect(passEvents).toHaveLength(2);
      expect(perfectEvents).toHaveLength(1);
    });
  });

  describe("awardPointsForCourseComplete", () => {
    it("writes a course_complete event worth 100 points", () => {
      awardPointsForCourseComplete(base.user.id, base.course.id);

      const events = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.CourseComplete
      );

      expect(events).toHaveLength(1);
      expect(events[0].points).toBe(100);
      expect(events[0].courseId).toBe(base.course.id);
    });

    it("is idempotent: a second call for the same (user, course) is a silent no-op", () => {
      awardPointsForCourseComplete(base.user.id, base.course.id);
      awardPointsForCourseComplete(base.user.id, base.course.id);

      const events = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.CourseComplete
      );

      expect(events).toHaveLength(1);
    });

    it("does not write a streak_day event (course completion is not a qualifying activity)", () => {
      awardPointsForCourseComplete(base.user.id, base.course.id);

      const streakEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.StreakDay
      );
      expect(streakEvents).toHaveLength(0);
    });
  });

  describe("getUserPoints", () => {
    it("returns 0 points, Newcomer, and zero-length streaks for a user with no events", () => {
      const result = getUserPoints(base.user.id);
      expect(result.totalPoints).toBe(0);
      expect(result.level.name).toBe("Newcomer");
      expect(result.level.index).toBe(1);
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(0);
      expect(result.lastActiveDate).toBeNull();
    });

    it("returns the sum of points and the resolved level", () => {
      // 5 lessons × 10 (lesson) + 5 (streak_day, one per day, all today) = 55 pts → Level 2 (Learner)
      for (let i = 0; i < 5; i++) {
        const lesson = createLesson();
        awardPointsForLessonComplete(base.user.id, lesson.id);
      }

      const result = getUserPoints(base.user.id);
      expect(result.totalPoints).toBe(55);
      expect(result.level.name).toBe("Learner");
      expect(result.level.index).toBe(2);
    });

    it("returns currentStreak and longestStreak computed from events", () => {
      vi.useFakeTimers();

      // Day -2
      vi.setSystemTime(new Date("2026-05-12T10:00:00Z"));
      awardPointsForLessonComplete(base.user.id, createLesson().id);

      // Day -1
      vi.setSystemTime(new Date("2026-05-13T10:00:00Z"));
      awardPointsForLessonComplete(base.user.id, createLesson().id);

      // Today
      vi.setSystemTime(new Date("2026-05-14T10:00:00Z"));
      awardPointsForLessonComplete(base.user.id, createLesson().id);

      const result = getUserPoints(base.user.id);
      expect(result.currentStreak).toBe(3);
      expect(result.longestStreak).toBe(3);
      expect(result.lastActiveDate).toBe("2026-05-14");
    });

    it("excludes backfill events from streak computation", () => {
      // Insert a backfill lesson event directly
      testDb
        .insert(schema.pointsEvents)
        .values({
          userId: base.user.id,
          kind: schema.PointsEventKind.LessonComplete,
          points: 10,
          lessonId: createLesson().id,
          isBackfill: true,
          createdAt: new Date().toISOString(),
        })
        .run();

      const result = getUserPoints(base.user.id);
      expect(result.totalPoints).toBe(10);
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(0);
    });
  });
});
