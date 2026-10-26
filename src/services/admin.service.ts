import type { z } from "zod";
import { prisma } from "../db/prisma";
import { Errors } from "../errors/AppError";
import { Prisma } from "../generated/prisma/client";
import { getGameState, toClock } from "../simulation/clock";
import { insensitive, pageOf, paginate } from "../utils/http";
import type {
  AdminMerchantsQuery,
  AdminSalesQuery,
  AdminStallsQuery,
  AdminTransactionsQuery,
  GrantBody,
} from "../validation/schemas";
import { toPublicUser } from "./auth.service";
import { changeBalance } from "./ledger.service";
import { getStallForAdmin, stallInclude, toStallView } from "./stall.service";

// ------------------------------------------------------------------ stats

export async function getStats() {
  const state = await getGameState(prisma);
  const fromDay = Math.max(1, state.currentDay - 13);

  const [merchants, byStatus, stalls, suspended, customers, allTime, today, perDay, byCategory, topStalls] = await Promise.all([
    prisma.user.count({ where: { role: "MERCHANT" } }),
    prisma.user.groupBy({ by: ["status"], where: { role: "MERCHANT" }, _count: { _all: true } }),
    prisma.stall.count(),
    prisma.stall.count({ where: { status: "SUSPENDED" } }),
    prisma.customer.count({ where: { listDay: state.currentDay, NOT: { shoppingList: { equals: [] } } } }),
    prisma.$queryRaw<{ quantity: number; revenue: number }[]>`
      SELECT COALESCE(SUM(q), 0)::int AS quantity, COALESCE(SUM(r), 0)::int AS revenue FROM (
        SELECT SUM(quantity) AS q, SUM("unitPrice" * quantity) AS r FROM "Sale"
        UNION ALL SELECT SUM(quantity), SUM(revenue) FROM "SalesDailySummary") t`,
    prisma.sale.aggregate({ where: { gameDay: state.currentDay }, _sum: { quantity: true, unitPrice: true } }),
    prisma.$queryRaw<{ day: number; quantity: number; revenue: number }[]>`
      SELECT day, SUM(q)::int AS quantity, SUM(r)::int AS revenue FROM (
        SELECT "gameDay" AS day, SUM(quantity) AS q, SUM("unitPrice" * quantity) AS r FROM "Sale"
          WHERE "gameDay" >= ${fromDay}::int GROUP BY "gameDay"
        UNION ALL
        SELECT "gameDay", SUM(quantity), SUM(revenue) FROM "SalesDailySummary"
          WHERE "gameDay" >= ${fromDay}::int GROUP BY "gameDay") t
      GROUP BY day ORDER BY day`,
    prisma.$queryRaw<{ categoryId: number; name: string; quantity: number; revenue: number }[]>`
      SELECT c.id AS "categoryId", c.name, COALESCE(SUM(t.q), 0)::int AS quantity, COALESCE(SUM(t.r), 0)::int AS revenue
      FROM "Category" c
      LEFT JOIN "Product" p ON p."categoryId" = c.id
      LEFT JOIN (
        SELECT "productId", SUM(quantity) AS q, SUM("unitPrice" * quantity) AS r FROM "Sale" GROUP BY "productId"
        UNION ALL
        SELECT "productId", SUM(quantity), SUM(revenue) FROM "SalesDailySummary" GROUP BY "productId"
      ) t ON t."productId" = p.id
      GROUP BY c.id, c.name ORDER BY revenue DESC, c.name`,
    prisma.stall.findMany({
      orderBy: [{ score: "desc" }, { id: "asc" }],
      take: 10,
      select: {
        id: true,
        name: true,
        score: true,
        slotNumber: true,
        status: true,
        merchant: { select: { id: true, displayName: true } },
        product: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Fill missing days with zeros so charts get a continuous x-axis
  const perDayMap = new Map(perDay.map((d) => [d.day, d]));
  const salesPerDay = [];
  for (let day = fromDay; day <= state.currentDay; day++) {
    salesPerDay.push(perDayMap.get(day) ?? { day, quantity: 0, revenue: 0 });
  }

  return {
    clock: toClock(state),
    totals: {
      merchants,
      stalls,
      activeStalls: stalls - suspended,
      suspendedStalls: suspended,
      activeCustomersToday: customers,
      unitsSoldAllTime: allTime[0]?.quantity ?? 0,
      revenueAllTime: allTime[0]?.revenue ?? 0,
      unitsSoldToday: today._sum.quantity ?? 0,
      revenueToday: today._sum.unitPrice ?? 0,
    },
    merchantsByStatus: (["BEGINNER", "EXPERIENCED", "GVIR"] as const).map((status) => ({
      status,
      count: byStatus.find((s) => s.status === status)?._count._all ?? 0,
    })),
    salesPerDay,
    salesByCategory: byCategory,
    topStalls,
  };
}

// -------------------------------------------------------------- merchants

async function netWorthMap(merchantIds: number[]) {
  const map = new Map<number, { stockValue: number; loanRemaining: number; stalls: number; avgScore: number }>();
  if (merchantIds.length === 0) return map;
  const rows = await prisma.$queryRaw<{ id: number; stockValue: number; loanRemaining: number; stalls: number; avgScore: number }[]>`
    SELECT u.id,
      COALESCE((SELECT SUM(s.stock * p."supplierPrice") FROM "Stall" s JOIN "Product" p ON p.id = s."productId" WHERE s."merchantId" = u.id), 0)::int AS "stockValue",
      COALESCE((SELECT l.remaining FROM "Loan" l WHERE l."merchantId" = u.id AND l.status = 'OPEN' LIMIT 1), 0)::int AS "loanRemaining",
      (SELECT COUNT(*) FROM "Stall" s WHERE s."merchantId" = u.id)::int AS stalls,
      COALESCE((SELECT AVG(s.score) FROM "Stall" s WHERE s."merchantId" = u.id), 0)::float AS "avgScore"
    FROM "User" u WHERE u.id IN (${Prisma.join(merchantIds)})`;
  for (const r of rows) map.set(r.id, r);
  return map;
}

export async function listMerchants(q: z.infer<typeof AdminMerchantsQuery>) {
  const where: Prisma.UserWhereInput = { role: "MERCHANT" };
  if (q.status) where.status = q.status;
  if (q.search) where.OR = [{ displayName: insensitive(q.search) }, { email: insensitive(q.search) }];

  const all = await prisma.user.findMany({ where, select: { id: true, email: true, displayName: true, role: true, balance: true, status: true, createdAt: true } });
  const worth = await netWorthMap(all.map((u) => u.id));
  const rows = all.map((u) => {
    const w = worth.get(u.id) ?? { stockValue: 0, loanRemaining: 0, stalls: 0, avgScore: 0 };
    return {
      ...toPublicUser(u),
      stallsCount: w.stalls,
      stockValue: w.stockValue,
      loanRemaining: w.loanRemaining,
      netWorth: u.balance + w.stockValue - w.loanRemaining,
      averageScore: Math.round(w.avgScore * 100) / 100,
    };
  });

  const dir = (q.order ?? (q.sort === "name" ? "asc" : "desc")) === "asc" ? 1 : -1;
  const key: Record<typeof q.sort, (r: (typeof rows)[number]) => number | string> = {
    name: (r) => r.displayName,
    balance: (r) => r.balance,
    createdAt: (r) => r.createdAt.getTime(),
    stalls: (r) => r.stallsCount,
    netWorth: (r) => r.netWorth,
  };
  rows.sort((a, b) => {
    const ka = key[q.sort](a);
    const kb = key[q.sort](b);
    const cmp = typeof ka === "string" ? ka.localeCompare(kb as string, "he") : ka - (kb as number);
    return dir * cmp || a.id - b.id;
  });
  const { skip, take } = paginate(q.page, q.pageSize);
  return pageOf(rows.slice(skip, skip + take), rows.length, q.page, q.pageSize);
}

export async function getMerchant(id: number) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "MERCHANT") throw Errors.notFound("Merchant");
  const state = await getGameState(prisma);
  const [stalls, loan, transactions, worth, sales] = await Promise.all([
    prisma.stall.findMany({ where: { merchantId: id }, include: stallInclude, orderBy: { slotNumber: "asc" } }),
    prisma.loan.findFirst({ where: { merchantId: id, status: "OPEN" } }),
    prisma.transaction.findMany({ where: { merchantId: id }, orderBy: { id: "desc" }, take: 20 }),
    netWorthMap([id]),
    prisma.sale.aggregate({ where: { merchantId: id }, _sum: { quantity: true, unitPrice: true } }),
  ]);
  const w = worth.get(id) ?? { stockValue: 0, loanRemaining: 0, stalls: 0, avgScore: 0 };
  const opts = { currentDay: state.currentDay, includeScore: true };
  return {
    ...toPublicUser(user),
    stockValue: w.stockValue,
    netWorth: user.balance + w.stockValue - w.loanRemaining,
    averageScore: Math.round(w.avgScore * 100) / 100,
    loan,
    recentSales: { units: sales._sum.quantity ?? 0, revenue: sales._sum.unitPrice ?? 0, note: "last 48 game days" },
    stalls: stalls.map((s) => toStallView(s, opts)),
    recentTransactions: transactions,
  };
}

export async function grantMerchant(id: number, input: z.infer<typeof GrantBody>) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id } });
    if (!user || user.role !== "MERCHANT") throw Errors.notFound("Merchant");
    const balance = await changeBalance(tx, {
      merchantId: id,
      amount: input.amount,
      type: "ADMIN_GRANT",
      description: `מענק מראש הקהל: ${input.message}`,
    });
    const notification = await tx.notification.create({
      data: { userId: id, type: "GRANT", message: `קיבלת מענק של ${input.amount} רובל מראש הקהל: ${input.message}` },
    });
    return { merchantId: id, amount: input.amount, balance, notification };
  });
}

