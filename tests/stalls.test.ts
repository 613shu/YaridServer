import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { api, auth, balanceOf, openStall, registerMerchant, resetDb, seedCatalog, setGameClock, type Catalog } from "./helpers";

let catalog: Catalog;
let m: Awaited<ReturnType<typeof registerMerchant>>;

beforeAll(async () => {
  await resetDb();
  catalog = await seedCatalog();
});

beforeEach(async () => {
  m = await registerMerchant();
});

describe("opening stalls", () => {
  it("every stall costs 300 (no free stall), slots are unique", async () => {
    const first = await openStall(m.token, catalog.products.apples, { name: "Apple corner" });
    expect(await balanceOf(m.user.id)).toBe(700);
    const second = await openStall(m.token, catalog.products.bread);
    expect(await balanceOf(m.user.id)).toBe(400);
    expect(first.slotNumber).not.toBe(second.slotNumber);

    const purchases = await prisma.transaction.findMany({ where: { merchantId: m.user.id, type: "STALL_PURCHASE" }, orderBy: { id: "asc" } });
    expect(purchases.map((t) => t.amount)).toEqual([-300, -300]);
    expect(purchases[1]!.balanceAfter).toBe(400);
  });

  it("returns the full stall without the score", async () => {
    const res = await api()
      .post("/api/stalls")
      .set(auth(m.token))
      .send({ name: "  Morning bakery ", productId: catalog.products.bread, price: 11 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Morning bakery",
      price: 11,
      stock: 0,
      status: "ACTIVE",
      product: { id: catalog.products.bread, name: "Bread", category: { name: "Food" } },
      decorations: [],
    });
    expect(res.body.score).toBeUndefined();
    expect(res.body.openHour).toBeUndefined();
    expect(res.body.closeHour).toBeUndefined();
  });

  it.each([
    [{ name: "A" }, "name"],
    [{ price: 0 }, "price"],
    [{ price: 2.5 }, "price"],
    [{ productId: undefined }, "productId"],
  ])("validates the body %o", async (override, field) => {
    const res = await api()
      .post("/api/stalls")
      .set(auth(m.token))
      .send({ name: "Valid", productId: catalog.products.apples, price: 5, ...override });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain(field);
  });

  it("rejects unknown and inactive products", async () => {
    expect((await api().post("/api/stalls").set(auth(m.token)).send({ name: "X1", productId: 99999, price: 5 })).status).toBe(400);
    const inactive = await api().post("/api/stalls").set(auth(m.token)).send({ name: "X2", productId: catalog.products.inactive, price: 5 });
    expect(inactive.status).toBe(409);
    expect(inactive.body.error.code).toBe("PRODUCT_INACTIVE");
  });

  it("422 when there is not enough money for another stall", async () => {
    await openStall(m.token, catalog.products.apples);
    await prisma.user.update({ where: { id: m.user.id }, data: { balance: 299 } });
    const res = await api().post("/api/stalls").set(auth(m.token)).send({ name: "Too poor", productId: catalog.products.apples, price: 5 });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "INSUFFICIENT_FUNDS", details: { needed: 300, balance: 299 } });
    expect(await prisma.stall.count({ where: { merchantId: m.user.id } })).toBe(1);
  });

  it("409 after 100 stalls", async () => {
    const used = await prisma.stall.aggregate({ _max: { slotNumber: true } });
    let slot = (used._max.slotNumber ?? 0) + 1000;
    await prisma.stall.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        merchantId: m.user.id,
        productId: catalog.products.apples,
        name: `Stall ${i}`,
        price: 5,
        slotNumber: slot++,
        createdGameDay: 1,
      })),
    });
    const res = await api().post("/api/stalls").set(auth(m.token)).send({ name: "One too many", productId: catalog.products.apples, price: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STALL_LIMIT_REACHED");
    await prisma.stall.deleteMany({ where: { merchantId: m.user.id } });
  });

  it("reuses a freed slot number", async () => {
    const a = await openStall(m.token, catalog.products.apples);
    await api().delete(`/api/stalls/${a.id}`).set(auth(m.token)).expect(200);
    const b = await openStall(m.token, catalog.products.apples);
    expect(b.slotNumber).toBeLessThanOrEqual(a.slotNumber);
  });
});

