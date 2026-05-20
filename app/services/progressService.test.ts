import { describe, it, expect, beforeEach, vi } from "vitest";
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

// Import after mock so the module picks up our test db
import {
  getLessonProgress,
  getLessonProgressForCourse,
  markLessonComplete,
  markLessonInProgress,
  resetLessonProgress,
  calculateProgress,
  getCompletedLessonCount,
  getTotalLessonCount,
  isLessonCompleted,
  getNextIncompleteLesson,
} from "./progressService";
import { enrollUser, findEnrollment } from "./enrollmentService";

// Helper to create a module with lessons in the test db
function createModuleWithLessons(
  courseId: number,
  moduleTitle: string,
  position: number,
  lessonCount: number,
  durationMinutes?: number
) {
  const mod = testDb
    .insert(schema.modules)
    .values({
      courseId,
      title: moduleTitle,
      position,
    })
    .returning()
    .get();

  const createdLessons = [];
  for (let i = 0; i < lessonCount; i++) {
    const lesson = testDb
      .insert(schema.lessons)
      .values({
        moduleId: mod.id,
        title: `Lesson ${i + 1}`,
        position: i + 1,
        durationMinutes: durationMinutes ?? null,
      })
      .returning()
      .get();
    createdLessons.push(lesson);
  }

  return { module: mod, lessons: createdLessons };
}

