import type { z } from "zod";
import { prisma } from "../db/prisma";
import { AppError, Errors } from "../errors/AppError";
import { Prisma } from "../generated/prisma/client";
import type { TransactionType } from "../generated/prisma/enums";
import { RULES } from "../game/rules";
import { getGameState } from "../simulation/clock";
import { pageOf, paginate } from "../utils/http";
import type { MySalesQuery, MyTransactionsQuery } from "../validation/schemas";
import { changeBalance } from "./ledger.service";

const INCOME_TYPES: TransactionType[] = ["SALE_INCOME", "STALL_SOLD", "STALL_CLOSED_REFUND", "ADMIN_GRANT", "OPENING_GRANT"];
const EXPENSE_TYPES: TransactionType[] = ["STALL_PURCHASE", "STOCK_PURCHASE", "DECORATION", "STALL_FEE"];

/** Net worth = balance + stock value at supplier price − remaining loan. */
export async function netWorthOf(merchantId: number) {
  const [user, stalls, loan] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: merchantId }, select: { balance: true } }),
    prisma.stall.findMany({ where: { merchantId }, select: { stock: true, score: true, product: { select: { supplierPrice: true } } } }),
    prisma.loan.findFirst({ where: { merchantId, status: "OPEN" } }),
  ]);
  const stockValue = stalls.reduce((sum, s) => sum + s.stock * s.product.supplierPrice, 0);
  const loanRemaining = loan?.remaining ?? 0;
  return {
    balance: user.balance,
    stockValue,
    loanRemaining,
    netWorth: user.balance + stockValue - loanRemaining,
    stallsCount: stalls.length,
    averageScore: stalls.length ? stalls.reduce((s, x) => s + x.score, 0) / stalls.length : 0,
    openLoan: loan,
  };
}

export async function getSummary(merchantId: number) {
  const state = await getGameState(prisma);
  const [user, worth, byType, today, unread] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: merchantId } }),
    netWorthOf(merchantId),
    prisma.transaction.groupBy({ by: ["type"], where: { merchantId }, _sum: { amount: true } }),
    prisma.sale.aggregate({ where: { merchantId, gameDay: state.currentDay }, _sum: { quantity: true, unitPrice: true } }),
    prisma.notification.count({ where: { userId: merchantId, isRead: false } }),
  ]);
  const sumOf = (types: TransactionType[]) =>
    byType.filter((t) => types.includes(t.type)).reduce((sum, t) => sum + (t._sum.amount ?? 0), 0);

  return {
    displayName: user.displayName,
    balance: user.balance,
    status: user.status,
    income: sumOf(INCOME_TYPES),
    expenses: -sumOf(EXPENSE_TYPES),
    incomeByType: Object.fromEntries(INCOME_TYPES.map((t) => [t, sumOf([t])])),
    expensesByType: Object.fromEntries(EXPENSE_TYPES.map((t) => [t, -sumOf([t])])),
    loan: worth.openLoan
      ? { id: worth.openLoan.id, amount: worth.openLoan.amount, remaining: worth.openLoan.remaining, createdAt: worth.openLoan.createdAt }
      : null,
    stockValue: worth.stockValue,
    netWorth: worth.netWorth,
    stallsCount: worth.stallsCount,
    today: { day: state.currentDay, unitsSold: today._sum.quantity ?? 0, revenue: today._sum.unitPrice ?? 0 },
    unreadNotifications: unread,
  };
}

// ------------------------------------------------------------------ sales

export async function listMySales(merchantId: number, q: z.infer<typeof MySalesQuery>) {
  const where: Prisma.SaleWhereInput = { merchantId };
  if (q.stallId) where.stallId = q.stallId;
  if (q.productId) where.productId = q.productId;
  if (q.fromDay || q.toDay) where.gameDay = { ...(q.fromDay ? { gte: q.fromDay } : {}), ...(q.toDay ? { lte: q.toDay } : {}) };

  const orderBy: Prisma.SaleOrderByWithRelationInput[] =
    q.sort === "oldest" ? [{ id: "asc" }] : q.sort === "price" ? [{ unitPrice: "desc" }, { id: "desc" }] : [{ id: "desc" }];

  const [items, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy,
      ...paginate(q.page, q.pageSize),
      include: {
        stall: { select: { id: true, name: true, slotNumber: true } },
        product: { select: { id: true, name: true } },
        customer: { select: { id: true, nickname: true } },
      },
    }),
    prisma.sale.count({ where }),
  ]);
  return pageOf(
    items.map((s) => ({
      id: s.id,
      gameDay: s.gameDay,
      gameHour: s.gameHour,
      unitPrice: s.unitPrice,
      quantity: s.quantity,
      total: s.unitPrice * s.quantity,
      customerGender: s.customerGender,
      customerAge: s.customerAge,
      customer: s.customer,
      product: s.product,
      stall: s.stall,
      createdAt: s.createdAt,
    })),
    total,
    q.page,
    q.pageSize,
  );
}

