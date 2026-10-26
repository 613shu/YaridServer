import type { Tx } from "../db/prisma";
import { Errors } from "../errors/AppError";
import type { TransactionType } from "../generated/prisma/enums";

/**
 * Changes a merchant's balance atomically and writes a ledger row.
 * For payments (amount < 0) with requireFunds = true, the update only happens
 * when the balance is high enough; otherwise a 422 INSUFFICIENT_FUNDS is thrown.
 */
export async function changeBalance(
  tx: Tx,
  params: {
    merchantId: number;
    amount: number;
    type: TransactionType;
    description?: string;
    stallId?: number | null;
    requireFunds?: boolean;
  },
): Promise<number> {
  const { merchantId, amount, requireFunds = true } = params;

  if (amount < 0 && requireFunds) {
    const updated = await tx.user.updateMany({
      where: { id: merchantId, balance: { gte: -amount } },
      data: { balance: { increment: amount } },
    });
    if (updated.count === 0) {
      const user = await tx.user.findUnique({ where: { id: merchantId }, select: { balance: true } });
      if (!user) throw Errors.notFound("Merchant");
      throw Errors.insufficientFunds(-amount, user.balance);
    }
  } else {
    await tx.user.update({ where: { id: merchantId }, data: { balance: { increment: amount } } });
  }

  const { balance } = await tx.user.findUniqueOrThrow({ where: { id: merchantId }, select: { balance: true } });
  await tx.transaction.create({
    data: {
      merchantId,
      type: params.type,
      amount,
      balanceAfter: balance,
      description: params.description ?? null,
      stallId: params.stallId ?? null,
    },
  });
  return balance;
}
