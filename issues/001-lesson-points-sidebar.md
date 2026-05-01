## Parent PRD

`issues/prd.md`

## What to build

The foundational tracer-bullet slice. After this issue ships, completing a lesson grants the student 10 points, and those points (plus the student's current level name) appear in the sidebar on every authenticated page. No streaks, no quiz/course events, no toasts, no backfill yet — those land in later slices.

End-to-end behaviour:

- A new student loads any authenticated page → sidebar shows `0 pts · Newcomer`.
- The student completes a lesson → on the next render, sidebar shows `10 pts · Newcomer`.
- The student completes 5 lessons → sidebar shows `50 pts · Learner` (because 50 pts is the Level 2 threshold).
- The student re-marks a previously completed lesson as complete → no additional points (database-level idempotency).

This slice introduces the core data shape, the deep `levelResolver` module, the coordinator `pointsService` (lesson-only for now), the schema migration, and the sidebar UI block. It deliberately defers the streak event, quiz/course events, toast feedback, dashboard panel, and backfill to later slices.

See parent PRD sections "Schema Changes", "Module Architecture", "Display Surfaces", and "Levels" for design rationale and locked decisions.

## Acceptance criteria

- [ ] `points_events` table exists with the schema specified in the PRD (id, user id with cascade-on-delete, kind enum, points, nullable lesson/quiz/course foreign keys with set-null-on-delete, nullable streak_date, is_backfill boolean default false, created_at).
- [ ] Unique index on `points_events` covering `(user_id, kind, lesson_id, quiz_id, course_id, streak_date)` using `COALESCE` for nullable columns.
- [ ] `users.timezone` column added with `NOT NULL DEFAULT 'UTC'`.
- [ ] `levelResolver` module exists as a pure function with no DB access, exposing the ten-level constant and a function from points total to `{ index, name, threshold, nextThreshold, pointsIntoLevel, pointsToNextLevel }`.
- [ ] `pointsService.awardPointsForLessonComplete(userId, lessonId)` writes a `lesson_complete` event worth 10 points; second invocation for the same `(user, lesson)` is a silent no-op (DB-level idempotency, not application-layer check).
- [ ] `pointsService.getUserPoints(userId)` returns `{ totalPoints, level }` (no streak fields yet — those land in slice 3).
- [ ] `progressService.markLessonComplete` calls into `pointsService.awardPointsForLessonComplete` after recording the lesson progress.
- [ ] The existing sidebar shows the student's total points and current level name on every authenticated page.
- [ ] Unit tests cover `levelResolver` boundary cases: 0 pts → Level 1, exact threshold values, points one below a threshold, above max threshold, top-level `nextThreshold` is null.
- [ ] Integration tests cover `pointsService` lesson-complete idempotency (double call writes one row), user-deletion cascade (events removed), lesson-deletion sets foreign key to null but preserves total.
- [ ] Existing `progressService` tests continue to pass; a new test verifies `markLessonComplete` produces exactly one `lesson_complete` event.
- [ ] Instructor and admin views show no gamification data anywhere (verify by inspection, no test required).

## Blocked by

None — can start immediately.

## User stories addressed

- User story 1
- User story 6
- User story 7
- User story 9
- User story 10
- User story 11
- User story 22
- User story 28
- User story 29
- User story 33
- User story 34
- User story 36
- User story 37
- User story 39
- User story 40
