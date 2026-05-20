## Parent PRD

`issues/prd.md`

## What to build

Inline toast feedback when a user earns points. The lesson-complete and quiz-attempt mutations return information about which events fired, so the client can render a small toast immediately. This slice covers the standard "small" toast tier only — the larger level-up celebration and streak milestone toasts arrive in slice 007.

End-to-end behaviour:

- A student completes a lesson → small toast: `+10 pts · Lesson complete` (and `+5 pts · Day 1 of streak 🔥` if it was the first qualifying activity of the day, in a second toast or stacked).
- A student passes a quiz at <100% → small toast: `+25 pts · Quiz passed`.
- A student passes a quiz at 100% (first time) → two stacked small toasts or a single combined toast: `+25 pts · Quiz passed` and `+15 pts · Perfect score`.
- A student completes a course → small toast: `+100 pts · Course complete!`.
- A student re-completes a lesson they've already finished → no toast (no event was written).

See parent PRD sections "Display Surfaces" and "Notifications" for the toast tiering rules.

## Acceptance criteria

- [ ] Mutation responses (lesson-complete, quiz-attempt-submission, course-completion) include a list of the points events that fired in this transaction (each with kind and points).
- [ ] The client renders a small toast for each event using the existing toast infrastructure (or shadcn/sonner if not yet installed — install if needed, this is the first toast use case in the app).
- [ ] No toast fires when no event was written (e.g. re-completion of an already-completed lesson).
- [ ] Toast text uses human-readable labels: "Lesson complete", "Quiz passed", "Perfect score", "Course complete!", "Day N of streak 🔥".
- [ ] When multiple events fire in one transaction (e.g. lesson + streak day), both toasts appear, stacked or combined coherently.
- [ ] Toast styling uses a small/standard tier — no oversized celebration variant (that's slice 007).
- [ ] Backfill-flagged events (from slice 004) never produce toasts — backfill happens at migration time, well before any user request, so this is naturally satisfied. Verify there is no code path that retroactively renders backfill events as toasts on first login.

## Blocked by

- Blocked by `issues/001-lesson-points-sidebar.md`
- Blocked by `issues/002-quiz-and-course-points.md`

## User stories addressed

- User story 26
- User story 27
