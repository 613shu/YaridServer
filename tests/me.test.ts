import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { api, auth, createAdmin, openStall, registerMerchant, resetDb, seedCatalog, setGameClock, type Catalog } from "./helpers";

let catalog: Catalog;
let adminToken: string;

beforeAll(async () => {
  await resetDb();
  catalog = await seedCatalog();
  adminToken = (await createAdmin()).token;
});

async function addSales(merchantId: number, stallId: number, productId: number, days: number[]) {
  const customer = await prisma.customer.create({
    data: { nickname: "Buyer", gender: "MALE", ageGroup: "YOUNG", dailyBudget: 100, budgetLeft: 100, visitHour: 9, shoppingList: [], listDay: 1 },
  });
  await prisma.sale.createMany({
    data: days.map((gameDay, i) => ({
      stallId,
      merchantId,
      productId,
      customerId: customer.id,
      customerGender: i % 2 === 0 ? ("MALE" as const) : ("FEMALE" as const),
      customerAge: "YOUNG" as const,
      unitPrice: 5 + i,
      quantity: 1,
      gameDay,
      gameHour: 9,
    })),
  });
}

describe("summary", () => {
  it("shows balance, status, income, expenses, loan and net worth", async () => {
    const m = await registerMerchant();
    const s1 = await openStall(m.token, catalog.products.apples); // -300
    await openStall(m.token, catalog.products.bread); // -300
    await api().post(`/api/stalls/${s1.id}/stock`).set(auth(m.token)).send({ quantity: 10 }).expect(200); // -30 → 370
    await api().post("/api/me/loan").set(auth(m.token)).send({ amount: 200 }).expect(201); // +200 → 570

    const res = await api().get("/api/me/summary").set(auth(m.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      balance: 570,
      status: "BEGINNER",
      income: 1000,
      expenses: 630,
      stockValue: 30,
      netWorth: 570 + 30 - 200,
      stallsCount: 2,
      loan: { amount: 200, remaining: 200 },
      unreadNotifications: 0,
    });
    expect(res.body.expensesByType.STOCK_PURCHASE).toBe(30);
  });
});

describe("sales", () => {
  it("paginates, filters and sorts my sales", async () => {
    const m = await registerMerchant();
    const s1 = await openStall(m.token, catalog.products.apples);
    const s2 = await openStall(m.token, catalog.products.bread);
    await addSales(m.user.id, s1.id, catalog.products.apples, [1, 2, 3, 4, 5]);
    await addSales(m.user.id, s2.id, catalog.products.bread, [5, 6]);

    const all = await api().get("/api/me/sales?pageSize=3").set(auth(m.token));
    expect(all.body).toMatchObject({ page: 1, pageSize: 3, total: 7, totalPages: 3 });
    expect(all.body.items).toHaveLength(3);

    const page3 = await api().get("/api/me/sales?pageSize=3&page=3").set(auth(m.token));
    expect(page3.body.items).toHaveLength(1);

    const byStall = await api().get(`/api/me/sales?stallId=${s2.id}`).set(auth(m.token));
    expect(byStall.body.total).toBe(2);
    const byProduct = await api().get(`/api/me/sales?productId=${catalog.products.apples}`).set(auth(m.token));
    expect(byProduct.body.total).toBe(5);
    const range = await api().get("/api/me/sales?fromDay=2&toDay=4").set(auth(m.token));
    expect(range.body.items.map((s: { gameDay: number }) => s.gameDay).sort()).toEqual([2, 3, 4]);

    const oldest = await api().get("/api/me/sales?sort=oldest").set(auth(m.token));
    expect(oldest.body.items[0].gameDay).toBe(1);
    const price = await api().get("/api/me/sales?sort=price").set(auth(m.token));
    const prices = price.body.items.map((s: { unitPrice: number }) => s.unitPrice);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => b - a));

    expect((await api().get("/api/me/sales?page=0").set(auth(m.token))).status).toBe(400);
    expect((await api().get("/api/me/sales?pageSize=1000").set(auth(m.token))).status).toBe(400);

    // other merchants never see my sales
    const other = await registerMerchant();
    expect((await api().get("/api/me/sales").set(auth(other.token))).body.total).toBe(0);
  });

  it("breaks sales down per product with gender and age", async () => {
    const m = await registerMerchant();
    const s = await openStall(m.token, catalog.products.apples);
    await addSales(m.user.id, s.id, catalog.products.apples, [1, 1, 1]);
    const res = await api().get("/api/me/sales/by-product").set(auth(m.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        product: { id: catalog.products.apples, name: "Apples" },
        quantity: 3,
        revenue: 5 + 6 + 7,
        customers: 3,
        byGender: { MALE: 2, FEMALE: 1 },
        byAge: { YOUNG: 3, OLD: 0 },
      },
    ]);
    const stalls = await api().get("/api/stalls/mine").set(auth(m.token));
    expect(stalls.body[0].sales).toMatchObject({ totalUnits: 3, totalRevenue: 18, todayUnits: 3, todayRevenue: 18 });
  });
});

