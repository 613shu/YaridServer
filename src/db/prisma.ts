import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { env } from "../config/env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Builds the pg connection config.
 * Cloud databases (Supabase etc.) need SSL; their certificate chain is not in
 * Node's default trust store, so SSL is enabled without strict verification.
 * Set DB_SSL=false to turn SSL off, or DB_SSL=true to force it on.
 */
function buildPgConfig() {
  const url = new URL(env.DATABASE_URL);
  const isLocal = LOCAL_HOSTS.has(url.hostname);
  const useSsl = env.DB_SSL ?? !isLocal;
  // Remove sslmode so it doesn't override the ssl object below.
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  };
}

const adapter = new PrismaPg(buildPgConfig());

export const prisma = new PrismaClient({ adapter });

export type Db = typeof prisma;
/** Transaction client type, usable inside prisma.$transaction(async (tx) => ...). */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
