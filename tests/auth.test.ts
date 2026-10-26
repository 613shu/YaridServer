import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { api, auth, registerMerchant, resetDb } from "./helpers";

beforeAll(resetDb);

describe("auth", () => {
  it("registers a merchant with the welcome gift", async () => {
    const res = await api()
      .post("/api/auth/register")
      .send({ email: "Sara@Test.local", password: "Password123", displayName: "Sara" });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user).toMatchObject({ email: "sara@test.local", displayName: "Sara", role: "MERCHANT", balance: 1000, status: "BEGINNER" });
    expect(res.body.user.passwordHash).toBeUndefined();

    const tx = await prisma.transaction.findMany({ where: { merchantId: res.body.user.id } });
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ type: "OPENING_GRANT", amount: 1000, balanceAfter: 1000 });
  });

  it("rejects a duplicate email with 409", async () => {
    const res = await api().post("/api/auth/register").send({ email: "sara@test.local", password: "Password123", displayName: "Sara 2" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_EXISTS");
  });

  it.each([
    [{ email: "bad", password: "Password123", displayName: "Ok" }, "email"],
    [{ email: "a@b.co", password: "short", displayName: "Ok" }, "password"],
    [{ email: "a@b.co", password: "Password123", displayName: "A" }, "displayName"],
    [{ email: "a@b.co", password: "Password123", displayName: "x".repeat(31) }, "displayName"],
    [{ email: "a@b.co", password: "Password123" }, "displayName"],
  ])("validates the register body (%o)", async (body, field) => {
    const res = await api().post("/api/auth/register").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body.error.details)).toContain(field);
  });

  it("logs in and returns the current user", async () => {
    const login = await api().post("/api/auth/login").send({ email: "sara@test.local", password: "Password123" });
    expect(login.status).toBe(200);
    const me = await api().get("/api/auth/me").set(auth(login.body.token));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: "sara@test.local" });
    expect(me.body.freeStallAvailable).toBeUndefined();
  });

  it("rejects a wrong password with 401", async () => {
    const res = await api().post("/api/auth/login").send({ email: "sara@test.local", password: "WrongPassword" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects missing, malformed and forged tokens with 401", async () => {
    expect((await api().get("/api/auth/me")).status).toBe(401);
    expect((await api().get("/api/auth/me").set("Authorization", "Token abc")).status).toBe(401);
    expect((await api().get("/api/auth/me").set(auth("not.a.jwt"))).status).toBe(401);
    const forged =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiQURNSU4iLCJzdWIiOiIxIn0.c2lnbmF0dXJlLWlzLXdyb25n";
    const res = await api().get("/api/auth/me").set(auth(forged));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED", message: expect.any(String) } });
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await api().post("/api/auth/login").set("Content-Type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("health is public", async () => {
    const res = await api().get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("unknown routes return the standard error format", async () => {
    const res = await api().get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("registerMerchant helper works", async () => {
    const m = await registerMerchant();
    expect(m.user.balance).toBe(1000);
  });
});
