# 008 — Deepen the gamification module

## Problem

Gamification logic is currently split across three shallow modules — `pointsService`, `levelResolver`, `streakCalculator` — that are tightly coupled in practice but tested independently. The seams between them produce three concrete kinds of friction:

**1. The "award + signal" dance is duplicated at every write site.** Three services (`progressService.markLessonComplete`, `quizScoringService.computeResult`, `enrollmentService.markEnrollmentComplete`) all run the same five-line sequence: read total → award → re-read total → call `detectLevelCrossed` → call `detectStreakMilestone` → merge `FiredPointsEvent[]`. The composition is invariant; only the award function differs. Any service that forgets a step silently breaks toasts.

**2. The lesson → course completion cascade is split across services.** `progressService.maybeAutoCompleteCourse` walks the lesson tree, decides the course is complete, calls into `enrollmentService.markEnrollmentComplete`, which then independently calls `awardPointsForCourseComplete` and re-runs its own level-crossing detection — and progressService then merges those signals back with its own award. The contract "completing the final lesson awards lesson points + course points and reports the combined level crossing" has no single owner.

**3. Routes rebuild the same view-model from low-level primitives.** Both `dashboard.tsx` and `layout.app.tsx` import `getUserPoints` from `pointsService`, `LEVELS` from `levelResolver`, and `toCalendarDate` from `streakCalculator`, then run inline IIFEs to compute `activeToday`, look up `nextLevelName`, derive `levelSpan`, and stitch a sidebar/dashboard shape. The route is doing view-model assembly that belongs in the service.

The integration risk is highest where it's least visible: the three pure-math modules (`resolveLevel`, `computeStreak`, milestone detection) have thorough unit tests, but the *composition* across `pointsService.test.ts`, `progressService.test.ts`, and `enrollmentService.test.ts` is what's covered most thinly — and that composition is exactly where new bugs land when a new award kind is added.

## Proposed Interface

A single deepened module exposing one function per concrete event source on the write side and one function per concrete consumer on the read side. The pure-math helpers (`resolveLevel`, `computeStreak`, milestone detection) stay alive **internally** as private helpers — they're useful primitives, just not part of the public surface.

```ts
// ─── Signals returned by every write call ───
export interface GamificationSignals {
  fired: FiredPointsEvent[];      // [] if all writes were idempotent no-ops
  levelCrossed: number | null;     // new level index, or null
  streakMilestone: number | null;  // 7|30|100|365, or null
  totalPointsAfter: number;        // for optimistic UI / caching
}

// ─── Write side: one entry per event source ───
export function onLessonCompleted(userId: number, lessonId: number): GamificationSignals;
export function onQuizAttempted(
  userId: number,
  quizId: number,
  score: number,
  passed: boolean,
): GamificationSignals;
export function onCourseCompleted(userId: number, courseId: number): GamificationSignals;

// onLessonCompleted internally calls onCourseCompleted when the auto-completion
// predicate fires. Signals are composed across the full batch.

// ─── Read side: one entry per consumer, returning view-ready shapes ───
export interface SidebarGamification {
  totalPoints: number;
  levelName: string;
  currentStreak: number;
  activeToday: boolean;
}

export interface DashboardGamification {
  totalPoints: number;
  levelName: string;
  nextLevelName: string | null;
  pointsIntoLevel: number;
  levelSpan: number | null;
  pointsToNextLevel: number | null;
  currentStreak: number;
  longestStreak: number;
  activeToday: boolean;
  recentEvents: ReadonlyArray<{ kind: PointsEventKind; points: number; createdAt: string }>;
}

export interface StreakBanner {
  previousStreakLength: number;
  lastActiveDate: string;
}

export function getSidebarGamification(userId: number): SidebarGamification | null;
export function getDashboardGamification(userId: number): DashboardGamification | null;
export function getStreakBanner(userId: number): StreakBanner | null;

// ─── Mutations ───
export function dismissStreakBanner(userId: number, lastActiveDate: string): void;

// ─── Backfill (rare, separate) ───
export function backfill(opts?: { userId?: number }): void;
```

### Usage example

`progressService.markLessonComplete` collapses from ~38 lines of awarding + cascading + signal merging to:

```ts
export function markLessonComplete(userId: number, lessonId: number) {
  const progress = upsertLessonProgressCompleted(userId, lessonId);
  return { ...progress, ...onLessonCompleted(userId, lessonId) };
}
```

`quizScoringService.computeResult` drops its trailing prev/new-total + signal-detection block:

```ts
return {
  attemptId: attempt.id, score: scoreValue, passed, grade,
  totalCorrect: correct, totalQuestions: total, questionResults,
  ...onQuizAttempted(userId, quizId, scoreValue, passed),
};
```

