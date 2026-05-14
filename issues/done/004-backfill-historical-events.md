## Parent PRD

`issues/prd.md`

## What to build

A one-shot, idempotent migration script that walks every existing user's history in `lessonProgress`, `quizAttempts`, and `enrollments` and inserts the corresponding points events with `isBackfill: true` and original timestamps. After this slice ships, existing power users log in to a populated points total and a level that reflects their prior work — not a zero balance.

Streaks are deliberately NOT backfilled. Every user starts at `currentStreak = 0` regardless of historical activity. The `streakCalculator` already excludes backfill events (from slice 003), so this falls out for free.

End-to-end behaviour:

- The migration runs as part of the standard `npm run db:migrate` flow.
- For each user, every `lessonProgress` row with `status = 'completed'` produces one `lesson_complete` event with `isBackfill = true` and `created_at` equal to the original `completedAt`.
- For each user, the first passing `quizAttempts` row per `(user, quiz)` produces one `quiz_pass` event, and the first 100% attempt per `(user, quiz)` produces one `quiz_perfect` event, with original timestamps.
- For each user, every `enrollments` row with non-null `completedAt` produces one `course_complete` event with original timestamp.
- No `streak_day` events are written.
- Re-running the migration produces no duplicate events (the unique index from slice 001 enforces this).

See parent PRD sections "Backfill" and "Schema Changes" for design rationale.

## Acceptance criteria

- [ ] `pointsService.backfillUserPoints(userId)` exists and is idempotent (re-runnable safely). Internally uses `INSERT OR IGNORE` against the unique index from slice 001.
- [ ] A migration (or one-off script invoked by the migrate flow) iterates all users and calls `backfillUserPoints` for each.
- [ ] Backfilled events have `isBackfill = true` and `created_at` set to the original event's timestamp (`lessonProgress.completedAt`, `quizAttempts.attemptedAt`, `enrollments.completedAt`).
- [ ] No `streak_day` events are produced by backfill, even for users with consecutive historical activity.
- [ ] After backfill, calling `pointsService.getUserPoints(userId)` for an existing user returns a total reflecting their full history, the level corresponding to that total, and `currentStreak = 0` regardless of past activity.
- [ ] Running the migration twice produces the same final state as running it once (verified by integration test: count of `points_events` rows is unchanged after second run).
- [ ] Integration test: a fixture user with historical lesson, quiz pass, perfect, and course completion data gets the expected events with the expected `isBackfill` flag and timestamps.
- [ ] Integration test: streak length for a backfilled-only user is 0 (no `streak_day` events were written, and any future `streakCalculator` call ignores backfill events).

## Blocked by

- Blocked by `issues/001-lesson-points-sidebar.md`
- Blocked by `issues/002-quiz-and-course-points.md`

## User stories addressed

- User story 19
- User story 21
- User story 38
