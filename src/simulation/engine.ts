/**
 * The fair simulation engine.
 *
 * One "tick" = one game hour. A tick:
 *   1. advances the clock (and on a new day: charges stall fees to merchants who played that day, archives old sales,
 *      and gives every customer a new budget, visit hour and shopping list),
 *   2. recomputes every stall score,
 *   3. lets the customers whose visit hour is now buy from stalls of ONLINE merchants,
 *   4. books income, auto loan repayments and merchant status changes.
 *
 * Everything is computed in memory and written back with a few bulk statements.
 * Balances, stock and loans are written as DELTAS (balance = balance + x), so a
 * merchant action that happens at the same moment is never overwritten.
 */
import { env } from "../config/env";
import { prisma, type Db, type Tx } from "../db/prisma";
import { Prisma } from "../generated/prisma/client";
import type { AgeGroup, Gender, MerchantStatus, StallStatus, TargetAge, TargetGender } from "../generated/prisma/enums";
import { merchantStatusFor, RULES, stallScore, targetCustomerCount, type Population } from "../game/rules";
import { forEachChunk, valuesList } from "../utils/sql";
import { getGameState, nextHour } from "./clock";
import {
  newCustomerIdentity,
  newShoppingList,
  parseShoppingList,
  randomBudget,
  randomVisitHour,
  weightedIndex,
  type CatalogProduct,
  type Rng,
  type ShoppingItem,
} from "./customers";
import { isOnline, usersSeenWithin } from "./presence";

const TICK_LOCK_KEY = 77_310_001; // pg advisory lock id shared by all server instances
const CHUNK = 1000;

export interface TickResult {
  day: number;
  hour: number;
  newDay: boolean;
  visitors: number;
  sales: number;
  revenue: number;
  feesCharged: number;
  archivedSales: number;
  durationMs: number;
}

interface StallRow {
  id: number;
  merchantId: number;
  productId: number;
  price: number;
  stock: number;
  status: StallStatus;
  stockOutTicks: number;
  totalTicks: number;
  marketPrice: number;
  supplierPrice: number;
  popularity: number;
  targetGender: TargetGender;
  targetAge: TargetAge;
  points: number;
}

interface CustomerRow {
  id: number;
  gender: Gender;
  ageGroup: AgeGroup;
  dailyBudget: number;
  budgetLeft: number;
  visitHour: number;
  shoppingList: ShoppingItem[];
  listDay: number;
}

interface SaleDraft {
  stallId: number;
  merchantId: number;
  productId: number;
  customerId: number;
  customerGender: Gender;
  customerAge: AgeGroup;
  unitPrice: number;
}

// ---------------------------------------------------------------- day rollover

/** Daily stall fee — only for merchants who were connected at some point during the past game day. */
async function chargeStallFees(tx: Tx, day: number): Promise<number> {
  const playedToday = usersSeenWithin(env.GAME_HOUR_MS * RULES.HOURS_PER_DAY);
  if (playedToday.length === 0) return 0;
  const rows = await tx.$queryRaw<{ id: number; balance: number; stalls: number }[]>`
    WITH counts AS (
      SELECT "merchantId", COUNT(*)::int AS n FROM "Stall" GROUP BY "merchantId"
    )
    UPDATE "User" u SET balance = u.balance - counts.n * ${RULES.STALL_DAILY_FEE}::int, "updatedAt" = NOW()
    FROM counts WHERE u.id = counts."merchantId" AND u.id = ANY(${playedToday}::int[])
    RETURNING u.id, u.balance, counts.n AS stalls`;
  if (rows.length === 0) return 0;
  await tx.transaction.createMany({
    data: rows.map((r) => ({
      merchantId: r.id,
      type: "STALL_FEE" as const,
      amount: -r.stalls * RULES.STALL_DAILY_FEE,
      balanceAfter: r.balance,
      description: `דמי דוכן ליום ${day - 1}: ${r.stalls} דוכנים × ${RULES.STALL_DAILY_FEE}`,
    })),
  });
  return rows.reduce((sum, r) => sum + r.stalls * RULES.STALL_DAILY_FEE, 0);
}

