import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth";
import { parseBody, parseId, parseQuery } from "../middleware/validate";
import * as me from "../services/me.service";
import { LoanBody, MySalesQuery, MyTransactionsQuery } from "../validation/schemas";

export async function summary(req: Request, res: Response) {
  res.json(await me.getSummary(currentUser(req).id));
}

export async function sales(req: Request, res: Response) {
  res.json(await me.listMySales(currentUser(req).id, parseQuery(MySalesQuery, req)));
}

export async function salesByProduct(req: Request, res: Response) {
  res.json(await me.salesByProduct(currentUser(req).id));
}

export async function transactions(req: Request, res: Response) {
  res.json(await me.listMyTransactions(currentUser(req).id, parseQuery(MyTransactionsQuery, req)));
}

export async function getLoan(req: Request, res: Response) {
  res.json(await me.getLoan(currentUser(req).id));
}

export async function takeLoan(req: Request, res: Response) {
  const { amount } = parseBody(LoanBody, req);
  res.status(201).json(await me.takeLoan(currentUser(req).id, amount));
}

export async function notifications(req: Request, res: Response) {
  res.json(await me.listNotifications(currentUser(req).id));
}

export async function markRead(req: Request, res: Response) {
  res.json(await me.markNotificationRead(currentUser(req).id, parseId(req)));
}
