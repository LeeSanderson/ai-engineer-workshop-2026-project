# PRD: Cadence Gamification (Points · Levels · Streaks)

## Problem Statement

Cadence's retention numbers are poor. Students sign up, complete a few lessons, then drop off. Beyond a per-lesson "complete" checkbox, the platform gives no visible sense of accumulated progress, no milestones to aim for, and no incentive to engage with quizzes. One student described finishing 40 lessons as having "nothing to show for it." Sarah Chen (VP Product) wants to ship a private, non-competitive gamification layer this quarter to give students an ambient sense of progress, milestones to aspire to, and a daily-engagement loop modelled on Duolingo-style streaks — without any of the leaderboard or social pressure that would feel inappropriate for a professional audience.

## Solution

Introduce a four-part gamification system that is private to each student:

1. **Points** — students earn points for completing lessons, passing quizzes, getting perfect quiz scores, completing courses, and being active on a given day. Points only ever go up.
2. **Levels** — ten named levels ("Newcomer" through "Grandmaster") on a gently exponential points curve, providing aspirational milestones without gating any content.
3. **Streaks** — a strict daily streak (any missed day resets to zero) computed in the user's local timezone. An active day requires completing a lesson or passing a quiz.
4. **Quiz integration** — quizzes are folded into the points system so students have a clear incentive to take them, with a separate bonus for perfect scores that rewards mastery.

Existing students are backfilled from their historical lesson, quiz, and course-completion records so they log in to a meaningful balance and level. Streaks start at zero on launch day for everyone.

The system surfaces in three places: a persistent sidebar widget showing points/level/streak; a larger dashboard panel showing progression to next level; and inline toasts on point-earning events, with a distinct celebration for level-ups. There are no emails, no push notifications, no streak-at-risk warnings, no leaderboards, and no visibility for instructors or admins into individual students' gamification state.

## User Stories