/** Moves detailed sales older than the retention window into SalesDailySummary. */
export async function archiveOldSales(tx: Tx | Db, currentDay: number): Promise<number> {
  const cutoff = currentDay - RULES.SALES_RETENTION_DAYS;
  if (cutoff <= 0) return 0;
  await tx.$executeRaw`
    INSERT INTO "SalesDailySummary"
      ("merchantId", "stallId", "productId", "gameDay", quantity, revenue, "maleCount", "femaleCount", "youngCount", "oldCount")
    SELECT "merchantId", "stallId", "productId", "gameDay",
      SUM(quantity)::int,
      SUM("unitPrice" * quantity)::int,
      SUM(CASE WHEN "customerGender" = 'MALE' THEN quantity ELSE 0 END)::int,
      SUM(CASE WHEN "customerGender" = 'FEMALE' THEN quantity ELSE 0 END)::int,
      SUM(CASE WHEN "customerAge" = 'YOUNG' THEN quantity ELSE 0 END)::int,
      SUM(CASE WHEN "customerAge" = 'OLD' THEN quantity ELSE 0 END)::int
    FROM "Sale" WHERE "gameDay" <= ${cutoff}::int
    GROUP BY "merchantId", "stallId", "productId", "gameDay"`;
  return tx.$executeRaw`DELETE FROM "Sale" WHERE "gameDay" <= ${cutoff}::int`;
}

// ------------------------------------------------------------------ customers

/**
 * Makes sure the right number of customers is active today.
 * Customers are never deleted (sales reference them); extra customers are
 * simply given an empty list, which makes them inactive for the day.
 */
async function prepareCustomers(
  tx: Tx,
  day: number,
  hour: number,
  activeStalls: number,
  products: CatalogProduct[],
  rng: Rng,
): Promise<CustomerRow[]> {
  const raw = await tx.customer.findMany({ orderBy: { id: "asc" } });
  const customers: CustomerRow[] = raw.map((c) => ({ ...c, shoppingList: parseShoppingList(c.shoppingList) }));
  const target = targetCustomerCount(activeStalls);

  // Create missing customers (they join the fair from the current hour on)
  if (customers.length < target) {
    const data = [];
    for (let i = customers.length; i < target; i++) {
      const who = newCustomerIdentity(i + 1, rng);
      const budget = randomBudget(who.ageGroup, rng);
      data.push({
        ...who,
        dailyBudget: budget,
        budgetLeft: budget,
        visitHour: randomVisitHour(rng, hour),
        shoppingList: newShoppingList(who, products, rng) as unknown as Prisma.InputJsonValue,
        listDay: day,
      });
    }
    await forEachChunk(data, CHUNK, (part) => tx.customer.createMany({ data: part }));
    const created = await tx.customer.findMany({ where: { id: { gt: customers.at(-1)?.id ?? 0 } }, orderBy: { id: "asc" } });
    customers.push(...created.map((c) => ({ ...c, shoppingList: parseShoppingList(c.shoppingList) })));
  }

  const updates: CustomerRow[] = [];
  customers.forEach((c, index) => {
    const shouldBeActive = index < target;
    if (c.listDay !== day) {
      // New day: new budget, visit hour and list (or an empty list = inactive today)
      const budget = randomBudget(c.ageGroup, rng);
      c.dailyBudget = budget;
      c.budgetLeft = shouldBeActive ? budget : 0;
      c.visitHour = randomVisitHour(rng);
      c.shoppingList = shouldBeActive ? newShoppingList(c, products, rng) : [];
      c.listDay = day;
      updates.push(c);
    } else if (shouldBeActive && c.shoppingList.length === 0) {
      // Activated in the middle of the day because new stalls opened
      c.budgetLeft = c.dailyBudget;
      c.visitHour = randomVisitHour(rng, hour);
      c.shoppingList = newShoppingList(c, products, rng);
      updates.push(c);
    }
  });

  await forEachChunk(updates, CHUNK, (part) =>
    tx.$executeRaw`
      UPDATE "Customer" c SET "dailyBudget" = v.budget, "budgetLeft" = v.left_, "visitHour" = v.hour,
        "shoppingList" = v.list, "listDay" = v.day
      FROM (VALUES ${valuesList(
        ["int", "int", "int", "int", "jsonb", "int"],
        part.map((c) => [c.id, c.dailyBudget, c.budgetLeft, c.visitHour, JSON.stringify(c.shoppingList), c.listDay]),
      )}) AS v(id, budget, left_, hour, list, day)
      WHERE c.id = v.id`,
  );

  return customers;
}

function populationOf(customers: CustomerRow[]): Population {
  const pop: Population = { total: 0, male: 0, female: 0, young: 0, old: 0 };
  for (const c of customers) {
    if (c.shoppingList.length === 0) continue;
    pop.total++;
    if (c.gender === "MALE") pop.male++;
    else pop.female++;
    if (c.ageGroup === "YOUNG") pop.young++;
    else pop.old++;
  }
  return pop;
}

