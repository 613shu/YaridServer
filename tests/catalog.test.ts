import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, createAdmin, registerMerchant, resetDb, seedCatalog, type Catalog } from "./helpers";

let catalog: Catalog;
let admin: string;
let merchant: string;

beforeAll(async () => {
  await resetDb();
  catalog = await seedCatalog();
  admin = (await createAdmin()).token;
  merchant = (await registerMerchant()).token;
});

describe("categories", () => {
  it("admin creates, lists and updates categories", async () => {
    const created = await api().post("/api/categories").set(auth(admin)).send({ name: "Books", description: "Paper things" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Books", description: "Paper things" });

    const list = await api().get("/api/categories").set(auth(merchant));
    expect(list.status).toBe(200);
    expect(list.body.map((c: { name: string }) => c.name)).toEqual(["Books", "Food", "Toys"]);
    expect(list.body.find((c: { name: string }) => c.name === "Food").productCount).toBe(2);

    const updated = await api().patch(`/api/categories/${created.body.id}`).set(auth(admin)).send({ name: "Books & pens" });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Books & pens");
  });

  it("validates and rejects duplicates", async () => {
    expect((await api().post("/api/categories").set(auth(admin)).send({ name: "X" })).status).toBe(400);
    expect((await api().post("/api/categories").set(auth(admin)).send({ name: "y".repeat(31) })).status).toBe(400);
    expect((await api().post("/api/categories").set(auth(admin)).send({ name: "Food" })).status).toBe(409);
    expect((await api().patch("/api/categories/9999").set(auth(admin)).send({ name: "Nope" })).status).toBe(404);
    expect((await api().patch(`/api/categories/${catalog.categories.food}`).set(auth(admin)).send({})).status).toBe(400);
  });
});

describe("products", () => {
  it("admin creates a product", async () => {
    const res = await api().post("/api/products").set(auth(admin)).send({
      name: "Honey cake",
      categoryId: catalog.categories.food,
      supplierPrice: 10,
      marketPrice: 20,
      popularity: 50,
      targetAge: "OLD",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Honey cake", targetGender: "ANY", targetAge: "OLD", isActive: true, category: { name: "Food" } });
  });

  it.each([
    [{ supplierPrice: 10, marketPrice: 10 }, "marketPrice"],
    [{ supplierPrice: 0, marketPrice: 10 }, "supplierPrice"],
    [{ popularity: 0 }, "popularity"],
    [{ popularity: 101 }, "popularity"],
    [{ targetGender: "CHILD" }, "targetGender"],
  ])("rejects invalid product %o", async (override, field) => {
    const res = await api()
      .post("/api/products")
      .set(auth(admin))
      .send({ name: `P-${field}-${Math.random()}`, categoryId: catalog.categories.food, supplierPrice: 5, marketPrice: 10, popularity: 50, ...override });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain(field);
  });

  it("rejects an unknown category and a duplicate name", async () => {
    const base = { supplierPrice: 5, marketPrice: 10, popularity: 50 };
    expect((await api().post("/api/products").set(auth(admin)).send({ ...base, name: "Ghost", categoryId: 9999 })).status).toBe(400);
    expect((await api().post("/api/products").set(auth(admin)).send({ ...base, name: "Apples", categoryId: catalog.categories.food })).status).toBe(409);
  });

  it("patch keeps marketPrice > supplierPrice using the stored values", async () => {
    const bad = await api().patch(`/api/products/${catalog.products.apples}`).set(auth(admin)).send({ supplierPrice: 6 });
    expect(bad.status).toBe(400);
    const ok = await api().patch(`/api/products/${catalog.products.apples}`).set(auth(admin)).send({ popularity: 95 });
    expect(ok.status).toBe(200);
    expect(ok.body.popularity).toBe(95);
  });

  it("searches, filters and sorts", async () => {
    const search = await api().get("/api/products?search=APP").set(auth(merchant));
    expect(search.body.map((p: { name: string }) => p.name)).toEqual(["Apples"]);

    const toys = await api().get(`/api/products?categoryId=${catalog.categories.toys}`).set(auth(merchant));
    expect(toys.body.map((p: { name: string }) => p.name)).toEqual(["Spinning top"]);

    const byPrice = await api().get("/api/products?sort=price").set(auth(merchant));
    const prices = byPrice.body.map((p: { marketPrice: number }) => p.marketPrice);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));

    const byPop = await api().get("/api/products?sort=popularity").set(auth(merchant));
    expect(byPop.body[0].name).toBe("Apples");

    const byName = await api().get("/api/products?sort=name&order=desc").set(auth(merchant));
    expect(byName.body[0].name).toBe("Spinning top");

    expect((await api().get("/api/products?sort=color").set(auth(merchant))).status).toBe(400);
  });

  it("hides inactive products from merchants, admin can include them", async () => {
    const m = await api().get("/api/products?includeInactive=true").set(auth(merchant));
    expect(m.body.some((p: { name: string }) => p.name === "Old lamp")).toBe(false);
    const a = await api().get("/api/products?includeInactive=true").set(auth(admin));
    expect(a.body.some((p: { name: string }) => p.name === "Old lamp")).toBe(true);
  });

  it("lists decorations", async () => {
    const res = await api().get("/api/decorations").set(auth(merchant));
    expect(res.status).toBe(200);
    expect(res.body.map((d: { name: string }) => d.name)).toEqual(["Flags", "Lamp", "Carpet"]);
  });
});
