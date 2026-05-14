import { Outlet } from "react-router";
import { useEffect } from "react";
import type { Route } from "./+types/layout.app";
import { Sidebar } from "~/components/sidebar";
import { DevUI } from "~/components/dev-ui";
import { Toaster } from "sonner";
import { getAllUsers, getUserById } from "~/services/userService";
import { getCurrentUserId, getDevCountry } from "~/lib/session";
import {
  getRecentlyProgressedCourses,
  calculateProgress,
  getCompletedLessonCount,
  getTotalLessonCount,
} from "~/services/progressService";
import { getUserPoints } from "~/services/pointsService";
import { getCountryTierInfo, COUNTRIES } from "~/lib/ppp";
import { isTeamAdmin } from "~/services/teamService";
import { UserRole } from "~/db/schema";

export async function loader({ request }: Route.LoaderArgs) {
  const users = getAllUsers();
  const currentUserId = await getCurrentUserId(request);
  const currentUser = currentUserId ? getUserById(currentUserId) : null;
  const devCountry = await getDevCountry(request);
  const countryTierInfo = getCountryTierInfo(devCountry);

  const userPoints =
    currentUserId && currentUser?.role === UserRole.Student
      ? (() => {
          const points = getUserPoints(currentUserId);
          const todayLocal = new Intl.DateTimeFormat("en-CA", {
            timeZone: currentUser?.timezone ?? "UTC",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date());
          return {
            totalPoints: points.totalPoints,
            levelName: points.level.name,
            currentStreak: points.currentStreak,
            activeToday: points.lastActiveDate === todayLocal,
          };
        })()
      : null;

  const recentCourses = currentUserId
    ? getRecentlyProgressedCourses(currentUserId).map((course) => {
        const completedLessons = getCompletedLessonCount(
          currentUserId,
          course.courseId
        );
        const totalLessons = getTotalLessonCount(course.courseId);
        const progress = calculateProgress(
          currentUserId,
          course.courseId,
          false,
          false
        );
        return {
          courseId: course.courseId,
          title: course.courseTitle,
          slug: course.courseSlug,
          coverImageUrl: course.coverImageUrl,
          completedLessons,
          totalLessons,
          progress,
        };
      })
    : [];

  return {
    users: users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    currentUser: currentUser
      ? {
          id: currentUser.id,
          name: currentUser.name,
          role: currentUser.role,
          avatarUrl: currentUser.avatarUrl ?? null,
          timezone: currentUser.timezone,
        }
      : null,
    recentCourses,
    userPoints,
    devCountry,
    countryTierInfo,
    countries: COUNTRIES,
    isTeamAdmin: currentUserId ? isTeamAdmin(currentUserId) : false,
  };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const {
    users,
    currentUser,
    recentCourses,
    userPoints,
    devCountry,
    countryTierInfo,
    countries,
    isTeamAdmin: userIsTeamAdmin,
  } = loaderData;

  useEffect(() => {
    if (!currentUser || currentUser.timezone !== "UTC") return;
    let browserZone: string;
    try {
      browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!browserZone || browserZone === "UTC") return;

    const form = new FormData();
    form.set("timezone", browserZone);
    fetch("/api/set-timezone", { method: "POST", body: form }).catch(() => {});
  }, [currentUser?.id, currentUser?.timezone]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        currentUser={currentUser}
        recentCourses={recentCourses}
        userPoints={userPoints}
        isTeamAdmin={userIsTeamAdmin}
      />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <DevUI
        users={users}
        currentUser={currentUser}
        devCountry={devCountry}
        countryTierInfo={countryTierInfo}
        countries={countries}
      />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
