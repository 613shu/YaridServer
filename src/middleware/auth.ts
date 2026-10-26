import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../auth/jwt";
import { prisma } from "../db/prisma";
import { Errors } from "../errors/AppError";
import type { Role } from "../generated/prisma/enums";
import { markSeen } from "../simulation/presence";

export interface AuthUser {
  id: number;
  role: Role;
  displayName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Requires a valid Bearer JWT. Loads the user from the DB so deleted users are rejected. */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) throw Errors.unauthorized();
  const payload = verifyToken(header.slice(7).trim());
  if (!payload) throw Errors.unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, displayName: true },
  });
  if (!user) throw Errors.unauthorized("User no longer exists");
  req.user = user;
  markSeen(user.id); // the game is open → this player is online
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw Errors.unauthorized();
    if (!roles.includes(req.user.role)) throw Errors.forbidden();
    next();
  };
}

/** Helper for controllers: returns the authenticated user (authenticate must run first). */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw Errors.unauthorized();
  return req.user;
}
