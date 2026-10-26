import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./db/prisma";
import { startScheduler, stopScheduler } from "./simulation/scheduler";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`🚀 The Great Fair API listening on port ${env.PORT}`);
  console.log(`📚 Swagger docs: http://localhost:${env.PORT}/api-docs`);
  startScheduler();
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  stopScheduler();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
