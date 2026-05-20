## Parent PRD

`issues/prd.md`

## What to build

Three additional pieces of feedback that build on the toast system from slice 006:

1. A **distinct, larger level-up celebration toast** when a points-earning transaction crosses a level threshold. Suppressed for backfill-flagged events.
2. **Streak milestone celebration toasts** when the streak hits 7, 30, 100, or 365 days.
3. A **calm "streak reset" banner** on the dashboard the next time the user visits, but only if their previous streak was ≥ 7 days. Below that threshold, streaks reset silently.

End-to-end behaviour:

- A student completes a lesson that pushes their total from 49 → 59 pts (crossing the Level 2 threshold of 50) → standard small "+10 pts · Lesson complete" toast PLUS a larger celebration toast: `Level up! · You're now a Learner`.
- A student crosses two level thresholds in one transaction (rare but possible if backfill is bypassed and an event grants enough points) → only one level-up celebration, for the highest level reached.
- A student completes a lesson that takes their streak from 6 → 7 days → standard "+5 pts · Day 7 of streak" toast PLUS a milestone toast: `🔥 7-day streak!`.
- A student returns to the dashboard after letting a 12-day streak lapse → a banner appears at the top of the dashboard: `Your 12-day streak ended. Start a new one today.` Banner is dismissible. Reappears on subsequent dashboard visits until dismissed once.
- A student lets a 4-day streak lapse → no banner, no toast. Silent reset.
- An existing power user logs in for the first time after the backfill migration → no level-up toasts fire for the multiple level transitions implied by their backfilled total (because backfill events are flagged and the level-up detector ignores them).

See parent PRD sections "Display Surfaces" (toast tiering), "Notifications" (streak-broken banner threshold), and "Backfill" (flag-driven suppression).

## Acceptance criteria

- [ ] Mutation responses include a `levelCrossed` field indicating the new level (or null) when a non-backfill transaction crosses one or more level thresholds.
- [ ] The client renders a distinct, larger toast variant for level-up events, visually separable from the small-tier event toasts.
- [ ] If multiple thresholds are crossed in one transaction, only one celebration fires — for the highest level reached.
- [ ] Backfill-flagged events do not contribute to level-cross detection. Specifically: when a backfill event is inserted, `levelCrossed` is not computed for it. (Backfill runs at migration time so this is naturally satisfied; the test verifies no level-up toast fires on a fresh login for a user who was just backfilled.)
- [ ] Mutation responses include a `streakMilestone` field set to one of `[7, 30, 100, 365]` or null when a transaction's streak event takes the streak length to one of those values.
- [ ] The client renders a milestone toast (also using the larger-tier visual treatment) when `streakMilestone` is non-null.
- [ ] On every dashboard load, the loader checks whether the user's previous streak (the most recent completed run before today) was ≥ 7 days AND broken (i.e. there's a gap day between the last day of the run and today). If so, the loader returns banner data.
- [ ] The dashboard renders a dismissible banner with the previous streak length when banner data is present.
- [ ] Banner dismissal is per-user-per-streak — once dismissed for a given previous-streak value, it does not reappear. (Storage approach: a small `dismissed_streak_banners` table or a flag on the events table — implementer's choice; trivial schema addition is acceptable.)
- [ ] Streak resets below 7 days produce no banner.
- [ ] Integration test: a user transition from 49 → 59 pts produces a level-cross signal in the response.
- [ ] Integration test: a backfilled user, on first call to `getUserPoints` post-backfill, does not produce a level-cross signal even though their level is high.
- [ ] Integration test: a streak transition from 6 → 7 produces a `streakMilestone: 7` signal; a transition from 7 → 8 does not.

## Blocked by

- Blocked by `issues/003-streaks-end-to-end.md`
- Blocked by `issues/006-points-event-toasts.md`

## User stories addressed

- User story 13
- User story 17
- User story 18
- User story 24
- User story 41
- User story 42
