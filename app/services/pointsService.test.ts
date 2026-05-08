import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { eq } from "drizzle-orm";

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

describe("pointsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("awardPointsForLessonComplete", () => {
    it("writes a lesson_complete event worth 10 points", () => {
      const lesson = createLesson();

      awardPointsForLessonComplete(base.user.id, lesson.id);

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe(schema.PointsEventKind.LessonComplete);
      expect(events[0].points).toBe(10);
      expect(events[0].lessonId).toBe(lesson.id);
      expect(events[0].isBackfill).toBe(false);
    });

    it("is idempotent: a second call for the same (user, lesson) is a silent no-op", () => {
      const lesson = createLesson();

      awardPointsForLessonComplete(base.user.id, lesson.id);
      awardPointsForLessonComplete(base.user.id, lesson.id);

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(1);
    });

    it("writes separate events for different lessons", () => {
      const l1 = createLesson();
      const l2 = createLesson();

      awardPointsForLessonComplete(base.user.id, l1.id);
      awardPointsForLessonComplete(base.user.id, l2.id);

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(2);
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

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(1);
      expect(events[0].lessonId).toBeNull();
      expect(events[0].points).toBe(10);
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

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe(schema.PointsEventKind.QuizPass);
      expect(events[0].points).toBe(25);
      expect(events[0].quizId).toBe(quiz.id);
    });

    it("writes both quiz_pass and quiz_perfect on a first 100% attempt", () => {
      const quiz = createQuiz();

      awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 1.0,
        passed: true,
      });

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(2);
      const kinds = events.map((e) => e.kind).sort();
      expect(kinds).toEqual(
        [
          schema.PointsEventKind.QuizPass,
          schema.PointsEventKind.QuizPerfect,
        ].sort()
      );
      const totalPoints = events.reduce((sum, e) => sum + e.points, 0);
      expect(totalPoints).toBe(40);
    });

    it("writes no events on a failing attempt", () => {
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

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe(schema.PointsEventKind.QuizPass);
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

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(2);
      const kinds = events.map((e) => e.kind).sort();
      expect(kinds).toEqual(
        [
          schema.PointsEventKind.QuizPass,
          schema.PointsEventKind.QuizPerfect,
        ].sort()
      );
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

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(2);
      const totalPoints = events.reduce((sum, e) => sum + e.points, 0);
      expect(totalPoints).toBe(40);
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

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(3);
      const totalPoints = events.reduce((sum, e) => sum + e.points, 0);
      expect(totalPoints).toBe(65); // 25 + 15 + 25
    });
  });

  describe("awardPointsForCourseComplete", () => {
    it("writes a course_complete event worth 100 points", () => {
      awardPointsForCourseComplete(base.user.id, base.course.id);

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe(schema.PointsEventKind.CourseComplete);
      expect(events[0].points).toBe(100);
      expect(events[0].courseId).toBe(base.course.id);
    });

    it("is idempotent: a second call for the same (user, course) is a silent no-op", () => {
      awardPointsForCourseComplete(base.user.id, base.course.id);
      awardPointsForCourseComplete(base.user.id, base.course.id);

      const events = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(events).toHaveLength(1);
    });
  });

  describe("getUserPoints", () => {
    it("returns 0 points and Newcomer level for a user with no events", () => {
      const result = getUserPoints(base.user.id);
      expect(result.totalPoints).toBe(0);
      expect(result.level.name).toBe("Newcomer");
      expect(result.level.index).toBe(1);
    });

    it("returns the sum of points and the resolved level", () => {
      // Create 5 lessons and complete all, totalling 50 pts → Level 2 (Learner)
      for (let i = 0; i < 5; i++) {
        const lesson = createLesson();
        awardPointsForLessonComplete(base.user.id, lesson.id);
      }

      const result = getUserPoints(base.user.id);
      expect(result.totalPoints).toBe(50);
      expect(result.level.name).toBe("Learner");
      expect(result.level.index).toBe(2);
    });

    it("returns Newcomer for a user with 49 points (just below the Level 2 threshold)", () => {
      // Award one lesson event to set up, then manually craft events totalling 49 pts.
      // Easiest: 4 lesson events × 10 + manual 9-pt streak event.
      for (let i = 0; i < 4; i++) {
        const lesson = createLesson();
        awardPointsForLessonComplete(base.user.id, lesson.id);
      }
      // Inject a 9-pt streak_day event directly to land at 49 total.
      testDb
        .insert(schema.pointsEvents)
        .values({
          userId: base.user.id,
          kind: schema.PointsEventKind.StreakDay,
          points: 9,
          streakDate: "2026-05-07",
        })
        .run();

      const result = getUserPoints(base.user.id);
      expect(result.totalPoints).toBe(49);
      expect(result.level.name).toBe("Newcomer");
    });
  });
});
