import type { Request, Response } from "express";
import { parseBody, parseId, parseQuery } from "../middleware/validate";
import * as admin from "../services/admin.service";
import {
  AdminMerchantsQuery,
  AdminSalesQuery,
  AdminStallsQuery,
  AdminTransactionsQuery,
  GrantBody,
  SuspendBody,
} from "../validation/schemas";

export async function stats(_req: Request, res: Response) {
  res.json(await admin.getStats());
}

export async function merchants(req: Request, res: Response) {
  res.json(await admin.listMerchants(parseQuery(AdminMerchantsQuery, req)));
}

export async function merchant(req: Request, res: Response) {
  res.json(await admin.getMerchant(parseId(req)));
}

export async function grant(req: Request, res: Response) {
  res.status(201).json(await admin.grantMerchant(parseId(req), parseBody(GrantBody, req)));
}

export async function stalls(req: Request, res: Response) {
  res.json(await admin.listStalls(parseQuery(AdminStallsQuery, req)));
}

export async function suspend(req: Request, res: Response) {
  const { reason } = parseBody(SuspendBody, req);
  res.json(await admin.suspendStall(parseId(req), reason));
}

export async function unsuspend(req: Request, res: Response) {
  res.json(await admin.unsuspendStall(parseId(req)));
}

export async function sales(req: Request, res: Response) {
  res.json(await admin.listSales(parseQuery(AdminSalesQuery, req)));
}

export async function transactions(req: Request, res: Response) {
  res.json(await admin.listTransactions(parseQuery(AdminTransactionsQuery, req)));
}
