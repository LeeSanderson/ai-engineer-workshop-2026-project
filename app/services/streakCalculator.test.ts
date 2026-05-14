import { describe, it, expect } from "vitest";
import { computeStreak, type StreakEvent } from "./streakCalculator";
import { PointsEventKind } from "~/db/schema";

function lessonEvent(timestamp: string, isBackfill = false): StreakEvent {
  return {
    timestamp,
    kind: PointsEventKind.LessonComplete,
    isBackfill,
  };
}

function quizEvent(timestamp: string, isBackfill = false): StreakEvent {
  return {
    timestamp,
    kind: PointsEventKind.QuizPass,
    isBackfill,
  };
}

describe("streakCalculator", () => {
  describe("empty input", () => {
    it("returns zeros and null lastActiveDate for an empty event list", () => {
      const result = computeStreak([], "UTC", new Date("2026-05-14T12:00:00Z"));
      expect(result).toEqual({
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: null,
      });
    });
  });

  describe("single day", () => {
    it("returns currentStreak=1 and longestStreak=1 for one event today", () => {
      const result = computeStreak(
        [lessonEvent("2026-05-14T10:00:00Z")],
        "UTC",
        new Date("2026-05-14T12:00:00Z")
      );
      expect(result.currentStreak).toBe(1);
      expect(result.longestStreak).toBe(1);
      expect(result.lastActiveDate).toBe("2026-05-14");
    });

    it("collapses multiple same-day events into one streak day", () => {
      const events = [
        lessonEvent("2026-05-14T08:00:00Z"),
        lessonEvent("2026-05-14T15:00:00Z"),
        quizEvent("2026-05-14T20:00:00Z"),
      ];
      const result = computeStreak(events, "UTC", new Date("2026-05-14T23:00:00Z"));
      expect(result.currentStreak).toBe(1);
      expect(result.longestStreak).toBe(1);
    });
  });

  describe("consecutive days", () => {
    it("extends the streak across consecutive days ending today", () => {
      const events = [
        lessonEvent("2026-05-12T10:00:00Z"),
        lessonEvent("2026-05-13T10:00:00Z"),
        lessonEvent("2026-05-14T10:00:00Z"),
      ];
      const result = computeStreak(events, "UTC", new Date("2026-05-14T12:00:00Z"));
      expect(result.currentStreak).toBe(3);
      expect(result.longestStreak).toBe(3);
      expect(result.lastActiveDate).toBe("2026-05-14");
    });

    it("keeps the streak alive if the user was active yesterday but not yet today", () => {
      const events = [
        lessonEvent("2026-05-12T10:00:00Z"),
        lessonEvent("2026-05-13T10:00:00Z"),
      ];
      const result = computeStreak(events, "UTC", new Date("2026-05-14T12:00:00Z"));
      expect(result.currentStreak).toBe(2);
      expect(result.lastActiveDate).toBe("2026-05-13");
    });
  });

  describe("missed day reset", () => {
    it("resets currentStreak to 0 when the last activity was more than one day ago", () => {
      const events = [
        lessonEvent("2026-05-10T10:00:00Z"),
        lessonEvent("2026-05-11T10:00:00Z"),
      ];
      const result = computeStreak(events, "UTC", new Date("2026-05-14T12:00:00Z"));
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(2);
      expect(result.lastActiveDate).toBe("2026-05-11");
    });

    it("starts a new streak after a gap day", () => {
      const events = [
        lessonEvent("2026-05-10T10:00:00Z"),
        lessonEvent("2026-05-11T10:00:00Z"),
        // gap on 2026-05-12
        lessonEvent("2026-05-13T10:00:00Z"),
        lessonEvent("2026-05-14T10:00:00Z"),
      ];
      const result = computeStreak(events, "UTC", new Date("2026-05-14T12:00:00Z"));
      expect(result.currentStreak).toBe(2);
      expect(result.longestStreak).toBe(2);
    });
  });

  describe("timezone handling", () => {
    it("counts a late-evening lesson in America/Los_Angeles toward that local day", () => {
      // 11:55pm Pacific on 2026-05-14 = 06:55 UTC on 2026-05-15
      const events = [lessonEvent("2026-05-15T06:55:00Z")];
      const result = computeStreak(
        events,
        "America/Los_Angeles",
        new Date("2026-05-15T06:56:00Z")
      );
      expect(result.lastActiveDate).toBe("2026-05-14");
      expect(result.currentStreak).toBe(1);
    });

    it("places a midnight-boundary event on the correct local day", () => {
      // 00:05 Pacific on 2026-05-15 = 07:05 UTC on 2026-05-15 (NOT 2026-05-14)
      const events = [lessonEvent("2026-05-15T07:05:00Z")];
      const result = computeStreak(
        events,
        "America/Los_Angeles",
        new Date("2026-05-15T08:00:00Z")
      );
      expect(result.lastActiveDate).toBe("2026-05-15");
      expect(result.currentStreak).toBe(1);
    });
  });

  describe("leap day", () => {
    it("handles consecutive days across a leap day", () => {
      const events = [
        lessonEvent("2024-02-28T10:00:00Z"),
        lessonEvent("2024-02-29T10:00:00Z"),
        lessonEvent("2024-03-01T10:00:00Z"),
      ];
      const result = computeStreak(events, "UTC", new Date("2024-03-01T12:00:00Z"));
      expect(result.currentStreak).toBe(3);
      expect(result.longestStreak).toBe(3);
    });
  });

  describe("backfill exclusion", () => {
    it("excludes isBackfill events from the streak computation", () => {
      const events = [
        lessonEvent("2026-05-12T10:00:00Z", true),
        lessonEvent("2026-05-13T10:00:00Z", true),
        lessonEvent("2026-05-14T10:00:00Z", true),
      ];
      const result = computeStreak(events, "UTC", new Date("2026-05-14T12:00:00Z"));
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(0);
      expect(result.lastActiveDate).toBeNull();
    });

    it("counts only non-backfill events when mixed with backfill ones", () => {
      const events = [
        lessonEvent("2026-05-10T10:00:00Z", true),
        lessonEvent("2026-05-11T10:00:00Z", true),
        lessonEvent("2026-05-13T10:00:00Z", false),
        lessonEvent("2026-05-14T10:00:00Z", false),
      ];
      const result = computeStreak(events, "UTC", new Date("2026-05-14T12:00:00Z"));
      expect(result.currentStreak).toBe(2);
      expect(result.longestStreak).toBe(2);
    });
  });

  describe("longest streak captured even when current is zero", () => {
    it("retains the historical longest streak after a long gap", () => {
      const events = [
        // 5-day run in early May
        lessonEvent("2026-05-01T10:00:00Z"),
        lessonEvent("2026-05-02T10:00:00Z"),
        lessonEvent("2026-05-03T10:00:00Z"),
        lessonEvent("2026-05-04T10:00:00Z"),
        lessonEvent("2026-05-05T10:00:00Z"),
      ];
      // "Now" is well after the run with no recent activity
      const result = computeStreak(events, "UTC", new Date("2026-05-14T12:00:00Z"));
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(5);
      expect(result.lastActiveDate).toBe("2026-05-05");
    });
  });

  describe("kind filtering", () => {
    it("counts quiz_pass events as qualifying activity", () => {
      const events = [quizEvent("2026-05-14T10:00:00Z")];
      const result = computeStreak(events, "UTC", new Date("2026-05-14T12:00:00Z"));
      expect(result.currentStreak).toBe(1);
    });

    it("ignores non-qualifying events like course_complete or quiz_perfect", () => {
      const events: StreakEvent[] = [
        {
          timestamp: "2026-05-14T10:00:00Z",
          kind: PointsEventKind.QuizPerfect,
          isBackfill: false,
        },
        {
          timestamp: "2026-05-14T10:00:00Z",
          kind: PointsEventKind.CourseComplete,
          isBackfill: false,
        },
      ];
      const result = computeStreak(events, "UTC", new Date("2026-05-14T12:00:00Z"));
      expect(result.currentStreak).toBe(0);
      expect(result.lastActiveDate).toBeNull();
    });
  });
});
