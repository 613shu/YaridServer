/**
 * Runs before every test file, before the app is imported.
 * Points the app at the TEST database and turns the background simulation off
 * (tests run ticks by hand with runTick).
 */
import { config } from "dotenv";

config({ quiet: true });

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error("TEST_DATABASE_URL is not set. Add it to .env (a separate, empty database for tests).");
}
if (testUrl === process.env.DATABASE_URL || testUrl === process.env.DIRECT_URL) {
  throw new Error("Safety stop: TEST_DATABASE_URL must be a DIFFERENT database than DATABASE_URL — tests delete all data.");
}

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = testUrl;
process.env.SIMULATION_ENABLED = "false";
process.env.BCRYPT_ROUNDS = "4";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-test-secret-test-secret";
process.env.GAME_HOUR_MS = "150000";
