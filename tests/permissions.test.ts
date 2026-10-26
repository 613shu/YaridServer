import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, createAdmin, openStall, registerMerchant, resetDb, seedCatalog, type Catalog } from "./helpers";

let catalog: Catalog;
let adminToken: string;
let merchant: Awaited<ReturnType<typeof registerMerchant>>;
let other: Awaited<ReturnType<typeof registerMerchant>>;
let stallId: number;

beforeAll(async () => {
  await resetDb();
  catalog = await seedCatalog();
  adminToken = (await createAdmin()).token;
  merchant = await registerMerchant("Owner");
  other = await registerMerchant("Other");
  stallId = (await openStall(merchant.token, catalog.products.apples)).id;
});

const adminOnly: [string, string][] = [
  ["get", "/api/admin/stats"],
  ["get", "/api/admin/merchants"],
  ["get", "/api/admin/merchants/1"],
  ["post", "/api/admin/merchants/1/grants"],
  ["get", "/api/admin/stalls"],
  ["post", "/api/admin/stalls/1/suspend"],
  ["post", "/api/admin/stalls/1/unsuspend"],
  ["get", "/api/admin/sales"],
  ["get", "/api/admin/transactions"],
  ["post", "/api/categories"],
  ["patch", "/api/categories/1"],
  ["post", "/api/products"],
  ["patch", "/api/products/1"],
];

const merchantOnly: [string, string][] = [
  ["get", "/api/stalls/mine"],
  ["post", "/api/stalls"],
  ["patch", "/api/stalls/1"],
  ["delete", "/api/stalls/1"],
  ["post", "/api/stalls/1/stock"],
  ["post", "/api/stalls/1/decorations"],
  ["get", "/api/stalls/1/sale-quote"],
  ["post", "/api/stalls/1/sell"],
  ["get", "/api/me/summary"],
  ["get", "/api/me/sales"],
  ["get", "/api/me/sales/by-product"],
  ["get", "/api/me/transactions"],
  ["get", "/api/me/loan"],
  ["post", "/api/me/loan"],
  ["get", "/api/me/notifications"],
  ["patch", "/api/me/notifications/1/read"],
];

type Method = "get" | "post" | "patch" | "delete";

describe("permissions", () => {
  it.each([...adminOnly, ...merchantOnly, ["get", "/api/fair"], ["get", "/api/products"], ["get", "/api/categories"]])(
    "guest gets 401 on %s %s",
    async (method, url) => {
      const res = await api()[method as Method](url);
      expect(res.status).toBe(401);
    },
  );

  it.each(adminOnly)("merchant gets 403 on admin route %s %s", async (method, url) => {
    const res = await api()[method as Method](url).set(auth(merchant.token)).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it.each(merchantOnly)("admin gets 403 on merchant route %s %s", async (method, url) => {
    const res = await api()[method as Method](url).set(auth(adminToken)).send({});
    expect(res.status).toBe(403);
  });

  it("both roles can view the fair and the catalog", async () => {
    for (const token of [merchant.token, adminToken]) {
      expect((await api().get("/api/fair").set(auth(token))).status).toBe(200);
      expect((await api().get("/api/products").set(auth(token))).status).toBe(200);
      expect((await api().get("/api/categories").set(auth(token))).status).toBe(200);
      expect((await api().get("/api/decorations").set(auth(token))).status).toBe(200);
      expect((await api().get("/api/fair/customers").set(auth(token))).status).toBe(200);
    }
  });

  describe("ownership", () => {
    it("another merchant cannot see or touch my stall (403)", async () => {
      const calls = [
        api().get(`/api/stalls/${stallId}`).set(auth(other.token)),
        api().patch(`/api/stalls/${stallId}`).set(auth(other.token)).send({ price: 1 }),
        api().delete(`/api/stalls/${stallId}`).set(auth(other.token)),
        api().post(`/api/stalls/${stallId}/stock`).set(auth(other.token)).send({ quantity: 1 }),
        api().post(`/api/stalls/${stallId}/decorations`).set(auth(other.token)).send({ decorationId: catalog.decorations.flags }),
        api().get(`/api/stalls/${stallId}/sale-quote`).set(auth(other.token)),
        api().post(`/api/stalls/${stallId}/sell`).set(auth(other.token)),
      ];
      for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    });

    it("the owner sees the stall without a score, the admin sees the score", async () => {
      const own = await api().get(`/api/stalls/${stallId}`).set(auth(merchant.token));
      expect(own.status).toBe(200);
      expect(own.body.score).toBeUndefined();
      const adm = await api().get(`/api/stalls/${stallId}`).set(auth(adminToken));
      expect(adm.status).toBe(200);
      expect(adm.body.score).toBeTypeOf("number");
      expect(adm.body.merchant.id).toBe(merchant.user.id);
    });

    it("the fair never exposes score or exact stock", async () => {
      const res = await api().get("/api/fair").set(auth(other.token));
      const stall = res.body.stalls.find((s: { id: number }) => s.id === stallId);
      expect(stall.isMine).toBe(false);
      expect(stall.score).toBeUndefined();
      expect(stall.stock).toBeUndefined();
      const mine = await api().get("/api/fair").set(auth(merchant.token));
      expect(mine.body.stalls.find((s: { id: number }) => s.id === stallId).isMine).toBe(true);
    });

    it("a missing stall returns 404", async () => {
      const res = await api().get("/api/stalls/999999").set(auth(merchant.token));
      expect(res.status).toBe(404);
    });

    it("an invalid id returns 400", async () => {
      const res = await api().get("/api/stalls/abc").set(auth(merchant.token));
      expect(res.status).toBe(400);
    });
  });
});
