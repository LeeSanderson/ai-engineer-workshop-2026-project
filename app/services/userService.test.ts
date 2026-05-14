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

import {
  captureBrowserTimezone,
  setUserTimezone,
  getUserById,
} from "./userService";

describe("userService timezone", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("captureBrowserTimezone", () => {
    it("updates the timezone when the stored value is the default 'UTC'", () => {
      captureBrowserTimezone(base.user.id, "America/Los_Angeles");

      const user = getUserById(base.user.id);
      expect(user?.timezone).toBe("America/Los_Angeles");
    });

    it("is a no-op when the stored timezone is already set to something other than 'UTC'", () => {
      testDb
        .update(schema.users)
        .set({ timezone: "Europe/London" })
        .where(eq(schema.users.id, base.user.id))
        .run();

      captureBrowserTimezone(base.user.id, "America/Los_Angeles");

      const user = getUserById(base.user.id);
      expect(user?.timezone).toBe("Europe/London");
    });

    it("is a no-op when the browser zone is also 'UTC' (no change needed)", () => {
      captureBrowserTimezone(base.user.id, "UTC");

      const user = getUserById(base.user.id);
      expect(user?.timezone).toBe("UTC");
    });

    it("rejects an invalid IANA zone string silently (no-op)", () => {
      captureBrowserTimezone(base.user.id, "Not/A/Real/Zone");

      const user = getUserById(base.user.id);
      expect(user?.timezone).toBe("UTC");
    });
  });

  describe("setUserTimezone", () => {
    it("updates the timezone unconditionally", () => {
      testDb
        .update(schema.users)
        .set({ timezone: "Europe/London" })
        .where(eq(schema.users.id, base.user.id))
        .run();

      setUserTimezone(base.user.id, "America/New_York");

      const user = getUserById(base.user.id);
      expect(user?.timezone).toBe("America/New_York");
    });

    it("rejects an invalid IANA zone with a thrown error", () => {
      expect(() => setUserTimezone(base.user.id, "Not/A/Real/Zone")).toThrow();
    });
  });
});
