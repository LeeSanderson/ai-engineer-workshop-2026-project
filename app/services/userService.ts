import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { users, UserRole } from "~/db/schema";

// ─── User Service ───
// Handles user CRUD operations and role management.
// Uses positional parameters (project convention).

export function getAllUsers() {
  return db.select().from(users).all();
}

export function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function getUserByEmail(email: string) {
  return db.select().from(users).where(eq(users.email, email)).get();
}

export function getUsersByRole(role: UserRole) {
  return db.select().from(users).where(eq(users.role, role)).all();
}

export function createUser(
  name: string,
  email: string,
  role: UserRole,
  avatarUrl: string | null
) {
  return db
    .insert(users)
    .values({ name, email, role, avatarUrl })
    .returning()
    .get();
}

export function updateUser(
  id: number,
  name: string,
  email: string,
  bio: string | null
) {
  return db
    .update(users)
    .set({ name, email, bio })
    .where(eq(users.id, id))
    .returning()
    .get();
}

export function updateUserRole(id: number, role: UserRole) {
  return db
    .update(users)
    .set({ role })
    .where(eq(users.id, id))
    .returning()
    .get();
}

function isValidIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function captureBrowserTimezone(id: number, browserZone: string) {
  if (!isValidIanaZone(browserZone)) return;
  if (browserZone === "UTC") return;

  db.update(users)
    .set({ timezone: browserZone })
    .where(and(eq(users.id, id), eq(users.timezone, "UTC")))
    .run();
}

export function setUserTimezone(id: number, zone: string) {
  if (!isValidIanaZone(zone)) {
    throw new Error(`Invalid IANA timezone: ${zone}`);
  }
  return db
    .update(users)
    .set({ timezone: zone })
    .where(eq(users.id, id))
    .returning()
    .get();
}
