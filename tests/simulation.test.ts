import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { RULES, targetCustomerCount } from "../src/game/rules";
import { runTick } from "../src/simulation/engine";
import { forgetPresence } from "../src/simulation/presence";
import { skipOldMissedTime } from "../src/simulation/scheduler";
import { api, auth, balanceOf, openStall, registerMerchant, resetDb, seedCatalog, seededRng, setGameClock, type Catalog } from "./helpers";

let catalog: Catalog;

beforeEach(async () => {
  await resetDb();
  catalog = await seedCatalog();
});

/** Runs ticks until the clock reaches the given hour of the current/next day. */
async function runHours(n: number, seed = 7) {
  const rng = seededRng(seed);
  const results = [];
  for (let i = 0; i < n; i++) {
    const r = await runTick({ force: true, rng });
    if (!r) throw new Error("tick did not run");
    results.push(r);
  }
  return results;
}

describe("game clock", () => {
  it("advances one game hour per tick and rolls over to a new day", async () => {
    await setGameClock(1, 22);
    const [a, b] = await runHours(2);
    expect(a).toMatchObject({ day: 1, hour: 23, newDay: false });
    expect(b).toMatchObject({ day: 2, hour: 0, newDay: true });
    const state = await prisma.gameState.findUniqueOrThrow({ where: { id: 1 } });
    expect(state).toMatchObject({ currentDay: 2, currentHour: 0 });
  });

  it("does not tick before a game hour has passed", async () => {
    expect(await runTick()).toBeNull();
    await prisma.gameState.update({ where: { id: 1 }, data: { lastTickAt: new Date(Date.now() - 151_000) } });
    expect(await runTick()).not.toBeNull();
    expect(await runTick()).toBeNull();
  });

  it("caps catch-up at 6 game hours after the server slept", async () => {
    const hourMs = 150_000;
    await prisma.gameState.update({ where: { id: 1 }, data: { lastTickAt: new Date(Date.now() - 20 * hourMs - 1000) } });
    const skipped = await skipOldMissedTime();
    expect(skipped).toBe(14);
    let ran = 0;
    while (await runTick()) ran++;
    expect(ran).toBe(RULES.MAX_CATCHUP_HOURS);
    const state = await prisma.gameState.findUniqueOrThrow({ where: { id: 1 } });
    expect(state.currentHour).toBe(6);
  });
});

describe("customers", () => {
  it("creates 150 + 75 × active stalls customers with 1–4 item lists", async () => {
    const m = await registerMerchant();
    await openStall(m.token, catalog.products.apples);
    await openStall(m.token, catalog.products.bread);
    await runHours(1);
    const customers = await prisma.customer.findMany();
    expect(customers).toHaveLength(targetCustomerCount(2));
    expect(targetCustomerCount(2)).toBe(300);
    expect(targetCustomerCount(1000)).toBe(15000);
    for (const c of customers) {
      const list = c.shoppingList as { productId: number; purchased: boolean }[];
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.length).toBeLessThanOrEqual(4);
      expect(new Set(list.map((i) => i.productId)).size).toBe(list.length);
      expect(c.budgetLeft).toBeLessThanOrEqual(c.dailyBudget);
      expect(c.visitHour).toBeGreaterThanOrEqual(0);
      expect(c.visitHour).toBeLessThanOrEqual(23);
    }
  });

  it("gives every customer a new list each day", async () => {
    await setGameClock(1, 23);
    await runHours(1); // → day 2
    const before = await prisma.customer.findMany({ orderBy: { id: "asc" } });
    expect(before.every((c) => c.listDay === 2)).toBe(true);
    await setGameClock(2, 23);
    await runHours(1, 99); // → day 3
    const after = await prisma.customer.findMany({ orderBy: { id: "asc" } });
    expect(after.every((c) => c.listDay === 3)).toBe(true);
  });
});

