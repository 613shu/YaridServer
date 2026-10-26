# The Great Fair ("HaYarid HaGadol") — Backend Specification

**Stack:** Node.js LTS, Express, TypeScript (strict), PostgreSQL, Prisma, Zod, JWT, bcrypt, Swagger/OpenAPI 3 at `/api-docs`, Vitest, npm. Deploy target: Render (free) + free PostgreSQL (e.g. Supabase).

---

## A. Project Description

A fair simulation game in the style of old small-town fairs. Merchants open stalls and manage pricing, stock and decorations. Every stall is open all the time, from the moment it is created. Virtual customers, generated and run by the server, move between stalls and buy according to commercially logical rules.

**Purpose:** fun, plus practicing trading and financial management skills.

**User types:**
- **MERCHANT:** every registered user.
- **ADMIN ("Rosh HaKahal"):** system manager.

Customers are server-managed virtual entities, not users. Nobody human can buy.

### Game Mechanics

**Game clock**
- 1 game day = 1 real hour, so 1 game hour = 2.5 real minutes.
- Each game hour, the server runs one "purchase tick".
- Catch-up after server sleep runs in the BACKGROUND and is capped at 6 game hours. Older missed time is skipped, as if the fair was closed. Requests never wait for the simulation.
- An in-process interval runs ticks while the server is awake.
- Ticks are computed in memory and persisted with bulk writes.

**Joining**
- Register with email, password and display name (`displayName`, required, 2–30 chars). The display name is shown on the fair and to the admin.
- Welcome gift: 1,000 rubles. There is no free stall.

**Stalls**
- Up to 100 active stalls per merchant. Any number of stalls may sell the same product.
- Every stall costs 300 rubles (including the first one).
- Stall fee: 20 rubles per stall per game day, charged at day rollover — only to merchants who were connected at some point during that game day. The balance may go negative.
- One product per stall, from the closed catalog.
- Stock is bought from the supplier at `supplierPrice`. A stall sells only while stock > 0.
- The product can be changed only when stock = 0.
- Decorations come from a closed list. Each costs money, adds upkeep points, and can be added once per stall.
- Fair map position: the server assigns a unique `slotNumber`.

**Customers**
- Count = 150 + 75 × active stalls, capped at 15,000.
- Attributes: gender (MALE/FEMALE), ageGroup (YOUNG/OLD), dailyBudget, visitHour.
- Each game day, a customer gets a new shopping list of 1–4 products, weighted by popularity and audience fit. The list is stored as JSON on the customer and overwritten daily.
- **Purchase algorithm.** At its visit hour, for each unpurchased list item, the customer:
  1. Finds candidate stalls that are ACTIVE (not suspended), selling that product, have stock, and whose merchant is online.
  2. Picks one by weighted random choice, where weight ∝ score² × price factor (cheaper relative to market = better).
  3. Buys 1 unit if the price ≤ budgetLeft and the price ≤ 1.5 × marketPrice.
- **Online only.** A merchant is online while his game is open: every authenticated request marks him as seen (in server memory), and he counts as online for 60 seconds after his last request. Offline merchants' stalls sell nothing and they pay no stall fee.
- `/api/fair/customers` returns only the customers active in the current game hour, with their target stall, for frontend animation.

**Stall score (0–100)**
Hidden from merchants, visible to admin. Recomputed every tick.

| Component | Weight | Rule |
|---|---|---|
| Decoration/upkeep | 25% | min(100, sum of decoration points) |
| Product popularity | 20% | product.popularity |
| Price vs market price | 25% | 100 within 0.8–1.1 × market, decreasing outside, 0 at ≥ 2 × market |
| Competition | 15% | 100 / number of active stalls selling the same product |
| Stock availability | 10% | share of ticks in which the stall had stock |
| Audience fit | 5% | product target vs current customer population |

**Loans**
- No interest. One OPEN loan at a time.
- 30% of each sale income is auto-deducted toward repayment.
- Max amount by status: BEGINNER 500, EXPERIENCED 2,000, GVIR 5,000.

**Merchant status**
Recomputed every tick. Net worth = balance + stock value at supplier price − loan remaining.

| Status | Condition |
|---|---|
| BEGINNER | default |
| EXPERIENCED | net worth ≥ 3,000 and average stall score ≥ 50 |
| GVIR | net worth ≥ 10,000 and average stall score ≥ 70 |

**Selling a stall to the admin**
- Allowed only after the stall has existed for 3 game days.
- Price = (300 + decorationSpent) × factor, where factor = 0.3 + 0.9 × score / 100 (range 0.3–1.2).
- Remaining stock is bought at 50% of supplierPrice.

**Closing a stall:** no compensation except a refund of 50% of the stock value.

**Data retention**
- Detailed Sale rows are kept for the last 48 game days.
- Older sales are aggregated into `SalesDailySummary`, including gender and age counts.

**Keep-alive:** document a free external ping (UptimeRobot / cron-job.org) of `/api/health` in START-HERE.md. Note that Render's terms may change.

---

