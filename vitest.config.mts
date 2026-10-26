import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
    // Tests share one database, so files run one after another
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