`enrollmentService.markEnrollmentComplete` **no longer awards points itself**. It updates `completedAt` and returns. When a lesson completion triggers the cascade, the gamification module calls `onCourseCompleted` directly. When an admin force-completes an enrollment outside of the lesson flow, that caller calls `onCourseCompleted` explicitly.

`dashboard.tsx` loader collapses the ~25-line IIFE to:

```ts
const gamification = isStudent ? getDashboardGamification(currentUserId) : null;
const streakBanner = isStudent ? getStreakBanner(currentUserId) : null;
```

`layout.app.tsx` collapses its sidebar IIFE to `const userPoints = getSidebarGamification(currentUserId);`. Routes no longer import `LEVELS`, `toCalendarDate`, `getUserPoints`, or `getRecentPointsEvents`.

### What complexity is hidden

- The `points_events` table schema, the `COALESCE`-unique-index idempotency contract, and `onConflictDoNothing` semantics.
- The pattern of writing a `streak_day` row alongside a `lesson_complete` or `quiz_pass` row inside one transaction.
- Computing `streakDayNumber` post-insert and threading it through `STREAK_MILESTONES` membership.
- The prev-total / new-total / `resolveLevel` diff for `levelCrossed`.
- The lesson → course cascade: looking up `modules.courseId` from `lessonId`, finding the enrollment, counting completed vs. total lessons, awarding course-complete points, and merging signals.
- Per-user timezone lookup and `Intl.DateTimeFormat`-based calendar-date math for `activeToday`.
- The `LEVELS` table and how to derive `nextLevelName` / `levelSpan` / `pointsToNextLevel` from a points total.
- Role gating: non-students get `null` from read functions rather than zeroed payloads.

## Dependency Strategy

**Local-substitutable** (category 2). The module is DB-bound on `points_events`, `dismissed_streak_banners`, and reads `users.timezone`. The existing test pattern (better-sqlite3 in-memory via `app/test/setup.ts`) covers this without any port/adapter machinery. Idempotency continues to be DB-enforced via the existing partial unique index — the module's contract to callers is "write and we'll deduplicate; you get `fired: []` for duplicates."