describe("purchases", () => {
  it("customers buy from open stalls with stock, money and stock move", async () => {
    const m = await registerMerchant();
    const s = await openStall(m.token, catalog.products.apples, { price: 6 });
    await prisma.user.update({ where: { id: m.user.id }, data: { balance: 1000 } }); // pay back the 300 stall price so the math below stays simple
    await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 300 }).expect(200); // -900 → 100
    const results = await runHours(24);
    const sales = await prisma.sale.findMany({ where: { stallId: s.id } });
    expect(sales.length).toBeGreaterThan(0);
    expect(results.reduce((sum, r) => sum + r.sales, 0)).toBe(sales.length);

    const stall = await prisma.stall.findUniqueOrThrow({ where: { id: s.id } });
    expect(stall.stock).toBe(300 - sales.length);
    expect(stall.totalTicks).toBe(24);
    expect(stall.score).toBeGreaterThan(0);
    expect(await balanceOf(m.user.id)).toBe(100 + sales.length * 6 - (results.some((r) => r.newDay) ? RULES.STALL_DAILY_FEE : 0));

    for (const sale of sales) {
      expect(sale.unitPrice).toBe(6);
      expect(sale.merchantId).toBe(m.user.id);
    }
    // ledger: SALE_INCOME rows match the sales, balanceAfter of the last row = current balance
    const income = await prisma.transaction.aggregate({ where: { merchantId: m.user.id, type: "SALE_INCOME" }, _sum: { amount: true } });
    expect(income._sum.amount).toBe(sales.length * 6);
    const last = await prisma.transaction.findFirstOrThrow({ where: { merchantId: m.user.id }, orderBy: { id: "desc" } });
    expect(last.balanceAfter).toBe(await balanceOf(m.user.id));
  });

  it("suspended, empty and overpriced stalls sell nothing", async () => {
    const m = await registerMerchant();
    await prisma.user.update({ where: { id: m.user.id }, data: { balance: 100_000 } });
    const suspended = await openStall(m.token, catalog.products.bread);
    const empty = await openStall(m.token, catalog.products.top);
    const greedy = await openStall(m.token, catalog.products.apples, { price: 10 }); // 10 > 1.5 × 6
    for (const id of [suspended.id, greedy.id]) {
      await api().post(`/api/stalls/${id}/stock`).set(auth(m.token)).send({ quantity: 500 }).expect(200);
    }
    await prisma.stall.update({ where: { id: suspended.id }, data: { status: "SUSPENDED" } });

    await setGameClock(1, 5); // simulate hours 6..23
    await runHours(18);
    const sales = await prisma.sale.groupBy({ by: ["stallId"], _count: { _all: true } });
    const ids = sales.map((s) => s.stallId);
    expect(ids).not.toContain(suspended.id);
    expect(ids).not.toContain(empty.id);
    expect(ids).not.toContain(greedy.id);
  });

  it("stalls of merchants who are not connected sell nothing", async () => {
    const online = await registerMerchant();
    const offline = await registerMerchant();
    const stalls = [];
    for (const m of [online, offline]) {
      await prisma.user.update({ where: { id: m.user.id }, data: { balance: 100_000 } });
      const s = await openStall(m.token, catalog.products.apples, { price: 6 });
      await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 500 }).expect(200);
      stalls.push(s);
    }
    forgetPresence(offline.user.id); // closed the game

    await setGameClock(1, 5); // simulate hours 6..23
    await runHours(18);
    expect(await prisma.sale.count({ where: { stallId: stalls[0]!.id } })).toBeGreaterThan(0);
    expect(await prisma.sale.count({ where: { stallId: stalls[1]!.id } })).toBe(0);
  });

  it("customers never spend more than their budget", async () => {
    const m = await registerMerchant();
    await prisma.user.update({ where: { id: m.user.id }, data: { balance: 100_000 } });
    const s = await openStall(m.token, catalog.products.bread, { price: 14 });
    await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 1000 }).expect(200);
    await runHours(23); // stay inside day 1 (budgets reset on a new day)
    const spent = await prisma.sale.groupBy({ by: ["customerId"], _sum: { unitPrice: true } });
    const customers = new Map((await prisma.customer.findMany()).map((c) => [c.id, c]));
    for (const row of spent) {
      const c = customers.get(row.customerId)!;
      expect(row._sum.unitPrice).toBeLessThanOrEqual(c.dailyBudget);
      expect(c.budgetLeft).toBe(c.dailyBudget - (row._sum.unitPrice ?? 0));
    }
  });

  it("better stalls sell more (score² weighting)", async () => {
    const good = await registerMerchant("Good");
    const bad = await registerMerchant("Bad");
    for (const x of [good, bad]) await prisma.user.update({ where: { id: x.user.id }, data: { balance: 100_000 } });
    const g = await openStall(good.token, catalog.products.apples, { price: 6 });
    const b = await openStall(bad.token, catalog.products.apples, { price: 8 });
    for (const [x, s] of [[good, g], [bad, b]] as const) {
      await api().post(`/api/stalls/${s.id}/stock`).set(auth(x.token)).send({ quantity: 1000 }).expect(200);
    }
    for (const d of [catalog.decorations.flags, catalog.decorations.lamp]) {
      await api().post(`/api/stalls/${g.id}/decorations`).set(auth(good.token)).send({ decorationId: d }).expect(201);
    }
    await runHours(24, 3);
    const [gs, bs] = await Promise.all([g.id, b.id].map((id) => prisma.stall.findUniqueOrThrow({ where: { id } })));
    expect(gs!.score).toBeGreaterThan(bs!.score);
    const count = async (id: number) => prisma.sale.count({ where: { stallId: id } });
    expect(await count(g.id)).toBeGreaterThan(await count(b.id));
  });
});