// ----------------------------------------------------------------- stalls

export async function listStalls(q: z.infer<typeof AdminStallsQuery>) {
  const where: Prisma.StallWhereInput = {};
  if (q.status) where.status = q.status;
  if (q.merchantId) where.merchantId = q.merchantId;
  if (q.categoryId) where.product = { categoryId: q.categoryId };
  if (q.search) {
    where.OR = [
      { name: insensitive(q.search) },
      { product: { name: insensitive(q.search) } },
      { merchant: { displayName: insensitive(q.search) } },
    ];
  }
  const dir = q.order ?? (q.sort === "score" || q.sort === "createdAt" ? "desc" : "asc");
  const orderBy: Prisma.StallOrderByWithRelationInput =
    q.sort === "name"
      ? { name: dir }
      : q.sort === "price"
        ? { price: dir }
        : q.sort === "slot"
          ? { slotNumber: dir }
          : q.sort === "createdAt"
            ? { createdAt: dir }
            : { score: dir };

  const state = await getGameState(prisma);
  const opts = { currentDay: state.currentDay, includeScore: true };
  const [items, total] = await Promise.all([
    prisma.stall.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      ...paginate(q.page, q.pageSize),
      include: { ...stallInclude, merchant: { select: { id: true, displayName: true, email: true } } },
    }),
    prisma.stall.count({ where }),
  ]);
  return pageOf(
    items.map((s) => ({ ...toStallView(s, opts), merchant: s.merchant })),
    total,
    q.page,
    q.pageSize,
  );
}

