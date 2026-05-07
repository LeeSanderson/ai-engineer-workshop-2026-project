import { describe, it, expect } from "vitest";
import { LEVELS, resolveLevel } from "./levelResolver";

describe("levelResolver", () => {
  describe("LEVELS constant", () => {
    it("has exactly ten levels", () => {
      expect(LEVELS).toHaveLength(10);
    });

    it("starts at threshold 0 with Newcomer", () => {
      expect(LEVELS[0]).toMatchObject({
        index: 1,
        name: "Newcomer",
        threshold: 0,
      });
    });

    it("tops out at Grandmaster with threshold 8000", () => {
      expect(LEVELS[9]).toMatchObject({
        index: 10,
        name: "Grandmaster",
        threshold: 8000,
      });
    });

    it("has strictly ascending thresholds", () => {
      for (let i = 1; i < LEVELS.length; i++) {
        expect(LEVELS[i].threshold).toBeGreaterThan(LEVELS[i - 1].threshold);
      }
    });
  });

  describe("resolveLevel", () => {
    it("places 0 pts at Level 1 (Newcomer)", () => {
      const result = resolveLevel(0);
      expect(result.index).toBe(1);
      expect(result.name).toBe("Newcomer");
      expect(result.threshold).toBe(0);
      expect(result.nextThreshold).toBe(50);
      expect(result.pointsIntoLevel).toBe(0);
      expect(result.pointsToNextLevel).toBe(50);
    });

    it("places points exactly equal to a threshold at the new level", () => {
      const result = resolveLevel(50);
      expect(result.index).toBe(2);
      expect(result.name).toBe("Learner");
      expect(result.threshold).toBe(50);
      expect(result.nextThreshold).toBe(150);
      expect(result.pointsIntoLevel).toBe(0);
      expect(result.pointsToNextLevel).toBe(100);
    });

    it("places points one below a threshold at the lower level", () => {
      const result = resolveLevel(49);
      expect(result.index).toBe(1);
      expect(result.name).toBe("Newcomer");
      expect(result.pointsIntoLevel).toBe(49);
      expect(result.pointsToNextLevel).toBe(1);
    });

    it("places points above the highest threshold at Grandmaster", () => {
      const result = resolveLevel(99999);
      expect(result.index).toBe(10);
      expect(result.name).toBe("Grandmaster");
      expect(result.threshold).toBe(8000);
      expect(result.nextThreshold).toBeNull();
      expect(result.pointsToNextLevel).toBeNull();
      expect(result.pointsIntoLevel).toBe(99999 - 8000);
    });

    it("places points exactly at the top threshold at Grandmaster with null next", () => {
      const result = resolveLevel(8000);
      expect(result.index).toBe(10);
      expect(result.name).toBe("Grandmaster");
      expect(result.nextThreshold).toBeNull();
      expect(result.pointsToNextLevel).toBeNull();
      expect(result.pointsIntoLevel).toBe(0);
    });

    it("computes pointsIntoLevel correctly mid-level", () => {
      const result = resolveLevel(200);
      expect(result.index).toBe(3);
      expect(result.name).toBe("Student");
      expect(result.threshold).toBe(150);
      expect(result.nextThreshold).toBe(350);
      expect(result.pointsIntoLevel).toBe(50);
      expect(result.pointsToNextLevel).toBe(150);
    });

    it("places 50 (Level 2 boundary from issue acceptance) at Learner", () => {
      // Issue says: 50 pts → Learner (Level 2 threshold)
      const result = resolveLevel(50);
      expect(result.name).toBe("Learner");
    });
  });
});