describe("loans", () => {
  it("30% of sale income repays the open loan automatically", async () => {
    const m = await registerMerchant();
    const s = await openStall(m.token, catalog.products.apples, { price: 6 });
    await prisma.user.update({ where: { id: m.user.id }, data: { balance: 1000 } }); // pay back the 300 stall price so the math below stays simple
    await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 300 }).expect(200);
    await api().post("/api/me/loan").set(auth(m.token)).send({ amount: 500 }).expect(201);
    await runHours(12);
    const sales = await prisma.sale.count({ where: { stallId: s.id } });
    expect(sales).toBeGreaterThan(0);
    const loan = await prisma.loan.findFirstOrThrow({ where: { merchantId: m.user.id } });
    const repaid = await prisma.transaction.aggregate({ where: { merchantId: m.user.id, type: "LOAN_REPAYMENT" }, _sum: { amount: true } });
    // round(6 × 0.3) = 2 per sale
    expect(-(repaid._sum.amount ?? 0)).toBe(sales * 2);
    expect(loan.remaining).toBe(500 - sales * 2);
    expect(await balanceOf(m.user.id)).toBe(100 + 500 + sales * 6 - sales * 2);
  });

  it("marks the loan REPAID when it reaches 0", async () => {
    const m = await registerMerchant();
    const s = await openStall(m.token, catalog.products.apples, { price: 6 });
    await prisma.user.update({ where: { id: m.user.id }, data: { balance: 1000 } }); // pay back the 300 stall price so the math below stays simple
    await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 300 }).expect(200);
    await prisma.loan.create({ data: { merchantId: m.user.id, amount: 3, remaining: 3 } });
    await runHours(24);
    const loan = await prisma.loan.findFirstOrThrow({ where: { merchantId: m.user.id } });
    expect(loan).toMatchObject({ remaining: 0, status: "REPAID" });
    expect(loan.repaidAt).not.toBeNull();
  });
});