export async function suspendStall(id: number, reason: string) {
  const stall = await prisma.stall.findUnique({ where: { id } });
  if (!stall) throw Errors.notFound("Stall");
  await prisma.$transaction([
    prisma.stall.update({ where: { id }, data: { status: "SUSPENDED", suspensionReason: reason } }),
    prisma.notification.create({
      data: { userId: stall.merchantId, type: "SUSPENSION", message: `הדוכן "${stall.name}" הושעה על ידי ראש הקהל. סיבה: ${reason}` },
    }),
  ]);
  return getStallForAdmin(id);
}

export async function unsuspendStall(id: number) {
  const stall = await prisma.stall.findUnique({ where: { id } });
  if (!stall) throw Errors.notFound("Stall");
  await prisma.$transaction([
    prisma.stall.update({ where: { id }, data: { status: "ACTIVE", suspensionReason: null } }),
    prisma.notification.create({
      data: { userId: stall.merchantId, type: "UNSUSPENSION", message: `ההשעיה של הדוכן "${stall.name}" בוטלה. אפשר למכור שוב!` },
    }),
  ]);
  return getStallForAdmin(id);
}

// ---------------------------------------------------- sales and payments

export async function listSales(q: z.infer<typeof AdminSalesQuery>) {
  const where: Prisma.SaleWhereInput = {};
  if (q.merchantId) where.merchantId = q.merchantId;
  if (q.categoryId) where.product = { categoryId: q.categoryId };
  if (q.fromDay || q.toDay) where.gameDay = { ...(q.fromDay ? { gte: q.fromDay } : {}), ...(q.toDay ? { lte: q.toDay } : {}) };
  const [items, total, sums] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: { id: "desc" },
      ...paginate(q.page, q.pageSize),
      include: {
        merchant: { select: { id: true, displayName: true } },
        stall: { select: { id: true, name: true, slotNumber: true } },
        product: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
        customer: { select: { id: true, nickname: true } },
      },
    }),
    prisma.sale.count({ where }),
    prisma.sale.aggregate({ where, _sum: { quantity: true, unitPrice: true } }),
  ]);
  return {
    ...pageOf(items, total, q.page, q.pageSize),
    totals: { units: sums._sum.quantity ?? 0, revenue: sums._sum.unitPrice ?? 0 },
  };
}

export async function listTransactions(q: z.infer<typeof AdminTransactionsQuery>) {
  const where: Prisma.TransactionWhereInput = {};
  if (q.merchantId) where.merchantId = q.merchantId;
  if (q.type) where.type = q.type;
  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { id: "desc" },
      ...paginate(q.page, q.pageSize),
      include: { merchant: { select: { id: true, displayName: true } } },
    }),
    prisma.transaction.count({ where }),
  ]);
  return pageOf(items, total, q.page, q.pageSize);
}
