import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { runTick } from "../src/simulation/engine";
import { api, auth, createAdmin, openStall, registerMerchant, resetDb, seedCatalog, seededRng, type Catalog } from "./helpers";

let catalog: Catalog;
let admin: string;
let alice: Awaited<ReturnType<typeof registerMerchant>>;
let bob: Awaited<ReturnType<typeof registerMerchant>>;
let aliceStall: number;
let bobStall: number;

beforeAll(async () => {
  await resetDb();
  catalog = await seedCatalog();
  admin = (await createAdmin()).token;
  alice = await registerMerchant("Alice");
  bob = await registerMerchant("Bob");
  aliceStall = (await openStall(alice.token, catalog.products.apples, { name: "Alice apples" })).id;
  bobStall = (await openStall(bob.token, catalog.products.top, { name: "Bob toys", price: 30 })).id;
  await api().post(`/api/stalls/${aliceStall}/stock`).set(auth(alice.token)).send({ quantity: 200 }).expect(200);
  const rng = seededRng(5);
  for (let i = 0; i < 12; i++) await runTick({ force: true, rng });
});

describe("admin dashboard", () => {
  it("returns totals and chart data", async () => {
    const res = await api().get("/api/admin/stats").set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ merchants: 2, stalls: 2, activeStalls: 2, suspendedStalls: 0 });
    expect(res.body.totals.unitsSoldAllTime).toBeGreaterThan(0);
    expect(res.body.merchantsByStatus.map((s: { status: string }) => s.status)).toEqual(["BEGINNER", "EXPERIENCED", "GVIR"]);
    expect(res.body.salesPerDay.at(-1).day).toBe(1);
    expect(res.body.salesByCategory.map((c: { name: string }) => c.name)).toContain("Food");
    expect(res.body.topStalls[0].score).toBeGreaterThanOrEqual(res.body.topStalls[1].score);
  });
});

describe("merchants", () => {
  it("lists, searches, filters and sorts merchants", async () => {
    const all = await api().get("/api/admin/merchants").set(auth(admin));
    expect(all.body.total).toBe(2);
    expect(all.body.items[0]).toHaveProperty("netWorth");
    expect(all.body.items[0].passwordHash).toBeUndefined();

    const search = await api().get("/api/admin/merchants?search=alice").set(auth(admin));
    expect(search.body.items.map((u: { id: number }) => u.id)).toEqual([alice.user.id]);

    const byName = await api().get("/api/admin/merchants?sort=name").set(auth(admin));
    expect(byName.body.items[0].id).toBe(alice.user.id);
    const byBalance = await api().get("/api/admin/merchants?sort=balance&order=asc").set(auth(admin));
    expect(byBalance.body.items[0].balance).toBeLessThanOrEqual(byBalance.body.items[1].balance);

    const gvir = await api().get("/api/admin/merchants?status=GVIR").set(auth(admin));
    expect(gvir.body.total).toBe(0);
    expect((await api().get("/api/admin/merchants?status=KING").set(auth(admin))).status).toBe(400);
  });

  it("shows merchant details with stall scores", async () => {
    const res = await api().get(`/api/admin/merchants/${alice.user.id}`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.stalls[0].score).toBeTypeOf("number");
    expect(res.body.recentTransactions.length).toBeGreaterThan(0);
    expect((await api().get("/api/admin/merchants/99999").set(auth(admin))).status).toBe(404);
  });

  it("gives grants", async () => {
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: bob.user.id } })).balance;
    const res = await api().post(`/api/admin/merchants/${bob.user.id}/grants`).set(auth(admin)).send({ amount: 250, message: "Gift" });
    expect(res.status).toBe(201);
    expect(res.body.balance).toBe(before + 250);
    const tx = await prisma.transaction.findFirstOrThrow({ where: { merchantId: bob.user.id, type: "ADMIN_GRANT" } });
    expect(tx).toMatchObject({ amount: 250, balanceAfter: before + 250 });
    expect((await api().post(`/api/admin/merchants/${bob.user.id}/grants`).set(auth(admin)).send({ amount: -5, message: "x" })).status).toBe(400);
  });
});

describe("stalls", () => {
  it("lists all stalls with score, filters and sorts", async () => {
    const all = await api().get("/api/admin/stalls").set(auth(admin));
    expect(all.body.total).toBe(2);
    const scores = all.body.items.map((s: { score: number }) => s.score);
    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));

    const byMerchant = await api().get(`/api/admin/stalls?merchantId=${bob.user.id}`).set(auth(admin));
    expect(byMerchant.body.items.map((s: { id: number }) => s.id)).toEqual([bobStall]);
    const byCategory = await api().get(`/api/admin/stalls?categoryId=${catalog.categories.food}`).set(auth(admin));
    expect(byCategory.body.items.map((s: { id: number }) => s.id)).toEqual([aliceStall]);
    const search = await api().get("/api/admin/stalls?search=bob").set(auth(admin));
    expect(search.body.items.map((s: { id: number }) => s.id)).toEqual([bobStall]);
  });

  it("suspends and unsuspends with notifications", async () => {
    const res = await api().post(`/api/admin/stalls/${bobStall}/suspend`).set(auth(admin)).send({ reason: "Prices too high" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "SUSPENDED", suspensionReason: "Prices too high" });
    expect((await api().get("/api/admin/stalls?status=SUSPENDED").set(auth(admin))).body.total).toBe(1);
    expect((await api().post(`/api/admin/stalls/${bobStall}/suspend`).set(auth(admin)).send({})).status).toBe(400);

    const un = await api().post(`/api/admin/stalls/${bobStall}/unsuspend`).set(auth(admin));
    expect(un.body).toMatchObject({ status: "ACTIVE", suspensionReason: null });
    const notes = await prisma.notification.findMany({ where: { userId: bob.user.id }, orderBy: { id: "asc" } });
    expect(notes.map((n) => n.type)).toEqual(["GRANT", "SUSPENSION", "UNSUSPENSION"]);
    expect((await api().post("/api/admin/stalls/99999/suspend").set(auth(admin)).send({ reason: "Nope" })).status).toBe(404);
  });
});

describe("sales and payments", () => {
  it("lists all sales with filters", async () => {
    const all = await api().get("/api/admin/sales").set(auth(admin));
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThan(0);
    expect(all.body.totals.units).toBe(all.body.total);
    const bobs = await api().get(`/api/admin/sales?merchantId=${bob.user.id}`).set(auth(admin));
    for (const s of bobs.body.items) expect(s.merchantId).toBe(bob.user.id);
    const toys = await api().get(`/api/admin/sales?categoryId=${catalog.categories.toys}`).set(auth(admin));
    for (const s of toys.body.items) expect(s.product.category.id).toBe(catalog.categories.toys);
    const none = await api().get("/api/admin/sales?fromDay=5").set(auth(admin));
    expect(none.body.total).toBe(0);
  });

  it("lists all payments with filters", async () => {
    const all = await api().get("/api/admin/transactions").set(auth(admin));
    expect(all.body.total).toBeGreaterThan(4);
    const grants = await api().get("/api/admin/transactions?type=ADMIN_GRANT").set(auth(admin));
    expect(grants.body.items.every((t: { type: string }) => t.type === "ADMIN_GRANT")).toBe(true);
    const alices = await api().get(`/api/admin/transactions?merchantId=${alice.user.id}`).set(auth(admin));
    expect(alices.body.items.every((t: { merchantId: number }) => t.merchantId === alice.user.id)).toBe(true);
  });
});
