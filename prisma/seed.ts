/**
 * Seed: categories, ~30 products, decorations, the game clock,
 * a demo admin and a demo merchant.
 *
 * Safe to run many times (upserts). Existing users keep their passwords.
 * In production the demo users are created ONLY if their env vars are set:
 *   ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME
 *   DEMO_MERCHANT_EMAIL, DEMO_MERCHANT_PASSWORD, DEMO_MERCHANT_NAME
 */
import { config } from "dotenv";
config({ quiet: true });
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { TargetAge, TargetGender } from "../src/generated/prisma/enums";

function pgConfig() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  const sslEnv = process.env.DB_SSL;
  const ssl = sslEnv ? sslEnv === "true" || sslEnv === "1" : !local;
  url.searchParams.delete("sslmode");
  return { connectionString: url.toString(), ssl: ssl ? { rejectUnauthorized: false } : undefined };
}

const prisma = new PrismaClient({ adapter: new PrismaPg(pgConfig()) });
const isProduction = process.env.NODE_ENV === "production";

const CATEGORIES = [
  { name: "פירות וירקות", description: "תוצרת טרייה מהשדות והמטעים" },
  { name: "מאפים", description: "לחמים, חלות ועוגות מהתנור" },
  { name: "ממתקים", description: "מתוקים לכל המשפחה" },
  { name: "כלי בית", description: "כלים ומוצרים למטבח ולבית" },
  { name: "בדים והלבשה", description: "בדים, כובעים וצעיפים" },
  { name: "צעצועים ומשחקים", description: "שעשועים לילדים" },
  { name: "כלי עבודה", description: "כלים לבעלי מלאכה" },
  { name: "ספרים וכתיבה", description: "ספרים, מחברות וכלי כתיבה" },
];

type P = [name: string, category: string, supplier: number, market: number, popularity: number, gender: TargetGender, age: TargetAge];

const PRODUCTS: P[] = [
  ["תפוחים", "פירות וירקות", 3, 6, 80, "ANY", "ANY"],
  ["תפוזים", "פירות וירקות", 3, 7, 75, "ANY", "ANY"],
  ["מלפפונים", "פירות וירקות", 2, 5, 60, "FEMALE", "ANY"],
  ["תפוחי אדמה", "פירות וירקות", 2, 4, 70, "FEMALE", "OLD"],
  ["ענבים", "פירות וירקות", 5, 10, 65, "ANY", "ANY"],
  ["חלה", "מאפים", 6, 12, 90, "ANY", "ANY"],
  ["לחם שיפון", "מאפים", 5, 10, 70, "ANY", "OLD"],
  ["עוגת שמרים", "מאפים", 15, 30, 75, "ANY", "ANY"],
  ["בייגלה", "מאפים", 2, 5, 85, "ANY", "YOUNG"],
  ["סוכריות על מקל", "ממתקים", 1, 3, 85, "ANY", "YOUNG"],
  ["חלבה", "ממתקים", 8, 16, 55, "ANY", "OLD"],
  ["תפוח בדבש", "ממתקים", 4, 9, 70, "ANY", "YOUNG"],
  ["שקדים קלויים", "ממתקים", 7, 14, 50, "ANY", "ANY"],
  ["סיר נחושת", "כלי בית", 40, 80, 35, "FEMALE", "OLD"],
  ["סל נצרים", "כלי בית", 12, 24, 45, "FEMALE", "ANY"],
  ["פמוטים", "כלי בית", 30, 60, 40, "FEMALE", "OLD"],
  ["כוס כסף", "כלי בית", 35, 70, 30, "MALE", "OLD"],
  ["מטאטא", "כלי בית", 6, 12, 40, "FEMALE", "ANY"],
  ["צעיף צמר", "בדים והלבשה", 15, 30, 50, "FEMALE", "ANY"],
  ["כובע", "בדים והלבשה", 25, 50, 45, "MALE", "ANY"],
  ["בד פשתן", "בדים והלבשה", 20, 40, 30, "FEMALE", "OLD"],
  ["סביבון עץ", "צעצועים ומשחקים", 3, 7, 70, "MALE", "YOUNG"],
  ["בובת סמרטוטים", "צעצועים ומשחקים", 6, 12, 60, "FEMALE", "YOUNG"],
  ["חישוק וגולות", "צעצועים ומשחקים", 2, 5, 65, "MALE", "YOUNG"],
  ["פטיש", "כלי עבודה", 15, 30, 35, "MALE", "OLD"],
  ["מסמרים (שקית)", "כלי עבודה", 3, 6, 45, "MALE", "ANY"],
  ["מסור", "כלי עבודה", 25, 50, 25, "MALE", "OLD"],
  ["מחברת", "ספרים וכתיבה", 2, 5, 60, "ANY", "YOUNG"],
  ["עט נובע", "ספרים וכתיבה", 20, 40, 35, "MALE", "OLD"],
  ["ספר סיפורים", "ספרים וכתיבה", 10, 20, 50, "ANY", "YOUNG"],
];

