# מדריך ה-API בשביל ה-Frontend 🎪

המדריך הזה מסביר אילו כתובות לקרוא בכל מסך, מה לשלוח ומה חוזר.
**את כותבת את ה-React בעצמך** — כאן יש רק כתובות, כותרות ודוגמאות JSON.

את התיאור המלא והמדויק של כל כתובת אפשר לראות ולנסות ב-Swagger: `<כתובת השרת>/api-docs`

---

## 1. כללי בסיס

**כתובת השרת:**
- במחשב: `http://localhost:3000`
- באינטרנט: `https://<השם-שלך>.onrender.com`

כדאי לשמור את הכתובת במקום אחד בקוד (למשל משתנה סביבה של Vite: `VITE_API_URL`), כדי להחליף בקלות בין המחשב לאינטרנט.

**כל הכתובות מתחילות ב-`/api`.** למשל: `GET http://localhost:3000/api/fair`

**שליחת נתונים:** בבקשות `POST` / `PATCH` שולחים JSON, עם הכותרת:
```
Content-Type: application/json
```

**התחברות:** אחרי login/register מקבלים `token`. שומרים אותו (למשל ב-localStorage) ושולחים בכל בקשה עם 🔒:
```
Authorization: Bearer <token>
```
הטוקן תקף 7 ימים. אם חוזר **401** — הטוקן חסר או פג → מחזירים למסך ההתחברות.

**כסף:** כל הסכומים הם **מספרים שלמים ברובלים** (בלי אגורות). היתרה יכולה להיות שלילית (בגלל דמי דוכן).

**מספרים:** בבקשות שולחים מספרים כמספרים (`"price": 12`), לא כמחרוזת (`"price": "12"` ← שגיאה 400). שימי לב: ערך משדה `<input>` הוא תמיד מחרוזת — צריך להמיר למספר לפני השליחה.

---

## 2. שגיאות

כל שגיאה חוזרת באותה צורה:

```json
{ "error": { "code": "INSUFFICIENT_FUNDS", "message": "Insufficient funds: need 300, balance is 120", "details": { "needed": 300, "balance": 120 } } }
```

| קוד HTTP | משמעות | מה להציג |
|---|---|---|
| 400 | נתונים לא תקינים. ב-`details` יש רשימה: `[{ "path": "price", "message": "..." }]` | להדגיש את השדה שב-`path` |
| 401 | לא מחובר / טוקן פג | להעביר למסך התחברות |
| 403 | אין הרשאה (תפקיד לא נכון, או דוכן של מישהו אחר) | "אין לך הרשאה" |
| 404 | לא נמצא | "לא נמצא" |
| 409 | התנגשות — ראי את `code` | הודעה לפי הטבלה למטה |
| 422 | אין מספיק כסף | "אין מספיק כסף" |

**ערכי `code` חשובים:**

| code | הודעה מוצעת בעברית |
|---|---|
| `EMAIL_EXISTS` | האימייל הזה כבר רשום |
| `UNAUTHORIZED` | אימייל או סיסמה לא נכונים / צריך להתחבר |
| `STALL_LIMIT_REACHED` | הגעת למקסימום של 100 דוכנים |
| `STOCK_NOT_EMPTY` | אפשר להחליף מוצר רק כשהמלאי ריק |
| `DECORATION_EXISTS` | הקישוט הזה כבר קיים בדוכן |
| `STALL_TOO_NEW` | אפשר למכור דוכן רק אחרי 3 ימי משחק |
| `OPEN_LOAN_EXISTS` | כבר יש לך הלוואה פתוחה |
| `LOAN_LIMIT_EXCEEDED` | הסכום גבוה מהמקסימום לסטטוס שלך |
| `PRODUCT_INACTIVE` | המוצר הזה כבר לא נמכר אצל הספקים |
| `INSUFFICIENT_FUNDS` | אין מספיק כסף |

---

## 3. תרגום ערכים קבועים לעברית

