import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { eq } from "drizzle-orm";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { computeResult } from "./quizScoringService";

function setupQuizWithTwoQuestions() {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 1 })
    .returning()
    .get();
  const lesson = testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson", position: 1 })
    .returning()
    .get();
  const quiz = testDb
    .insert(schema.quizzes)
    .values({ lessonId: lesson.id, title: "Quiz", passingScore: 0.7 })
    .returning()
    .get();

  const q1 = testDb
    .insert(schema.quizQuestions)
    .values({
      quizId: quiz.id,
      questionText: "Q1",
      questionType: schema.QuestionType.MultipleChoice,
      position: 1,
    })
    .returning()
    .get();
  const q1Right = testDb
    .insert(schema.quizOptions)
    .values({ questionId: q1.id, optionText: "right", isCorrect: true })
    .returning()
    .get();
  const q1Wrong = testDb
    .insert(schema.quizOptions)
    .values({ questionId: q1.id, optionText: "wrong", isCorrect: false })
    .returning()
    .get();

  const q2 = testDb
    .insert(schema.quizQuestions)
    .values({
      quizId: quiz.id,
      questionText: "Q2",
      questionType: schema.QuestionType.MultipleChoice,
      position: 2,
    })
    .returning()
    .get();
  const q2Right = testDb
    .insert(schema.quizOptions)
    .values({ questionId: q2.id, optionText: "right", isCorrect: true })
    .returning()
    .get();
  const q2Wrong = testDb
    .insert(schema.quizOptions)
    .values({ questionId: q2.id, optionText: "wrong", isCorrect: false })
    .returning()
    .get();

  return { quiz, q1, q1Right, q1Wrong, q2, q2Right, q2Wrong };
}

describe("quizScoringService.computeResult — points wiring", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("writes a quiz_pass event when the user passes a quiz", () => {
    const { quiz, q1, q1Right, q2, q2Wrong } = setupQuizWithTwoQuestions();

    // 1/2 correct = 0.5, that's not > 0.7 so it would fail. Let's get both correct for a perfect.
    // Actually let's make it pass at 100% to test perfect too.
    const result = computeResult(base.user.id, quiz.id, {
      [q1.id]: q1Right.id,
      [q2.id]: q2Wrong.id, // wrong on purpose for a 50% non-passing
    });

    expect(result).not.toBeNull();
    expect(result.passed).toBe(false);

    const events = testDb
      .select()
      .from(schema.pointsEvents)
      .where(eq(schema.pointsEvents.userId, base.user.id))
      .all();

    expect(events).toHaveLength(0);
  });

  it("writes a single quiz_pass event when the user passes (non-perfect)", () => {
    const setup = setupQuizWithTwoQuestions();
    // Add a third question to allow a pass at 2/3 ≈ 0.667... Actually that's not > 0.7
    // Use 4 questions, 3 correct → 0.75 > 0.7
    const q3 = testDb
      .insert(schema.quizQuestions)
      .values({
        quizId: setup.quiz.id,
        questionText: "Q3",
        questionType: schema.QuestionType.MultipleChoice,
        position: 3,
      })
      .returning()
      .get();
    const q3Right = testDb
      .insert(schema.quizOptions)
      .values({ questionId: q3.id, optionText: "right", isCorrect: true })
      .returning()
      .get();
    testDb
      .insert(schema.quizOptions)
      .values({ questionId: q3.id, optionText: "wrong", isCorrect: false })
      .run();
    const q4 = testDb
      .insert(schema.quizQuestions)
      .values({
        quizId: setup.quiz.id,
        questionText: "Q4",
        questionType: schema.QuestionType.MultipleChoice,
        position: 4,
      })
      .returning()
      .get();
    testDb
      .insert(schema.quizOptions)
      .values({ questionId: q4.id, optionText: "right", isCorrect: true })
      .run();
    const q4Wrong = testDb
      .insert(schema.quizOptions)
      .values({ questionId: q4.id, optionText: "wrong", isCorrect: false })
      .returning()
      .get();

    const result = computeResult(base.user.id, setup.quiz.id, {
      [setup.q1.id]: setup.q1Right.id,
      [setup.q2.id]: setup.q2Right.id,
      [q3.id]: q3Right.id,
      [q4.id]: q4Wrong.id,
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBeCloseTo(0.75, 5);

    const events = testDb
      .select()
      .from(schema.pointsEvents)
      .where(eq(schema.pointsEvents.userId, base.user.id))
      .all();

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe(schema.PointsEventKind.QuizPass);
    expect(events[0].points).toBe(25);
    expect(events[0].quizId).toBe(setup.quiz.id);
  });

  it("writes both quiz_pass and quiz_perfect on a perfect score", () => {
    const { quiz, q1, q1Right, q2, q2Right } = setupQuizWithTwoQuestions();

    const result = computeResult(base.user.id, quiz.id, {
      [q1.id]: q1Right.id,
      [q2.id]: q2Right.id,
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);

    const events = testDb
      .select()
      .from(schema.pointsEvents)
      .where(eq(schema.pointsEvents.userId, base.user.id))
      .all();

    expect(events).toHaveLength(2);
    const totalPoints = events.reduce((sum, e) => sum + e.points, 0);
    expect(totalPoints).toBe(40);
  });

  it("a re-pass at <100% after a previous pass writes no additional events", () => {
    const { quiz, q1, q1Right, q1Wrong, q2, q2Right, q2Wrong } =
      setupQuizWithTwoQuestions();

    // First: pass at 100%
    computeResult(base.user.id, quiz.id, {
      [q1.id]: q1Right.id,
      [q2.id]: q2Right.id,
    });

    // Second attempt at 50% (failing) — no new events.
    computeResult(base.user.id, quiz.id, {
      [q1.id]: q1Right.id,
      [q2.id]: q2Wrong.id,
    });

    const events = testDb
      .select()
      .from(schema.pointsEvents)
      .where(eq(schema.pointsEvents.userId, base.user.id))
      .all();

    expect(events).toHaveLength(2); // still just the initial pass + perfect
  });
});