describe("progressService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("markLessonComplete", () => {
    it("marks a lesson as completed with a new progress record", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      const progress = markLessonComplete(base.user.id, lessons[0].id);

      expect(progress).toBeDefined();
      expect(progress.userId).toBe(base.user.id);
      expect(progress.lessonId).toBe(lessons[0].id);
      expect(progress.status).toBe(schema.LessonProgressStatus.Completed);
      expect(progress.completedAt).toBeDefined();
      expect(progress.completedAt).not.toBeNull();
    });

    it("updates an existing in-progress record to completed", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      markLessonInProgress(base.user.id, lessons[0].id);
      const progress = markLessonComplete(base.user.id, lessons[0].id);

      expect(progress.status).toBe(schema.LessonProgressStatus.Completed);
      expect(progress.completedAt).not.toBeNull();
    });

    it("is idempotent — completing an already completed lesson still returns completed", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      markLessonComplete(base.user.id, lessons[0].id);
      const progress = markLessonComplete(base.user.id, lessons[0].id);

      expect(progress.status).toBe(schema.LessonProgressStatus.Completed);
    });

    it("produces exactly one lesson_complete points event per (user, lesson)", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      markLessonComplete(base.user.id, lessons[0].id);
      markLessonComplete(base.user.id, lessons[0].id);

      const lessonEvents = testDb
        .select()
        .from(schema.pointsEvents)
        .where(
          and(
            eq(schema.pointsEvents.userId, base.user.id),
            eq(schema.pointsEvents.kind, schema.PointsEventKind.LessonComplete)
          )
        )
        .all();

      expect(lessonEvents).toHaveLength(1);
      expect(lessonEvents[0].points).toBe(10);
      expect(lessonEvents[0].lessonId).toBe(lessons[0].id);
    });
  });

  describe("markLessonComplete — signals", () => {
    it("returns levelCrossed = 2 when total crosses the Level 2 threshold (49 → 64)", () => {
      // Seed user with 49 pts of backfill data: 4 lesson_complete (40) + 1 quiz_perfect (15) = 55
      // Need exactly 49 → use a fabricated points value. Tests can write events directly.
      // Easiest path: 4 lesson_complete events (40 pts) + 1 backfilled streak_day-style event of 9pts.
      // But streak_day-only-9 isn't a valid kind shape. Instead, write 4 lesson_complete + 1 quiz_pass=25 → 65; too much.
      // Use a custom row: kind=lesson_complete, points=49 (valid schema). We write directly to bypass the unique index.
      testDb
        .insert(schema.pointsEvents)
        .values({
          userId: base.user.id,
          kind: schema.PointsEventKind.LessonComplete,
          points: 49,
          lessonId: null,
          isBackfill: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        })
        .run();

      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);
      const result = markLessonComplete(base.user.id, lessons[0].id);

      // 49 backfill + 10 lesson + 5 streak_day = 64 → Level 2 (threshold 50)
      expect(result.levelCrossed).toBe(2);
    });

    it("returns levelCrossed = null when no level threshold is crossed", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);
      const result = markLessonComplete(base.user.id, lessons[0].id);
      // 0 + 10 + 5 = 15 → still Level 1
      expect(result.levelCrossed).toBeNull();
    });

    it("does not signal a level cross on a fresh award when prior backfill already placed user at that level", () => {
      // Backfill the user to ~770 pts (Level 5 = Apprentice, threshold 700).
      testDb
        .insert(schema.pointsEvents)
        .values({
          userId: base.user.id,
          kind: schema.PointsEventKind.LessonComplete,
          points: 770,
          lessonId: null,
          isBackfill: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        })
        .run();

      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);
      const result = markLessonComplete(base.user.id, lessons[0].id);
      // 770 + 10 + 5 = 785 → still Level 5
      expect(result.levelCrossed).toBeNull();
    });

    it("returns streakMilestone = 7 on a 6 → 7 day transition", () => {
      vi.useFakeTimers();

      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 7);

      const days = [
        "2026-05-08T10:00:00Z",
        "2026-05-09T10:00:00Z",
        "2026-05-10T10:00:00Z",
        "2026-05-11T10:00:00Z",
        "2026-05-12T10:00:00Z",
        "2026-05-13T10:00:00Z",
        "2026-05-14T10:00:00Z",
      ];

      let lastResult;
      for (let i = 0; i < days.length; i++) {
        vi.setSystemTime(new Date(days[i]));
        lastResult = markLessonComplete(base.user.id, lessons[i].id);
      }

      expect(lastResult!.streakMilestone).toBe(7);
      vi.useRealTimers();
    });

    it("returns streakMilestone = null on a 7 → 8 day transition", () => {
      vi.useFakeTimers();

      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 8);

      const days = [
        "2026-05-08T10:00:00Z",
        "2026-05-09T10:00:00Z",
        "2026-05-10T10:00:00Z",
        "2026-05-11T10:00:00Z",
        "2026-05-12T10:00:00Z",
        "2026-05-13T10:00:00Z",
        "2026-05-14T10:00:00Z",
        "2026-05-15T10:00:00Z",
      ];

      let lastResult;
      for (let i = 0; i < days.length; i++) {
        vi.setSystemTime(new Date(days[i]));
        lastResult = markLessonComplete(base.user.id, lessons[i].id);
      }

      expect(lastResult!.streakMilestone).toBeNull();
      vi.useRealTimers();
    });

    it("returns streakMilestone = null when no streak_day event fires (same-day repeat)", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 2);

      markLessonComplete(base.user.id, lessons[0].id);
      const second = markLessonComplete(base.user.id, lessons[1].id);

      // Streak day already exists for today; no new streak_day event, so no milestone.
      expect(second.streakMilestone).toBeNull();
    });
  });

  describe("markLessonComplete — course auto-completion", () => {
    it("marks the enrollment complete when the final lesson is completed", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);
      enrollUser(base.user.id, base.course.id, false, false);

      markLessonComplete(base.user.id, lessons[0].id);

      const enrollment = findEnrollment(base.user.id, base.course.id);
      expect(enrollment).toBeDefined();
      expect(enrollment!.completedAt).not.toBeNull();
    });

    it("does not mark the enrollment complete when other lessons remain", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 3);
      enrollUser(base.user.id, base.course.id, false, false);

      markLessonComplete(base.user.id, lessons[0].id);

      const enrollment = findEnrollment(base.user.id, base.course.id);
      expect(enrollment!.completedAt).toBeNull();
    });

    it("is idempotent — re-completing the final lesson preserves completedAt and writes no extra course_complete event", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);
      enrollUser(base.user.id, base.course.id, false, false);

      markLessonComplete(base.user.id, lessons[0].id);
      const firstStamp = findEnrollment(base.user.id, base.course.id)!.completedAt;

      markLessonComplete(base.user.id, lessons[0].id);
      const secondStamp = findEnrollment(base.user.id, base.course.id)!.completedAt;

      expect(secondStamp).toBe(firstStamp);

      const courseEvents = testDb
        .select()
        .from(schema.pointsEvents)
        .where(eq(schema.pointsEvents.kind, schema.PointsEventKind.CourseComplete))
        .all();
      expect(courseEvents).toHaveLength(1);
    });

    it("does not throw and does not fabricate an enrollment when the user is not enrolled", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      expect(() => markLessonComplete(base.user.id, lessons[0].id)).not.toThrow();

      const enrollment = findEnrollment(base.user.id, base.course.id);
      expect(enrollment).toBeUndefined();
    });

    it("triggers completion when the final lesson is in a later module", () => {
      const m1 = createModuleWithLessons(base.course.id, "Module 1", 1, 2);
      const m2 = createModuleWithLessons(base.course.id, "Module 2", 2, 2);
      enrollUser(base.user.id, base.course.id, false, false);

      markLessonComplete(base.user.id, m1.lessons[0].id);
      markLessonComplete(base.user.id, m1.lessons[1].id);
      markLessonComplete(base.user.id, m2.lessons[0].id);

      let enrollment = findEnrollment(base.user.id, base.course.id);
      expect(enrollment!.completedAt).toBeNull();

      markLessonComplete(base.user.id, m2.lessons[1].id);

      enrollment = findEnrollment(base.user.id, base.course.id);
      expect(enrollment!.completedAt).not.toBeNull();
    });
  });

  describe("markLessonInProgress", () => {
    it("marks a lesson as in-progress with a new progress record", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      const progress = markLessonInProgress(base.user.id, lessons[0].id);

      expect(progress.status).toBe(schema.LessonProgressStatus.InProgress);
      expect(progress.completedAt).toBeNull();
    });

    it("does not downgrade a completed lesson back to in-progress", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      markLessonComplete(base.user.id, lessons[0].id);
      const progress = markLessonInProgress(base.user.id, lessons[0].id);

      expect(progress.status).toBe(schema.LessonProgressStatus.Completed);
    });

    it("updates an existing not-started record to in-progress", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      // Create initial in-progress, then mark in-progress again (no-op for in_progress)
      const first = markLessonInProgress(base.user.id, lessons[0].id);
      const second = markLessonInProgress(base.user.id, lessons[0].id);

      expect(second.status).toBe(schema.LessonProgressStatus.InProgress);
      expect(second.id).toBe(first.id);
    });
  });

  describe("getLessonProgress", () => {
    it("returns the progress record for a user/lesson pair", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      markLessonComplete(base.user.id, lessons[0].id);

      const progress = getLessonProgress(base.user.id, lessons[0].id);
      expect(progress).toBeDefined();
      expect(progress!.status).toBe(schema.LessonProgressStatus.Completed);
    });

    it("returns undefined when no progress exists", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      const progress = getLessonProgress(base.user.id, lessons[0].id);
      expect(progress).toBeUndefined();
    });
  });

  describe("getLessonProgressForCourse", () => {
    it("returns all lesson progress records for a user in a course", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 3);

      markLessonComplete(base.user.id, lessons[0].id);
      markLessonInProgress(base.user.id, lessons[1].id);

      const progress = getLessonProgressForCourse(base.user.id, base.course.id);
      expect(progress).toHaveLength(2);
    });

    it("returns empty array for a course with no modules", () => {
      // Use a second course with no modules
      const emptyCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Empty Course",
          slug: "empty-course",
          description: "No modules",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      const progress = getLessonProgressForCourse(base.user.id, emptyCourse.id);
      expect(progress).toHaveLength(0);
    });

    it("returns empty array when user has no progress", () => {
      createModuleWithLessons(base.course.id, "Module 1", 1, 3);

      const progress = getLessonProgressForCourse(base.user.id, base.course.id);
      expect(progress).toHaveLength(0);
    });
  });

  describe("resetLessonProgress", () => {
    it("deletes the progress record for a user/lesson pair", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      markLessonComplete(base.user.id, lessons[0].id);
      const deleted = resetLessonProgress(base.user.id, lessons[0].id);

      expect(deleted).toBeDefined();
      expect(getLessonProgress(base.user.id, lessons[0].id)).toBeUndefined();
    });

    it("returns undefined when no progress exists to reset", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      const deleted = resetLessonProgress(base.user.id, lessons[0].id);
      expect(deleted).toBeUndefined();
    });
  });

  describe("isLessonCompleted", () => {
    it("returns true when lesson is completed", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      markLessonComplete(base.user.id, lessons[0].id);

      expect(isLessonCompleted(base.user.id, lessons[0].id)).toBe(true);
    });

    it("returns false when lesson is in-progress", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      markLessonInProgress(base.user.id, lessons[0].id);

      expect(isLessonCompleted(base.user.id, lessons[0].id)).toBe(false);
    });

    it("returns false when no progress exists", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 1);

      expect(isLessonCompleted(base.user.id, lessons[0].id)).toBe(false);
    });
  });

  describe("calculateProgress", () => {
    it("returns 0 for a course with no lessons", () => {
      const emptyCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Empty Course",
          slug: "empty-course",
          description: "No content",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      const progress = calculateProgress(base.user.id, emptyCourse.id, false, false);
      expect(progress).toBe(0);
    });

    it("returns 0 when no lessons are completed", () => {
      createModuleWithLessons(base.course.id, "Module 1", 1, 4);

      const progress = calculateProgress(base.user.id, base.course.id, false, false);
      expect(progress).toBe(0);
    });

    it("returns 100 when all lessons are completed", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 3);

      for (const lesson of lessons) {
        markLessonComplete(base.user.id, lesson.id);
      }

      const progress = calculateProgress(base.user.id, base.course.id, false, false);
      expect(progress).toBe(100);
    });

    it("calculates correct percentage for partial completion", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 4);

      markLessonComplete(base.user.id, lessons[0].id);
      markLessonComplete(base.user.id, lessons[1].id);

      const progress = calculateProgress(base.user.id, base.course.id, false, false);
      expect(progress).toBe(50); // 2/4 = 50%
    });

    it("only counts completed lessons, not in-progress ones", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 4);

      markLessonComplete(base.user.id, lessons[0].id);
      markLessonInProgress(base.user.id, lessons[1].id);

      const progress = calculateProgress(base.user.id, base.course.id, false, false);
      expect(progress).toBe(25); // 1/4 = 25%
    });

    it("calculates progress across multiple modules", () => {
      const m1 = createModuleWithLessons(base.course.id, "Module 1", 1, 2);
      const m2 = createModuleWithLessons(base.course.id, "Module 2", 2, 2);

      markLessonComplete(base.user.id, m1.lessons[0].id);
      markLessonComplete(base.user.id, m2.lessons[0].id);

      const progress = calculateProgress(base.user.id, base.course.id, false, false);
      expect(progress).toBe(50); // 2/4 = 50%
    });

    it("rounds progress to nearest integer", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 3);

      markLessonComplete(base.user.id, lessons[0].id);

      const progress = calculateProgress(base.user.id, base.course.id, false, false);
      expect(progress).toBe(33); // 1/3 = 33.33... → 33
    });
  });

  describe("calculateProgress — weight by duration", () => {
    it("weights progress by lesson duration", () => {
      const mod = testDb
        .insert(schema.modules)
        .values({ courseId: base.course.id, title: "Module 1", position: 1 })
        .returning()
        .get();

      const lesson1 = testDb
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: "Short Lesson", position: 1, durationMinutes: 10 })
        .returning()
        .get();

      const lesson2 = testDb
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: "Long Lesson", position: 2, durationMinutes: 30 })
        .returning()
        .get();

      // Complete only the short lesson (10 out of 40 total minutes)
      markLessonComplete(base.user.id, lesson1.id);

      const progress = calculateProgress(base.user.id, base.course.id, false, true);
      expect(progress).toBe(25); // 10/40 = 25%
    });

    it("uses duration 1 as fallback for lessons with null duration", () => {
      const mod = testDb
        .insert(schema.modules)
        .values({ courseId: base.course.id, title: "Module 1", position: 1 })
        .returning()
        .get();

      const lesson1 = testDb
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: "Timed Lesson", position: 1, durationMinutes: 9 })
        .returning()
        .get();

      testDb
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: "No Duration", position: 2 })
        .returning()
        .get();

      // Complete only the timed lesson (9 out of 10 total minutes)
      markLessonComplete(base.user.id, lesson1.id);

      const progress = calculateProgress(base.user.id, base.course.id, false, true);
      expect(progress).toBe(90); // 9/10 = 90%
    });

    it("returns 0 for empty course with weight by duration", () => {
      const emptyCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Empty",
          slug: "empty",
          description: "Empty",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      const progress = calculateProgress(base.user.id, emptyCourse.id, false, true);
      expect(progress).toBe(0);
    });
  });

  describe("getCompletedLessonCount", () => {
    it("returns count of completed lessons in a course", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 3);

      markLessonComplete(base.user.id, lessons[0].id);
      markLessonComplete(base.user.id, lessons[1].id);

      expect(getCompletedLessonCount(base.user.id, base.course.id)).toBe(2);
    });

    it("does not count in-progress lessons", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 3);

      markLessonComplete(base.user.id, lessons[0].id);
      markLessonInProgress(base.user.id, lessons[1].id);

      expect(getCompletedLessonCount(base.user.id, base.course.id)).toBe(1);
    });

    it("returns 0 when no lessons are completed", () => {
      createModuleWithLessons(base.course.id, "Module 1", 1, 3);

      expect(getCompletedLessonCount(base.user.id, base.course.id)).toBe(0);
    });

    it("returns 0 for a course with no lessons", () => {
      expect(getCompletedLessonCount(base.user.id, base.course.id)).toBe(0);
    });
  });

  describe("getTotalLessonCount", () => {
    it("returns total number of lessons in a course", () => {
      createModuleWithLessons(base.course.id, "Module 1", 1, 3);
      createModuleWithLessons(base.course.id, "Module 2", 2, 2);

      expect(getTotalLessonCount(base.course.id)).toBe(5);
    });

    it("returns 0 for a course with no lessons", () => {
      expect(getTotalLessonCount(base.course.id)).toBe(0);
    });
  });

  describe("getNextIncompleteLesson", () => {
    it("returns the first lesson when no progress exists", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 3);

      const next = getNextIncompleteLesson(base.user.id, base.course.id);
      expect(next).toBeDefined();
      expect(next!.id).toBe(lessons[0].id);
    });

    it("returns the first incomplete lesson after completed ones", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 3);

      markLessonComplete(base.user.id, lessons[0].id);

      const next = getNextIncompleteLesson(base.user.id, base.course.id);
      expect(next).toBeDefined();
      expect(next!.id).toBe(lessons[1].id);
    });

    it("crosses module boundaries to find the next incomplete lesson", () => {
      const m1 = createModuleWithLessons(base.course.id, "Module 1", 1, 2);
      const m2 = createModuleWithLessons(base.course.id, "Module 2", 2, 2);

      // Complete all lessons in module 1
      markLessonComplete(base.user.id, m1.lessons[0].id);
      markLessonComplete(base.user.id, m1.lessons[1].id);

      const next = getNextIncompleteLesson(base.user.id, base.course.id);
      expect(next).toBeDefined();
      expect(next!.id).toBe(m2.lessons[0].id);
    });

    it("returns null when all lessons are completed", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 2);

      for (const lesson of lessons) {
        markLessonComplete(base.user.id, lesson.id);
      }

      const next = getNextIncompleteLesson(base.user.id, base.course.id);
      expect(next).toBeNull();
    });

    it("returns null for a course with no modules", () => {
      const next = getNextIncompleteLesson(base.user.id, base.course.id);
      expect(next).toBeNull();
    });

    it("treats in-progress lessons as incomplete", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "Module 1", 1, 3);

      markLessonInProgress(base.user.id, lessons[0].id);

      const next = getNextIncompleteLesson(base.user.id, base.course.id);
      expect(next).toBeDefined();
      expect(next!.id).toBe(lessons[0].id);
    });
  });
});
