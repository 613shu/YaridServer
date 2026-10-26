# The Great Fair (HaYarid HaGadol) — Backend

A fair simulation game server. Merchants open stalls, set prices, buy stock and decorate.
Virtual customers, run by the server, walk the fair and buy by commercially logical rules.

> 🇮🇱 Step-by-step Hebrew guide: **[START-HERE.md](START-HERE.md)** · API guide for the frontend: **[FRONTEND-API-GUIDE.md](FRONTEND-API-GUIDE.md)**

## Stack

Node.js 22 · Express 5 · TypeScript (strict) · PostgreSQL · Prisma 6 (driver adapter `@prisma/adapter-pg`) · Zod 4 · JWT · bcrypt (bcryptjs) · Swagger UI · Vitest

## Quick start

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL, DIRECT_URL, JWT_SECRET
npx prisma migrate deploy     # create the tables
npx prisma generate           # generate the Prisma client
npm run db:seed               # categories, products, decorations, demo users
npm run dev                   # http://localhost:3000  ·  docs: /api-docs
```

Demo users (development): `admin@yarid.local / Admin1234!` and `merchant@yarid.local / Merchant1234!`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with auto-reload |
| `npm run build` | `prisma generate` + compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run start:prod` | Migrate + seed + start (used by Render) |
| `npm run typecheck` | Type-check app and tests |
| `npm test` | Run all tests (needs `TEST_DATABASE_URL`) |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed the catalog and demo users (safe to re-run) |
| `npm run openapi:export` | Re-write `openapi.json` |

## Project structure

```
prisma/
  schema.prisma        database models
  migrations/          SQL migrations (incl. CHECK constraints, one open loan per merchant)
  seed.ts              8 categories, 31 products, 8 decorations, demo users
src/
  app.ts, server.ts    Express app and entry point
  config/              env validation (Zod)
  db/                  Prisma client
  auth/                JWT and password hashing
  middleware/          authenticate, requireRole, validation helpers, error handler
  validation/          all Zod request schemas
  routes/              every /api route in one file
  controllers/         thin HTTP handlers
  services/            business logic (stalls, money, loans, admin...)
  game/rules.ts        ALL game numbers and formulas in one place
  simulation/          game clock, customers, tick engine, background scheduler
  docs/openapi.ts      OpenAPI document (generated from the Zod schemas)
tests/                 Vitest + Supertest against a real test database
```

## How the simulation works

- 1 game hour = 2.5 real minutes (`GAME_HOUR_MS`), 1 game day = 1 real hour.
- A timer checks every few seconds and runs due ticks **in the background** — requests never wait.
- After the server slept, at most **6 game hours** are replayed; older time is skipped (the fair was "closed").
- One tick: advance the clock → on a new day: stall fees (20/stall), archive sales older than 48 days,
  new customer budgets and shopping lists → recompute stall scores → customers of this hour buy →
  income, 30% auto loan repayment, merchant status.
- Everything is computed in memory and written with bulk SQL. Money and stock are written as deltas,
  so merchant actions at the same moment are never lost. A PostgreSQL advisory lock prevents double ticks.

## Error format

```json
{ "error": { "code": "INSUFFICIENT_FUNDS", "message": "Insufficient funds: need 300, balance is 120", "details": { "needed": 300, "balance": 120 } } }
```

400 validation · 401 no/invalid token · 403 forbidden · 404 not found · 409 conflict · 422 insufficient funds.