## B. Screens (implemented by the student in React)

1. **Start page:** login (email, password) and registration (email, password, display name).
2. **Fair page:**
   - Map of all stalls, with my stalls highlighted.
   - Game clock.
   - Customers moving between stalls.
   - Clicking a stall shows its details.
3. **Merchant personal area**, in tabs:
   - Summary: balance, status, income, expenses, loan, net worth.
   - My stalls: search and filter; stock, decorate, close, sell.
   - Sales.
   - Per-product breakdown (customers per item, by gender and age).
   - Transactions.
   - Loan.
   - Notifications from the admin.
4. **Add/edit stall form:**
   - Name, product (filter by category, search by name), price, open hour, close hour.
   - In edit mode: also stock purchase and decorations.
5. **Admin area:**
   - Dashboard with charts.
   - Merchants table, with grants.
   - Stalls table including score, with suspend and unsuspend.
   - Sales and payments.
6. **Catalog management (admin):** categories and products.

---

## C. Permissions

| Action | Guest | Merchant | Admin |
|---|---|---|---|
| Register / login | ✅ | ✅ | ✅ |
| View fair and catalog | ❌ | ✅ | ✅ |
| Manage stalls (CRUD, stock, decorate, sell, close) | ❌ | ✅ own only | ❌ |
| Personal data and loans | ❌ | ✅ own only | ❌ |
| View stall score | ❌ | ❌ | ✅ |
| View all merchants, stalls, sales, payments | ❌ | ❌ | ✅ |
| Suspend stall, grant merchant | ❌ | ❌ | ✅ |
| Manage categories and products | ❌ | ❌ | ✅ |
| Buy | ❌ | ❌ | ❌ (virtual customers only) |

---

## D. Database (PostgreSQL via Prisma)

Money is stored as integer rubles.

| Table | Purpose | Fields (* required) | Constraints / Relations |
|---|---|---|---|
| **User** | Merchants and admin | id PK, email*, passwordHash*, displayName*, role* (MERCHANT/ADMIN), balance* Int, status* (BEGINNER/EXPERIENCED/GVIR), createdAt, updatedAt | email unique and valid; password ≥ 8 chars; displayName 2–30 chars; 1:N stalls, transactions, loans, notifications |
| **Category** | Product categories | id PK, name*, description | name unique, 2–30 chars |
| **Product** | Closed catalog | id PK, name*, categoryId* FK, supplierPrice*, marketPrice*, popularity* (1–100), targetGender* (ANY/MALE/FEMALE), targetAge* (ANY/YOUNG/OLD), isActive* | name unique; marketPrice > supplierPrice > 0 |
| **Stall** | Central entity | id PK, merchantId* FK, productId* FK, name* (2–40), price*, stock*, score* Float, status* (ACTIVE/SUSPENDED), suspensionReason, slotNumber* unique, decorationSpent*, stockOutTicks, totalTicks, createdGameDay*, createdAt, updatedAt | ≤ 100 active per merchant; price > 0; stock ≥ 0 |
| **Decoration** | Closed decoration list | id PK, name* unique, cost*, points* | |
| **StallDecoration** | Stall decorations | stallId + decorationId (composite PK), addedAt | N:M; cascade on stall delete |
| **Customer** | Virtual customer | id PK, nickname*, gender*, ageGroup*, dailyBudget*, budgetLeft*, visitHour* (0–23), shoppingList* JSON `[{productId, purchased}]`, listDay* | |
| **Sale** | Detailed sale | id PK, stallId FK nullable (SET NULL on delete), merchantId* FK, productId* FK, customerId* FK, customerGender*, customerAge*, unitPrice*, quantity*, gameDay*, gameHour*, createdAt | kept for 48 game days |
| **SalesDailySummary** | Aggregated old sales | id PK, merchantId*, stallId nullable, productId*, gameDay*, quantity*, revenue*, maleCount*, femaleCount*, youngCount*, oldCount* | |
| **Transaction** | Ledger | id PK, merchantId* FK, type*, amount* (signed), balanceAfter*, description, stallId, createdAt | types: OPENING_GRANT, STALL_PURCHASE, STOCK_PURCHASE, DECORATION, STALL_FEE, SALE_INCOME, LOAN_TAKEN, LOAN_REPAYMENT, ADMIN_GRANT, STALL_SOLD, STALL_CLOSED_REFUND |
| **Loan** | Loan | id PK, merchantId* FK, amount*, remaining*, status* (OPEN/REPAID), createdAt, repaidAt | one OPEN loan per merchant |
| **Notification** | Messages to merchant | id PK, userId* FK, type* (SUSPENSION/UNSUSPENSION/GRANT), message*, isRead*, createdAt | |
| **GameState** | Fair clock (singleton) | id = 1, currentDay*, currentHour*, lastTickAt* | |

---

## E. Endpoints

All endpoints are prefixed with `/api`. 🔒 means a Bearer JWT is required.