/** Products removed from the catalog. Existing databases keep the row (old sales point to it) but it is turned off. */
const REMOVED_PRODUCTS = ["גרביים"];

const DECORATIONS = [
  { name: "דגלונים צבעוניים", cost: 20, points: 10 },
  { name: "מפת שולחן רקומה", cost: 35, points: 15 },
  { name: "עציצי פרחים", cost: 40, points: 15 },
  { name: "פנסי נייר", cost: 50, points: 20 },
  { name: "שלט עץ מגולף", cost: 60, points: 20 },
  { name: "סוכך מפוספס", cost: 80, points: 25 },
  { name: "פעמון נחושת", cost: 100, points: 30 },
  { name: "שטיח צבעוני", cost: 120, points: 35 },
];

async function upsertUser(params: { email?: string; password?: string; name: string; role: "ADMIN" | "MERCHANT" }) {
  if (!params.email || !params.password) return null;
  const email = params.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // The password from the environment (e.g. Render) always wins:
    // if it changed since the user was created, update the stored hash.
    const samePassword = await bcrypt.compare(params.password, existing.passwordHash);
    if (samePassword && existing.role === params.role) return existing;
    const newHash = await bcrypt.hash(params.password, 10);
    return prisma.user.update({ where: { id: existing.id }, data: { passwordHash: newHash, role: params.role } });
  }
  const passwordHash = await bcrypt.hash(params.password, 10);
  const balance = params.role === "MERCHANT" ? 1000 : 0;
  const user = await prisma.user.create({
    data: { email, passwordHash, displayName: params.name.slice(0, 30), role: params.role, balance },
  });
  if (params.role === "MERCHANT") {
    await prisma.transaction.create({
      data: { merchantId: user.id, type: "OPENING_GRANT", amount: balance, balanceAfter: balance, description: "מתנת הצטרפות" },
    });
  }
  return user;
}

async function main() {
  for (const c of CATEGORIES) {
    await prisma.category.upsert({ where: { name: c.name }, update: {}, create: c });
  }
  const categories = new Map((await prisma.category.findMany()).map((c) => [c.name, c.id]));

  for (const [name, category, supplierPrice, marketPrice, popularity, targetGender, targetAge] of PRODUCTS) {
    const categoryId = categories.get(category);
    if (!categoryId) throw new Error(`Missing category ${category}`);
    await prisma.product.upsert({
      where: { name },
      update: {},
      create: { name, categoryId, supplierPrice, marketPrice, popularity, targetGender, targetAge },
    });
  }

  await prisma.product.updateMany({ where: { name: { in: REMOVED_PRODUCTS } }, data: { isActive: false } });

  for (const d of DECORATIONS) {
    await prisma.decoration.upsert({ where: { name: d.name }, update: {}, create: d });
  }

  await prisma.gameState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  const admin = await upsertUser({
    email: process.env.ADMIN_EMAIL ?? (isProduction ? undefined : "admin@yarid.local"),
    password: process.env.ADMIN_PASSWORD ?? (isProduction ? undefined : "Admin1234!"),
    name: process.env.ADMIN_NAME ?? "ראש הקהל",
    role: "ADMIN",
  });
  const merchant = await upsertUser({
    email: process.env.DEMO_MERCHANT_EMAIL ?? (isProduction ? undefined : "merchant@yarid.local"),
    password: process.env.DEMO_MERCHANT_PASSWORD ?? (isProduction ? undefined : "Merchant1234!"),
    name: process.env.DEMO_MERCHANT_NAME ?? "סוחר לדוגמה",
    role: "MERCHANT",
  });

  console.log(
    `🌱 Seed done: ${CATEGORIES.length} categories, ${PRODUCTS.length} products, ${DECORATIONS.length} decorations` +
      (admin ? `, admin ${admin.email}` : ", no admin (set ADMIN_EMAIL/ADMIN_PASSWORD)") +
      (merchant ? `, merchant ${merchant.email}` : ""),
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