| ערך | עברית |
|---|---|
| `MERCHANT` / `ADMIN` | סוחר / ראש הקהל |
| `BEGINNER` / `EXPERIENCED` / `GVIR` | מתחיל / מנוסה / גביר |
| `ACTIVE` / `SUSPENDED` | פעיל / מושעה |
| `MALE` / `FEMALE` | גבר / אישה |
| `YOUNG` / `OLD` | צעיר / מבוגר |
| `ANY` | כולם |
| `OPEN` / `REPAID` (הלוואה) | פתוחה / הוחזרה |
| `SUSPENSION` / `UNSUSPENSION` / `GRANT` (הודעה) | השעיה / ביטול השעיה / מענק |

**סוגי תנועות (`type`):**

| type | עברית |
|---|---|
| `OPENING_GRANT` | מתנת הצטרפות |
| `STALL_PURCHASE` | קניית דוכן |
| `STOCK_PURCHASE` | קניית מלאי |
| `DECORATION` | קישוט |
| `STALL_FEE` | דמי דוכן יומיים |
| `SALE_INCOME` | הכנסה ממכירות |
| `LOAN_TAKEN` | קבלת הלוואה |
| `LOAN_REPAYMENT` | החזר הלוואה |
| `ADMIN_GRANT` | מענק מראש הקהל |
| `STALL_SOLD` | מכירת דוכן |
| `STALL_CLOSED_REFUND` | החזר בסגירת דוכן |

---

## 4. שעון היריד ⏰

- **יום משחק = שעה אמיתית.** **שעת משחק = 2.5 דקות אמיתיות.**
- השעון מגיע בתשובות של `/fair`, `/fair/customers` ו-`/admin/stats`:

```json
"clock": {
  "day": 2,
  "hour": 9,
  "lastTickAt": "2026-10-12T14:11:03.026Z",
  "nextTickAt": "2026-10-12T14:13:33.026Z",
  "msPerGameHour": 150000,
  "msPerGameDay": 3600000
}
```

- להצגה: "יום 2, 09:00".
- **רעיון לשעון זז:** הדקות בתוך השעה = (הזמן עכשיו − `lastTickAt`) ÷ `msPerGameHour` × 60. כך אפשר להציג 09:00, 09:12, 09:24... עד שמגיעה שעה חדשה מהשרת.
- `nextTickAt` = מתי בערך תגיע שעת המשחק הבאה. זה זמן טוב לטעון שוב את היריד.

**כמה פעמים לטעון מחדש (polling)?**
- `/api/fair` — פעם בדקה, או כשמגיע `nextTickAt`.
- `/api/fair/customers` — כשמגיע `nextTickAt` (הלקוחות מתחלפים כל שעת משחק).
- לא צריך לטעון כל שנייה — זה מעמיס על השרת החינמי.

**מרוויחים רק כשמחוברים:** השרת רואה שהסוחר "במשחק" כל עוד מגיעות ממנו בקשות עם טוקן. אם לא הגיעה ממנו בקשה בדקה האחרונה — הדוכנים שלו לא מוכרים. וביום משחק שבו לא התחבר בכלל — הוא גם לא משלם דמי דוכן.
לכן כשהמשחק פתוח צריכה לרוץ לפחות בקשה אחת קבועה (למשל רענון היתרה כל 10 שניות) — זה מספיק.

---

## 5. מסך פתיחה — הרשמה והתחברות

### הרשמה
`POST /api/auth/register`
```json
{ "email": "sara@example.com", "password": "Password123", "displayName": "שרה" }
```
חוקים: אימייל תקין · סיסמה לפחות 8 תווים · שם תצוגה 2–30 תווים.
מתנה: 1,000 רובל. כל דוכן עולה 300 רובל.

### התחברות
`POST /api/auth/login`
```json
{ "email": "sara@example.com", "password": "Password123" }
```