describe("day rollover", () => {
  it("charges 20 per stall per day, even into a negative balance", async () => {
    const m = await registerMerchant();
    await openStall(m.token, catalog.products.apples);
    await openStall(m.token, catalog.products.bread); // 400 left
    await prisma.user.update({ where: { id: m.user.id }, data: { balance: 10 } });
    await setGameClock(4, 23);
    const [r] = await runHours(1);
    expect(r).toMatchObject({ day: 5, hour: 0, newDay: true, feesCharged: 40 });
    expect(await balanceOf(m.user.id)).toBe(-30);
    const fee = await prisma.transaction.findFirstOrThrow({ where: { merchantId: m.user.id, type: "STALL_FEE" } });
    expect(fee).toMatchObject({ amount: -40, balanceAfter: -30 });
  });

  it("does not charge stall fees to merchants who were not connected that day", async () => {
    const played = await registerMerchant();
    const away = await registerMerchant();
    await openStall(played.token, catalog.products.apples);
    await openStall(away.token, catalog.products.bread);
    forgetPresence(away.user.id);
    const awayBalance = await balanceOf(away.user.id);
    await setGameClock(4, 23);
    const [r] = await runHours(1);
    expect(r).toMatchObject({ newDay: true, feesCharged: RULES.STALL_DAILY_FEE });
    expect(await balanceOf(away.user.id)).toBe(awayBalance);
    expect(await prisma.transaction.count({ where: { merchantId: away.user.id, type: "STALL_FEE" } })).toBe(0);
  });

  it("archives sales older than 48 game days into daily summaries", async () => {
    const m = await registerMerchant();
    const s = await openStall(m.token, catalog.products.apples);
    const customer = await prisma.customer.create({
      data: { nickname: "Test", gender: "FEMALE", ageGroup: "OLD", dailyBudget: 100, budgetLeft: 100, visitHour: 3, shoppingList: [], listDay: 1 },
    });
    const sale = (gameDay: number, gender: "MALE" | "FEMALE", age: "YOUNG" | "OLD") => ({
      stallId: s.id,
      merchantId: m.user.id,
      productId: catalog.products.apples,
      customerId: customer.id,
      customerGender: gender,
      customerAge: age,
      unitPrice: 6,
      quantity: 1,
      gameDay,
      gameHour: 10,
    });
    await prisma.sale.createMany({
      data: [sale(1, "MALE", "YOUNG"), sale(1, "FEMALE", "OLD"), sale(1, "FEMALE", "YOUNG"), sale(2, "MALE", "OLD"), sale(3, "MALE", "OLD")],
    });
    await setGameClock(49, 23);
    const [r] = await runHours(1); // → day 50: keep days 3..50, archive days 1–2
    expect(r!.archivedSales).toBe(4);
    expect(await prisma.sale.count({ where: { gameDay: { lte: 2 } } })).toBe(0);
    const summary = await prisma.salesDailySummary.findMany({ orderBy: { gameDay: "asc" } });
    expect(summary).toHaveLength(2);
    expect(summary[0]).toMatchObject({ gameDay: 1, quantity: 3, revenue: 18, maleCount: 1, femaleCount: 2, youngCount: 2, oldCount: 1, stallId: s.id });
    expect(summary[1]).toMatchObject({ gameDay: 2, quantity: 1, maleCount: 1, oldCount: 1 });

    // archived sales still show in the per-product breakdown
    const byProduct = await api().get("/api/me/sales/by-product").set(auth(m.token));
    const apples = byProduct.body.find((p: { product: { id: number } }) => p.product.id === catalog.products.apples);
    expect(apples.quantity).toBeGreaterThanOrEqual(5);
    expect(apples.byGender.FEMALE).toBeGreaterThanOrEqual(2);
  });
});

describe("merchant status", () => {
  it("is recomputed every tick from net worth and average score", async () => {
    const m = await registerMerchant();
    const s = await openStall(m.token, catalog.products.apples);
    await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 10 }).expect(200);
    for (const d of [catalog.decorations.flags, catalog.decorations.lamp]) {
      await api().post(`/api/stalls/${s.id}/decorations`).set(auth(m.token)).send({ decorationId: d }).expect(201);
    }
    await prisma.user.update({ where: { id: m.user.id }, data: { balance: 3500 } });
    await runHours(1);
    const stall = await prisma.stall.findUniqueOrThrow({ where: { id: s.id } });
    expect(stall.score).toBeGreaterThanOrEqual(50);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: m.user.id } })).status).toBe("EXPERIENCED");

    await prisma.user.update({ where: { id: m.user.id }, data: { balance: 0 } });
    await runHours(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: m.user.id } })).status).toBe("BEGINNER");
  });
});

describe("fair customers endpoint", () => {
  it("returns only customers visiting this hour, with their target stalls", async () => {
    const m = await registerMerchant();
    const s = await openStall(m.token, catalog.products.apples);
    await prisma.user.update({ where: { id: m.user.id }, data: { balance: 1000 } }); // pay back the 300 stall price so the math below stays simple
    await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 300 }).expect(200);
    await setGameClock(1, 8);
    await runHours(1); // simulate 09:00 (peak)
    const res = await api().get("/api/fair/customers").set(auth(m.token));
    expect(res.status).toBe(200);
    expect(res.body.clock).toMatchObject({ day: 1, hour: 9, msPerGameHour: 150000 });
    const visitors = await prisma.customer.count({ where: { visitHour: 9, listDay: 1 } });
    expect(res.body.customers.length).toBe(visitors);
    const buyers = res.body.customers.filter((c: { targetStallId: number | null }) => c.targetStallId !== null);
    for (const b of buyers) expect(b.targetStallIds).toContain(s.id);
    const salesNow = await prisma.sale.count({ where: { gameDay: 1, gameHour: 9 } });
    expect(buyers.length > 0).toBe(salesNow > 0);
  });
});
