import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth";
import { parseBody } from "../middleware/validate";
import * as authService from "../services/auth.service";
import { LoginBody, RegisterBody } from "../validation/schemas";

export async function register(req: Request, res: Response) {
  res.status(201).json(await authService.register(parseBody(RegisterBody, req)));
}

export async function login(req: Request, res: Response) {
  res.json(await authService.login(parseBody(LoginBody, req)));
}

export async function me(req: Request, res: Response) {
  res.json(await authService.me(currentUser(req).id));
}
