import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { openApiDocument } from "./docs/openapi";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { buildRouter } from "./routes";

export function createApp(): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // Swagger UI uses inline scripts, so helmet's CSP is relaxed for it
  app.use(helmet({ contentSecurityPolicy: false }));
  const origins = env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins.includes("*") ? true : origins }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/", (_req, res) => {
    res.json({ name: "The Great Fair API", docs: "/api-docs", health: "/api/health" });
  });

  app.get("/openapi.json", (_req, res) => res.json(openApiDocument));
  app.get("/api-docs/openapi.json", (_req, res) => res.json(openApiDocument));
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "The Great Fair API",
      swaggerOptions: { persistAuthorization: true },
    }),
  );

  app.use("/api", buildRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
