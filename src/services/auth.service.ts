import { signToken } from "../auth/jwt";
import { hashPassword, verifyPassword } from "../auth/password";
import { prisma } from "../db/prisma";
import { AppError, Errors } from "../errors/AppError";
import type { User } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import { RULES } from "../game/rules";
import type { z } from "zod";
import type { LoginBody, RegisterBody } from "../validation/schemas";

export function toPublicUser(user: Pick<User, "id" | "email" | "displayName" | "role" | "balance" | "status" | "createdAt">) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    balance: user.balance,
    status: user.status,
    createdAt: user.createdAt,
  };
}

export async function register(input: z.infer<typeof RegisterBody>) {
  const exists = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (exists) throw Errors.conflict("EMAIL_EXISTS", "This email is already registered");

  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          role: "MERCHANT",
          balance: RULES.OPENING_BALANCE,
        },
      });
      await tx.transaction.create({
        data: {
          merchantId: created.id,
          type: "OPENING_GRANT",
          amount: RULES.OPENING_BALANCE,
          balanceAfter: RULES.OPENING_BALANCE,
          description: "מתנת הצטרפות: 1,000 רובל + דוכן ראשון חינם",
        },
      });
      return created;
    });
    return { token: signToken({ sub: user.id, role: user.role }), user: toPublicUser(user) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw Errors.conflict("EMAIL_EXISTS", "This email is already registered");
    }
    throw err;
  }
}

export async function login(input: z.infer<typeof LoginBody>) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;
  if (!user || !ok) throw new AppError(401, "UNAUTHORIZED", "Wrong email or password");
  return { token: signToken({ sub: user.id, role: user.role }), user: toPublicUser(user) };
}

export async function me(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Errors.notFound("User");
  return toPublicUser(user);
}
