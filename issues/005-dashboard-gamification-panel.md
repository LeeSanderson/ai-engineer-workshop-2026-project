## Parent PRD

`issues/prd.md`

## What to build

A larger gamification panel rendered on the dashboard above the existing course grid. Reuses `pointsService.getUserPoints` from earlier slices; no new service work — this is a UI-layer slice that depends on the data layer being complete.

End-to-end behaviour:

- A student opens the dashboard → above the course grid, a panel shows: current level name (e.g. "Practitioner"), total points, a progress bar to the next level (visualising `pointsIntoLevel / (nextThreshold - threshold)`), the points needed to next level, current streak with flame icon if active today, longest streak, and a short list of recent point-earning events.
- A student at the top level (Grandmaster) sees a maxed-out progress bar and "Top level reached" instead of "X points to next level".
- A student with no activity yet sees the panel with `0 pts · Newcomer · 0% to Learner · No streak yet` — no error state, just zeros.

See parent PRD sections "Display Surfaces" and "Module Architecture" for what the panel renders and why it sits where it does.

## Acceptance criteria

- [ ] The dashboard route's loader includes the result of `pointsService.getUserPoints(currentUserId)` in its return value.
- [ ] A new dashboard panel component renders above the existing in-progress / completed course sections.
- [ ] The panel shows: level name, total points, progress bar to next level, points-to-next-level (or "Top level reached" at Grandmaster), current streak with flame icon if `lastActiveDate === today`, longest streak.
- [ ] The panel includes a list of the most recent 5–10 point-earning events for the user, each with its kind (translated to a human label like "Lesson complete") and points earned.
- [ ] At Grandmaster, the panel hides the points-to-next-level number and shows a "Top level reached" affordance instead.
- [ ] A user with zero activity sees the panel with sensible zero/empty states, no errors.
- [ ] Instructors and admins viewing student-facing pages see no panel — verified by inspection (the panel is only on the student dashboard).

## Blocked by

- Blocked by `issues/003-streaks-end-to-end.md`

## User stories addressed

- User story 12
- User story 25
