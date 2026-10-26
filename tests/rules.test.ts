import { describe, expect, it } from "vitest";
import {
  audienceScore,
  closeRefund,
  competitionScore,
  merchantStatusFor,
  priceScore,
  sellQuote,
  stallScore,
  stockScore,
} from "../src/game/rules";
import { newShoppingList, weightedIndex } from "../src/simulation/customers";
import { seededRng } from "./helpers";

describe("score parts", () => {
  it("price: 100 in 0.8–1.1 × market, 0 at 2 × market", () => {
    expect(priceScore(8, 10)).toBe(100);
    expect(priceScore(11, 10)).toBe(100);
    expect(priceScore(20, 10)).toBe(0);
    expect(priceScore(30, 10)).toBe(0);
    expect(priceScore(15.5, 10)).toBeCloseTo(50, 5);
    expect(priceScore(4, 10)).toBeCloseTo(50, 5);
  });

  it("competition and stock", () => {
    expect(competitionScore(1)).toBe(100);
    expect(competitionScore(4)).toBe(25);
    expect(stockScore(0, 0, 5)).toBe(100);
    expect(stockScore(0, 0, 0)).toBe(0);
    expect(stockScore(3, 4, 0)).toBe(25);
  });

  it("audience fit uses the current population", () => {
    const pop = { total: 100, male: 40, female: 60, young: 25, old: 75 };
    expect(audienceScore("ANY", "ANY", pop)).toBe(100);
    expect(audienceScore("FEMALE", "ANY", pop)).toBe(60);
    expect(audienceScore("MALE", "YOUNG", pop)).toBe(10);
  });

  it("the total score is weighted and stays within 0–100", () => {
    const pop = { total: 10, male: 5, female: 5, young: 5, old: 5 };
    const perfect = stallScore(
      { decorationPoints: 200, popularity: 100, price: 10, marketPrice: 10, sameProductActiveStalls: 1, stockOutTicks: 0, totalTicks: 10, stock: 5, targetGender: "ANY", targetAge: "ANY" },
      pop,
    );
    expect(perfect).toBe(100);
    const worst = stallScore(
      { decorationPoints: 0, popularity: 1, price: 30, marketPrice: 10, sameProductActiveStalls: 100, stockOutTicks: 10, totalTicks: 10, stock: 0, targetGender: "MALE", targetAge: "OLD" },
      { total: 10, male: 0, female: 10, young: 10, old: 0 },
    );
    expect(worst).toBeCloseTo(0.2 * 1 + 0.15 * 1, 2);
  });
});

describe("status, buyout and refunds", () => {
  it("merchant status thresholds", () => {
    expect(merchantStatusFor(2999, 90)).toBe("BEGINNER");
    expect(merchantStatusFor(3000, 50)).toBe("EXPERIENCED");
    expect(merchantStatusFor(10000, 69.9)).toBe("EXPERIENCED");
    expect(merchantStatusFor(10000, 70)).toBe("GVIR");
    expect(merchantStatusFor(50000, 10)).toBe("BEGINNER");
  });

  it("sell quote factor goes from 0.3 to 1.2", () => {
    expect(sellQuote({ decorationSpent: 0, score: 0, stock: 0, supplierPrice: 5 })).toMatchObject({ factor: 0.3, stallValue: 90 });
    expect(sellQuote({ decorationSpent: 100, score: 100, stock: 10, supplierPrice: 5 })).toMatchObject({
      factor: 1.2,
      stallValue: 480,
      stockValue: 25,
      total: 505,
    });
    expect(closeRefund(10, 5)).toBe(25);
  });
});

describe("customer helpers", () => {
  it("weighted choice respects weights", () => {
    const rng = seededRng(1);
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) counts[weightedIndex([1, 0, 3], rng)]!++;
    expect(counts[1]).toBe(0);
    expect(counts[2]!).toBeGreaterThan(counts[0]! * 2);
    expect(weightedIndex([0, 0], rng)).toBe(-1);
  });

  it("shopping lists have 1–4 distinct products", () => {
    const rng = seededRng(2);
    const products = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, popularity: 50, targetGender: "ANY" as const, targetAge: "ANY" as const }));
    for (let i = 0; i < 200; i++) {
      const list = newShoppingList({ gender: "MALE", ageGroup: "OLD" }, products, rng);
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.length).toBeLessThanOrEqual(4);
      expect(new Set(list.map((x) => x.productId)).size).toBe(list.length);
    }
    expect(newShoppingList({ gender: "MALE", ageGroup: "OLD" }, [], rng)).toEqual([]);
  });
});