No clock injection in the public API. If a unit test ever needs to assert streak-banner behavior at a specific date, the `now` parameter stays an internal optional on the private helpers (matching today's `getStreakBannerData(userId, timezone, now)` shape).

## Testing Strategy

**New boundary tests to write** (against the deepened module's interface):

- `onLessonCompleted` writes lesson + streak_day, returns the right signals, is idempotent on repeat.
- `onLessonCompleted` cascade: when the lesson is the final unfinished lesson of an enrolled course, course-complete points fire in the same call; `levelCrossed` reflects the combined point delta; `enrollments.completedAt` is set.
- `onLessonCompleted` cascade is suppressed when the enrollment is already `completedAt`-set.
- `onQuizAttempted` writes `quiz_pass` + optional `quiz_perfect` + `streak_day` for passing attempts, none of them for failing.
- `onQuizAttempted` is idempotent — the second pass for the same `quizId` returns `fired: []` and no signals.
- `onCourseCompleted` called directly (admin path) sets `completedAt` and awards course-complete points exactly once.
- `getDashboardGamification` returns the correct view-model for a known event history (level, next level, span, streak, activeToday).
- `getSidebarGamification` returns the smaller projection for the same history.
- `getStreakBanner` returns banner data for a ≥7-day broken streak, `null` once dismissed.
- `backfill({ userId })` re-derives `points_events` from `lesson_progress`/`quiz_attempts`/`enrollments` without duplicating existing rows.
- Streak-milestone signal fires for day 7/30/100/365 and not for day 6/8.

**Old tests to delete or move:**

- `pointsService.test.ts` — the ~1200-line file is mostly boundary-test material in disguise. Delete the orchestration tests (idempotency-via-helper-call, signal detection composed with awards) and replace with the boundary tests above. The DB-write assertions move with them; they belong to the new module.
- `progressService.test.ts` — keep the lesson-progress upsert tests; delete the `levelCrossed` / `streakMilestone` / cascade-signal-merging assertions (replaced by the new module's cascade test).
- `enrollmentService.test.ts` — keep the enrollment-state tests; delete the `pointsEvents` / `levelCrossed` assertions on `markEnrollmentComplete` (that behavior moved to the gamification module).

**Tests that stay unchanged:**

- `levelResolver.test.ts` and `streakCalculator.test.ts` — these test the pure-math primitives that remain as **internal** helpers inside the new module. Keep them as fast unit tests of the math; the boundary tests cover composition. (If we wanted to be maximalist about "replace, don't layer," these could be deleted in favor of behavior-only coverage at the boundary. Recommendation: keep them — they're fast, the math is non-trivial, and they document the level/streak rules in one place.)

**Test environment needs:** none new. The existing better-sqlite3 in-memory harness covers everything.

## Implementation Recommendations

### What the module owns

- Writing `points_events` rows (every kind: lesson, quiz pass/perfect, course, streak day).
- Writing and reading `dismissed_streak_banners`.
- Resolving `users.timezone` per user, every time it's needed for calendar-date math.
- Computing the auto-completion cascade: looking up the enrollment and lesson count from a completed lesson, awarding course-complete points if the predicate fires, updating `enrollments.completedAt`.
- Computing all derived signals (`levelCrossed`, `streakMilestone`, `streakDayNumber`).
- Assembling the view-models consumed by the dashboard, sidebar, and any future gamification UI.
- Backfill from historical `lesson_progress` / `quiz_attempts` / `enrollments` rows.

### What it hides

- The `points_events` schema and the unique-index contract.
- The `PointsEventKind` enum at the seam: callers should not need to import it (an exception is `DashboardGamification.recentEvents[].kind`, which exposes the enum because the UI labels each event — acceptable).
- The `LEVELS` table.
- The `STREAK_MILESTONES` set.
- The pure-math helpers `resolveLevel`, `computeStreak`, `detectLevelCrossed`, `detectStreakMilestone`, `toCalendarDate` — they stay as private functions inside the module.

### What it exposes

- The nine public entry points listed in the interface section.
- The shape types: `GamificationSignals`, `SidebarGamification`, `DashboardGamification`, `StreakBanner`, plus `FiredPointsEvent` (which is needed by routes constructing toasts).

### How callers migrate

The migration is mechanical and per-caller. Suggested order:

1. **Create the new module** at `app/services/gamification.ts` (or `app/services/gamification/index.ts` with internal helpers split out). Move the implementations of all `pointsService` functions, the `levelResolver` constants and `resolveLevel`, and `streakCalculator` functions into private helpers. Implement the nine public functions as orchestrations of those helpers.
2. **Write boundary tests** against the new module before deleting the old test files.
3. **Migrate `progressService.markLessonComplete`** to call `onLessonCompleted`. Delete its `maybeAutoCompleteCourse` (the cascade now lives in the gamification module). Delete its imports from `pointsService`.
4. **Migrate `quizScoringService.computeResult`** to call `onQuizAttempted`.
5. **Migrate `enrollmentService.markEnrollmentComplete`** to no longer award points. Update any caller that relied on `markEnrollmentComplete`'s returned `pointsEvents`/`levelCrossed` to call `onCourseCompleted` explicitly if they need the signals.
6. **Migrate `dashboard.tsx`** to `getDashboardGamification` + `getStreakBanner`.
7. **Migrate `layout.app.tsx`** to `getSidebarGamification`.
8. **Migrate `courses.$slug.lessons.$lessonId.tsx`** to import `FiredPointsEvent` from the new module instead of `pointsService`, and remove the direct `LEVELS` import (the route only uses `LEVELS` to label the toast — pass the level name through the signals instead, or expose a small `getLevelName(index)` helper if we want to keep the toast purely client-side).
9. **Migrate `api.dismiss-streak-banner.ts`** to call `dismissStreakBanner` from the new module.
10. **Migrate `scripts/`** backfill calls.
11. **Delete `pointsService.ts`, `levelResolver.ts`, `streakCalculator.ts`** and their tests (keeping `levelResolver.test.ts` and `streakCalculator.test.ts` if we adopt them as internal-helper unit tests; co-locate them under the new module folder).

The migration can be done in one PR or split per-caller behind a re-export shim from the old files (each old function re-exports from the new module). The re-export approach makes the migration trivially reversible but risks leaving the old files around — prefer one PR if the diff stays manageable.

### Durable architectural guidance

- **Routes do not import gamification primitives.** They call one of the read functions. If a route needs new data, the read function grows a field; the route does not reach for `LEVELS` or `toCalendarDate`.
- **Services do not compose award + signal detection.** They call one `onX` function and spread the result.
- **The cascade lives in the gamification module, not in the service that triggered it.** Adding a new "completion triggers another completion" rule (e.g. "completing all courses in a category awards a category badge") goes inside `onLessonCompleted` or wherever the triggering event is, not in the calling service.
- **Pure math stays pure and private.** New award rules add a new `onX` function and possibly new private helpers; they do not extend a registry or schedule. We will reconsider a registry/schedule design (Design B in the RFC discussion) only when the award-kind set actually starts changing frequently.
