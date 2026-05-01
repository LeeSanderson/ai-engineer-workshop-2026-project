## Parent PRD

`issues/prd.md`

## What to build

Extend the points system from slice 001 to cover the remaining non-streak event sources: quiz pass, perfect quiz score (separate stacking event), and course completion. The sidebar already exists and renders totals from slice 001 — this slice just adds new event sources flowing into it.

End-to-end behaviour:

- A student passes a quiz for the first time → sidebar total increases by 25 points.
- A student passes a quiz with a perfect score (100%) on their first attempt → sidebar total increases by 25 + 15 = 40 points (two separate event rows).
- A student passes a quiz at 80%, then re-attempts and gets 100% → first attempt grants 25; second attempt grants the 15-point perfect bonus only (no second pass-points).
- A student re-attempts a quiz they've already passed at any score → no points granted.
- A student completes a course (`enrollments.completedAt` becomes non-null) → sidebar total increases by 100 points.
- The student's level updates if any of the above pushes them across a threshold.

See parent PRD sections "Points and Earning Rules" and "Idempotency" for the locked rules.

## Acceptance criteria

- [ ] `pointsService.awardPointsForQuizAttempt(userId, attempt)` writes a `quiz_pass` event (25 pts) on first passing attempt for a `(user, quiz)` pair, and a `quiz_perfect` event (15 pts) on first 100% attempt for a `(user, quiz)` pair. Both events are independent and DB-level idempotent.
- [ ] `pointsService.awardPointsForCourseComplete(userId, courseId)` writes a `course_complete` event (100 pts), idempotent per `(user, course)`.
- [ ] The quiz-scoring code path calls `awardPointsForQuizAttempt` after persisting the attempt.
- [ ] The course-completion code path calls `awardPointsForCourseComplete` immediately after `enrollments.completedAt` is set.
- [ ] A failing quiz attempt grants no points.
- [ ] A user who has already passed a quiz and re-attempts (passing again) gets no additional `quiz_pass` event.
- [ ] A user who passed a quiz at <100% and later achieves 100% gets the `quiz_perfect` event but no additional `quiz_pass` event.
- [ ] Integration tests cover: first quiz pass writes one `quiz_pass` event; first perfect score writes both `quiz_pass` and `quiz_perfect` if not already passed, or only `quiz_perfect` if previously passed; double-passing a quiz is idempotent; course completion writes one `course_complete` event and is idempotent on second call.
- [ ] Existing quiz-scoring and enrollment tests continue to pass.

## Blocked by

- Blocked by `issues/001-lesson-points-sidebar.md`

## User stories addressed

- User story 2
- User story 3
- User story 4
- User story 8
