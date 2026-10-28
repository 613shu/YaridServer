import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth";
import * as fair from "../services/fair.service";

export async function getFair(req: Request, res: Response) {
  res.json(await fair.getFair(currentUser(req).id));
}

export async function getCustomers(req: Request, res: Response) {
  res.json(await fair.getActiveCustomers(currentUser(req).id));
}
