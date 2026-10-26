import type { Request } from "express";
import type { z } from "zod";
import { Errors } from "../errors/AppError";

function format(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export function parseBody<S extends z.ZodType>(schema: S, req: Request): z.infer<S> {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) throw Errors.validation("Invalid request body", format(result.error));
  return result.data;
}

export function parseQuery<S extends z.ZodType>(schema: S, req: Request): z.infer<S> {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) throw Errors.validation("Invalid query parameters", format(result.error));
  return result.data;
}

export function parseId(req: Request, name = "id"): number {
  const raw = req.params[name];
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw Errors.validation(`Invalid ${name}`, [{ path: name, message: "Must be a positive integer" }]);
  return id;
}
