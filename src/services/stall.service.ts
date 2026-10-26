import type { z } from "zod";
import { prisma, type Tx } from "../db/prisma";
import { Errors } from "../errors/AppError";
import { Prisma } from "../generated/prisma/client";
import { closeRefund, RULES, sellQuote } from "../game/rules";
import { getGameState } from "../simulation/clock";
import { insensitive } from "../utils/http";
import type { MyStallsQuery, StallCreateBody, StallPatchBody } from "../validation/schemas";
import { changeBalance } from "./ledger.service";

export const stallInclude = {
  product: { include: { category: { select: { id: true, name: true } } } },
  decorations: { include: { decoration: true }, orderBy: { addedAt: "asc" } },
} as const;

type StallWithRelations = Prisma.StallGetPayload<{ include: typeof stallInclude }>;

/** Serialises a stall. The score is only included for the admin. */
export function toStallView(stall: StallWithRelations, opts: { includeScore: boolean; currentDay: number }) {
  const decorationPoints = stall.decorations.reduce((sum, d) => sum + d.decoration.points, 0);
  return {
    id: stall.id,
    merchantId: stall.merchantId,
    name: stall.name,
    slotNumber: stall.slotNumber,
    status: stall.status,
    suspensionReason: stall.suspensionReason,
    price: stall.price,
    stock: stall.stock,
    product: {
      id: stall.product.id,
      name: stall.product.name,
      supplierPrice: stall.product.supplierPrice,
      marketPrice: stall.product.marketPrice,
      popularity: stall.product.popularity,
      isActive: stall.product.isActive,
      category: stall.product.category,
    },
    decorations: stall.decorations.map((d) => ({
      id: d.decoration.id,
      name: d.decoration.name,
      points: d.decoration.points,
      cost: d.decoration.cost,
      addedAt: d.addedAt,
    })),
    decorationPoints,
    decorationSpent: stall.decorationSpent,
    createdGameDay: stall.createdGameDay,
    ageInGameDays: opts.currentDay - stall.createdGameDay,
    createdAt: stall.createdAt,
    updatedAt: stall.updatedAt,
    ...(opts.includeScore ? { score: stall.score } : {}),
  };
}