describe("transactions", () => {
  it("lists my ledger newest first and filters by type", async () => {
    const m = await registerMerchant();
    const s = await openStall(m.token, catalog.products.apples);
    await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 1 }).expect(200);
    const all = await api().get("/api/me/transactions").set(auth(m.token));
    expect(all.body.items.map((t: { type: string }) => t.type)).toEqual(["STOCK_PURCHASE", "STALL_PURCHASE", "OPENING_GRANT"]);
    const filtered = await api().get("/api/me/transactions?type=STOCK_PURCHASE").set(auth(m.token));
    expect(filtered.body.total).toBe(1);
    expect((await api().get("/api/me/transactions?type=MAGIC").set(auth(m.token))).status).toBe(400);
  });
});

describe("loan", () => {
  it("enforces limits by status and one open loan", async () => {
    const m = await registerMerchant();
    const info = await api().get("/api/me/loan").set(auth(m.token));
    expect(info.body).toMatchObject({ loan: null, status: "BEGINNER", maxAmount: 500, canTakeLoan: true, repaymentShare: 0.3 });

    const tooMuch = await api().post("/api/me/loan").set(auth(m.token)).send({ amount: 501 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe("LOAN_LIMIT_EXCEEDED");
    expect((await api().post("/api/me/loan").set(auth(m.token)).send({ amount: 0 })).status).toBe(400);

    const ok = await api().post("/api/me/loan").set(auth(m.token)).send({ amount: 500 });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ balance: 1500, loan: { amount: 500, remaining: 500, status: "OPEN" } });

    const second = await api().post("/api/me/loan").set(auth(m.token)).send({ amount: 10 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("OPEN_LOAN_EXISTS");

    const after = await api().get("/api/me/loan").set(auth(m.token));
    expect(after.body).toMatchObject({ canTakeLoan: false, loan: { remaining: 500 } });
  });

  it("allows bigger loans for higher statuses", async () => {
    const m = await registerMerchant();
    await prisma.user.update({ where: { id: m.user.id }, data: { status: "GVIR" } });
    expect((await api().get("/api/me/loan").set(auth(m.token))).body.maxAmount).toBe(5000);
    expect((await api().post("/api/me/loan").set(auth(m.token)).send({ amount: 5000 })).status).toBe(201);
  });
});

describe("notifications", () => {
  it("receives admin messages and marks them read", async () => {
    const m = await registerMerchant();
    const s = await openStall(m.token, catalog.products.apples);
    await api().post(`/api/admin/stalls/${s.id}/suspend`).set(auth(adminToken)).send({ reason: "Dirty stall" }).expect(200);
    await api().post(`/api/admin/merchants/${m.user.id}/grants`).set(auth(adminToken)).send({ amount: 100, message: "Well done" }).expect(201);

    const list = await api().get("/api/me/notifications").set(auth(m.token));
    expect(list.body.unread).toBe(2);
    expect(list.body.items.map((n: { type: string }) => n.type)).toEqual(["GRANT", "SUSPENSION"]);
    expect(list.body.items[1].message).toContain("Dirty stall");

    const id = list.body.items[0].id;
    const read = await api().patch(`/api/me/notifications/${id}/read`).set(auth(m.token));
    expect(read.status).toBe(200);
    expect(read.body.isRead).toBe(true);
    expect((await api().get("/api/me/notifications").set(auth(m.token))).body.unread).toBe(1);

    const other = await registerMerchant();
    expect((await api().patch(`/api/me/notifications/${id}/read`).set(auth(other.token))).status).toBe(404);
  });
});

describe("clock in the fair page", () => {
  it("returns the game clock", async () => {
    await setGameClock(3, 17);
    const m = await registerMerchant();
    const res = await api().get("/api/fair").set(auth(m.token));
    expect(res.body.clock).toMatchObject({ day: 3, hour: 17, msPerGameHour: 150000, msPerGameDay: 3600000 });
  });
});
