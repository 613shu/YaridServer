import { z } from "zod";

const intId = z.coerce.number().int().positive();
const optionalIntId = z.coerce.number().int().positive().optional();
const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(20);
const search = z.string().trim().max(100).optional();
const order = z.enum(["asc", "desc"]).optional();
const gameDay = z.coerce.number().int().min(1).optional();

// ------------------------------------------------------------------- auth

export const RegisterBody = z.object({
  email: z.email("Invalid email").trim().toLowerCase().max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  displayName: z.string().trim().min(2, "Display name must be 2–30 characters").max(30, "Display name must be 2–30 characters"),
});

export const LoginBody = z.object({
  email: z.email("Invalid email").trim().toLowerCase(),
  password: z.string().min(1, "Password is required").max(72),
});

// ---------------------------------------------------------------- catalog

export const CategoryBody = z.object({
  name: z.string().trim().min(2).max(30),
  description: z.string().trim().max(300).optional().nullable(),
});
export const CategoryPatch = CategoryBody.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update");

const productFields = {
  name: z.string().trim().min(2).max(60),
  categoryId: intId,
  supplierPrice: z.number().int().positive(),
  marketPrice: z.number().int().positive(),
  popularity: z.number().int().min(1).max(100),
  targetGender: z.enum(["ANY", "MALE", "FEMALE"]).default("ANY"),
  targetAge: z.enum(["ANY", "YOUNG", "OLD"]).default("ANY"),
  isActive: z.boolean().default(true),
};

export const ProductBody = z
  .object(productFields)
  .refine((p) => p.marketPrice > p.supplierPrice, { message: "marketPrice must be greater than supplierPrice", path: ["marketPrice"] });

export const ProductPatch = z
  .object({
    name: productFields.name,
    categoryId: productFields.categoryId,
    supplierPrice: productFields.supplierPrice,
    marketPrice: productFields.marketPrice,
    popularity: productFields.popularity,
    targetGender: z.enum(["ANY", "MALE", "FEMALE"]),
    targetAge: z.enum(["ANY", "YOUNG", "OLD"]),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const ProductQuery = z.object({
  search,
  categoryId: optionalIntId,
  sort: z.enum(["name", "price", "popularity"]).default("name"),
  order,
  includeInactive: z.enum(["true", "false"]).optional(),
});

// ----------------------------------------------------------------- stalls

export const StallCreateBody = z.object({
  name: z.string().trim().min(2, "Name must be 2–40 characters").max(40, "Name must be 2–40 characters"),
  productId: intId,
  price: z.number().int().positive().max(1_000_000),
});

export const StallPatchBody = z
  .object({
    name: z.string().trim().min(2).max(40),
    productId: intId,
    price: z.number().int().positive().max(1_000_000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const StockBody = z.object({ quantity: z.number().int().min(1).max(10_000) });
export const DecorationBody = z.object({ decorationId: intId });

export const MyStallsQuery = z.object({
  search,
  categoryId: optionalIntId,
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  sort: z.enum(["name", "price", "stock", "slot", "createdAt", "revenue"]).default("slot"),
  order,
});

// --------------------------------------------------------------------- me

export const MySalesQuery = z.object({
  stallId: optionalIntId,
  productId: optionalIntId,
  fromDay: gameDay,
  toDay: gameDay,
  sort: z.enum(["newest", "oldest", "price"]).default("newest"),
  page,
  pageSize,
});

const transactionType = z.enum([
  "OPENING_GRANT",
  "STALL_PURCHASE",
  "STOCK_PURCHASE",
  "DECORATION",
  "STALL_FEE",
  "SALE_INCOME",
  "LOAN_TAKEN",
  "LOAN_REPAYMENT",
  "ADMIN_GRANT",
  "STALL_SOLD",
  "STALL_CLOSED_REFUND",
]);

export const MyTransactionsQuery = z.object({ type: transactionType.optional(), page, pageSize });
export const LoanBody = z.object({ amount: z.number().int().positive() });

// ------------------------------------------------------------------ admin

export const AdminMerchantsQuery = z.object({
  search,
  status: z.enum(["BEGINNER", "EXPERIENCED", "GVIR"]).optional(),
  sort: z.enum(["name", "balance", "createdAt", "stalls", "netWorth"]).default("createdAt"),
  order,
  page,
  pageSize,
});

export const GrantBody = z.object({
  amount: z.number().int().positive().max(1_000_000),
  message: z.string().trim().min(2).max(500),
});

export const AdminStallsQuery = z.object({
  search,
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  categoryId: optionalIntId,
  merchantId: optionalIntId,
  sort: z.enum(["score", "name", "price", "slot", "createdAt"]).default("score"),
  order,
  page,
  pageSize,
});

export const SuspendBody = z.object({ reason: z.string().trim().min(2).max(500) });

export const AdminSalesQuery = z.object({
  merchantId: optionalIntId,
  categoryId: optionalIntId,
  fromDay: gameDay,
  toDay: gameDay,
  page,
  pageSize,
});

export const AdminTransactionsQuery = z.object({
  merchantId: optionalIntId,
  type: transactionType.optional(),
  page,
  pageSize,
});
