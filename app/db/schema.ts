import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
} from "drizzle-orm/sqlite-core";

export enum UserRole {
  Student = "student",
  Instructor = "instructor",
  Admin = "admin",
}

export enum CourseStatus {
  Draft = "draft",
  Published = "published",
  Archived = "archived",
}

export enum LessonProgressStatus {
  NotStarted = "not_started",
  InProgress = "in_progress",
  Completed = "completed",
}

export enum QuestionType {
  MultipleChoice = "multiple_choice",
  TrueFalse = "true_false",
}

export enum TeamMemberRole {
  Admin = "admin",
  Member = "member",
}

export enum PointsEventKind {
  LessonComplete = "lesson_complete",
  QuizPass = "quiz_pass",
  QuizPerfect = "quiz_perfect",
  CourseComplete = "course_complete",
  StreakDay = "streak_day",
}

// ─── Tables ───

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().$type<UserRole>(),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const courses = sqliteTable("courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  salesCopy: text("sales_copy"),
  instructorId: integer("instructor_id")
    .notNull()
    .references(() => users.id),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  status: text("status").notNull().$type<CourseStatus>(),
  coverImageUrl: text("cover_image_url"),
  price: integer("price").notNull().default(0),
  pppEnabled: integer("ppp_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const modules = sqliteTable("modules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  title: text("title").notNull(),
  position: integer("position").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const lessons = sqliteTable("lessons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id")
    .notNull()
    .references(() => modules.id),
  title: text("title").notNull(),
  content: text("content"),
  videoUrl: text("video_url"),
  githubRepoUrl: text("github_repo_url"),
  position: integer("position").notNull(),
  durationMinutes: integer("duration_minutes"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const enrollments = sqliteTable("enrollments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  enrolledAt: text("enrolled_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  completedAt: text("completed_at"),
});

export const lessonProgress = sqliteTable("lesson_progress", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  status: text("status").notNull().$type<LessonProgressStatus>(),
  completedAt: text("completed_at"),
});

export const quizzes = sqliteTable("quizzes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  title: text("title").notNull(),
  passingScore: real("passing_score").notNull(),
});

export const quizQuestions = sqliteTable("quiz_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quizId: integer("quiz_id")
    .notNull()
    .references(() => quizzes.id),
  questionText: text("question_text").notNull(),
  questionType: text("question_type").notNull().$type<QuestionType>(),
  position: integer("position").notNull(),
});

export const quizOptions = sqliteTable("quiz_options", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id")
    .notNull()
    .references(() => quizQuestions.id),
  optionText: text("option_text").notNull(),
  isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
});

export const quizAttempts = sqliteTable("quiz_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  quizId: integer("quiz_id")
    .notNull()
    .references(() => quizzes.id),
  score: real("score").notNull(),
  passed: integer("passed", { mode: "boolean" }).notNull(),
  attemptedAt: text("attempted_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const quizAnswers = sqliteTable("quiz_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  attemptId: integer("attempt_id")
    .notNull()
    .references(() => quizAttempts.id),
  questionId: integer("question_id")
    .notNull()
    .references(() => quizQuestions.id),
  selectedOptionId: integer("selected_option_id")
    .notNull()
    .references(() => quizOptions.id),
});

export const purchases = sqliteTable("purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  pricePaid: integer("price_paid").notNull(),
  country: text("country"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const teamMembers = sqliteTable("team_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  role: text("role").notNull().$type<TeamMemberRole>(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const coupons = sqliteTable("coupons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  code: text("code").notNull().unique(),
  purchaseId: integer("purchase_id")
    .notNull()
    .references(() => purchases.id),
  redeemedByUserId: integer("redeemed_by_user_id").references(() => users.id),
  redeemedAt: text("redeemed_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const pointsEvents = sqliteTable("points_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().$type<PointsEventKind>(),
  points: integer("points").notNull(),
  lessonId: integer("lesson_id").references(() => lessons.id, {
    onDelete: "set null",
  }),
  quizId: integer("quiz_id").references(() => quizzes.id, {
    onDelete: "set null",
  }),
  courseId: integer("course_id").references(() => courses.id, {
    onDelete: "set null",
  }),
  streakDate: text("streak_date"),
  isBackfill: integer("is_backfill", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const dismissedStreakBanners = sqliteTable(
  "dismissed_streak_banners",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastActiveDate: text("last_active_date").notNull(),
    dismissedAt: text("dismissed_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.lastActiveDate] }),
  })
);

export const videoWatchEvents = sqliteTable("video_watch_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  eventType: text("event_type").notNull(),
  positionSeconds: real("position_seconds").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
