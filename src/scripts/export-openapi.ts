/** Writes openapi.json to the project root: npm run openapi:export */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openApiDocument } from "../docs/openapi";

const target = join(__dirname, "..", "..", "openapi.json");
writeFileSync(target, JSON.stringify(openApiDocument, null, 2) + "\n");
console.log(`✅ OpenAPI written to ${target}`);