| Method | URL | Description | Access |
|---|---|---|---|
| GET | /health | Health check | Public |
| POST | /auth/register | `{email, password, displayName}` → `{token, user}`; 1,000 rubles gift | Public |
| POST | /auth/login | `{email, password}` → `{token, user}` | Public |
| GET | /auth/me | Current user | 🔒 any |
| GET | /categories | List | 🔒 any |
| POST | /categories | Create | 🔒 admin |
| PATCH | /categories/:id | Update | 🔒 admin |
| GET | /products?search=&categoryId=&sort=name\|price\|popularity | List / search / filter / sort | 🔒 any |
| POST | /products | Create | 🔒 admin |
| PATCH | /products/:id | Update | 🔒 admin |
| GET | /decorations | List | 🔒 any |
| GET | /fair | All stalls (public info), `isMine`, game clock | 🔒 any |
| GET | /fair/customers | Customers active now, with target stall | 🔒 any |
| GET | /stalls/mine?search=&categoryId=&status=&sort= | My stalls with sales summary (no score) | 🔒 merchant |
| POST | /stalls | `{name, productId, price}`; every stall costs 300 | 🔒 merchant |
| GET | /stalls/:id | Stall details | 🔒 owner or admin |
| PATCH | /stalls/:id | Update name/price; productId only when stock = 0 | 🔒 owner |
| DELETE | /stalls/:id | Close stall (50% stock refund) | 🔒 owner |
| POST | /stalls/:id/stock | `{quantity}` | 🔒 owner |
| POST | /stalls/:id/decorations | `{decorationId}` | 🔒 owner |
| GET | /stalls/:id/sale-quote | Admin buyout quote | 🔒 owner |
| POST | /stalls/:id/sell | Sell stall to admin | 🔒 owner |
| GET | /me/summary | Balance, status, income, expenses, loan, net worth | 🔒 merchant |
| GET | /me/sales?stallId=&productId=&fromDay=&toDay=&sort=&page= | My sales | 🔒 merchant |
| GET | /me/sales/by-product | Per-product breakdown incl. gender/age (detail + summary) | 🔒 merchant |
| GET | /me/transactions?type=&page= | Ledger | 🔒 merchant |
| GET | /me/loan | Active loan and max amount | 🔒 merchant |
| POST | /me/loan | `{amount}` | 🔒 merchant |
| GET | /me/notifications | Messages | 🔒 merchant |
| PATCH | /me/notifications/:id/read | Mark as read | 🔒 merchant |
| GET | /admin/stats | Totals + chart data (by status, sales per day, by category, top stalls) | 🔒 admin |
| GET | /admin/merchants?search=&status=&sort= | All merchants | 🔒 admin |
| GET | /admin/merchants/:id | Merchant details | 🔒 admin |
| POST | /admin/merchants/:id/grants | `{amount, message}` | 🔒 admin |
| GET | /admin/stalls?search=&status=&categoryId=&merchantId=&sort=score | All stalls incl. score | 🔒 admin |
| POST | /admin/stalls/:id/suspend | `{reason}`; notifies owner | 🔒 admin |
| POST | /admin/stalls/:id/unsuspend | Unsuspend; notifies owner | 🔒 admin |
| GET | /admin/sales?merchantId=&categoryId=&fromDay=&toDay= | All sales | 🔒 admin |
| GET | /admin/transactions?merchantId=&type= | All payments | 🔒 admin |

**Error codes:**

| Code | Meaning |
|---|---|
| 400 | Validation error |
| 401 | Missing or invalid token |
| 403 | Forbidden |
| 404 | Not found |
| 409 | Conflict (email exists, > 100 stalls, open loan exists, stock not 0 for product change, stall too new to sell) |
| 422 | Insufficient funds |

**Error format:** `{ "error": { "code": "...", "message": "..." } }`

---

## F. Requirements Compliance

| Requirement | How it is met |
|---|---|
| Login | JWT (register / login / me) |
| Two user types | MERCHANT and ADMIN, enforced server-side |
| Central entity | Stall, with > 5 meaningful fields |
| List / add / edit | GET /stalls/mine, POST /stalls, PATCH /stalls/:id |
| Selection field | product and category (closed lists), stall status, merchant status |
| Search / filter / sort | products, stalls, sales, merchants |
| Real database | PostgreSQL via Prisma with migrations |

---

## Build Deliverables

- `src/` structure: routes, controllers, services, validation (Zod), middleware, auth, simulation engine, config, errors.
- Prisma schema, migrations, and seed: demo admin + demo merchant via env vars in production, categories, ~30 products, decorations.
- Swagger UI at `/api-docs` with Bearer Authorize, plus `openapi.json`.
- Vitest tests covering auth, 401/403, CRUD, validation, filters, ownership, Prisma and Swagger validity.
- Pass typecheck, build and tests.
- `render.yaml`, `.env.example`, `.gitignore`, `README.md`.
- `START-HERE.md` (Hebrew: GitHub, DB, Render, testing, troubleshooting, keep-alive).
- `FRONTEND-API-GUIDE.md` (no React code).
- Final ZIP excluding `node_modules`, `.env` and any secrets.
