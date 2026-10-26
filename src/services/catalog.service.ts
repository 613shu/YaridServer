import type { z } from "zod";
import { prisma } from "../db/prisma";
import { Errors } from "../errors/AppError";
import { Prisma } from "../generated/prisma/client";
import { insensitive } from "../utils/http";
import type { CategoryBody, CategoryPatch, ProductBody, ProductPatch, ProductQuery } from "../validation/schemas";

function uniqueNameConflict(err: unknown, what: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw Errors.conflict("CONFLICT", `A ${what} with this name already exists`);
  }
  throw err;
}

// ------------------------------------------------------------- categories

export async function listCategories() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });
  return categories.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
}

export async function createCategory(input: z.infer<typeof CategoryBody>) {
  try {
    return await prisma.category.create({ data: { name: input.name, description: input.description ?? null } });
  } catch (err) {
    uniqueNameConflict(err, "category");
  }
}

export async function updateCategory(id: number, input: z.infer<typeof CategoryPatch>) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw Errors.notFound("Category");
  try {
    return await prisma.category.update({ where: { id }, data: input });
  } catch (err) {
    uniqueNameConflict(err, "category");
  }
}

// --------------------------------------------------------------- products

const productInclude = { category: { select: { id: true, name: true } } } as const;

export async function listProducts(query: z.infer<typeof ProductQuery>, isAdmin: boolean) {
  const where: Prisma.ProductWhereInput = {};
  if (query.search) where.name = insensitive(query.search);
  if (query.categoryId) where.categoryId = query.categoryId;
  if (!(isAdmin && query.includeInactive === "true")) where.isActive = true;

  const orderBy: Prisma.ProductOrderByWithRelationInput =
    query.sort === "price"
      ? { marketPrice: query.order ?? "asc" }
      : query.sort === "popularity"
        ? { popularity: query.order ?? "desc" }
        : { name: query.order ?? "asc" };

  return prisma.product.findMany({ where, orderBy: [orderBy, { id: "asc" }], include: productInclude });
}

async function assertCategory(categoryId: number) {
  const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!category) throw Errors.validation("Category does not exist", [{ path: "categoryId", message: "Category not found" }]);
}

export async function createProduct(input: z.infer<typeof ProductBody>) {
  await assertCategory(input.categoryId);
  try {
    return await prisma.product.create({ data: input, include: productInclude });
  } catch (err) {
    uniqueNameConflict(err, "product");
  }
}

export async function updateProduct(id: number, input: z.infer<typeof ProductPatch>) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw Errors.notFound("Product");
  if (input.categoryId) await assertCategory(input.categoryId);
  const supplierPrice = input.supplierPrice ?? existing.supplierPrice;
  const marketPrice = input.marketPrice ?? existing.marketPrice;
  if (marketPrice <= supplierPrice) {
    throw Errors.validation("marketPrice must be greater than supplierPrice", [
      { path: "marketPrice", message: "marketPrice must be greater than supplierPrice" },
    ]);
  }
  try {
    return await prisma.product.update({ where: { id }, data: input, include: productInclude });
  } catch (err) {
    uniqueNameConflict(err, "product");
  }
}

// ------------------------------------------------------------ decorations

export function listDecorations() {
  return prisma.decoration.findMany({ orderBy: [{ cost: "asc" }, { id: "asc" }] });
}
