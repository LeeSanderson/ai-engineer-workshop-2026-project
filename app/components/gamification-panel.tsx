import { Award, BookCheck, Flame, GraduationCap, Sparkles, Trophy } from "lucide-react";
import { PointsEventKind } from "~/db/schema";
import { Card, CardContent } from "~/components/ui/card";

export interface GamificationPanelEvent {
  kind: PointsEventKind;
  points: number;
  createdAt: string;
}

interface GamificationPanelProps {
  totalPoints: number;
  levelName: string;
  nextLevelName: string | null;
  pointsIntoLevel: number;
  levelSpan: number | null;
  pointsToNextLevel: number | null;
  currentStreak: number;
  longestStreak: number;
  activeToday: boolean;
  recentEvents: ReadonlyArray<GamificationPanelEvent>;
}

const KIND_LABELS: Record<PointsEventKind, string> = {
  [PointsEventKind.LessonComplete]: "Lesson complete",
  [PointsEventKind.QuizPass]: "Quiz passed",
  [PointsEventKind.QuizPerfect]: "Perfect score",
  [PointsEventKind.CourseComplete]: "Course complete",
  [PointsEventKind.StreakDay]: "Streak day",
};

function KindIcon({ kind }: { kind: PointsEventKind }) {
  switch (kind) {
    case PointsEventKind.LessonComplete:
      return <BookCheck className="size-4 text-emerald-500" />;
    case PointsEventKind.QuizPass:
      return <Award className="size-4 text-sky-500" />;
    case PointsEventKind.QuizPerfect:
      return <Trophy className="size-4 text-amber-500" />;
    case PointsEventKind.CourseComplete:
      return <GraduationCap className="size-4 text-purple-500" />;
    case PointsEventKind.StreakDay:
      return <Flame className="size-4 text-orange-500" />;
  }
}

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function GamificationPanel({
  totalPoints,
  levelName,
  nextLevelName,
  pointsIntoLevel,
  levelSpan,
  pointsToNextLevel,
  currentStreak,
  longestStreak,
  activeToday,
  recentEvents,
}: GamificationPanelProps) {
  const atTopLevel = pointsToNextLevel === null;
  const progressPct =
    atTopLevel || !levelSpan
      ? 100
      : Math.min(100, Math.max(0, Math.round((pointsIntoLevel / levelSpan) * 100)));

  return (
    <Card className="mb-8">
      <CardContent>
        <div className="grid gap-6 md:grid-cols-3">
          {/* Level & progress */}
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="size-5 text-amber-500" />
                <h2 className="text-2xl font-bold tabular-nums">
                  {totalPoints}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">
                    pts
                  </span>
                </h2>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold">{levelName}</div>
                {atTopLevel ? (
                  <div className="text-xs text-amber-600">Top level reached</div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {pointsToNextLevel} pts to {nextLevelName}
                  </div>
                )}
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{levelName}</span>
              <span>{atTopLevel ? "—" : nextLevelName}</span>
            </div>
          </div>

          {/* Streaks */}
          <div className="space-y-3 rounded-md bg-muted/40 p-4">
            <div className="flex items-center gap-2">
              <Flame
                className={
                  activeToday
                    ? "size-5 text-orange-500"
                    : "size-5 text-muted-foreground/40"
                }
              />
              <div>
                <div className="text-lg font-semibold tabular-nums">
                  {currentStreak === 0 ? (
                    <span className="text-muted-foreground">No streak yet</span>
                  ) : (
                    <>
                      {currentStreak}-day streak
                    </>
                  )}
                </div>
                {currentStreak > 0 && !activeToday && (
                  <div className="text-xs text-muted-foreground">
                    Active again today to keep it alive
                  </div>
                )}
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Longest streak:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {longestStreak}
              </span>
            </div>
          </div>
        </div>

        {/* Recent events */}
        <div className="mt-6 border-t pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent activity
          </h3>
          {recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No activity yet — complete a lesson to earn your first points.
            </p>
          ) : (
            <ul className="divide-y">
              {recentEvents.map((event, i) => (
                <li
                  key={`${event.createdAt}-${i}`}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <KindIcon kind={event.kind} />
                    <span>{KIND_LABELS[event.kind]}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {formatEventTime(event.createdAt)}
                    </span>
                    <span className="font-medium tabular-nums">
                      +{event.points}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
