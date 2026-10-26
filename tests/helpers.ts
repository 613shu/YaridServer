import request from "supertest";
import { createApp } from "../src/app";
import { hashPassword } from "../src/auth/password";
import { signToken } from "../src/auth/jwt";
import { prisma } from "../src/db/prisma";

export const app = createApp();
export const api = () => request(app);

/** Wipes every table (test database only). */
export async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "Sale", "SalesDailySummary", "Transaction", "Loan", "Notification", "StallDecoration",
      "Stall", "Customer", "Decoration", "Product", "Category", "User", "GameState"
    RESTART IDENTITY CASCADE`);
  await prisma.gameState.create({ data: { id: 1, currentDay: 1, currentHour: 0, lastTickAt: new Date() } });
}

export interface Catalog {
  categories: { food: number; toys: number };
  products: { apples: number; bread: number; top: number; inactive: number };
  decorations: { flags: number; lamp: number; carpet: number };
}

export async function seedCatalog(): Promise<Catalog> {
  const food = await prisma.category.create({ data: { name: "Food" } });
  const toys = await prisma.category.create({ data: { name: "Toys" } });
  const apples = await prisma.product.create({
    data: { name: "Apples", categoryId: food.id, supplierPrice: 3, marketPrice: 6, popularity: 90 },
  });
  const bread = await prisma.product.create({
    data: { name: "Bread", categoryId: food.id, supplierPrice: 5, marketPrice: 10, popularity: 70 },
  });
  const top = await prisma.product.create({
    data: { name: "Spinning top", categoryId: toys.id, supplierPrice: 4, marketPrice: 8, popularity: 60, targetAge: "YOUNG" },
  });
  const inactive = await prisma.product.create({
    data: { name: "Old lamp", categoryId: toys.id, supplierPrice: 4, marketPrice: 8, popularity: 10, isActive: false },
  });
  const flags = await prisma.decoration.create({ data: { name: "Flags", cost: 20, points: 10 } });
  const lamp = await prisma.decoration.create({ data: { name: "Lamp", cost: 50, points: 20 } });
  const carpet = await prisma.decoration.create({ data: { name: "Carpet", cost: 5000, points: 40 } });
  return {
    categories: { food: food.id, toys: toys.id },
    products: { apples: apples.id, bread: bread.id, top: top.id, inactive: inactive.id },
    decorations: { flags: flags.id, lamp: lamp.id, carpet: carpet.id },
  };
}

export async function createAdmin() {
  const user = await prisma.user.create({
    data: { email: "admin@test.local", passwordHash: await hashPassword("Admin1234!"), displayName: "Rosh HaKahal", role: "ADMIN" },
  });
  return { user, token: signToken({ sub: user.id, role: "ADMIN" }) };
}

let counter = 0;
export async function registerMerchant(name = "Merchant") {
  counter++;
  const email = `merchant${counter}-${Date.now()}@test.local`;
  const res = await api().post("/api/auth/register").send({ email, password: "Password123", displayName: `${name} ${counter}` });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, user: res.body.user as { id: number; email: string; balance: number }, email };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function openStall(token: string, productId: number, extra: Record<string, unknown> = {}) {
  const res = await api()
    .post("/api/stalls")
    .set(auth(token))
    .send({ name: "My stall", productId, price: 6, ...extra });
  if (res.status !== 201) throw new Error(`open stall failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; slotNumber: number };
}

export async function balanceOf(userId: number) {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).balance;
}

export async function setGameClock(day: number, hour: number) {
  await prisma.gameState.update({ where: { id: 1 }, data: { currentDay: day, currentHour: hour } });
}

/** Deterministic random numbers for simulation tests. */
export function seededRng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
