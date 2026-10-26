import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth";
import { parseBody, parseId, parseQuery } from "../middleware/validate";
import * as catalog from "../services/catalog.service";
import { CategoryBody, CategoryPatch, ProductBody, ProductPatch, ProductQuery } from "../validation/schemas";

export async function listCategories(_req: Request, res: Response) {
  res.json(await catalog.listCategories());
}

export async function createCategory(req: Request, res: Response) {
  res.status(201).json(await catalog.createCategory(parseBody(CategoryBody, req)));
}

export async function updateCategory(req: Request, res: Response) {
  res.json(await catalog.updateCategory(parseId(req), parseBody(CategoryPatch, req)));
}

export async function listProducts(req: Request, res: Response) {
  res.json(await catalog.listProducts(parseQuery(ProductQuery, req), currentUser(req).role === "ADMIN"));
}

export async function createProduct(req: Request, res: Response) {
  res.status(201).json(await catalog.createProduct(parseBody(ProductBody, req)));
}

export async function updateProduct(req: Request, res: Response) {
  res.json(await catalog.updateProduct(parseId(req), parseBody(ProductPatch, req)));
}

export async function listDecorations(_req: Request, res: Response) {
  res.json(await catalog.listDecorations());
}
