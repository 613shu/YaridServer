import { prisma } from "../db/prisma";
import { getGameState, toClock } from "../simulation/clock";
import { parseShoppingList } from "../simulation/customers";
import { visibleCustomerCount } from "../game/rules";

/** Public view of the whole fair. No scores and no exact stock — only what a visitor could see. */
export async function getFair(userId: number) {
  const state = await getGameState(prisma);
  const stalls = await prisma.stall.findMany({
    orderBy: { slotNumber: "asc" },
    include: {
      merchant: { select: { id: true, displayName: true } },
      product: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
      decorations: { select: { decoration: { select: { id: true, name: true } } } },
    },
  });

  return {
    clock: toClock(state),
    stalls: stalls.map((s) => ({
      id: s.id,
      slotNumber: s.slotNumber,
      name: s.name,
      merchant: s.merchant,
      isMine: s.merchantId === userId,
      product: s.product,
      price: s.price,
      inStock: s.stock > 0,
      status: s.status,
      decorations: s.decorations.map((d) => d.decoration),
    })),
  };
}

/**
 * Customers visiting in the current game hour, with the stalls they bought from (for animation).
 * The simulation is shared by the whole fair, but each merchant SEES only a few of them:
 * 15 per active stall of her own, at least 10 and at most 80.
 * Order: first customers who bought at her stalls, then customers who want one of her products, then the rest.
 */
export async function getActiveCustomers(userId: number) {
  const state = await getGameState(prisma);
  const myStalls = await prisma.stall.findMany({
    where: { merchantId: userId, status: "ACTIVE" },
    select: { id: true, productId: true },
  });
  const myStallIds = new Set(myStalls.map((s) => s.id));
  const myProductIds = new Set(myStalls.map((s) => s.productId));
  const limit = visibleCustomerCount(myStalls.length);

  const customers = await prisma.customer.findMany({
    where: { visitHour: state.currentHour, listDay: state.currentDay },
    orderBy: { id: "asc" },
  });
  const active = customers.filter((c) => parseShoppingList(c.shoppingList).length > 0);
  const sales = await prisma.sale.findMany({
    where: { gameDay: state.currentDay, gameHour: state.currentHour, customerId: { in: active.map((c) => c.id) } },
    select: { customerId: true, stallId: true, productId: true, unitPrice: true },
    orderBy: { id: "asc" },
  });
  const byCustomer = new Map<number, typeof sales>();
  for (const s of sales) {
    const list = byCustomer.get(s.customerId) ?? [];
    list.push(s);
    byCustomer.set(s.customerId, list);
  }

  const boughtFromMe: typeof active = [];
  const wantsMyProduct: typeof active = [];
  const others: typeof active = [];
  for (const c of active) {
    const mySales = (byCustomer.get(c.id) ?? []).filter((p) => p.stallId !== null && myStallIds.has(p.stallId));
    const wants = parseShoppingList(c.shoppingList).some((item) => myProductIds.has(item.productId));
    if (mySales.length > 0) boughtFromMe.push(c);
    else if (wants) wantsMyProduct.push(c);
    else others.push(c);
  }
  const shown = [...boughtFromMe, ...wantsMyProduct, ...others].slice(0, limit);

  return {
    clock: toClock(state),
    customers: shown.map((c) => {
      const purchases = (byCustomer.get(c.id) ?? []).filter((p) => p.stallId !== null);
      return {
        id: c.id,
        nickname: c.nickname,
        gender: c.gender,
        ageGroup: c.ageGroup,
        targetStallId: purchases[0]?.stallId ?? null,
        targetStallIds: [...new Set(purchases.map((p) => p.stallId as number))],
        purchases: purchases.map((p) => ({ stallId: p.stallId, productId: p.productId, price: p.unitPrice })),
        shoppingList: parseShoppingList(c.shoppingList),
      };
    }),
  };
}
