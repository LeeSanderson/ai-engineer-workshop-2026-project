import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../app/db";
import { backfillAllUsersPoints } from "../app/services/pointsService";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, "../drizzle");

console.log("Applying SQL migrations...");
migrate(db, { migrationsFolder });
console.log("SQL migrations applied.");

console.log("Backfilling historical points events for all users...");
backfillAllUsersPoints();
console.log("Backfill complete.");
