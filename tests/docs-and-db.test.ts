import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { openApiDocument } from "../src/docs/openapi";
import { api } from "./helpers";

const root = join(__dirname, "..");

describe("Swagger / OpenAPI", () => {
  it("is a valid OpenAPI 3 document", async () => {
    const doc = structuredClone(openApiDocument);
    await expect(SwaggerParser.validate(doc as never)).resolves.toBeTruthy();
    expect(openApiDocument.openapi).toMatch(/^3\./);
    expect(openApiDocument.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("documents every route of the server", () => {
    const routesFile = readFileSync(join(root, "src/routes/index.ts"), "utf8");
    const routes = [...routesFile.matchAll(/r\.(get|post|patch|delete)\("([^"]+)"/g)].map(
      ([, method, path]) => `${method} /api${path!.replace(/:(\w+)/g, "{$1}")}`,
    );
    expect(routes.length).toBeGreaterThanOrEqual(39); // every endpoint of the spec
    const documented = Object.entries(openApiDocument.paths).flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m} ${path}`));
    expect(documented.sort()).toEqual(routes.sort());
  });

  it("serves Swagger UI and openapi.json", async () => {
    const ui = await api().get("/api-docs/");
    expect(ui.status).toBe(200);
    expect(ui.text).toContain("swagger");
    const json = await api().get("/openapi.json");
    expect(json.status).toBe(200);
    expect(json.body.info.title).toContain("Great Fair");
  });

  it("the exported openapi.json file is up to date", () => {
    const file = JSON.parse(readFileSync(join(root, "openapi.json"), "utf8"));
    expect(file).toEqual(JSON.parse(JSON.stringify(openApiDocument)));
  });
});

describe("Prisma schema and migrations", () => {
  const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
  const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]!);

  it("has all tables from the specification", () => {
    expect(models.sort()).toEqual(
      ["Category", "Customer", "Decoration", "GameState", "Loan", "Notification", "Product", "Sale", "SalesDailySummary", "Stall", "StallDecoration", "Transaction", "User"].sort(),
    );
  });

  it("migrations create every table and the business-rule constraints", () => {
    const dir = join(root, "prisma/migrations");
    const sql = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => readFileSync(join(dir, d.name, "migration.sql"), "utf8"))
      .join("\n");
    for (const model of models) expect(sql).toContain(`CREATE TABLE "${model}"`);
    expect(sql).toContain("Loan_one_open_per_merchant");
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "Stall_hours_check"'); // stalls are always open
    expect(sql).toContain("Product_prices_check");
  });

  it("the database matches the Prisma client (every model can be queried)", async () => {
    const delegates = models.map((m) => m[0]!.toLowerCase() + m.slice(1)) as (keyof typeof prisma)[];
    for (const d of delegates) {
      const delegate = prisma[d] as unknown as { count: () => Promise<number> };
      await expect(delegate.count()).resolves.toBeTypeOf("number");
    }
  });

  it("the database enforces the rules too", async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "Category" (name) VALUES ('C-check')`)).resolves.toBe(1);
    const [cat] = await prisma.$queryRawUnsafe<{ id: number }[]>(`SELECT id FROM "Category" WHERE name = 'C-check'`);
    await expect(
      prisma.product.create({ data: { name: "Bad price", categoryId: cat!.id, supplierPrice: 10, marketPrice: 5, popularity: 5 } }),
    ).rejects.toThrow();
    await prisma.category.delete({ where: { id: cat!.id } });
  });
});