// ------------------------------------------------------------------- one tick

async function loadStalls(tx: Tx): Promise<StallRow[]> {
  return tx.$queryRaw<StallRow[]>`
    SELECT s.id, s."merchantId", s."productId", s.price, s.stock, s.status,
      s."stockOutTicks", s."totalTicks",
      p."marketPrice", p."supplierPrice", p.popularity, p."targetGender", p."targetAge",
      COALESCE(d.points, 0)::int AS points
    FROM "Stall" s
    JOIN "Product" p ON p.id = s."productId"
    LEFT JOIN (
      SELECT sd."stallId", SUM(dec.points)::int AS points
      FROM "StallDecoration" sd JOIN "Decoration" dec ON dec.id = sd."decorationId"
      GROUP BY sd."stallId"
    ) d ON d."stallId" = s.id
    ORDER BY s.id`;
}

async function simulateHour(tx: Tx, day: number, hour: number, rng: Rng) {
  const products = await tx.product.findMany({
    where: { isActive: true },
    select: { id: true, popularity: true, targetGender: true, targetAge: true },
  });
  const stalls = await loadStalls(tx);
  const activeStalls = stalls.filter((s) => s.status === "ACTIVE");
  const customers = await prepareCustomers(tx, day, hour, activeStalls.length, products, rng);
  const population = populationOf(customers);

  // --- scores (stock availability counts this tick)
  const sameProduct = new Map<number, number>();
  for (const s of activeStalls) sameProduct.set(s.productId, (sameProduct.get(s.productId) ?? 0) + 1);
  const scores = new Map<number, number>();
  const outThisTick = new Map<number, number>();
  for (const s of stalls) {
    const out = s.stock <= 0 ? 1 : 0;
    outThisTick.set(s.id, out);
    scores.set(
      s.id,
      stallScore(
        {
          decorationPoints: s.points,
          popularity: s.popularity,
          price: s.price,
          marketPrice: s.marketPrice,
          sameProductActiveStalls: sameProduct.get(s.productId) ?? 1,
          stockOutTicks: s.stockOutTicks + out,
          totalTicks: s.totalTicks + 1,
          stock: s.stock,
          targetGender: s.targetGender,
          targetAge: s.targetAge,
        },
        population,
      ),
    );
  }

  // --- purchases
  const candidatesByProduct = new Map<number, StallRow[]>();
  for (const s of activeStalls) {
    if (s.stock <= 0) continue; // every stall is open all the time
    if (!isOnline(s.merchantId)) continue; // merchant not playing now → not part of the fair
    const list = candidatesByProduct.get(s.productId) ?? [];
    list.push(s);
    candidatesByProduct.set(s.productId, list);
  }

  const visitors = customers.filter((c) => c.visitHour === hour && c.shoppingList.length > 0);
  for (let i = visitors.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [visitors[i], visitors[j]] = [visitors[j]!, visitors[i]!];
  }

  const sales: SaleDraft[] = [];
  const soldPerStall = new Map<number, number>();
  const changedCustomers: CustomerRow[] = [];

  for (const customer of visitors) {
    let changed = false;
    for (const item of customer.shoppingList) {
      if (item.purchased) continue;
      const candidates = (candidatesByProduct.get(item.productId) ?? []).filter((s) => s.stock > 0);
      if (candidates.length === 0) continue;
      const weights = candidates.map((s) => {
        const score = Math.max(1, scores.get(s.id) ?? 0);
        const priceFactor = Math.min(3, Math.max(0.2, s.marketPrice / s.price));
        return score * score * priceFactor;
      });
      const chosen = candidates[weightedIndex(weights, rng)];
      if (!chosen) continue;
      if (chosen.price > customer.budgetLeft || chosen.price > RULES.MAX_PRICE_FACTOR * chosen.marketPrice) continue;

      chosen.stock -= 1;
      customer.budgetLeft -= chosen.price;
      item.purchased = true;
      changed = true;
      soldPerStall.set(chosen.id, (soldPerStall.get(chosen.id) ?? 0) + 1);
      sales.push({
        stallId: chosen.id,
        merchantId: chosen.merchantId,
        productId: chosen.productId,
        customerId: customer.id,
        customerGender: customer.gender,
        customerAge: customer.ageGroup,
        unitPrice: chosen.price,
      });
    }
    if (changed) changedCustomers.push(customer);
  }

  // --- write stalls (delta stock) — RETURNING tells us which stalls still exist
  const existing = new Set<number>();
  await forEachChunk(stalls, CHUNK, async (part) => {
    const rows = await tx.$queryRaw<{ id: number }[]>`
      UPDATE "Stall" s SET
        stock = GREATEST(0, s.stock - v.sold),
        score = v.score,
        "totalTicks" = s."totalTicks" + 1,
        "stockOutTicks" = s."stockOutTicks" + v.out_
      FROM (VALUES ${valuesList(
        ["int", "int", "float", "int"],
        part.map((s) => [s.id, soldPerStall.get(s.id) ?? 0, scores.get(s.id) ?? 0, outThisTick.get(s.id) ?? 0]),
      )}) AS v(id, sold, score, out_)
      WHERE s.id = v.id
      RETURNING s.id`;
    for (const r of rows) existing.add(r.id);
  });
  const validSales = sales.filter((s) => existing.has(s.stallId));

  await forEachChunk(validSales, CHUNK, (part) =>
    tx.sale.createMany({ data: part.map((s) => ({ ...s, quantity: 1, gameDay: day, gameHour: hour })) }),
  );

  await forEachChunk(changedCustomers, CHUNK, (part) =>
    tx.$executeRaw`
      UPDATE "Customer" c SET "budgetLeft" = v.left_, "shoppingList" = v.list
      FROM (VALUES ${valuesList(
        ["int", "int", "jsonb"],
        part.map((c) => [c.id, c.budgetLeft, JSON.stringify(c.shoppingList)]),
      )}) AS v(id, left_, list)
      WHERE c.id = v.id`,
  );

  // --- money: income per stall, 30% auto repayment of open loans
  const openLoans = await tx.loan.findMany({ where: { status: "OPEN" }, select: { id: true, merchantId: true, remaining: true } });
  const loanByMerchant = new Map(openLoans.map((l) => [l.merchantId, { ...l, repay: 0 }]));
  const incomeByStall = new Map<number, { merchantId: number; units: number; income: number }>();
  for (const sale of validSales) {
    const entry = incomeByStall.get(sale.stallId) ?? { merchantId: sale.merchantId, units: 0, income: 0 };
    entry.units++;
    entry.income += sale.unitPrice;
    incomeByStall.set(sale.stallId, entry);
    const loan = loanByMerchant.get(sale.merchantId);
    if (loan && loan.remaining - loan.repay > 0) {
      loan.repay += Math.min(loan.remaining - loan.repay, Math.round(sale.unitPrice * RULES.LOAN_REPAYMENT_SHARE));
    }
  }

  const deltaByMerchant = new Map<number, number>();
  for (const e of incomeByStall.values()) deltaByMerchant.set(e.merchantId, (deltaByMerchant.get(e.merchantId) ?? 0) + e.income);
  for (const l of loanByMerchant.values()) {
    if (l.repay > 0) deltaByMerchant.set(l.merchantId, (deltaByMerchant.get(l.merchantId) ?? 0) - l.repay);
  }

  // --- merchant status: net worth = balance + stock value − loan remaining
  const merchants = await tx.user.findMany({ where: { role: "MERCHANT" }, select: { id: true, balance: true, status: true } });
  const stockValue = new Map<number, number>();
  const scoreSum = new Map<number, { sum: number; n: number }>();
  for (const s of stalls) {
    if (!existing.has(s.id)) continue;
    stockValue.set(s.merchantId, (stockValue.get(s.merchantId) ?? 0) + s.stock * s.supplierPrice);
    const agg = scoreSum.get(s.merchantId) ?? { sum: 0, n: 0 };
    agg.sum += scores.get(s.id) ?? 0;
    agg.n++;
    scoreSum.set(s.merchantId, agg);
  }

  const userUpdates: [number, number, MerchantStatus][] = [];
  for (const m of merchants) {
    const delta = deltaByMerchant.get(m.id) ?? 0;
    const loan = loanByMerchant.get(m.id);
    const loanLeft = loan ? loan.remaining - loan.repay : 0;
    const netWorth = m.balance + delta + (stockValue.get(m.id) ?? 0) - loanLeft;
    const agg = scoreSum.get(m.id);
    const status = merchantStatusFor(netWorth, agg && agg.n > 0 ? agg.sum / agg.n : 0);
    if (delta !== 0 || status !== m.status) userUpdates.push([m.id, delta, status]);
  }

  const finalBalance = new Map<number, number>();
  await forEachChunk(userUpdates, CHUNK, async (part) => {
    const rows = await tx.$queryRaw<{ id: number; balance: number }[]>`
      UPDATE "User" u SET balance = u.balance + v.delta, status = v.status::"MerchantStatus", "updatedAt" = NOW()
      FROM (VALUES ${valuesList(["int", "int", "text"], part)}) AS v(id, delta, status)
      WHERE u.id = v.id
      RETURNING u.id, u.balance`;
    for (const r of rows) finalBalance.set(r.id, r.balance);
  });

  const loanUpdates = [...loanByMerchant.values()].filter((l) => l.repay > 0);
  await forEachChunk(loanUpdates, CHUNK, (part) =>
    tx.$executeRaw`
      UPDATE "Loan" l SET
        remaining = GREATEST(0, l.remaining - v.repay),
        status = (CASE WHEN l.remaining - v.repay <= 0 THEN 'REPAID' ELSE 'OPEN' END)::"LoanStatus",
        "repaidAt" = CASE WHEN l.remaining - v.repay <= 0 THEN NOW() ELSE NULL END
      FROM (VALUES ${valuesList(["int", "int"], part.map((l) => [l.id, l.repay]))}) AS v(id, repay)
      WHERE l.id = v.id`,
  );

  // --- ledger rows. balanceAfter is reconstructed backwards from the final balance:
  //     income rows first, then the loan repayment.
  const txRows: Prisma.TransactionCreateManyInput[] = [];
  const byMerchant = new Map<number, { stallId: number; units: number; income: number }[]>();
  for (const [stallId, e] of incomeByStall) {
    const list = byMerchant.get(e.merchantId) ?? [];
    list.push({ stallId, units: e.units, income: e.income });
    byMerchant.set(e.merchantId, list);
  }
  for (const [merchantId, entries] of byMerchant) {
    const final = finalBalance.get(merchantId);
    if (final === undefined) continue;
    const loan = loanByMerchant.get(merchantId);
    const repay = loan?.repay ?? 0;
    let running = final + repay - entries.reduce((sum, e) => sum + e.income, 0);
    for (const e of entries) {
      running += e.income;
      txRows.push({
        merchantId,
        type: "SALE_INCOME",
        amount: e.income,
        balanceAfter: running,
        stallId: e.stallId,
        description: `מכירות ביום ${day} שעה ${hour}: ${e.units} יחידות`,
      });
    }
    if (repay > 0) {
      txRows.push({
        merchantId,
        type: "LOAN_REPAYMENT",
        amount: -repay,
        balanceAfter: final,
        description: `החזר הלוואה אוטומטי (${Math.round(RULES.LOAN_REPAYMENT_SHARE * 100)}% מההכנסות)`,
      });
    }
  }
  await forEachChunk(txRows, CHUNK, (part) => tx.transaction.createMany({ data: part }));

  return {
    visitors: visitors.length,
    sales: validSales.length,
    revenue: validSales.reduce((sum, s) => sum + s.unitPrice, 0),
  };
}

