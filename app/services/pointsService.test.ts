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
  backfillUserPoints,
  getUserPoints,
  getRecentPointsEvents,
  getStreakBannerData,
  dismissStreakBanner,
  detectLevelCrossed,
  detectStreakMilestone,
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

  describe("fired-event return values", () => {
    it("awardPointsForLessonComplete returns lesson_complete + streak_day on first call", () => {
      const lesson = createLesson();

      const fired = awardPointsForLessonComplete(base.user.id, lesson.id);

      expect(fired).toHaveLength(2);
      const lessonEv = fired.find(
        (e) => e.kind === schema.PointsEventKind.LessonComplete
      );
      const streakEv = fired.find(
        (e) => e.kind === schema.PointsEventKind.StreakDay
      );
      expect(lessonEv).toEqual({
        kind: schema.PointsEventKind.LessonComplete,
        points: 10,
      });
      expect(streakEv?.points).toBe(5);
      expect(streakEv?.streakDayNumber).toBe(1);
    });

    it("awardPointsForLessonComplete returns [] on a duplicate (already-completed) call", () => {
      const lesson = createLesson();
      awardPointsForLessonComplete(base.user.id, lesson.id);

      const fired = awardPointsForLessonComplete(base.user.id, lesson.id);
      expect(fired).toEqual([]);
    });

    it("awardPointsForLessonComplete returns only lesson_complete when streak_day already exists today", () => {
      const l1 = createLesson();
      const l2 = createLesson();
      awardPointsForLessonComplete(base.user.id, l1.id);

      const fired = awardPointsForLessonComplete(base.user.id, l2.id);
      expect(fired).toEqual([
        { kind: schema.PointsEventKind.LessonComplete, points: 10 },
      ]);
    });

    it("streakDayNumber on lesson_complete reflects consecutive-day count", () => {
      vi.useFakeTimers();

      vi.setSystemTime(new Date("2026-05-12T10:00:00Z"));
      awardPointsForLessonComplete(base.user.id, createLesson().id);

      vi.setSystemTime(new Date("2026-05-13T10:00:00Z"));
      awardPointsForLessonComplete(base.user.id, createLesson().id);

      vi.setSystemTime(new Date("2026-05-14T10:00:00Z"));
      const fired = awardPointsForLessonComplete(
        base.user.id,
        createLesson().id
      );

      const streakEv = fired.find(
        (e) => e.kind === schema.PointsEventKind.StreakDay
      );
      expect(streakEv?.streakDayNumber).toBe(3);
    });

    it("awardPointsForQuizAttempt returns quiz_pass + quiz_perfect + streak_day on a perfect first pass", () => {
      const quiz = createQuiz();

      const fired = awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 1.0,
        passed: true,
      });

      expect(fired.map((e) => e.kind).sort()).toEqual(
        [
          schema.PointsEventKind.QuizPass,
          schema.PointsEventKind.QuizPerfect,
          schema.PointsEventKind.StreakDay,
        ].sort()
      );
    });

    it("awardPointsForQuizAttempt returns [] on a failing attempt", () => {
      const quiz = createQuiz();
      const fired = awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 0.5,
        passed: false,
      });
      expect(fired).toEqual([]);
    });

    it("awardPointsForQuizAttempt returns only quiz_perfect when pass and streak_day are already recorded", () => {
      const quiz = createQuiz();
      awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 0.8,
        passed: true,
      });

      const fired = awardPointsForQuizAttempt(base.user.id, {
        quizId: quiz.id,
        score: 1.0,
        passed: true,
      });

      expect(fired).toEqual([
        { kind: schema.PointsEventKind.QuizPerfect, points: 15 },
      ]);
    });

    it("awardPointsForCourseComplete returns the course_complete event on first call, [] on duplicate", () => {
      const first = awardPointsForCourseComplete(base.user.id, base.course.id);
      expect(first).toEqual([
        { kind: schema.PointsEventKind.CourseComplete, points: 100 },
      ]);

      const second = awardPointsForCourseComplete(base.user.id, base.course.id);
      expect(second).toEqual([]);
    });
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

  describe("getRecentPointsEvents", () => {
    it("returns an empty list when the user has no events", () => {
      const events = getRecentPointsEvents(base.user.id, 10);
      expect(events).toEqual([]);
    });

    it("returns events newest-first with kind, points, and createdAt", () => {
      vi.useFakeTimers();

      vi.setSystemTime(new Date("2026-05-12T10:00:00Z"));
      awardPointsForLessonComplete(base.user.id, createLesson().id);
      vi.setSystemTime(new Date("2026-05-13T10:00:00Z"));
      awardPointsForLessonComplete(base.user.id, createLesson().id);
      vi.setSystemTime(new Date("2026-05-14T10:00:00Z"));
      awardPointsForCourseComplete(base.user.id, base.course.id);

      const events = getRecentPointsEvents(base.user.id, 10);

      // Most recent first. The course_complete is the latest event.
      expect(events[0].kind).toBe(schema.PointsEventKind.CourseComplete);
      expect(events[0].points).toBe(100);
      expect(events[0].createdAt).toBeTruthy();

      // Each event has shape { kind, points, createdAt }
      for (const e of events) {
        expect(typeof e.kind).toBe("string");
        expect(typeof e.points).toBe("number");
        expect(typeof e.createdAt).toBe("string");
      }

      // Order is strictly descending by createdAt
      for (let i = 1; i < events.length; i++) {
        expect(events[i - 1].createdAt >= events[i].createdAt).toBe(true);
      }
    });

    it("respects the limit parameter", () => {
      for (let i = 0; i < 8; i++) {
        awardPointsForLessonComplete(base.user.id, createLesson().id);
      }

      const events = getRecentPointsEvents(base.user.id, 5);
      expect(events.length).toBe(5);
    });

    it("only returns events for the requested user", () => {
      const otherUser = testDb
        .insert(schema.users)
        .values({
          name: "Other",
          email: "other@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();
      awardPointsForLessonComplete(base.user.id, createLesson().id);
      awardPointsForLessonComplete(otherUser.id, createLesson().id);

      const events = getRecentPointsEvents(base.user.id, 10);
      // base.user has lesson + streak_day = 2 rows. otherUser's events excluded.
      expect(events.length).toBe(2);
    });
  });

  describe("signal helpers", () => {
    it("detectLevelCrossed returns the new index when total crosses a threshold", () => {
      expect(detectLevelCrossed(49, 64)).toBe(2);
    });

    it("detectLevelCrossed returns null when level stays the same", () => {
      expect(detectLevelCrossed(10, 40)).toBeNull();
    });

    it("detectLevelCrossed returns the highest crossed level when multiple are crossed", () => {
      // 0 → 700 crosses Levels 2, 3, 4, 5; expect 5 (Apprentice)
      expect(detectLevelCrossed(0, 700)).toBe(5);
    });

    it("detectStreakMilestone returns the milestone when a streak_day fired at 7", () => {
      expect(
        detectStreakMilestone([
          {
            kind: schema.PointsEventKind.StreakDay,
            points: 5,
            streakDayNumber: 7,
          },
        ])
      ).toBe(7);
    });

    it("detectStreakMilestone returns null when streak length is non-milestone", () => {
      expect(
        detectStreakMilestone([
          {
            kind: schema.PointsEventKind.StreakDay,
            points: 5,
            streakDayNumber: 8,
          },
        ])
      ).toBeNull();
    });

    it("detectStreakMilestone returns null when no streak_day event was fired", () => {
      expect(
        detectStreakMilestone([
          {
            kind: schema.PointsEventKind.LessonComplete,
            points: 10,
          },
        ])
      ).toBeNull();
    });
  });

  describe("getStreakBannerData", () => {
    it("returns null when the user has no events", () => {
      const banner = getStreakBannerData(
        base.user.id,
        "UTC",
        new Date("2026-05-14T12:00:00Z")
      );
      expect(banner).toBeNull();
    });

    it("returns null when the current streak is active today", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-14T10:00:00Z"));
      // Build a 10-day run ending today
      for (let i = 0; i < 10; i++) {
        const d = new Date(`2026-05-${String(5 + i).padStart(2, "0")}T10:00:00Z`);
        vi.setSystemTime(d);
        awardPointsForLessonComplete(base.user.id, createLesson().id);
      }

      const banner = getStreakBannerData(
        base.user.id,
        "UTC",
        new Date("2026-05-14T20:00:00Z")
      );
      expect(banner).toBeNull();
    });

    it("returns null when the previous run was shorter than 7 days", () => {
      vi.useFakeTimers();
      // 4-day run ending 2026-05-05
      for (let i = 0; i < 4; i++) {
        vi.setSystemTime(
          new Date(`2026-05-0${2 + i}T10:00:00Z`)
        );
        awardPointsForLessonComplete(base.user.id, createLesson().id);
      }

      const banner = getStreakBannerData(
        base.user.id,
        "UTC",
        new Date("2026-05-14T12:00:00Z")
      );
      expect(banner).toBeNull();
    });

    it("returns banner data when the previous run was ≥ 7 days and is broken", () => {
      vi.useFakeTimers();
      // 12-day run from 2026-04-29 → 2026-05-10
      const start = new Date("2026-04-29T10:00:00Z").getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      for (let i = 0; i < 12; i++) {
        vi.setSystemTime(new Date(start + i * dayMs));
        awardPointsForLessonComplete(base.user.id, createLesson().id);
      }

      // "Now" is 2026-05-14 — five days after the last active day, well past the
      // one-day grace window, so currentStreak resets to 0.
      const banner = getStreakBannerData(
        base.user.id,
        "UTC",
        new Date("2026-05-14T12:00:00Z")
      );
      expect(banner).toEqual({
        previousStreakLength: 12,
        lastActiveDate: "2026-05-10",
      });
    });

    it("returns null after the banner has been dismissed for that lastActiveDate", () => {
      vi.useFakeTimers();
      const start = new Date("2026-04-29T10:00:00Z").getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      for (let i = 0; i < 12; i++) {
        vi.setSystemTime(new Date(start + i * dayMs));
        awardPointsForLessonComplete(base.user.id, createLesson().id);
      }

      dismissStreakBanner(base.user.id, "2026-05-10");

      const banner = getStreakBannerData(
        base.user.id,
        "UTC",
        new Date("2026-05-14T12:00:00Z")
      );
      expect(banner).toBeNull();
    });

    it("dismissing one user's banner does not affect another user", () => {
      vi.useFakeTimers();
      const otherUser = testDb
        .insert(schema.users)
        .values({
          name: "Other",
          email: "other@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();

      const start = new Date("2026-04-29T10:00:00Z").getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      for (let i = 0; i < 12; i++) {
        vi.setSystemTime(new Date(start + i * dayMs));
        const lesson = createLesson();
        awardPointsForLessonComplete(base.user.id, lesson.id);
        awardPointsForLessonComplete(otherUser.id, lesson.id);
      }

      dismissStreakBanner(base.user.id, "2026-05-10");

      const otherBanner = getStreakBannerData(
        otherUser.id,
        "UTC",
        new Date("2026-05-14T12:00:00Z")
      );
      expect(otherBanner).toEqual({
        previousStreakLength: 12,
        lastActiveDate: "2026-05-10",
      });
    });
  });

  describe("backfillUserPoints", () => {
    it("writes a lesson_complete event with isBackfill=true and createdAt from completedAt for each completed lessonProgress row", () => {
      const l1 = createLesson();
      const l2 = createLesson();
      testDb
        .insert(schema.lessonProgress)
        .values([
          {
            userId: base.user.id,
            lessonId: l1.id,
            status: schema.LessonProgressStatus.Completed,
            completedAt: "2026-04-01T10:00:00.000Z",
          },
          {
            userId: base.user.id,
            lessonId: l2.id,
            status: schema.LessonProgressStatus.Completed,
            completedAt: "2026-04-02T10:00:00.000Z",
          },
        ])
        .run();

      backfillUserPoints(base.user.id);

      const events = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.LessonComplete
      );
      expect(events).toHaveLength(2);
      for (const ev of events) {
        expect(ev.isBackfill).toBe(true);
        expect(ev.points).toBe(10);
      }
      const byLesson = new Map(events.map((e) => [e.lessonId, e.createdAt]));
      expect(byLesson.get(l1.id)).toBe("2026-04-01T10:00:00.000Z");
      expect(byLesson.get(l2.id)).toBe("2026-04-02T10:00:00.000Z");
    });

    it("ignores lessonProgress rows that are not completed", () => {
      const l1 = createLesson();
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: base.user.id,
          lessonId: l1.id,
          status: schema.LessonProgressStatus.InProgress,
        })
        .run();

      backfillUserPoints(base.user.id);

      const events = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.LessonComplete
      );
      expect(events).toHaveLength(0);
    });

    it("writes quiz_pass with isBackfill=true and original timestamp from the first passing attempt per (user, quiz)", () => {
      const quiz = createQuiz();
      // Earlier failing attempt, later passing attempt — should not be picked
      testDb
        .insert(schema.quizAttempts)
        .values([
          {
            userId: base.user.id,
            quizId: quiz.id,
            score: 0.5,
            passed: false,
            attemptedAt: "2026-04-01T10:00:00.000Z",
          },
          {
            userId: base.user.id,
            quizId: quiz.id,
            score: 0.8,
            passed: true,
            attemptedAt: "2026-04-02T10:00:00.000Z",
          },
          {
            userId: base.user.id,
            quizId: quiz.id,
            score: 0.9,
            passed: true,
            attemptedAt: "2026-04-03T10:00:00.000Z",
          },
        ])
        .run();

      backfillUserPoints(base.user.id);

      const events = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPass
      );
      expect(events).toHaveLength(1);
      expect(events[0].isBackfill).toBe(true);
      expect(events[0].points).toBe(25);
      expect(events[0].quizId).toBe(quiz.id);
      expect(events[0].createdAt).toBe("2026-04-02T10:00:00.000Z");
    });

    it("writes quiz_perfect from the first 100% attempt with that attempt's original timestamp", () => {
      const quiz = createQuiz();
      // First pass at 0.8, later perfect — pass takes earlier ts, perfect takes its own ts
      testDb
        .insert(schema.quizAttempts)
        .values([
          {
            userId: base.user.id,
            quizId: quiz.id,
            score: 0.8,
            passed: true,
            attemptedAt: "2026-04-02T10:00:00.000Z",
          },
          {
            userId: base.user.id,
            quizId: quiz.id,
            score: 1.0,
            passed: true,
            attemptedAt: "2026-04-05T10:00:00.000Z",
          },
          {
            userId: base.user.id,
            quizId: quiz.id,
            score: 1.0,
            passed: true,
            attemptedAt: "2026-04-06T10:00:00.000Z",
          },
        ])
        .run();

      backfillUserPoints(base.user.id);

      const pass = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPass
      );
      const perfect = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.QuizPerfect
      );
      expect(pass).toHaveLength(1);
      expect(pass[0].createdAt).toBe("2026-04-02T10:00:00.000Z");
      expect(perfect).toHaveLength(1);
      expect(perfect[0].isBackfill).toBe(true);
      expect(perfect[0].points).toBe(15);
      expect(perfect[0].createdAt).toBe("2026-04-05T10:00:00.000Z");
    });

    it("writes a course_complete event with isBackfill=true and createdAt from enrollment.completedAt", () => {
      testDb
        .insert(schema.enrollments)
        .values({
          userId: base.user.id,
          courseId: base.course.id,
          enrolledAt: "2026-03-01T10:00:00.000Z",
          completedAt: "2026-04-10T10:00:00.000Z",
        })
        .run();

      backfillUserPoints(base.user.id);

      const events = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.CourseComplete
      );
      expect(events).toHaveLength(1);
      expect(events[0].isBackfill).toBe(true);
      expect(events[0].points).toBe(100);
      expect(events[0].courseId).toBe(base.course.id);
      expect(events[0].createdAt).toBe("2026-04-10T10:00:00.000Z");
    });

    it("ignores enrollments with null completedAt", () => {
      testDb
        .insert(schema.enrollments)
        .values({
          userId: base.user.id,
          courseId: base.course.id,
          enrolledAt: "2026-03-01T10:00:00.000Z",
          completedAt: null,
        })
        .run();

      backfillUserPoints(base.user.id);

      const events = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.CourseComplete
      );
      expect(events).toHaveLength(0);
    });

    it("writes no streak_day events even for users with consecutive historical activity", () => {
      const l1 = createLesson();
      const l2 = createLesson();
      const l3 = createLesson();
      testDb
        .insert(schema.lessonProgress)
        .values([
          {
            userId: base.user.id,
            lessonId: l1.id,
            status: schema.LessonProgressStatus.Completed,
            completedAt: "2026-04-01T10:00:00.000Z",
          },
          {
            userId: base.user.id,
            lessonId: l2.id,
            status: schema.LessonProgressStatus.Completed,
            completedAt: "2026-04-02T10:00:00.000Z",
          },
          {
            userId: base.user.id,
            lessonId: l3.id,
            status: schema.LessonProgressStatus.Completed,
            completedAt: "2026-04-03T10:00:00.000Z",
          },
        ])
        .run();

      backfillUserPoints(base.user.id);

      const streakEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.StreakDay
      );
      expect(streakEvents).toHaveLength(0);
    });

    it("is idempotent: running twice produces the same row count and identical events", () => {
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

      backfillUserPoints(base.user.id);
      const firstRun = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      backfillUserPoints(base.user.id);
      const secondRun = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.userId, base.user.id))
        .all();

      expect(secondRun).toHaveLength(firstRun.length);
      expect(secondRun.map((e) => e.id).sort()).toEqual(
        firstRun.map((e) => e.id).sort()
      );
    });

    it("after backfill, getUserPoints returns the expected total/level and currentStreak=0", () => {
      const l1 = createLesson();
      const l2 = createLesson();
      const quiz = createQuiz();
      testDb
        .insert(schema.lessonProgress)
        .values([
          {
            userId: base.user.id,
            lessonId: l1.id,
            status: schema.LessonProgressStatus.Completed,
            completedAt: "2026-04-01T10:00:00.000Z",
          },
          {
            userId: base.user.id,
            lessonId: l2.id,
            status: schema.LessonProgressStatus.Completed,
            completedAt: "2026-04-02T10:00:00.000Z",
          },
        ])
        .run();
      testDb
        .insert(schema.quizAttempts)
        .values({
          userId: base.user.id,
          quizId: quiz.id,
          score: 1.0,
          passed: true,
          attemptedAt: "2026-04-03T10:00:00.000Z",
        })
        .run();
      testDb
        .insert(schema.enrollments)
        .values({
          userId: base.user.id,
          courseId: base.course.id,
          enrolledAt: "2026-03-01T10:00:00.000Z",
          completedAt: "2026-04-04T10:00:00.000Z",
        })
        .run();

      backfillUserPoints(base.user.id);

      // 2 lessons × 10 + quiz pass 25 + quiz perfect 15 + course 100 = 160
      const result = getUserPoints(base.user.id);
      expect(result.totalPoints).toBe(160);
      expect(result.level.name).toBe("Student");
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(0);
    });

    it("does not write events for users other than the target user", () => {
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
        .values({
          userId: otherUser.id,
          lessonId: lesson.id,
          status: schema.LessonProgressStatus.Completed,
          completedAt: "2026-04-01T10:00:00.000Z",
        })
        .run();

      backfillUserPoints(base.user.id);

      const baseEvents = eventsOfKind(
        base.user.id,
        schema.PointsEventKind.LessonComplete
      );
      const otherEvents = eventsOfKind(
        otherUser.id,
        schema.PointsEventKind.LessonComplete
      );
      expect(baseEvents).toHaveLength(0);
      expect(otherEvents).toHaveLength(0);
    });
  });
});
