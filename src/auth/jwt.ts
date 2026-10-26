import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import type { Role } from "../generated/prisma/enums";

export interface TokenPayload {
  sub: number;
  role: Role;
}

export function signToken(payload: TokenPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"] };
  return jwt.sign({ role: payload.role }, env.JWT_SECRET, { ...options, subject: String(payload.sub) });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === "string" || !decoded.sub) return null;
    const sub = Number(decoded.sub);
    if (!Number.isInteger(sub)) return null;
    return { sub, role: decoded.role as Role };
  } catch {
    return null;
  }
}
