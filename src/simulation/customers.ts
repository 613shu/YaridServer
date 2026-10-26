import type { AgeGroup, Gender, TargetAge, TargetGender } from "../generated/prisma/enums";
import { RULES } from "../game/rules";

export interface ShoppingItem {
  productId: number;
  purchased: boolean;
}

export interface CatalogProduct {
  id: number;
  popularity: number;
  targetGender: TargetGender;
  targetAge: TargetAge;
}

export type Rng = () => number;

const MALE_NAMES = ["אברהם", "יצחק", "יעקב", "משה", "אהרן", "דוד", "שלמה", "יוסף", "בנימין", "שמעון", "לוי", "יהודה", "נפתלי", "זבולון", "מנחם", "חיים", "ברוך", "שמואל", "אליהו", "נחום"];
const FEMALE_NAMES = ["שרה", "רבקה", "רחל", "לאה", "מרים", "חנה", "אסתר", "רות", "דבורה", "יהודית", "פנינה", "בתיה", "צפורה", "חיה", "גיטל", "פייגא", "מלכה", "שושנה", "טובה", "בלומה"];
const PLACES = ["מהכפר", "מהעיירה", "מהגבעה", "מהעמק", "מהשוק", "מהנהר", "מהיער", "מהטחנה"];

export function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)] as T;
}

export function randomInt(min: number, max: number, rng: Rng): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Weighted random choice. Returns the index, or -1 if all weights are 0. */
export function weightedIndex(weights: number[], rng: Rng): number {
  let total = 0;
  for (const w of weights) total += w > 0 ? w : 0;
  if (total <= 0) return -1;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]! > 0 ? weights[i]! : 0;
    if (r < w) return i;
    r -= w;
  }
  return weights.length - 1;
}

/** Relative chance of visiting at each hour: busy at peaks, quiet at night. */
const HOUR_WEIGHTS: number[] = Array.from({ length: 24 }, (_, h) => {
  if (h < 6) return 0.6;
  if ((RULES.PEAK_HOURS as readonly number[]).includes(h)) return 3;
  if (h >= 21) return 0.5;
  return 1.5;
});

export function randomVisitHour(rng: Rng, fromHour = 0): number {
  const weights = HOUR_WEIGHTS.map((w, h) => (h >= fromHour ? w : 0));
  const idx = weightedIndex(weights, rng);
  return idx < 0 ? 23 : idx;
}

export function randomBudget(ageGroup: AgeGroup, rng: Rng): number {
  return ageGroup === "YOUNG" ? randomInt(40, 180, rng) : randomInt(60, 260, rng);
}

export function newCustomerIdentity(index: number, rng: Rng) {
  const gender: Gender = rng() < 0.5 ? "MALE" : "FEMALE";
  const ageGroup: AgeGroup = rng() < 0.5 ? "YOUNG" : "OLD";
  const name = pick(gender === "MALE" ? MALE_NAMES : FEMALE_NAMES, rng);
  const nickname = `${name} ${pick(PLACES, rng)} #${index}`;
  return { gender, ageGroup, nickname };
}

function fit(target: string, actual: string): number {
  if (target === "ANY") return 1;
  return target === actual ? 1.6 : 0.35;
}

/** A fresh shopping list of 1–4 distinct products, weighted by popularity and audience fit. */
export function newShoppingList(
  customer: { gender: Gender; ageGroup: AgeGroup },
  products: CatalogProduct[],
  rng: Rng,
): ShoppingItem[] {
  if (products.length === 0) return [];
  const size = Math.min(products.length, randomInt(RULES.SHOPPING_LIST_MIN, RULES.SHOPPING_LIST_MAX, rng));
  const pool = [...products];
  const weights = pool.map((p) => p.popularity * fit(p.targetGender, customer.gender) * fit(p.targetAge, customer.ageGroup));
  const list: ShoppingItem[] = [];
  for (let i = 0; i < size; i++) {
    const idx = weightedIndex(weights, rng);
    if (idx < 0) break;
    list.push({ productId: pool[idx]!.id, purchased: false });
    pool.splice(idx, 1);
    weights.splice(idx, 1);
  }
  return list;
}

export function parseShoppingList(value: unknown): ShoppingItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is { productId: unknown; purchased: unknown } => typeof v === "object" && v !== null)
    .map((v) => ({ productId: Number(v.productId), purchased: Boolean(v.purchased) }))
    .filter((v) => Number.isInteger(v.productId));
}