1. As a student, I want to earn points when I complete a lesson, so that my progress feels visible and rewarded.
2. As a student, I want to earn points when I pass a quiz, so that I have a reason to engage with quizzes instead of skipping them.
3. As a student, I want to earn a bonus when I get a perfect score on a quiz, so that mastery is rewarded beyond just clearing the pass threshold.
4. As a student, I want to earn a large points bonus when I complete a whole course, so that finishing feels like a meaningful achievement.
5. As a student, I want to earn small daily-activity points whenever I do a lesson or pass a quiz, so that consistency is recognised even on slow days.
6. As a student, I want my points total to only ever go up, so that I never feel punished for trying things or for content changes outside my control.
7. As a student, I want re-completing a lesson to grant no additional points, so that the system isn't gameable by replaying easy content.
8. As a student, I want re-passing a quiz I already passed to grant no additional points, so that points reflect genuine new progress.
9. As a student, I want to belong to one of ten named levels based on my total points, so that I have aspirational milestones to work toward.
10. As a student, I want my level to have a thematic name (e.g. "Practitioner", "Specialist", "Expert"), so that progression feels meaningful rather than just a number.
11. As a student, I want my level to be visible at all times in the sidebar, so that I always see where I stand.
12. As a student, I want to see a progress bar showing how far I am to the next level, so that I know how much effort the next milestone requires.
13. As a student, I want a distinct celebration when I reach a new level, so that the milestone feels like an event rather than a silent counter increment.
14. As a student, I want to maintain a daily streak by completing at least one lesson or passing one quiz each day, so that I'm motivated to come back daily.
15. As a student, I want my streak counted in my own local timezone, so that an evening lesson in my time zone counts for the right day.
16. As a student, I want my streak to reset to zero if I miss any day, so that the streak number genuinely represents continuous engagement.
17. As a student, I want a small celebration toast when I hit streak milestones (7, 30, 100, 365 days), so that long-term consistency is recognised.
18. As a student, I want a calm, non-guilt-tripping notification when my streak resets after a meaningful run (≥7 days), so that I'm informed without feeling manipulated.
19. As a student returning to the platform after time away, I want my historical lesson completions, quiz passes, and course completions to be reflected in my points and level, so that my prior work is acknowledged.
20. As a returning student, I want my level on first login to reflect my history without spamming me with one toast per backfilled level transition, so that the welcome is calm rather than overwhelming.
21. As a returning student, I want my streak to start at zero (not retroactively claim I've had a long streak), so that streaks remain a measure of forward-looking behaviour.
22. As a student, I want my gamification state to be private — no other student, instructor, or admin sees it — so that I can engage at my own pace without external pressure.
23. As a student, I do not want a competitive leaderboard, so that the platform stays focused on my own learning rather than comparison.
24. As a student, I do not want streak-at-risk emails or push notifications, so that the platform doesn't feel manipulative.
25. As a student, I want to see a dashboard panel summarising my level, points-to-next-level, current streak, and longest streak, so that I have one place to see all my progress at a glance.
26. As a student, I want a toast immediately on completing a lesson showing the points earned (lesson + streak-day if applicable), so that the action feels rewarding in the moment.
27. As a student, I want a toast immediately on passing a quiz showing the pass points (and bonus if perfect), so that quiz effort is acknowledged in real time.
28. As a student, I want my points total to be unaffected if an instructor edits or deletes a quiz I previously passed, so that my history remains stable.
29. As a student, I want my points total to be unaffected if a course or lesson is deleted, so that my record reflects what I actually did.
30. As a student, I want unenrollment or refund of a course to leave my points intact, so that I'm not punished for changing my mind about a course.
31. As a student, I want my timezone to default sensibly on my first authenticated session, so that streaks work correctly without me having to configure anything.
32. As a student, I want to be able to override my detected timezone in settings, so that I can correct it if the auto-detection picks the wrong zone.
33. As an instructor, I do not see any gamification data (points, level, streak) for my students, so that engagement signals stay separate from the gamification layer that students opted into.
34. As an admin, I do not have a UI for adjusting student points, so that the system's integrity (every point is earned through real activity) is preserved.
35. As an admin investigating a support query, I can answer "why do I have N points?" by querying the points event log directly in the database, so that audit questions are answerable without needing a built admin tool.
36. As a developer, I want all point-grant events to be idempotent at the database level, so that double-clicks, retries, or replayed transactions cannot grant duplicate points.
37. As a developer, I want streak length to be derived from events rather than stored in a counter, so that there is no synchronisation bug surface area between events and totals.
38. As a developer, I want backfill to be re-runnable safely, so that recovering from a partial migration is just rerunning the same script.
39. As a developer, I want the streak calculator and level resolver to be pure functions with no DB dependency, so that they can be unit-tested exhaustively without integration setup.
40. As a developer, I want the level threshold table to live as a constant in app code, so that product can adjust the curve without writing a database migration.
41. As Sarah (VP Product), I want to ship all four mechanics in a single coordinated release this quarter, so that students experience a complete progression system rather than disjointed pieces.
42. As Sarah, I want to be able to revisit decisions like email notifications and instructor visibility in v2 based on observed metrics, so that the v1 launch isn't pre-loaded with controversial choices.

## Implementation Decisions

### Points and Earning Rules

- Points are awarded at fixed rates: lesson complete = 10, quiz pass = 25, perfect quiz score = +15 (separate event, stacks with the pass), course complete = 100, streak day = 5.
- "Streak day" means the user had at least one qualifying activity (lesson complete OR quiz pass) on a given calendar day in their local timezone. The streak-day points event is granted in the same transaction as the qualifying activity, not on a cron.
- Failed quiz attempts grant no points. Video watch events grant no points. Enrollment grants no points.
- A single currency ("points"). No secondary currency.

### Idempotency

- Every points-granting event is once-per-(user, source) — ever. Re-completing a lesson, re-passing a quiz, or re-attempting a perfect score after the first one grants no additional points.
- Idempotency is enforced at the database level via a unique index on the points events table, not by application logic. Re-runs (including the backfill) safely no-op on conflict.

### Backfill

- On migration, all eligible historical events from `lessonProgress`, `quizAttempts`, and `enrollments` are backfilled into the points events table using the original timestamp.
- Streaks are NOT backfilled — every user starts at streak = 0 on launch day, and streak-day points only begin counting from launch.
- Backfill events are flagged with an `isBackfill` boolean so the level-up toast notifier can ignore them — preventing a 14-toast welcome storm for power users on first login.
- The unique index makes backfill idempotent and re-runnable.

### Levels

- Ten levels with a gently exponential thresholds (in points): 0, 50, 150, 350, 700, 1200, 2000, 3200, 5000, 8000.
- Level names are competence-coded thematic labels ("Newcomer", "Learner", "Student", "Practitioner", "Apprentice", "Specialist", "Adept", "Expert", "Master", "Grandmaster"). Final names are bikeshed-friendly; the structure is what matters.
- Level thresholds and names live as a constant array in app code, not as database rows, so product can adjust without a migration.
- Levels are display-only. They never gate access to content.

### Streaks

- A streak is a chain of consecutive calendar days with at least one qualifying activity (lesson complete OR quiz pass) in the user's local timezone.
- Strict reset: any missed day resets the current streak to zero. No grace period, no streak freezes, no rolling-window forgiveness in v1.
- Both `currentStreak` and `longestStreak` are derived on read from the events table — there is no stored counter to keep in sync.
- Per-user timezone is stored on the `users` table as an IANA zone string, NOT NULL with a default of `'UTC'`. On first authenticated request after the migration, the browser's detected timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) is silently captured and stored, upgrading the default. Users can override the stored value in settings.
- A user changing timezone does not retroactively rewrite past streak history — events are interpreted using the user's *current* stored timezone.

### Visibility and Privacy

- Gamification data is private to the student. Instructors do NOT see points, level, or streak in the existing instructor students view. Admins do NOT have a UI for it.
- No leaderboards anywhere.
- No instructor- or admin-facing aggregate analytics in v1. Sarah-level product analytics ("average level across cohort", "% with active streak") is a separate workstream, not part of this PRD.
- Admin support for "why do I have N points?" support queries is satisfied by direct SQL access to the points events table; no admin UI is built.

### Notifications

- All v1 feedback is in-app. No emails, no push, no SMS.
- Toasts fire on: each points-granting event (lesson, quiz, perfect, course), with a *distinct, larger* visual treatment for level-up transitions, and a celebratory toast at streak milestones (7, 30, 100, 365 days).
- A streak-broken banner appears on the dashboard the next time a user visits, but only if their previous streak was ≥ 7 days. Tone is matter-of-fact, not guilt-tripping. Streaks that reset below 7 days reset silently.
- Explicitly NOT in v1: streak-at-risk warnings of any kind (in-app banner, email, or push). This is the canonical Duolingo dark pattern and is off-brand for Cadence's professional audience.

### Display Surfaces

- Sidebar: persistent display of total points, current level name, and current streak (with a flame icon if the streak is active today). Mounts into the existing `sidebar.tsx`.
- Dashboard: a larger gamification panel above the existing course grid, showing level name, progress bar to next level, current streak, longest streak, and recent point-earning events.
- Toasts: fire inline on the lesson-complete and quiz-attempt mutations. Two visual tiers: a small standard tier for points-earning events, and a larger distinct tier for level-ups.
- Explicitly out of v1: lesson page footer point hints, profile/lifetime-stats page, points/level mentions on course catalog or instructor pages.

### Edge Cases for Content and Account Lifecycle

- Lesson, quiz, and course deletions do NOT recompute or revoke any user's points. The points events table preserves the historical row; foreign keys to `lessons`, `quizzes`, and `courses` use `ON DELETE SET NULL`.
- User deletion cascades: when a user is deleted, their points events go with them. `points_events.user_id` uses `ON DELETE CASCADE`.
- Quiz edits (rewording questions, changing options) do not retroactively grant or revoke points. The user passed *the quiz that existed at the time*.
- Course unenrollment or refund does not revoke points.
- No admin UI to manually grant or revoke points in v1.

### Schema Changes

- New table: `points_events`. Columns include id, user id (cascade on delete), event kind (enum: lesson_complete, quiz_pass, quiz_perfect, course_complete, streak_day), points awarded, nullable foreign keys to lesson/quiz/course (set null on delete), nullable streak_date for streak-day events (YYYY-MM-DD in user-local zone), is_backfill boolean default false, created_at timestamp.
- Unique index on `points_events` covering (user_id, kind, lesson_id, quiz_id, course_id, streak_date) using `COALESCE` for nullable columns to enforce idempotency.
- New column on `users`: `timezone TEXT NOT NULL DEFAULT 'UTC'` (IANA zone string).
- No `user_points_total` column — totals derived via `SUM(points)`. Add only if it shows up as slow under load.
- No `user_streaks` table — streak length derived from the events table.
- No `levels` table — thresholds and names are a constant array in app code.

### Module Architecture

The implementation introduces five modules with a deliberate split between deep (pure, no-DB) and coordinator (DB-aware) layers:

- **`streakCalculator`** (deep): Pure function. Takes a list of timestamped events and an IANA timezone string. Returns `{ currentStreak, longestStreak, lastActiveDate }`. Encapsulates timezone conversion, calendar-day grouping, and strict-daily reset logic. No I/O, no database access. Designed for exhaustive unit testing.
- **`levelResolver`** (deep): Pure function. Takes a points total. Returns `{ index, name, threshold, nextThreshold, pointsIntoLevel, pointsToNextLevel }`. Holds the ten-level constant. No I/O.
- **`pointsService`** (coordinator): Service module orchestrating the points events table. Exposes `awardPointsForLessonComplete`, `awardPointsForQuizAttempt`, `awardPointsForCourseComplete`, `getUserPoints` (returns combined points/level/streak state via the deep modules), and `backfillUserPoints`. All award functions use INSERT-OR-IGNORE semantics so the DB-level idempotency does the heavy lifting.
- **Existing service modifications**: `progressService.markLessonComplete` gains a single call into `pointsService.awardPointsForLessonComplete` (which writes both the lesson and streak-day events in one transaction). The quiz-scoring code path gains a call into `pointsService.awardPointsForQuizAttempt`. The course-completion code path gains a call into `pointsService.awardPointsForCourseComplete`. No other behaviour in these services changes.
- **UI modules**: an updated `sidebar.tsx` with a points/level/streak summary block; a new dashboard gamification panel rendered above the course grid in `dashboard.tsx`; toast wiring on the lesson-complete and quiz-attempt mutation responses, with a level-up variant. Toast triggering is driven by the loader/action returns indicating whether a new level was crossed in this transaction.

### Slicing Plan

Six sequential issues, each independently mergeable. No feature flag — gamification simply isn't visible until the UI surfaces ship.

1. **Schema + migration + backfill**: create `points_events`, add `users.timezone`, run the historical backfill from `lessonProgress`, `quizAttempts`, and `enrollments`. Lands silently — data is correct from day one with no UI.
2. **`pointsService` + service hooks**: implement the coordinator service and wire it into `progressService.markLessonComplete`, the quiz-scoring path, and the course-complete path. New activity now produces events. Still no UI.
3. **Deep modules and derivation**: implement `streakCalculator` and `levelResolver` as pure functions; finalise `getUserPoints`. Comprehensive unit tests for both deep modules.
4. **Sidebar display**: persistent points/level/streak block in the existing sidebar — first user-visible surface.
5. **Dashboard panel**: gamification widget above the course grid, with progress to next level, current/longest streak, and recent events. Independent of sidebar; can ship in either order.
6. **Toast feedback**: standard points toast, distinct level-up celebration toast, streak-milestone toast at 7/30/100/365.

## Testing Decisions

A good test in this codebase follows the existing service-layer convention: it tests *external behaviour* of a module (inputs and observable outputs) rather than implementation details. Tests should not stub or assert on internal helper functions, internal SQL queries, or the structure of intermediate objects — only on what a caller of the module's public surface would observe.

All five modules will be tested:

- **`streakCalculator` (unit, exhaustive)**: empty event list returns zero-length streaks; single-day activity returns currentStreak = 1; consecutive days extend the streak; any missed day resets the current streak; activity at 11:55pm in a non-UTC zone counts toward the right calendar day; timezone boundary at midnight is handled correctly; leap days don't break the walk; backfill-flagged events are excluded from streak computation; longestStreak captures the largest historical run even if currentStreak is now zero.
- **`levelResolver` (unit, boundary-focused)**: zero points returns Level 1 (Newcomer); points exactly equal to a threshold places the user *at* the new level; points one below a threshold place them at the lower level; points above the highest threshold cap at Level 10 (Grandmaster); the `pointsToNextLevel` calculation is correct at and across boundaries; the `nextThreshold` is null at the top level.
- **`pointsService` (integration, DB-backed)**: awarding lesson-complete points twice for the same (user, lesson) results in a single events row and unchanged total (idempotency); a lesson-complete call writes both the lesson event and the streak-day event in the same transaction (or neither, on failure); quiz-pass with a perfect score writes both pass and perfect events; deleting a user cascades and removes their events; deleting a lesson sets the lesson_id to null on associated events but leaves them in place and the user's total unchanged; backfill is re-runnable without producing duplicate events.
- **Existing service modifications (integration)**: existing `progressService` and quiz-scoring tests should continue to pass; new tests verify that calling these services produces the expected new events (without re-testing the points logic itself, which is covered by `pointsService` tests).

UI components are not tested. This matches the existing codebase pattern, where services have `.test.ts` files (`progressService.test.ts`, `quizService.test.ts`, `enrollmentService.test.ts`, etc.) but UI routes and components do not. Test runner is Vitest, configured at the project root.

Prior art for tests: `app/services/progressService.test.ts`, `app/services/quizService.test.ts` (and similar service tests in `app/services/`). New tests should follow the same setup pattern (in-memory or scratch SQLite per test, drizzle migrations applied, table-level cleanup between tests).

## Out of Scope

- **Streak-at-risk notifications** of any kind (in-app banner, email, push). This is a deliberate v1 omission to avoid the dark-pattern engagement loop. Sarah may revisit in v2 with retention data in hand.
- **Email and push notification infrastructure**. The codebase has none today; building it for a v1 gamification feature would dwarf the feature itself.
- **Streak freezes, makeup days, weekly quotas, weekend pause modes**. Strict daily reset only.
- **Level-locked content**. Levels recognise; they do not gate.
- **Leaderboards or any cross-user comparison surface**. Explicitly excluded by the brief.
- **Instructor or admin visibility into individual students' gamification state**. Per-student data stays private to the student.
- **Aggregate product analytics dashboards** ("what % of users have an active streak", "average level across cohorts"). Useful for Sarah, but a separate analytics workstream.
- **Admin UI for granting or revoking points**. Support queries are answered via SQL.
- **A profile or lifetime-stats page**. Lifetime stats fit on the dashboard widget in v1.
- **Lesson-page footer point hints** ("complete this for +10 points"). The toast on completion is sufficient.
- **Multiple currencies** (e.g. XP plus gems). Single currency only.
- **Points for video watching, enrollment, or failed quiz attempts**. These are gameable or train the wrong behaviour.
- **Course-refund logic that revokes points**. Points are immutable except on user deletion.
- **A `user_points_total` denormalised column or `user_streaks` counter table**. Totals and streak lengths are derived. Add denormalisation only if a real query becomes slow.

## Further Notes

- The brief came from Sarah Chen (VP Product) via Slack on the `#product-requests` channel two days before this PRD was written. The single most quoted student feedback ("I finished 40 lessons and I have nothing to show for it") is the load-bearing motivator and should remain visible to whoever picks this up.
- The "3x more likely to finish a course" stat for daily-engagement students comes from Sarah and is the explicit justification for prioritising streaks. This is also why we're shipping all four mechanics together rather than scoping streaks out — they are the retention lever.
- The decision to start everyone at streak = 0 (rather than retroactively claim historical streaks) is deliberate. Backfilling streaks from `lessonProgress.completedAt` would technically be possible but cheapens the streak number for students who actually build one day-by-day, and doesn't change forward behaviour anyway.
- The strict-daily streak rule was a user-driven choice over a 6-of-7 rolling-window alternative. It's harsher on busy professionals but produces a cleaner, more meaningful streak number. If post-launch data shows excessive streak-resets correlate with churn, the rolling-window forgiveness is a low-risk v2 change (the points events table doesn't need to change, only the calculator).
- The level threshold curve (0, 50, 150, 350, 700, 1200, 2000, 3200, 5000, 8000) is calibrated so a typical 30-lesson, 5-quiz course earns roughly 525 points — placing the average single-course finisher around Level 4. Three to four courses with some perfect-quiz play reaches Level 10. This calibration assumes typical course size; if the catalog skews larger or smaller, product may want to revisit the curve before launch.
- The level names are competence-coded ("Practitioner", "Specialist", "Expert", "Master") rather than fantasy-coded ("Adept", "Archmage") to fit the professional audience. Final naming is open to bikeshedding; the structure (numeric + thematic, ten levels, exponential curve) is what's locked.
- Once shipped, a natural follow-up is a one-time agent in 6–8 weeks that pulls retention metrics and writes a "what worked / what didn't" memo — particularly for the streak rule (strict vs. rolling-window) and the no-email-notifications decision. These are the two product calls most likely to need revisiting.
