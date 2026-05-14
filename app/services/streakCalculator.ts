import { PointsEventKind } from "~/db/schema";

// ─── Streak Calculator ───
// Pure function module. No DB, no I/O.
// Derives streak length from a list of points-event-shaped records and an IANA timezone.

export interface StreakEvent {
  timestamp: string;
  kind: PointsEventKind | string;
  isBackfill: boolean;
  streakDate?: string | null;
}

export interface StreakResult {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
}

const QUALIFYING_KINDS: ReadonlySet<string> = new Set([
  PointsEventKind.LessonComplete,
  PointsEventKind.QuizPass,
]);

export function toCalendarDate(timestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));

  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${year}-${month}-${day}`;
}

function previousDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function computeStreak(
  events: StreakEvent[],
  timezone: string,
  now: Date = new Date()
): StreakResult {
  const dates = new Set<string>();
  for (const event of events) {
    if (event.isBackfill) continue;
    if (!QUALIFYING_KINDS.has(event.kind)) continue;
    const date = event.streakDate ?? toCalendarDate(event.timestamp, timezone);
    dates.add(date);
  }

  if (dates.size === 0) {
    return { currentStreak: 0, longestStreak: 0, lastActiveDate: null };
  }

  const sortedDates = Array.from(dates).sort();
  const lastActiveDate = sortedDates[sortedDates.length - 1];

  let longestStreak = 1;
  let runLength = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    if (sortedDates[i] === nextDate(sortedDates[i - 1])) {
      runLength += 1;
    } else {
      runLength = 1;
    }
    if (runLength > longestStreak) longestStreak = runLength;
  }

  const today = toCalendarDate(now.toISOString(), timezone);
  const yesterday = previousDate(today);

  let currentStreak = 0;
  if (lastActiveDate === today || lastActiveDate === yesterday) {
    currentStreak = 1;
    let cursor = lastActiveDate;
    for (let i = sortedDates.length - 2; i >= 0; i--) {
      if (sortedDates[i] === previousDate(cursor)) {
        currentStreak += 1;
        cursor = sortedDates[i];
      } else {
        break;
      }
    }
  }

  return { currentStreak, longestStreak, lastActiveDate };
}

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