/** Serialises all money actions of one merchant (prevents double spending). */
async function lockMerchant(tx: Tx, merchantId: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(1, ${merchantId}::int)`;
}

async function getOwnStall(tx: Tx | typeof prisma, stallId: number, merchantId: number) {
  const stall = await tx.stall.findUnique({ where: { id: stallId }, include: stallInclude });
  if (!stall) throw Errors.notFound("Stall");
  if (stall.merchantId !== merchantId) throw Errors.forbidden("This stall belongs to another merchant");
  return stall;
}

async function getActiveProduct(tx: Tx, productId: number) {
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) throw Errors.validation("Product does not exist", [{ path: "productId", message: "Product not found" }]);
  if (!product.isActive) throw Errors.conflict("PRODUCT_INACTIVE", "This product is no longer sold by suppliers");
  return product;
}

/** Smallest free slot number on the fair map. */
async function nextFreeSlot(tx: Tx): Promise<number> {
  const [row] = await tx.$queryRaw<{ slot: number }[]>`
    SELECT COALESCE(
      (SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM "Stall" WHERE "slotNumber" = 1)),
      (SELECT MIN(s."slotNumber") + 1 FROM "Stall" s
        WHERE NOT EXISTS (SELECT 1 FROM "Stall" s2 WHERE s2."slotNumber" = s."slotNumber" + 1))
    )::int AS slot`;
  return row?.slot ?? 1;
}

async function viewOpts() {
  const state = await getGameState(prisma);
  return { currentDay: state.currentDay };
}

// ----------------------------------------------------------------- create

export async function createStall(merchantId: number, input: z.infer<typeof StallCreateBody>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const stallId = await prisma.$transaction(async (tx) => {
        await lockMerchant(tx, merchantId);
        await getActiveProduct(tx, input.productId);

        const count = await tx.stall.count({ where: { merchantId } });
        if (count >= RULES.MAX_STALLS_PER_MERCHANT) {
          throw Errors.conflict("STALL_LIMIT_REACHED", `You can have at most ${RULES.MAX_STALLS_PER_MERCHANT} stalls`);
        }

        const state = await getGameState(tx);
        const stall = await tx.stall.create({
          data: {
            merchantId,
            productId: input.productId,
            name: input.name,
            price: input.price,
            slotNumber: await nextFreeSlot(tx),
            createdGameDay: state.currentDay,
          },
        });
        await changeBalance(tx, {
          merchantId,
          amount: -RULES.STALL_PRICE,
          type: "STALL_PURCHASE",
          stallId: stall.id,
          description: `קניית דוכן: ${stall.name}`,
        });
        return stall.id;
      });
      return getStallForOwner(stallId, merchantId);
    } catch (err) {
      // Two stalls got the same slot at the same moment — try again with the next free one
      const isSlotClash =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        JSON.stringify(err.meta ?? {}).includes("slotNumber");
      if (!isSlotClash) throw err;
    }
  }
  throw Errors.conflict("CONFLICT", "The fair is busy, please try again");
}

// ------------------------------------------------------------------- read

export async function getStallForOwner(stallId: number, merchantId: number) {
  const stall = await getOwnStall(prisma, stallId, merchantId);
  return toStallView(stall, { ...(await viewOpts()), includeScore: false });
}

export async function getStallForAdmin(stallId: number) {
  const stall = await prisma.stall.findUnique({
    where: { id: stallId },
    include: { ...stallInclude, merchant: { select: { id: true, displayName: true, email: true, status: true } } },
  });
  if (!stall) throw Errors.notFound("Stall");
  return { ...toStallView(stall, { ...(await viewOpts()), includeScore: true }), merchant: stall.merchant };
}

/** Sales totals per stall (detailed rows + archived summaries). */
export async function salesSummaryByStall(stallIds: number[], currentDay: number) {
  const result = new Map<number, { todayUnits: number; todayRevenue: number; totalUnits: number; totalRevenue: number }>();
  if (stallIds.length === 0) return result;
  const rows = await prisma.$queryRaw<{ stallId: number; todayUnits: number; todayRevenue: number; totalUnits: number; totalRevenue: number }[]>`
    SELECT "stallId",
      SUM(CASE WHEN day = ${currentDay}::int THEN units ELSE 0 END)::int AS "todayUnits",
      SUM(CASE WHEN day = ${currentDay}::int THEN revenue ELSE 0 END)::int AS "todayRevenue",
      SUM(units)::int AS "totalUnits",
      SUM(revenue)::int AS "totalRevenue"
    FROM (
      SELECT "stallId", "gameDay" AS day, SUM(quantity) AS units, SUM("unitPrice" * quantity) AS revenue
        FROM "Sale" WHERE "stallId" IN (${Prisma.join(stallIds)}) GROUP BY "stallId", "gameDay"
      UNION ALL
      SELECT "stallId", "gameDay" AS day, SUM(quantity), SUM(revenue)
        FROM "SalesDailySummary" WHERE "stallId" IN (${Prisma.join(stallIds)}) GROUP BY "stallId", "gameDay"
    ) t GROUP BY "stallId"`;
  for (const { stallId, ...totals } of rows) result.set(stallId, totals);
  return result;
}

export async function listMyStalls(merchantId: number, query: z.infer<typeof MyStallsQuery>) {
  const where: Prisma.StallWhereInput = { merchantId };
  if (query.status) where.status = query.status;
  if (query.categoryId) where.product = { categoryId: query.categoryId };
  if (query.search) where.OR = [{ name: insensitive(query.search) }, { product: { name: insensitive(query.search) } }];

  const dir = query.order ?? (query.sort === "revenue" || query.sort === "createdAt" ? "desc" : "asc");
  const orderBy: Prisma.StallOrderByWithRelationInput =
    query.sort === "name"
      ? { name: dir }
      : query.sort === "price"
        ? { price: dir }
        : query.sort === "stock"
          ? { stock: dir }
          : query.sort === "createdAt"
            ? { createdAt: dir }
            : { slotNumber: dir };

  const opts = await viewOpts();
  const stalls = await prisma.stall.findMany({ where, orderBy: [orderBy, { id: "asc" }], include: stallInclude });
  const sales = await salesSummaryByStall(stalls.map((s) => s.id), opts.currentDay);
  const items = stalls.map((s) => ({
    ...toStallView(s, { ...opts, includeScore: false }),
    sales: sales.get(s.id) ?? { todayUnits: 0, todayRevenue: 0, totalUnits: 0, totalRevenue: 0 },
  }));
  if (query.sort === "revenue") {
    items.sort((a, b) => (dir === "asc" ? 1 : -1) * (a.sales.totalRevenue - b.sales.totalRevenue));
  }
  return items;
}

// ----------------------------------------------------------------- update

export async function updateStall(stallId: number, merchantId: number, input: z.infer<typeof StallPatchBody>) {
  await prisma.$transaction(async (tx) => {
    const stall = await getOwnStall(tx, stallId, merchantId);
    if (input.productId !== undefined && input.productId !== stall.productId) {
      if (stall.stock > 0) throw Errors.conflict("STOCK_NOT_EMPTY", "You can change the product only when the stock is 0");
      await getActiveProduct(tx, input.productId);
    }
    // Conditional on stock = 0 when the product changes (protects against a stock purchase at the same moment)
    const updated = await tx.stall.updateMany({
      where: { id: stallId, ...(input.productId !== undefined && input.productId !== stall.productId ? { stock: 0 } : {}) },
      data: input,
    });
    if (updated.count === 0) throw Errors.conflict("STOCK_NOT_EMPTY", "You can change the product only when the stock is 0");
  });
  return getStallForOwner(stallId, merchantId);
}

// ------------------------------------------------------------------ stock

export async function buyStock(stallId: number, merchantId: number, quantity: number) {
  const result = await prisma.$transaction(async (tx) => {
    await lockMerchant(tx, merchantId);
    const stall = await getOwnStall(tx, stallId, merchantId);
    if (!stall.product.isActive) throw Errors.conflict("PRODUCT_INACTIVE", "This product is no longer sold by suppliers");
    const cost = quantity * stall.product.supplierPrice;
    const balance = await changeBalance(tx, {
      merchantId,
      amount: -cost,
      type: "STOCK_PURCHASE",
      stallId,
      description: `קניית מלאי: ${quantity} × ${stall.product.name} (${stall.product.supplierPrice} ליחידה)`,
    });
    await tx.stall.update({ where: { id: stallId }, data: { stock: { increment: quantity } } });
    return { cost, balance };
  });
  return { ...result, stall: await getStallForOwner(stallId, merchantId) };
}

// ------------------------------------------------------------ decorations

export async function addDecoration(stallId: number, merchantId: number, decorationId: number) {
  const result = await prisma.$transaction(async (tx) => {
    await lockMerchant(tx, merchantId);
    const stall = await getOwnStall(tx, stallId, merchantId);
    const decoration = await tx.decoration.findUnique({ where: { id: decorationId } });
    if (!decoration) throw Errors.validation("Decoration does not exist", [{ path: "decorationId", message: "Decoration not found" }]);
    if (stall.decorations.some((d) => d.decorationId === decorationId)) {
      throw Errors.conflict("DECORATION_EXISTS", "This decoration was already added to this stall");
    }
    const balance = await changeBalance(tx, {
      merchantId,
      amount: -decoration.cost,
      type: "DECORATION",
      stallId,
      description: `קישוט "${decoration.name}" לדוכן ${stall.name}`,
    });
    await tx.stallDecoration.create({ data: { stallId, decorationId } });
    await tx.stall.update({ where: { id: stallId }, data: { decorationSpent: { increment: decoration.cost } } });
    return { cost: decoration.cost, balance };
  });
  return { ...result, stall: await getStallForOwner(stallId, merchantId) };
}

// ------------------------------------------------------- sell and close

export async function getSaleQuote(stallId: number, merchantId: number) {
  const stall = await getOwnStall(prisma, stallId, merchantId);
  const { currentDay } = await viewOpts();
  return buildQuote(stall, currentDay);
}

function buildQuote(stall: StallWithRelations, currentDay: number) {
  const ageInGameDays = currentDay - stall.createdGameDay;
  const quote = sellQuote({
    decorationSpent: stall.decorationSpent,
    score: stall.score,
    stock: stall.stock,
    supplierPrice: stall.product.supplierPrice,
  });
  return {
    stallId: stall.id,
    ageInGameDays,
    minAgeInGameDays: RULES.SELL_MIN_AGE_DAYS,
    canSell: ageInGameDays >= RULES.SELL_MIN_AGE_DAYS,
    availableFromDay: stall.createdGameDay + RULES.SELL_MIN_AGE_DAYS,
    stallValue: quote.stallValue,
    stockUnits: stall.stock,
    stockValue: quote.stockValue,
    total: quote.total,
  };
}

export async function sellStall(stallId: number, merchantId: number) {
  return prisma.$transaction(async (tx) => {
    await lockMerchant(tx, merchantId);
    const stall = await getOwnStall(tx, stallId, merchantId);
    const state = await getGameState(tx);
    const quote = buildQuote(stall, state.currentDay);
    if (!quote.canSell) {
      throw Errors.conflict(
        "STALL_TOO_NEW",
        `A stall can be sold only after ${RULES.SELL_MIN_AGE_DAYS} game days (from day ${quote.availableFromDay})`,
      );
    }
    const balance = await changeBalance(tx, {
      merchantId,
      amount: quote.total,
      type: "STALL_SOLD",
      stallId,
      description: `מכירת הדוכן "${stall.name}" לראש הקהל (דוכן ${quote.stallValue} + מלאי ${quote.stockValue})`,
    });
    await tx.stall.delete({ where: { id: stallId } });
    return { ...quote, balance };
  });
}

export async function closeStall(stallId: number, merchantId: number) {
  return prisma.$transaction(async (tx) => {
    await lockMerchant(tx, merchantId);
    const stall = await getOwnStall(tx, stallId, merchantId);
    const refund = closeRefund(stall.stock, stall.product.supplierPrice);
    let balance: number;
    if (refund > 0) {
      balance = await changeBalance(tx, {
        merchantId,
        amount: refund,
        type: "STALL_CLOSED_REFUND",
        stallId,
        description: `סגירת הדוכן "${stall.name}": החזר 50% משווי ${stall.stock} יחידות מלאי`,
      });
    } else {
      balance = (await tx.user.findUniqueOrThrow({ where: { id: merchantId }, select: { balance: true } })).balance;
    }
    await tx.stall.delete({ where: { id: stallId } });
    return { stallId, refund, balance };
  });
}