/**
 * Runs one tick if one is due (or immediately when force = true).
 * Safe to call from several places at once: a PostgreSQL advisory lock makes sure
 * only one tick runs at a time, even across server instances.
 */
export async function runTick(options: { force?: boolean; rng?: Rng; now?: Date } = {}): Promise<TickResult | null> {
  const rng = options.rng ?? Math.random;
  const started = Date.now();
  await getGameState(prisma); // make sure the singleton exists

  return prisma.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${TICK_LOCK_KEY}::bigint) AS locked`;
      if (!lock?.locked) return null;

      const [state] = await tx.$queryRaw<{ currentDay: number; currentHour: number; lastTickAt: Date }[]>`
        SELECT "currentDay", "currentHour", "lastTickAt" FROM "GameState" WHERE id = 1 FOR UPDATE`;
      if (!state) return null;

      const now = options.now ?? new Date();
      const lastTick = new Date(state.lastTickAt);
      if (!options.force && now.getTime() - lastTick.getTime() < env.GAME_HOUR_MS) return null;

      const next = nextHour(state.currentDay, state.currentHour);
      let feesCharged = 0;
      let archivedSales = 0;
      if (next.isNewDay) {
        feesCharged = await chargeStallFees(tx, next.day);
        archivedSales = await archiveOldSales(tx, next.day);
      }

      const result = await simulateHour(tx, next.day, next.hour, rng);

      const lastTickAt = options.force ? now : new Date(lastTick.getTime() + env.GAME_HOUR_MS);
      await tx.gameState.update({
        where: { id: 1 },
        data: { currentDay: next.day, currentHour: next.hour, lastTickAt },
      });

      return {
        day: next.day,
        hour: next.hour,
        newDay: next.isNewDay,
        ...result,
        feesCharged,
        archivedSales,
        durationMs: Date.now() - started,
      };
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
}
