/**
 * OpenAPI 3 document for Swagger UI (/api-docs) and /openapi.json.
 * Request bodies and query parameters are generated from the same Zod schemas
 * the server uses for validation, so the docs never drift from the real rules.
 */
import { z } from "zod";
import * as S from "../validation/schemas";

type Json = Record<string, unknown>;

function jsonSchema(schema: z.ZodType): Json {
  const out = z.toJSONSchema(schema, { target: "openapi-3.0", io: "input", unrepresentable: "any" }) as Json;
  delete out.$schema;
  return out;
}

function queryParams(schema: z.ZodType): Json[] {
  const js = jsonSchema(schema) as { properties?: Record<string, Json>; required?: string[] };
  return Object.entries(js.properties ?? {}).map(([name, prop]) => ({
    name,
    in: "query",
    required: false,
    schema: prop,
  }));
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (name: string) => ({ type: "array", items: ref(name) });
const pageOf = (name: string) => ({
  type: "object",
  properties: {
    items: arrayOf(name),
    page: { type: "integer" },
    pageSize: { type: "integer" },
    total: { type: "integer" },
    totalPages: { type: "integer" },
  },
});

const idParam = { name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } };

const errorResponses: Record<number, string> = {
  400: "Validation error",
  401: "Missing or invalid token",
  403: "Forbidden (wrong role or not your resource)",
  404: "Not found",
  409: "Conflict",
  422: "Insufficient funds",
};

interface OpSpec {
  tag: string;
  summary: string;
  description?: string;
  auth?: "any" | "merchant" | "admin" | "owner-or-admin" | false;
  body?: z.ZodType;
  query?: z.ZodType;
  pathId?: boolean;
  response?: Json;
  status?: number;
  errors?: number[];
}

function op(spec: OpSpec): Json {
  const status = spec.status ?? 200;
  const authLabel =
    spec.auth === "merchant" ? "🔒 Merchant only" : spec.auth === "admin" ? "🔒 Admin only" : spec.auth === "owner-or-admin" ? "🔒 Owner or admin" : spec.auth === "any" ? "🔒 Any logged-in user" : "Public";
  const errors = new Set(spec.errors ?? []);
  if (spec.auth) {
    errors.add(401);
    if (spec.auth !== "any") errors.add(403);
  }
  if (spec.body || spec.query || spec.pathId) errors.add(400);
  if (spec.pathId) errors.add(404);

  const responses: Json = {
    [status]: { description: "Success", content: { "application/json": { schema: spec.response ?? { type: "object" } } } },
  };
  for (const code of [...errors].sort()) {
    responses[code] = { description: errorResponses[code] ?? "Error", content: { "application/json": { schema: ref("Error") } } };
  }

  return {
    tags: [spec.tag],
    summary: spec.summary,
    description: [authLabel, spec.description].filter(Boolean).join("\n\n"),
    ...(spec.auth ? { security: [{ bearerAuth: [] }] } : { security: [] }),
    parameters: [...(spec.pathId ? [idParam] : []), ...(spec.query ? queryParams(spec.query) : [])],
    ...(spec.body
      ? { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(spec.body) } } } }
      : {}),
    responses,
  };
}

// ------------------------------------------------------------ components

