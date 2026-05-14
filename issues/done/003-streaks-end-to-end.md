## Parent PRD

`issues/prd.md`

## What to build

Add the streak mechanic end-to-end: the deep `streakCalculator` module, streak-day points events written in the same transaction as qualifying lesson/quiz events, sidebar streak display, browser-timezone auto-capture, and a settings UI for manual timezone override.

End-to-end behaviour:

- A student completes a lesson on day N → `lesson_complete` event AND a `streak_day` event for day N (in their local timezone) are written in the same transaction. Sidebar shows `1-day streak 🔥`.
- The student completes another lesson the same day → no second `streak_day` event (DB-level idempotent on `(user, calendar_date)`).
- The student completes a lesson the next day → streak becomes `2-day streak 🔥`.
- The student misses a day, then returns → streak resets to `1-day streak 🔥` (strict daily reset, no grace).
- A student in `America/Los_Angeles` completes a lesson at 11:55pm Pacific → counted as today's streak day, not tomorrow's.
- On first authenticated request after the migration, the browser's timezone (via `Intl.DateTimeFormat().resolvedOptions().timeZone`) is silently captured and stored on `users.timezone`.
- The settings page exposes the current timezone with an editable dropdown of IANA zones.

See parent PRD sections "Streaks" and "Points and Earning Rules" for the locked design.

## Acceptance criteria

- [ ] `streakCalculator` exists as a pure function module with no DB access. Input: list of `{ timestamp, kind, isBackfill, streakDate? }` events plus an IANA timezone string. Output: `{ currentStreak, longestStreak, lastActiveDate }`.
- [ ] `pointsService.awardPointsForLessonComplete` is extended: in addition to the lesson event from slice 001, it writes a `streak_day` event (5 pts) for the user's current calendar date in their timezone, in the same transaction. The streak event is DB-level idempotent on `(user_id, kind='streak_day', streak_date)`.
- [ ] `pointsService.awardPointsForQuizAttempt` is extended in the same way: a passing attempt (only) also writes a `streak_day` event for the user's current local date.
- [ ] `pointsService.getUserPoints` now also returns `{ currentStreak, longestStreak, lastActiveDate }`, computed by calling `streakCalculator` with the user's events and stored timezone.
- [ ] `streakCalculator` excludes `isBackfill: true` events from the streak computation (set up for slice 004's backfill).
- [ ] On the first authenticated request where `users.timezone` is still `'UTC'` and the browser sends a different detected zone, the column is updated. Subsequent requests do not overwrite it.
- [ ] The settings page exposes a timezone field with current value populated. Saving updates `users.timezone`.
- [ ] Sidebar gains a streak block: shows `N-day streak` with a flame icon if the user was active today (i.e., `lastActiveDate === today in their zone`), otherwise no flame.
- [ ] Unit tests for `streakCalculator` cover: empty list, single day, consecutive days, missed-day reset, late-evening activity in a non-UTC zone counted to the right day, midnight boundary, leap day, backfill events excluded, longest streak captured even when current is zero.
- [ ] Integration test: lesson-complete writes both `lesson_complete` and `streak_day` events in the same transaction (or neither, on simulated failure).
- [ ] Integration test: same-day double lesson-complete writes one `streak_day` event, not two.

## Blocked by

- Blocked by `issues/001-lesson-points-sidebar.md`
- Blocked by `issues/002-quiz-and-course-points.md`

## User stories addressed

- User story 5
- User story 14
- User story 15
- User story 16
- User story 31
- User story 32
