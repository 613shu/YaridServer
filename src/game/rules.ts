/**
 * Game rules — every number from the specification lives here,
 * so the whole economy can be tuned in one place.
 */
import type { MerchantStatus, TargetAge, TargetGender } from "../generated/prisma/enums";

export const RULES = {
  HOURS_PER_DAY: 24,
  /** Max game hours simulated when catching up after the server slept. */
  MAX_CATCHUP_HOURS: 6,

  OPENING_BALANCE: 1000,
  STALL_PRICE: 300,
  STALL_DAILY_FEE: 20,
  MAX_STALLS_PER_MERCHANT: 100,

  /** Customers = BASE + PER_STALL × active stalls, capped. */
  CUSTOMERS_BASE: 150,
  CUSTOMERS_PER_STALL: 75,
  CUSTOMERS_MAX: 15000,
  SHOPPING_LIST_MIN: 1,
  SHOPPING_LIST_MAX: 4,
  /** A merchant counts as online (stalls sell) if he sent a request in the last minute. */
  ONLINE_WINDOW_MS: 60_000,

  /** A customer won't pay more than this × marketPrice. */
  MAX_PRICE_FACTOR: 1.5,

  LOAN_REPAYMENT_SHARE: 0.3,
  LOAN_MAX: { BEGINNER: 500, EXPERIENCED: 2000, GVIR: 5000 } as Record<MerchantStatus, number>,

  STATUS_THRESHOLDS: {
    GVIR: { netWorth: 10_000, avgScore: 70 },
    EXPERIENCED: { netWorth: 3_000, avgScore: 50 },
  },

  SELL_MIN_AGE_DAYS: 3,
  SELL_BASE_VALUE: 300,
  SELL_STOCK_SHARE: 0.5,
  CLOSE_STOCK_REFUND_SHARE: 0.5,

  /** Detailed sales kept for this many game days, older ones are summarized. */
  SALES_RETENTION_DAYS: 48,

  /** Peak hours: 08–11 and 16–19 (end exclusive) — more customers come then. */
  PEAK_HOURS: [8, 9, 10, 16, 17, 18],

  SCORE_WEIGHTS: {
    decoration: 0.25,
    popularity: 0.2,
    price: 0.25,
    competition: 0.15,
    stock: 0.1,
    audience: 0.05,
  },
} as const;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// ---------------------------------------------------------------- score parts

export function decorationScore(totalPoints: number): number {
  return clamp(totalPoints, 0, 100);
}

/** 100 inside 0.8–1.1 × market, linearly down to 0 at ≥ 2 × market (or at price 0 on the cheap side). */
export function priceScore(price: number, marketPrice: number): number {
  if (marketPrice <= 0) return 0;
  const r = price / marketPrice;
  if (r >= 0.8 && r <= 1.1) return 100;
  if (r > 1.1) return r >= 2 ? 0 : (100 * (2 - r)) / (2 - 1.1);
  return clamp((100 * r) / 0.8, 0, 100);
}

export function competitionScore(activeStallsWithSameProduct: number): number {
  return 100 / Math.max(1, activeStallsWithSameProduct);
}

export function stockScore(stockOutTicks: number, totalTicks: number, currentStock: number): number {
  if (totalTicks <= 0) return currentStock > 0 ? 100 : 0;
  return clamp(100 * (1 - stockOutTicks / totalTicks), 0, 100);
}

export interface Population {
  total: number;
  male: number;
  female: number;
  young: number;
  old: number;
}

export function audienceScore(targetGender: TargetGender, targetAge: TargetAge, pop: Population): number {
  if (pop.total <= 0) return targetGender === "ANY" && targetAge === "ANY" ? 100 : 50;
  const g = targetGender === "ANY" ? 1 : (targetGender === "MALE" ? pop.male : pop.female) / pop.total;
  const a = targetAge === "ANY" ? 1 : (targetAge === "YOUNG" ? pop.young : pop.old) / pop.total;
  return 100 * g * a;
}

export interface ScoreInput {
  decorationPoints: number;
  popularity: number;
  price: number;
  marketPrice: number;
  sameProductActiveStalls: number;
  stockOutTicks: number;
  totalTicks: number;
  stock: number;
  targetGender: TargetGender;
  targetAge: TargetAge;
}

export function stallScore(input: ScoreInput, pop: Population): number {
  const w = RULES.SCORE_WEIGHTS;
  const score =
    w.decoration * decorationScore(input.decorationPoints) +
    w.popularity * clamp(input.popularity, 0, 100) +
    w.price * priceScore(input.price, input.marketPrice) +
    w.competition * competitionScore(input.sameProductActiveStalls) +
    w.stock * stockScore(input.stockOutTicks, input.totalTicks, input.stock) +
    w.audience * audienceScore(input.targetGender, input.targetAge, pop);
  return Math.round(clamp(score, 0, 100) * 100) / 100;
}

// ------------------------------------------------------------ merchant status

export function merchantStatusFor(netWorth: number, avgScore: number): MerchantStatus {
  const t = RULES.STATUS_THRESHOLDS;
  if (netWorth >= t.GVIR.netWorth && avgScore >= t.GVIR.avgScore) return "GVIR";
  if (netWorth >= t.EXPERIENCED.netWorth && avgScore >= t.EXPERIENCED.avgScore) return "EXPERIENCED";
  return "BEGINNER";
}

// --------------------------------------------------------------- stall buyout

export function sellQuote(params: {
  decorationSpent: number;
  score: number;
  stock: number;
  supplierPrice: number;
}) {
  const factor = 0.3 + (0.9 * clamp(params.score, 0, 100)) / 100;
  const stallValue = Math.round((RULES.SELL_BASE_VALUE + params.decorationSpent) * factor);
  const stockValue = Math.round(params.stock * params.supplierPrice * RULES.SELL_STOCK_SHARE);
  return { factor: Math.round(factor * 1000) / 1000, stallValue, stockValue, total: stallValue + stockValue };
}

export function closeRefund(stock: number, supplierPrice: number): number {
  return Math.round(stock * supplierPrice * RULES.CLOSE_STOCK_REFUND_SHARE);
}

export function targetCustomerCount(stallCount: number): number {
  return Math.min(RULES.CUSTOMERS_MAX, RULES.CUSTOMERS_BASE + RULES.CUSTOMERS_PER_STALL * stallCount);
}