**תשובה (לשתיהן):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 2,
    "email": "sara@example.com",
    "displayName": "שרה",
    "role": "MERCHANT",
    "balance": 1000,
    "status": "BEGINNER",
    "createdAt": "2026-10-12T14:08:46.748Z"
  }
}
```
לפי `user.role` מחליטים מה להציג: `MERCHANT` ← אזור הסוחר, `ADMIN` ← אזור ראש הקהל.

### מי מחובר עכשיו (בטעינת האתר)
`GET /api/auth/me` 🔒 ← אותם שדות כמו `user`.

---

## 6. מסך היריד

### מפת הדוכנים
`GET /api/fair` 🔒

```json
{
  "clock": { "day": 2, "hour": 9, "...": "..." },
  "stalls": [
    {
      "id": 1,
      "slotNumber": 1,
      "name": "דוכן החלות של שרה",
      "merchant": { "id": 2, "displayName": "שרה" },
      "isMine": true,
      "product": { "id": 6, "name": "חלה", "category": { "id": 2, "name": "מאפים" } },
      "price": 12,
      "inStock": true,
      "status": "ACTIVE",
      "decorations": [{ "id": 1, "name": "דגלונים צבעוניים" }]
    }
  ]
}
```

- `slotNumber` = המקום של הדוכן במפה (1, 2, 3...). אפשר לסדר רשת לפי המספר.
- `isMine: true` ← להדגיש את הדוכנים שלי.
- `inStock`, `status` ← לצבוע: פעיל / ריק / מושעה.
- אין שעות פתיחה וסגירה: כל דוכן פתוח כל הזמן, מהרגע שנוצר.
- בלחיצה על דוכן אפשר להציג את הפרטים מהרשימה הזאת. אם זה הדוכן שלי — אפשר לקרוא ל-`GET /api/stalls/:id` לפרטים מלאים.

### לקוחות שמסתובבים ביריד
`GET /api/fair/customers` 🔒 — רק הלקוחות שמבקרים **בשעת המשחק הנוכחית**.

כל משתמש מקבל רק חלק מהלקוחות, לפי הדוכנים **שלו**: 15 לכל דוכן פעיל שלו, לפחות 10 ולכל היותר 80. קודם מגיעים לקוחות שקנו אצלו, אחר כך לקוחות שמחפשים מוצר שהוא מוכר, ואז השאר.

```json
{
  "clock": { "day": 2, "hour": 9, "...": "..." },
  "customers": [
    {
      "id": 65,
      "nickname": "דוד מהיער #65",
      "gender": "MALE",
      "ageGroup": "OLD",
      "targetStallId": 1,
      "targetStallIds": [1, 4],
      "purchases": [{ "stallId": 1, "productId": 6, "price": 12 }, { "stallId": 4, "productId": 1, "price": 6 }],
      "shoppingList": [{ "productId": 6, "purchased": true }, { "productId": 1, "purchased": true }]
    },
    {
      "id": 70,
      "nickname": "רחל מהעמק #70",
      "gender": "FEMALE",
      "ageGroup": "YOUNG",
      "targetStallId": null,
      "targetStallIds": [],
      "purchases": [],
      "shoppingList": [{ "productId": 3, "purchased": false }]
    }
  ]
}
```

- **לאנימציה:** כל לקוח הולך לדוכנים שב-`targetStallIds` (לפי הסדר). אם הרשימה ריקה — הלקוח לא מצא מה לקנות; אפשר להראות אותו מסתובב.
- `gender` ו-`ageGroup` ← לבחור דמות/אייקון.
- בלילה יש מעט מאוד לקוחות, ובשעות השיא (08–11, 16–19) הכי הרבה.

---

## 7. אזור הסוחר האישי 🔒 (רק `MERCHANT`)

### לשונית סיכום
`GET /api/me/summary`
```json
{
  "displayName": "שרה",
  "balance": 696,
  "status": "BEGINNER",
  "income": 1096,
  "expenses": 400,
  "incomeByType": { "SALE_INCOME": 96, "STALL_SOLD": 0, "STALL_CLOSED_REFUND": 0, "ADMIN_GRANT": 0, "OPENING_GRANT": 1000 },
  "expensesByType": { "STALL_PURCHASE": 0, "STOCK_PURCHASE": 360, "DECORATION": 20, "STALL_FEE": 20 },
  "loan": null,
  "stockValue": 312,
  "netWorth": 1008,
  "stallsCount": 1,
  "today": { "day": 2, "unitsSold": 0, "revenue": 0 },
  "unreadNotifications": 0
}
```
- `netWorth` (שווי נקי) = יתרה + שווי המלאי − ההלוואה שנשארה.
- `loan` = `null` אם אין הלוואה, אחרת `{ "id", "amount", "remaining", "createdAt" }`.
- `unreadNotifications` ← מספר על אייקון ההודעות 🔔.

**איך עולים בסטטוס** (להסבר במסך):
| סטטוס | תנאי |
|---|---|
| מנוסה | שווי נקי ≥ 3,000 **וגם** ציון ממוצע של הדוכנים ≥ 50 |
| גביר | שווי נקי ≥ 10,000 **וגם** ציון ממוצע ≥ 70 |

הציון עצמו **סודי** — הסוחר לא רואה אותו. הוא תלוי ב: קישוטים, פופולריות המוצר, מחיר קרוב למחיר השוק, מעט מתחרים, מלאי שלא נגמר, והתאמה לקהל.

### לשונית הדוכנים שלי
`GET /api/stalls/mine` — עם סינון (כולם לא חובה):

| פרמטר | ערכים |
|---|---|
| `search` | טקסט — מחפש בשם הדוכן ובשם המוצר |
| `categoryId` | מספר קטגוריה |
| `status` | `ACTIVE` / `SUSPENDED` |
| `sort` | `slot` (ברירת מחדל) / `name` / `price` / `stock` / `createdAt` / `revenue` |
| `order` | `asc` / `desc` |

דוגמה: `GET /api/stalls/mine?search=חלה&sort=revenue&order=desc`

כל דוכן ברשימה:
```json
{
  "id": 1,
  "merchantId": 2,
  "name": "דוכן החלות של שרה",
  "slotNumber": 1,
  "status": "ACTIVE",
  "suspensionReason": null,
  "price": 12,
  "stock": 52,
  "product": {
    "id": 6, "name": "חלה", "supplierPrice": 6, "marketPrice": 12, "popularity": 90, "isActive": true,
    "category": { "id": 2, "name": "מאפים" }
  },
  "decorations": [{ "id": 1, "name": "דגלונים צבעוניים", "points": 10, "cost": 20, "addedAt": "..." }],
  "decorationPoints": 10,
  "decorationSpent": 20,
  "createdGameDay": 1,
  "ageInGameDays": 1,
  "createdAt": "...",
  "updatedAt": "...",
  "sales": { "todayUnits": 0, "todayRevenue": 0, "totalUnits": 8, "totalRevenue": 96 }
}
```
אם `status` הוא `SUSPENDED` — להציג את `suspensionReason`. דוכן מושעה לא מוכר.

**פעולות על דוכן:**

| פעולה | בקשה | גוף |
|---|---|---|
| קניית מלאי | `POST /api/stalls/:id/stock` | `{ "quantity": 20 }` (1–10,000) |
| הוספת קישוט | `POST /api/stalls/:id/decorations` | `{ "decorationId": 3 }` |
| הצעת מחיר למכירה | `GET /api/stalls/:id/sale-quote` | — |
| מכירה לראש הקהל | `POST /api/stalls/:id/sell` | — |
| סגירת דוכן | `DELETE /api/stalls/:id` | — |

תשובה לקניית מלאי / קישוט: `{ "cost": 120, "balance": 576, "stall": { ...הדוכן המעודכן } }`

**הצעת מחיר** (להציג **לפני** שהסוחר מאשר מכירה):
```json
{
  "stallId": 1,
  "ageInGameDays": 1,
  "minAgeInGameDays": 3,
  "canSell": false,
  "availableFromDay": 4,
  "stallValue": 326,
  "stockUnits": 52,
  "stockValue": 156,
  "total": 482
}
```
אם `canSell` הוא `false` ← כפתור "מכור" כבוי, ולהציג "אפשר למכור מיום 4".
תשובה למכירה: אותו דבר ועוד `balance`. **אחרי מכירה או סגירה הדוכן נמחק.**

**סגירה:** מחזירה רק 50% משווי המלאי. תשובה: `{ "stallId": 1, "refund": 23, "balance": 978 }`. כדאי לשאול "בטוחה?" לפני.

### לשונית מכירות
`GET /api/me/sales` — עם סינון ודפים:

| פרמטר | ערכים |
|---|---|
| `stallId`, `productId` | מספר |
| `fromDay`, `toDay` | מספר יום משחק |
| `sort` | `newest` (ברירת מחדל) / `oldest` / `price` |
| `page` | מספר עמוד, מתחיל ב-1 |
| `pageSize` | 1–100 (ברירת מחדל 20) |

```json
{
  "items": [
    {
      "id": 8, "gameDay": 1, "gameHour": 17, "unitPrice": 12, "quantity": 1, "total": 12,
      "customerGender": "MALE", "customerAge": "OLD",
      "customer": { "id": 65, "nickname": "דוד מהיער #65" },
      "product": { "id": 6, "name": "חלה" },
      "stall": { "id": 1, "name": "דוכן החלות של שרה", "slotNumber": 1 },
      "createdAt": "..."
    }
  ],
  "page": 1, "pageSize": 20, "total": 8, "totalPages": 1
}
```
**כל הרשימות עם דפים** מחזירות את אותה צורה: `items`, `page`, `pageSize`, `total`, `totalPages` ← לכפתורי "הקודם / הבא".

שימי לב: מכירות מפורטות נשמרות ל-48 ימי משחק אחרונים. אחר כך הן נשמרות רק כסיכום (ונכללות בפילוח לפי מוצר).
`stall` יכול להיות `null` אם הדוכן נסגר או נמכר.

### לשונית פילוח לפי מוצר
`GET /api/me/sales/by-product`
```json
[
  {
    "product": { "id": 6, "name": "חלה" },
    "quantity": 8,
    "revenue": 96,
    "customers": 8,
    "byGender": { "MALE": 5, "FEMALE": 3 },
    "byAge": { "YOUNG": 2, "OLD": 6 }
  }
]
```
מתאים מאוד לגרף עוגה / עמודות.

### לשונית תנועות
`GET /api/me/transactions?type=&page=&pageSize=`
```json
{
  "items": [
    { "id": 12, "merchantId": 2, "type": "STALL_FEE", "amount": -20, "balanceAfter": 696, "description": "דמי דוכן ליום 1: 1 דוכנים × 20", "stallId": null, "createdAt": "..." },
    { "id": 11, "merchantId": 2, "type": "SALE_INCOME", "amount": 12, "balanceAfter": 716, "description": "מכירות ביום 1 שעה 17: 1 יחידות", "stallId": 1, "createdAt": "..." }
  ],
  "page": 1, "pageSize": 20, "total": 12, "totalPages": 1
}
```
`amount` חיובי = נכנס כסף (ירוק), שלילי = יצא כסף (אדום). `balanceAfter` = היתרה אחרי התנועה.

### לשונית הלוואה
`GET /api/me/loan`
```json
{ "loan": null, "status": "BEGINNER", "maxAmount": 500, "canTakeLoan": true, "repaymentShare": 0.3, "history": [] }
```
- `maxAmount`: מתחיל 500 · מנוסה 2,000 · גביר 5,000.
- `repaymentShare: 0.3` ← "30% מכל מכירה הולכים להחזר ההלוואה אוטומטית". אין ריבית.
- `history` — הלוואות קודמות.

לקיחת הלוואה: `POST /api/me/loan` עם `{ "amount": 300 }` ← תשובה: `{ "loan": {...}, "balance": 1300 }`.

### לשונית הודעות
`GET /api/me/notifications`
```json
{
  "items": [
    { "id": 3, "userId": 2, "type": "GRANT", "message": "קיבלת מענק של 100 רובל מראש הקהל: כל הכבוד", "isRead": false, "createdAt": "..." }
  ],
  "unread": 1
}
```
סימון כנקרא: `PATCH /api/me/notifications/:id/read` (בלי גוף).

---

## 8. טופס הוספה / עריכה של דוכן

**רשימות לטופס:**
- קטגוריות: `GET /api/categories` ← `[{ "id": 2, "name": "מאפים", "description": "...", "productCount": 4 }]`
- מוצרים: `GET /api/products?categoryId=2&search=חל&sort=name`
  - `sort`: `name` / `price` / `popularity` · `order`: `asc` / `desc`
  - כל מוצר: `{ "id", "name", "categoryId", "category": {...}, "supplierPrice", "marketPrice", "popularity", "targetGender", "targetAge", "isActive" }`
  - `supplierPrice` = כמה הסוחר משלם לספק על יחידת מלאי. `marketPrice` = מחיר השוק. **רמז טוב לסוחר:** מחיר בין 80% ל-110% ממחיר השוק הוא הכי טוב. מעל פי 1.5 ממחיר השוק — אף אחד לא קונה.
- קישוטים: `GET /api/decorations` ← `[{ "id": 1, "name": "דגלונים צבעוניים", "cost": 20, "points": 10 }]`

**יצירה:** `POST /api/stalls`
```json
{ "name": "דוכן החלות של שרה", "productId": 6, "price": 12 }
```
חוקים: שם 2–40 תווים · מחיר מספר שלם > 0. הדוכן פתוח מיד וכל הזמן — אין שעות פתיחה.
כל דוכן עולה 300 רובל.
תשובה: הדוכן החדש (כמו ברשימה, בלי `sales`).

**עריכה:** `PATCH /api/stalls/:id` — שולחים רק מה שהשתנה:
```json
{ "price": 11 }
```
אפשר לשנות `name`, `price` ו-`productId` (**רק כשהמלאי 0**).

**במצב עריכה:** כפתורי "קניית מלאי" ו"הוספת קישוט" משתמשים בפעולות שבסעיף 7. קישוט שכבר קיים בדוכן (ב-`decorations`) — להציג כ"כבר יש".

---

## 9. אזור ראש הקהל 🔒 (רק `ADMIN`)

### לוח בקרה עם גרפים
`GET /api/admin/stats`
```json
{
  "clock": { "...": "..." },
  "totals": {
    "merchants": 12, "stalls": 30, "activeStalls": 28, "suspendedStalls": 2, "activeCustomersToday": 750,
    "unitsSoldAllTime": 5400, "revenueAllTime": 61000, "unitsSoldToday": 210, "revenueToday": 2300
  },
  "merchantsByStatus": [{ "status": "BEGINNER", "count": 9 }, { "status": "EXPERIENCED", "count": 2 }, { "status": "GVIR", "count": 1 }],
  "salesPerDay": [{ "day": 13, "quantity": 400, "revenue": 4600 }, { "day": 14, "quantity": 210, "revenue": 2300 }],
  "salesByCategory": [{ "categoryId": 2, "name": "מאפים", "quantity": 900, "revenue": 10800 }],
  "topStalls": [{ "id": 1, "name": "...", "score": 80, "slotNumber": 1, "status": "ACTIVE", "merchant": { "id": 2, "displayName": "שרה" }, "product": { "id": 6, "name": "חלה" } }]
}
```
רעיונות לגרפים: עוגה ל-`merchantsByStatus`, קו ל-`salesPerDay` (14 הימים האחרונים, ימים בלי מכירות מופיעים עם 0), עמודות ל-`salesByCategory`, טבלה ל-`topStalls`.

### טבלת סוחרים
`GET /api/admin/merchants?search=&status=&sort=&order=&page=&pageSize=`
- `sort`: `createdAt` (ברירת מחדל) / `name` / `balance` / `stalls` / `netWorth`
- כל שורה: פרטי המשתמש + `stallsCount`, `stockValue`, `loanRemaining`, `netWorth`, `averageScore`.

פרטי סוחר: `GET /api/admin/merchants/:id` ← כולל `stalls` (עם `score`), `loan`, `recentTransactions`.

מענק: `POST /api/admin/merchants/:id/grants`
```json
{ "amount": 200, "message": "כל הכבוד על הדוכן היפה!" }
```
הסוחר מקבל הודעה אוטומטית.

### טבלת דוכנים (כולל ציון)
`GET /api/admin/stalls?search=&status=&categoryId=&merchantId=&sort=score&order=&page=&pageSize=`
- `sort`: `score` (ברירת מחדל, מהגבוה לנמוך) / `name` / `price` / `slot` / `createdAt`
- `search` מחפש בשם הדוכן, בשם המוצר ובשם הסוחר.
- כל דוכן כולל `score` (0–100) ו-`merchant`.

השעיה: `POST /api/admin/stalls/:id/suspend` עם `{ "reason": "המחירים גבוהים מדי" }`
ביטול השעיה: `POST /api/admin/stalls/:id/unsuspend` (בלי גוף)
בשני המקרים הסוחר מקבל הודעה אוטומטית, והתשובה היא הדוכן המעודכן.

### מכירות ותשלומים
- `GET /api/admin/sales?merchantId=&categoryId=&fromDay=&toDay=&page=&pageSize=` ← דפים + `totals: { units, revenue }` לסינון הנוכחי.
- `GET /api/admin/transactions?merchantId=&type=&page=&pageSize=` ← כל התנועות, עם `merchant: { id, displayName }`.

---

## 10. ניהול קטלוג (ADMIN)

| פעולה | בקשה | גוף לדוגמה |
|---|---|---|
| קטגוריה חדשה | `POST /api/categories` | `{ "name": "ספרים", "description": "ספרים וכלי כתיבה" }` |
| עריכת קטגוריה | `PATCH /api/categories/:id` | `{ "name": "ספרים ומחברות" }` |
| מוצר חדש | `POST /api/products` | ראי למטה |
| עריכת מוצר | `PATCH /api/products/:id` | `{ "popularity": 80 }` או `{ "isActive": false }` |
| כל המוצרים כולל לא פעילים | `GET /api/products?includeInactive=true` | — |

מוצר חדש:
```json
{
  "name": "עוגת דבש",
  "categoryId": 2,
  "supplierPrice": 10,
  "marketPrice": 20,
  "popularity": 60,
  "targetGender": "ANY",
  "targetAge": "OLD",
  "isActive": true
}
```
חוקים: שם קטגוריה 2–30 תווים וייחודי · שם מוצר ייחודי · `marketPrice` גדול מ-`supplierPrice` · `popularity` 1–100.
מוצר עם `isActive: false` לא מופיע לסוחרים, ואי אפשר לפתוח איתו דוכן או לקנות לו מלאי.

---

## 11. טבלת הרשאות קצרה

| | אורח | סוחר | ראש הקהל |
|---|---|---|---|
| הרשמה / התחברות | ✅ | ✅ | ✅ |
| יריד, קטלוג, קישוטים | ❌ | ✅ | ✅ |
| `/stalls/...` (ניהול דוכנים) | ❌ | ✅ רק שלו | ❌ (רק צפייה ב-`GET /stalls/:id`) |
| `/me/...` | ❌ | ✅ | ❌ |
| `/admin/...`, יצירה/עריכה של קטלוג | ❌ | ❌ | ✅ |

בהצלחה עם ה-React! 💪
