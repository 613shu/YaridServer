/**
 * Creates/updates the tables in the TEST database: npm run db:migrate:test
 * (runs "prisma migrate deploy" with DATABASE_URL = TEST_DATABASE_URL)
 */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ quiet: true });
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error("❌ TEST_DATABASE_URL is not set in .env");
  process.exit(1);
}
if (testUrl === process.env.DATABASE_URL) {
  console.error("❌ TEST_DATABASE_URL must be different from DATABASE_URL");
  process.exit(1);
}
const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: testUrl, DIRECT_URL: testUrl },
});
process.exit(result.status ?? 1);