const schemas: Record<string, Json> = {
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string", example: "VALIDATION_ERROR" },
          message: { type: "string" },
          details: {},
        },
      },
    },
  },
  User: {
    type: "object",
    properties: {
      id: { type: "integer" },
      email: { type: "string", format: "email" },
      displayName: { type: "string" },
      role: { type: "string", enum: ["MERCHANT", "ADMIN"] },
      balance: { type: "integer", description: "Rubles (may be negative after stall fees)" },
      status: { type: "string", enum: ["BEGINNER", "EXPERIENCED", "GVIR"] },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  AuthResponse: { type: "object", properties: { token: { type: "string" }, user: ref("User") } },
  Clock: {
    type: "object",
    properties: {
      day: { type: "integer" },
      hour: { type: "integer", minimum: 0, maximum: 23 },
      lastTickAt: { type: "string", format: "date-time" },
      nextTickAt: { type: "string", format: "date-time" },
      msPerGameHour: { type: "integer", example: 150000 },
      msPerGameDay: { type: "integer", example: 3600000 },
    },
  },
  Category: {
    type: "object",
    properties: { id: { type: "integer" }, name: { type: "string" }, description: { type: "string", nullable: true }, productCount: { type: "integer" } },
  },
  Product: {
    type: "object",
    properties: {
      id: { type: "integer" },
      name: { type: "string" },
      categoryId: { type: "integer" },
      category: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } },
      supplierPrice: { type: "integer" },
      marketPrice: { type: "integer" },
      popularity: { type: "integer", minimum: 1, maximum: 100 },
      targetGender: { type: "string", enum: ["ANY", "MALE", "FEMALE"] },
      targetAge: { type: "string", enum: ["ANY", "YOUNG", "OLD"] },
      isActive: { type: "boolean" },
    },
  },
  Decoration: {
    type: "object",
    properties: { id: { type: "integer" }, name: { type: "string" }, cost: { type: "integer" }, points: { type: "integer" } },
  },
  Stall: {
    type: "object",
    description: "`score` appears only for the admin.",
    properties: {
      id: { type: "integer" },
      merchantId: { type: "integer" },
      name: { type: "string" },
      slotNumber: { type: "integer" },
      status: { type: "string", enum: ["ACTIVE", "SUSPENDED"] },
      suspensionReason: { type: "string", nullable: true },
      price: { type: "integer" },
      stock: { type: "integer" },
      product: ref("Product"),
      decorations: { type: "array", items: { type: "object" } },
      decorationPoints: { type: "integer" },
      decorationSpent: { type: "integer" },
      createdGameDay: { type: "integer" },
      ageInGameDays: { type: "integer" },
      score: { type: "number", description: "Admin only" },
      sales: {
        type: "object",
        description: "Only in /stalls/mine",
        properties: {
          todayUnits: { type: "integer" },
          todayRevenue: { type: "integer" },
          totalUnits: { type: "integer" },
          totalRevenue: { type: "integer" },
        },
      },
    },
  },
  FairStall: {
    type: "object",
    properties: {
      id: { type: "integer" },
      slotNumber: { type: "integer" },
      name: { type: "string" },
      merchant: { type: "object", properties: { id: { type: "integer" }, displayName: { type: "string" } } },
      isMine: { type: "boolean" },
      product: { type: "object" },
      price: { type: "integer" },
      inStock: { type: "boolean" },
      status: { type: "string", enum: ["ACTIVE", "SUSPENDED"] },
      decorations: { type: "array", items: { type: "object" } },
    },
  },
  Fair: { type: "object", properties: { clock: ref("Clock"), stalls: arrayOf("FairStall") } },
  FairCustomers: {
    type: "object",
    properties: {
      clock: ref("Clock"),
      customers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            nickname: { type: "string" },
            gender: { type: "string", enum: ["MALE", "FEMALE"] },
            ageGroup: { type: "string", enum: ["YOUNG", "OLD"] },
            targetStallId: { type: "integer", nullable: true },
            targetStallIds: { type: "array", items: { type: "integer" } },
            purchases: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  },
  SaleQuote: {
    type: "object",
    properties: {
      stallId: { type: "integer" },
      ageInGameDays: { type: "integer" },
      minAgeInGameDays: { type: "integer" },
      canSell: { type: "boolean" },
      availableFromDay: { type: "integer" },
      stallValue: { type: "integer" },
      stockUnits: { type: "integer" },
      stockValue: { type: "integer" },
      total: { type: "integer" },
    },
  },
  MoneyResult: {
    type: "object",
    properties: { cost: { type: "integer" }, balance: { type: "integer" }, stall: ref("Stall") },
  },
  Sale: {
    type: "object",
    properties: {
      id: { type: "integer" },
      gameDay: { type: "integer" },
      gameHour: { type: "integer" },
      unitPrice: { type: "integer" },
      quantity: { type: "integer" },
      customerGender: { type: "string" },
      customerAge: { type: "string" },
      product: { type: "object" },
      stall: { type: "object", nullable: true },
    },
  },
  Transaction: {
    type: "object",
    properties: {
      id: { type: "integer" },
      merchantId: { type: "integer" },
      type: {
        type: "string",
        enum: ["OPENING_GRANT", "STALL_PURCHASE", "STOCK_PURCHASE", "DECORATION", "STALL_FEE", "SALE_INCOME", "LOAN_TAKEN", "LOAN_REPAYMENT", "ADMIN_GRANT", "STALL_SOLD", "STALL_CLOSED_REFUND"],
      },
      amount: { type: "integer", description: "Positive = money in, negative = money out" },
      balanceAfter: { type: "integer" },
      description: { type: "string", nullable: true },
      stallId: { type: "integer", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  Loan: {
    type: "object",
    properties: {
      id: { type: "integer" },
      amount: { type: "integer" },
      remaining: { type: "integer" },
      status: { type: "string", enum: ["OPEN", "REPAID"] },
      createdAt: { type: "string", format: "date-time" },
      repaidAt: { type: "string", format: "date-time", nullable: true },
    },
  },
  Notification: {
    type: "object",
    properties: {
      id: { type: "integer" },
      type: { type: "string", enum: ["SUSPENSION", "UNSUSPENSION", "GRANT"] },
      message: { type: "string" },
      isRead: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
    },
  },
};

// ----------------------------------------------------------------- paths

const paths: Record<string, Record<string, Json>> = {
  "/api/health": { get: op({ tag: "System", summary: "Health check (use for keep-alive pings)", auth: false }) },

  "/api/auth/register": {
    post: op({
      tag: "Auth",
      summary: "Register a new merchant",
      description: "Gift: 1,000 rubles. Every stall costs 300.",
      auth: false,
      body: S.RegisterBody,
      status: 201,
      response: ref("AuthResponse"),
      errors: [409],
    }),
  },
  "/api/auth/login": {
    post: op({ tag: "Auth", summary: "Log in", auth: false, body: S.LoginBody, response: ref("AuthResponse"), errors: [401] }),
  },
  "/api/auth/me": { get: op({ tag: "Auth", summary: "Current user", auth: "any", response: ref("User") }) },

  "/api/categories": {
    get: op({ tag: "Catalog", summary: "List categories", auth: "any", response: arrayOf("Category") }),
    post: op({ tag: "Catalog", summary: "Create category", auth: "admin", body: S.CategoryBody, status: 201, response: ref("Category"), errors: [409] }),
  },
  "/api/categories/{id}": {
    patch: op({ tag: "Catalog", summary: "Update category", auth: "admin", pathId: true, body: S.CategoryPatch, response: ref("Category"), errors: [409] }),
  },
  "/api/products": {
    get: op({
      tag: "Catalog",
      summary: "List / search / filter / sort products",
      description: "Merchants see active products only. Admin can pass includeInactive=true.",
      auth: "any",
      query: S.ProductQuery,
      response: arrayOf("Product"),
    }),
    post: op({ tag: "Catalog", summary: "Create product", auth: "admin", body: S.ProductBody, status: 201, response: ref("Product"), errors: [409] }),
  },
  "/api/products/{id}": {
    patch: op({ tag: "Catalog", summary: "Update product", auth: "admin", pathId: true, body: S.ProductPatch, response: ref("Product"), errors: [409] }),
  },
  "/api/decorations": { get: op({ tag: "Catalog", summary: "List decorations", auth: "any", response: arrayOf("Decoration") }) },

  "/api/fair": { get: op({ tag: "Fair", summary: "All stalls (public info) + game clock", auth: "any", response: ref("Fair") }) },
  "/api/fair/customers": {
    get: op({ tag: "Fair", summary: "Customers visiting this game hour that I see: 15 per own active stall, min 5, max 80", auth: "any", response: ref("FairCustomers") }),
  },

  "/api/stalls/mine": {
    get: op({ tag: "Stalls", summary: "My stalls with sales summary (no score)", auth: "merchant", query: S.MyStallsQuery, response: arrayOf("Stall") }),
  },
  "/api/stalls": {
    post: op({
      tag: "Stalls",
      summary: "Open a stall (first one free, then 300)",
      auth: "merchant",
      body: S.StallCreateBody,
      status: 201,
      response: ref("Stall"),
      errors: [409, 422],
    }),
  },
  "/api/stalls/{id}": {
    get: op({ tag: "Stalls", summary: "Stall details", auth: "owner-or-admin", pathId: true, response: ref("Stall") }),
    patch: op({
      tag: "Stalls",
      summary: "Update name / price (product only when stock = 0)",
      auth: "merchant",
      pathId: true,
      body: S.StallPatchBody,
      response: ref("Stall"),
      errors: [409],
    }),
    delete: op({
      tag: "Stalls",
      summary: "Close stall (refund 50% of stock value)",
      auth: "merchant",
      pathId: true,
      response: { type: "object", properties: { stallId: { type: "integer" }, refund: { type: "integer" }, balance: { type: "integer" } } },
    }),
  },
  "/api/stalls/{id}/stock": {
    post: op({ tag: "Stalls", summary: "Buy stock at supplier price", auth: "merchant", pathId: true, body: S.StockBody, response: ref("MoneyResult"), errors: [409, 422] }),
  },
  "/api/stalls/{id}/decorations": {
    post: op({ tag: "Stalls", summary: "Add a decoration (once per stall)", auth: "merchant", pathId: true, body: S.DecorationBody, status: 201, response: ref("MoneyResult"), errors: [409, 422] }),
  },
  "/api/stalls/{id}/sale-quote": {
    get: op({ tag: "Stalls", summary: "Quote for selling the stall to the admin", auth: "merchant", pathId: true, response: ref("SaleQuote") }),
  },
  "/api/stalls/{id}/sell": {
    post: op({ tag: "Stalls", summary: "Sell stall to the admin (after 3 game days)", auth: "merchant", pathId: true, response: ref("SaleQuote"), errors: [409] }),
  },

  "/api/me/summary": { get: op({ tag: "Me", summary: "Balance, status, income, expenses, loan, net worth", auth: "merchant" }) },
  "/api/me/sales": { get: op({ tag: "Me", summary: "My sales (paginated)", auth: "merchant", query: S.MySalesQuery, response: pageOf("Sale") }) },
  "/api/me/sales/by-product": { get: op({ tag: "Me", summary: "Per-product breakdown incl. gender and age", auth: "merchant" }) },
  "/api/me/transactions": {
    get: op({ tag: "Me", summary: "My ledger (paginated)", auth: "merchant", query: S.MyTransactionsQuery, response: pageOf("Transaction") }),
  },
  "/api/me/loan": {
    get: op({ tag: "Me", summary: "Open loan and max amount", auth: "merchant" }),
    post: op({ tag: "Me", summary: "Take an interest-free loan", auth: "merchant", body: S.LoanBody, status: 201, errors: [409] }),
  },
  "/api/me/notifications": { get: op({ tag: "Me", summary: "Messages from the admin", auth: "merchant" }) },
  "/api/me/notifications/{id}/read": {
    patch: op({ tag: "Me", summary: "Mark a notification as read", auth: "merchant", pathId: true, response: ref("Notification") }),
  },

  "/api/admin/stats": { get: op({ tag: "Admin", summary: "Dashboard totals + chart data", auth: "admin" }) },
  "/api/admin/merchants": { get: op({ tag: "Admin", summary: "All merchants", auth: "admin", query: S.AdminMerchantsQuery, response: pageOf("User") }) },
  "/api/admin/merchants/{id}": { get: op({ tag: "Admin", summary: "Merchant details", auth: "admin", pathId: true }) },
  "/api/admin/merchants/{id}/grants": {
    post: op({ tag: "Admin", summary: "Give a merchant a grant (sends a notification)", auth: "admin", pathId: true, body: S.GrantBody, status: 201 }),
  },
  "/api/admin/stalls": { get: op({ tag: "Admin", summary: "All stalls incl. score", auth: "admin", query: S.AdminStallsQuery, response: pageOf("Stall") }) },
  "/api/admin/stalls/{id}/suspend": {
    post: op({ tag: "Admin", summary: "Suspend a stall (notifies the owner)", auth: "admin", pathId: true, body: S.SuspendBody, response: ref("Stall") }),
  },
  "/api/admin/stalls/{id}/unsuspend": {
    post: op({ tag: "Admin", summary: "Unsuspend a stall (notifies the owner)", auth: "admin", pathId: true, response: ref("Stall") }),
  },
  "/api/admin/sales": { get: op({ tag: "Admin", summary: "All sales", auth: "admin", query: S.AdminSalesQuery, response: pageOf("Sale") }) },
  "/api/admin/transactions": {
    get: op({ tag: "Admin", summary: "All payments", auth: "admin", query: S.AdminTransactionsQuery, response: pageOf("Transaction") }),
  },
};

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "The Great Fair (HaYarid HaGadol) API",
    version: "1.0.0",
    description:
      "Backend for a fair simulation game. 1 game day = 1 real hour.\n\n" +
      "**How to try it:** call POST /api/auth/login (or register), copy the `token`, click **Authorize** and paste it.\n\n" +
      "All money values are integer rubles. Errors look like `{ \"error\": { \"code\": \"...\", \"message\": \"...\" } }`.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "System" },
    { name: "Auth" },
    { name: "Catalog" },
    { name: "Fair" },
    { name: "Stalls" },
    { name: "Me" },
    { name: "Admin" },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas,
  },
  paths,
};