describe("editing stalls", () => {
  it("updates name and price", async () => {
    const s = await openStall(m.token, catalog.products.apples);
    const res = await api().patch(`/api/stalls/${s.id}`).set(auth(m.token)).send({ name: "Renamed", price: 7 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Renamed", price: 7 });
  });

  it("there are no opening hours to update", async () => {
    const s = await openStall(m.token, catalog.products.apples);
    const res = await api().patch(`/api/stalls/${s.id}`).set(auth(m.token)).send({ openHour: 12 });
    expect(res.status).toBe(400); // unknown field is ignored → nothing to update
  });

  it("product can change only when stock is 0", async () => {
    const s = await openStall(m.token, catalog.products.apples);
    const ok = await api().patch(`/api/stalls/${s.id}`).set(auth(m.token)).send({ productId: catalog.products.bread });
    expect(ok.status).toBe(200);
    expect(ok.body.product.id).toBe(catalog.products.bread);

    await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 2 }).expect(200);
    const blocked = await api().patch(`/api/stalls/${s.id}`).set(auth(m.token)).send({ productId: catalog.products.apples });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("STOCK_NOT_EMPTY");
  });
});

describe("stock and decorations", () => {
  it("buys stock at supplier price", async () => {
    const s = await openStall(m.token, catalog.products.bread); // supplierPrice 5
    const res = await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 20 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cost: 100, balance: 600, stall: { stock: 20 } });
    const tx = await prisma.transaction.findFirst({ where: { merchantId: m.user.id, type: "STOCK_PURCHASE" } });
    expect(tx).toMatchObject({ amount: -100, balanceAfter: 600, stallId: s.id });
  });

  it("validates quantity and money", async () => {
    const s = await openStall(m.token, catalog.products.bread);
    expect((await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 0 })).status).toBe(400);
    expect((await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: "5" })).status).toBe(400);
    const poor = await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 201 }); // 1005 > 700
    expect(poor.status).toBe(422);
    expect(await balanceOf(m.user.id)).toBe(700);
  });

  it("adds each decoration once", async () => {
    const s = await openStall(m.token, catalog.products.apples);
    const first = await api().post(`/api/stalls/${s.id}/decorations`).set(auth(m.token)).send({ decorationId: catalog.decorations.flags });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ cost: 20, balance: 680, stall: { decorationSpent: 20, decorationPoints: 10 } });
    const again = await api().post(`/api/stalls/${s.id}/decorations`).set(auth(m.token)).send({ decorationId: catalog.decorations.flags });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("DECORATION_EXISTS");
    const tooExpensive = await api().post(`/api/stalls/${s.id}/decorations`).set(auth(m.token)).send({ decorationId: catalog.decorations.carpet });
    expect(tooExpensive.status).toBe(422);
    const unknown = await api().post(`/api/stalls/${s.id}/decorations`).set(auth(m.token)).send({ decorationId: 99999 });
    expect(unknown.status).toBe(400);
  });
});

