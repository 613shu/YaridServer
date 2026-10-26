import { Prisma } from "../generated/prisma/client";
import type { Tx } from "../db/prisma";

export type SqlType = "int" | "float" | "text" | "jsonb" | "bool" | "timestamptz";

/**
 * Builds a parameterised VALUES list where every placeholder is cast to its column type,
 * e.g. ( $1::int, $2::float ), ( $3::int, $4::float ).
 */
export function valuesList(types: SqlType[], rows: unknown[][]): Prisma.Sql {
  return Prisma.join(
    rows.map(
      (row) =>
        Prisma.sql`(${Prisma.join(
          row.map((value, i) => Prisma.sql`${value}::${Prisma.raw(types[i] ?? "text")}`),
          ", ",
        )})`,
    ),
    ", ",
  );
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs fn for each chunk of rows (keeps every query well under PostgreSQL's parameter limit). */
export async function forEachChunk<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>): Promise<void> {
  for (const part of chunk(rows, size)) {
    if (part.length > 0) await fn(part);
  }
}

export type { Tx };