/** Per-product breakdown incl. gender and age, from detailed sales + archived summaries. */
export async function salesByProduct(merchantId: number) {
  const rows = await prisma.$queryRaw<
    { productId: number; name: string; quantity: number; revenue: number; maleCount: number; femaleCount: number; youngCount: number; oldCount: number; customers: number }[]
  >`
    SELECT t."productId", p.name,
      SUM(t.quantity)::int AS quantity, SUM(t.revenue)::int AS revenue,
      SUM(t.male)::int AS "maleCount", SUM(t.female)::int AS "femaleCount",
      SUM(t.young)::int AS "youngCount", SUM(t.old)::int AS "oldCount",
      SUM(t.customers)::int AS customers
    FROM (
      SELECT "productId", SUM(quantity) AS quantity, SUM("unitPrice" * quantity) AS revenue,
        SUM(CASE WHEN "customerGender" = 'MALE' THEN quantity ELSE 0 END) AS male,
        SUM(CASE WHEN "customerGender" = 'FEMALE' THEN quantity ELSE 0 END) AS female,
        SUM(CASE WHEN "customerAge" = 'YOUNG' THEN quantity ELSE 0 END) AS young,
        SUM(CASE WHEN "customerAge" = 'OLD' THEN quantity ELSE 0 END) AS old,
        COUNT(*) AS customers
      FROM "Sale" WHERE "merchantId" = ${merchantId}::int GROUP BY "productId"
      UNION ALL
      SELECT "productId", SUM(quantity), SUM(revenue), SUM("maleCount"), SUM("femaleCount"),
        SUM("youngCount"), SUM("oldCount"), SUM(quantity)
      FROM "SalesDailySummary" WHERE "merchantId" = ${merchantId}::int GROUP BY "productId"
    ) t
    JOIN "Product" p ON p.id = t."productId"
    GROUP BY t."productId", p.name
    ORDER BY revenue DESC`;
  return rows.map((r) => ({
    product: { id: r.productId, name: r.name },
    quantity: r.quantity,
    revenue: r.revenue,
    customers: r.customers,
    byGender: { MALE: r.maleCount, FEMALE: r.femaleCount },
    byAge: { YOUNG: r.youngCount, OLD: r.oldCount },
  }));
}

// ----------------------------------------------------------- transactions

export async function listMyTransactions(merchantId: number, q: z.infer<typeof MyTransactionsQuery>) {
  const where: Prisma.TransactionWhereInput = { merchantId, ...(q.type ? { type: q.type } : {}) };
  const [items, total] = await Promise.all([
    prisma.transaction.findMany({ where, orderBy: { id: "desc" }, ...paginate(q.page, q.pageSize) }),
    prisma.transaction.count({ where }),
  ]);
  return pageOf(items, total, q.page, q.pageSize);
}

// ------------------------------------------------------------------- loan

export async function getLoan(merchantId: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: merchantId }, select: { status: true } });
  const loan = await prisma.loan.findFirst({ where: { merchantId, status: "OPEN" } });
  const history = await prisma.loan.findMany({ where: { merchantId }, orderBy: { id: "desc" }, take: 20 });
  return {
    loan,
    status: user.status,
    maxAmount: RULES.LOAN_MAX[user.status],
    canTakeLoan: !loan,
    repaymentShare: RULES.LOAN_REPAYMENT_SHARE,
    history,
  };
}

export async function takeLoan(merchantId: number, amount: number) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1, ${merchantId}::int)`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: merchantId }, select: { status: true } });
      const open = await tx.loan.findFirst({ where: { merchantId, status: "OPEN" } });
      if (open) throw Errors.conflict("OPEN_LOAN_EXISTS", "You already have an open loan");
      const max = RULES.LOAN_MAX[user.status];
      if (amount > max) {
        throw new AppError(400, "LOAN_LIMIT_EXCEEDED", `The maximum loan for status ${user.status} is ${max}`, { maxAmount: max });
      }
      const loan = await tx.loan.create({ data: { merchantId, amount, remaining: amount } });
      const balance = await changeBalance(tx, {
        merchantId,
        amount,
        type: "LOAN_TAKEN",
        description: `הלוואה ללא ריבית: ${amount} רובל`,
      });
      return { loan, balance };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw Errors.conflict("OPEN_LOAN_EXISTS", "You already have an open loan");
    }
    throw err;
  }
}

// ---------------------------------------------------------- notifications

export async function listNotifications(userId: number) {
  const items = await prisma.notification.findMany({ where: { userId }, orderBy: { id: "desc" }, take: 100 });
  return { items, unread: items.filter((n) => !n.isRead).length };
}

export async function markNotificationRead(userId: number, id: number) {
  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n || n.userId !== userId) throw Errors.notFound("Notification");
  return prisma.notification.update({ where: { id }, data: { isRead: true } });
}
