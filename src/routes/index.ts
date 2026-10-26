import { Router } from "express";
import * as adminC from "../controllers/admin.controller";
import * as authC from "../controllers/auth.controller";
import * as catalogC from "../controllers/catalog.controller";
import * as fairC from "../controllers/fair.controller";
import * as meC from "../controllers/me.controller";
import * as stallC from "../controllers/stall.controller";
import { prisma } from "../db/prisma";
import { authenticate, requireRole } from "../middleware/auth";
import { getClock } from "../simulation/clock";

const merchant = requireRole("MERCHANT");
const admin = requireRole("ADMIN");
const anyRole = requireRole("MERCHANT", "ADMIN");

export function buildRouter(): Router {
  const r = Router();

  // ------------------------------------------------------------ public
  r.get("/health", async (_req, res) => {
    try {
      const clock = await getClock(prisma);
      res.json({ status: "ok", database: "ok", time: new Date().toISOString(), game: { day: clock.day, hour: clock.hour } });
    } catch {
      res.status(503).json({ status: "degraded", database: "unreachable", time: new Date().toISOString() });
    }
  });
  r.post("/auth/register", authC.register);
  r.post("/auth/login", authC.login);

  // ------------------------------------------------ authenticated below
  r.use(authenticate);

  r.get("/auth/me", authC.me);

  r.get("/categories", anyRole, catalogC.listCategories);
  r.post("/categories", admin, catalogC.createCategory);
  r.patch("/categories/:id", admin, catalogC.updateCategory);

  r.get("/products", anyRole, catalogC.listProducts);
  r.post("/products", admin, catalogC.createProduct);
  r.patch("/products/:id", admin, catalogC.updateProduct);

  r.get("/decorations", anyRole, catalogC.listDecorations);

  r.get("/fair", anyRole, fairC.getFair);
  r.get("/fair/customers", anyRole, fairC.getCustomers);

  r.get("/stalls/mine", merchant, stallC.listMine);
  r.post("/stalls", merchant, stallC.create);
  r.get("/stalls/:id", anyRole, stallC.getById);
  r.patch("/stalls/:id", merchant, stallC.update);
  r.delete("/stalls/:id", merchant, stallC.close);
  r.post("/stalls/:id/stock", merchant, stallC.buyStock);
  r.post("/stalls/:id/decorations", merchant, stallC.addDecoration);
  r.get("/stalls/:id/sale-quote", merchant, stallC.saleQuote);
  r.post("/stalls/:id/sell", merchant, stallC.sell);

  r.get("/me/summary", merchant, meC.summary);
  r.get("/me/sales", merchant, meC.sales);
  r.get("/me/sales/by-product", merchant, meC.salesByProduct);
  r.get("/me/transactions", merchant, meC.transactions);
  r.get("/me/loan", merchant, meC.getLoan);
  r.post("/me/loan", merchant, meC.takeLoan);
  r.get("/me/notifications", merchant, meC.notifications);
  r.patch("/me/notifications/:id/read", merchant, meC.markRead);

  r.get("/admin/stats", admin, adminC.stats);
  r.get("/admin/merchants", admin, adminC.merchants);
  r.get("/admin/merchants/:id", admin, adminC.merchant);
  r.post("/admin/merchants/:id/grants", admin, adminC.grant);
  r.get("/admin/stalls", admin, adminC.stalls);
  r.post("/admin/stalls/:id/suspend", admin, adminC.suspend);
  r.post("/admin/stalls/:id/unsuspend", admin, adminC.unsuspend);
  r.get("/admin/sales", admin, adminC.sales);
  r.get("/admin/transactions", admin, adminC.transactions);

  return r;
}