describe("selling and closing", () => {
  it("cannot sell before 3 game days, then sells with the formula", async () => {
    await setGameClock(10, 5);
    const s = await openStall(m.token, catalog.products.apples); // supplier 3
    await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 10 }).expect(200); // -300 stall, -30 → 670
    await api().post(`/api/stalls/${s.id}/decorations`).set(auth(m.token)).send({ decorationId: catalog.decorations.lamp }).expect(201); // -50 → 620
    await prisma.stall.update({ where: { id: s.id }, data: { score: 50 } });

    const quote = await api().get(`/api/stalls/${s.id}/sale-quote`).set(auth(m.token));
    // factor = 0.3 + 0.9 × 0.5 = 0.75 → (300 + 50) × 0.75 = 262.5 → 263; stock 10 × 3 × 0.5 = 15
    expect(quote.body).toMatchObject({ canSell: false, ageInGameDays: 0, availableFromDay: 13, stallValue: 263, stockValue: 15, total: 278 });
    expect(quote.body.factor).toBeUndefined();

    const tooNew = await api().post(`/api/stalls/${s.id}/sell`).set(auth(m.token));
    expect(tooNew.status).toBe(409);
    expect(tooNew.body.error.code).toBe("STALL_TOO_NEW");

    await setGameClock(13, 0);
    const sold = await api().post(`/api/stalls/${s.id}/sell`).set(auth(m.token));
    expect(sold.status).toBe(200);
    expect(sold.body).toMatchObject({ total: 278, balance: 620 + 278 });
    expect(await prisma.stall.findUnique({ where: { id: s.id } })).toBeNull();
    const tx = await prisma.transaction.findFirst({ where: { merchantId: m.user.id, type: "STALL_SOLD" } });
    expect(tx).toMatchObject({ amount: 278, balanceAfter: 898 });
  });

  it("closing refunds 50% of stock value", async () => {
    const s = await openStall(m.token, catalog.products.bread); // supplier 5
    await api().post(`/api/stalls/${s.id}/stock`).set(auth(m.token)).send({ quantity: 9 }).expect(200); // -300 stall, -45 → 655
    const res = await api().delete(`/api/stalls/${s.id}`).set(auth(m.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ refund: 23, balance: 678 }); // 9 × 5 × 0.5 = 22.5 → 23
    expect((await api().get(`/api/stalls/${s.id}`).set(auth(m.token))).status).toBe(404);
  });
});

describe("my stalls list", () => {
  it("searches, filters and sorts", async () => {
    await openStall(m.token, catalog.products.apples, { name: "Zebra apples", price: 9 });
    await openStall(m.token, catalog.products.bread, { name: "Alpha bread", price: 4 });
    await openStall(m.token, catalog.products.top, { name: "Middle toys", price: 6 });
    const stalls = await prisma.stall.findMany({ where: { merchantId: m.user.id } });
    await prisma.stall.update({ where: { id: stalls.find((s) => s.name === "Middle toys")!.id }, data: { status: "SUSPENDED" } });

    const byName = await api().get("/api/stalls/mine?sort=name").set(auth(m.token));
    expect(byName.body.map((s: { name: string }) => s.name)).toEqual(["Alpha bread", "Middle toys", "Zebra apples"]);
    expect(byName.body[0].sales).toEqual({ todayUnits: 0, todayRevenue: 0, totalUnits: 0, totalRevenue: 0 });
    expect(byName.body[0].score).toBeUndefined();

    const byPrice = await api().get("/api/stalls/mine?sort=price&order=desc").set(auth(m.token));
    expect(byPrice.body.map((s: { price: number }) => s.price)).toEqual([9, 6, 4]);

    const search = await api().get("/api/stalls/mine?search=bread").set(auth(m.token));
    expect(search.body).toHaveLength(1);
    const searchProduct = await api().get("/api/stalls/mine?search=spinning").set(auth(m.token));
    expect(searchProduct.body.map((s: { name: string }) => s.name)).toEqual(["Middle toys"]);

    const toys = await api().get(`/api/stalls/mine?categoryId=${catalog.categories.toys}`).set(auth(m.token));
    expect(toys.body).toHaveLength(1);

    const suspended = await api().get("/api/stalls/mine?status=SUSPENDED").set(auth(m.token));
    expect(suspended.body.map((s: { name: string }) => s.name)).toEqual(["Middle toys"]);

    expect((await api().get("/api/stalls/mine?status=CLOSED").set(auth(m.token))).status).toBe(400);
  });
});
