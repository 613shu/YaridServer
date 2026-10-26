import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth";
import { parseBody, parseId, parseQuery } from "../middleware/validate";
import * as stalls from "../services/stall.service";
import { DecorationBody, MyStallsQuery, StallCreateBody, StallPatchBody, StockBody } from "../validation/schemas";

export async function listMine(req: Request, res: Response) {
  res.json(await stalls.listMyStalls(currentUser(req).id, parseQuery(MyStallsQuery, req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await stalls.createStall(currentUser(req).id, parseBody(StallCreateBody, req)));
}

/** Owner sees the stall without its score; the admin sees everything. */
export async function getById(req: Request, res: Response) {
  const user = currentUser(req);
  const id = parseId(req);
  res.json(user.role === "ADMIN" ? await stalls.getStallForAdmin(id) : await stalls.getStallForOwner(id, user.id));
}

export async function update(req: Request, res: Response) {
  res.json(await stalls.updateStall(parseId(req), currentUser(req).id, parseBody(StallPatchBody, req)));
}

export async function close(req: Request, res: Response) {
  res.json(await stalls.closeStall(parseId(req), currentUser(req).id));
}

export async function buyStock(req: Request, res: Response) {
  const { quantity } = parseBody(StockBody, req);
  res.json(await stalls.buyStock(parseId(req), currentUser(req).id, quantity));
}

export async function addDecoration(req: Request, res: Response) {
  const { decorationId } = parseBody(DecorationBody, req);
  res.status(201).json(await stalls.addDecoration(parseId(req), currentUser(req).id, decorationId));
}

export async function saleQuote(req: Request, res: Response) {
  res.json(await stalls.getSaleQuote(parseId(req), currentUser(req).id));
}

export async function sell(req: Request, res: Response) {
  res.json(await stalls.sellStall(parseId(req), currentUser(req).id));
}
