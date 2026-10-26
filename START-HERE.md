# מתחילים כאן 👋 — השרת של "היריד הגדול"

המדריך הזה מסביר, צעד אחרי צעד, איך מפעילים את השרת: במחשב שלך, ואחר כך באינטרנט (Render + Supabase), בחינם.

---

## 1. מה יש בתיקייה?

| מה | הסבר קצר |
|---|---|
| `src/` | כל הקוד של השרת |
| `prisma/` | מבנה מסד הנתונים, המיגרציות ונתוני ההתחלה (קטגוריות, מוצרים, קישוטים) |
| `tests/` | בדיקות אוטומטיות |
| `src/game/rules.ts` | **כל המספרים של המשחק** במקום אחד (מחירים, דמי דוכן, הלוואות...) |
| `FRONTEND-API-GUIDE.md` | מדריך לכתובות ה-API — בשבילך כשאת כותבת את ה-React |
| `openapi.json` | תיאור מלא של ה-API (אותו דבר שרואים ב-Swagger) |

---

## 2. מה צריך להתקין במחשב (פעם אחת)

1. **Node.js** גרסה 22 (LTS) — מהאתר nodejs.org.
2. **Git** — מהאתר git-scm.com.
3. **VS Code** — עורך קוד.

בדיקה שהכל הותקן: פותחים טרמינל ומקלידים:

```bash
node -v
git --version
```

---

## 3. יצירת מסד נתונים בחינם ב-Supabase

1. נכנסים ל-supabase.com ונרשמים.
2. לוחצים **New project**. נותנים שם (למשל `yarid`), בוחרים **סיסמה למסד נתונים** — ושומרים אותה!
   אזור (Region): מומלץ אירופה (Frankfurt).
3. כשהפרויקט מוכן: לוחצים למעלה על **Connect**.
4. בוחרים **Session pooler** ומעתיקים את הכתובת. היא נראית בערך כך:
   `postgresql://postgres.abcdefg:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
5. מחליפים את `[YOUR-PASSWORD]` בסיסמה ששמרת.

> 💡 למה Session pooler? כי Render (השרת החינמי) לא תמיד מצליח להתחבר לכתובת הישירה של Supabase. ה-Session pooler עובד תמיד.

**למסד נתונים של בדיקות** — הבדיקות מוחקות את כל הנתונים! לכן צריך מסד נתונים **נפרד**:
פותחים פרויקט שני ב-Supabase בשם `yarid-test` ולוקחים גם ממנו כתובת Session pooler.

---

## 4. הרצה במחשב שלך

פותחים טרמינל בתיקיית הפרויקט:

```bash
npm install
```

יוצרים קובץ הגדרות: מעתיקים את `.env.example` לקובץ חדש בשם `.env` וממלאים:

- `DATABASE_URL` — הכתובת מ-Supabase (פרויקט `yarid`)
- `DIRECT_URL` — **אותה כתובת בדיוק**
- `TEST_DATABASE_URL` — הכתובת של פרויקט הבדיקות (`yarid-test`). **חייבת להיות שונה** מ-`DATABASE_URL`.
- `JWT_SECRET` — מחרוזת ארוכה ואקראית (לפחות 16 תווים). אפשר פשוט להקליד הרבה אותיות ומספרים.

עכשיו יוצרים את הטבלאות וממלאים נתוני התחלה:

```bash
npx prisma migrate deploy
npx prisma generate
npm run db:seed
```

ומפעילים את השרת:

```bash
npm run dev
```

פותחים בדפדפן: **http://localhost:3000/api-docs** — זה ה-Swagger. 🎉

### איך מנסים ב-Swagger

1. פותחים את `POST /api/auth/login` ← **Try it out**.
2. כותבים: `{"email": "merchant@yarid.local", "password": "Merchant1234!"}` ← **Execute**.
3. מעתיקים את ה-`token` מהתשובה.
4. לוחצים על הכפתור **Authorize** 🔓 למעלה, מדביקים את הטוקן ← **Authorize**.
5. עכשיו כל הכתובות עם המנעול עובדות.

משתמשי דמו:

| תפקיד | אימייל | סיסמה |
|---|---|---|
| ראש הקהל (מנהל) | `admin@yarid.local` | `Admin1234!` |
| סוחר | `merchant@yarid.local` | `Merchant1234!` |

> 🕐 רוצה לראות קונים מהר? ב-`.env` שמים `GAME_HOUR_MS=10000` (שעת משחק = 10 שניות). בסוף מחזירים ל-`150000`.

---

## 5. הרצת הבדיקות

```bash
npm run typecheck   # בדיקת טיפוסים
npm test            # כל הבדיקות האוטומטיות
npm run build       # בנייה לגרסת הפקה
```

לפני הבדיקות בפעם הראשונה (ואחרי כל שינוי במבנה הטבלאות) צריך ליצור את הטבלאות גם במסד הבדיקות:

```bash
npm run db:migrate:test
```

**מסד נתונים מקומי לבדיקות (אופציה נוחה):** מתקינים PostgreSQL במחשב, יוצרים מסד נתונים בשם `yarid_test`, ושמים:
`TEST_DATABASE_URL="postgresql://postgres:<הסיסמה שלך>@localhost:5432/yarid_test"`

---

## 6. העלאה ל-GitHub

1. ב-github.com לוחצים **New repository**, שם: `hayarid-hagadol-server`, **Private** או Public — כרצונך. לא מסמנים "Add README".
2. בטרמינל, בתיקיית הפרויקט:

```bash
git init
git add .
git commit -m "First version of the server"
git branch -M main
git remote add origin https://github.com/<שם-המשתמש-שלך>/hayarid-hagadol-server.git
git push -u origin main
```

> 🔒 הקובץ `.env` **לא** עולה ל-GitHub (הוא ב-`.gitignore`). כך הסיסמאות שלך נשארות סודיות. אל תמחקי את השורה הזאת מ-`.gitignore`!

---

## 7. העלאה לאינטרנט ב-Render (חינם)

1. נכנסים ל-render.com ונרשמים עם חשבון ה-GitHub.
2. לוחצים **New +** ← **Blueprint** ← בוחרים את ה-repository.
   Render יקרא את הקובץ `render.yaml` ויציע ליצור את השירות `hayarid-hagadol-api`.
3. Render יבקש למלא כמה ערכים:
   - `DATABASE_URL` ו-`DIRECT_URL` — כתובת ה-Session pooler של Supabase (אותה כתובת בשניהם).
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` — האימייל והסיסמה של ראש הקהל (בחרי סיסמה חזקה!).
   - `DEMO_MERCHANT_EMAIL`, `DEMO_MERCHANT_PASSWORD` — אם רוצים סוחר לדוגמה (אפשר להשאיר ריק).
   - `JWT_SECRET` נוצר אוטומטית.
4. לוחצים **Apply**. הבנייה לוקחת כמה דקות.
5. בסוף מקבלים כתובת כמו `https://hayarid-hagadol-api.onrender.com`.
   בודקים: `https://...onrender.com/api/health` צריך להחזיר `"status":"ok"`.
   ה-Swagger: `https://...onrender.com/api-docs`

**כל פעם שעושים `git push` — Render מעדכן את השרת לבד.**

בכל הפעלה השרת: יוצר/מעדכן טבלאות (`migrate deploy`), מוסיף נתוני התחלה שחסרים (`seed` — לא מוחק כלום), ומפעיל את היריד.

> כשהאתר שלך (React) יהיה באוויר, כדאי לשנות ב-Render את `CORS_ORIGIN` לכתובת האתר שלך, למשל `https://my-yarid.netlify.app`.

---

## 8. שמירה על השרת ער (Keep-alive) ⏰

בתוכנית החינמית של Render השרת **נרדם** אחרי כ-15 דקות בלי ביקורים, וההתעוררות לוקחת בערך דקה.
כשהוא ישן — גם היריד "סגור": הקונים לא קונים. כשהוא מתעורר, הוא משלים עד 6 שעות משחק ברקע, והשאר נחשב כאילו היריד היה סגור.

כדי שהשרת יישאר ער, מגדירים "פינג" חינמי שמבקר בו כל כמה דקות:

**אפשרות א' — UptimeRobot (uptimerobot.com):**
1. נרשמים ← **Add New Monitor**.
2. סוג: **HTTP(s)**. כתובת: `https://<השרת-שלך>.onrender.com/api/health`
3. תדירות: כל **5 דקות** ← שומרים.

**אפשרות ב' — cron-job.org:**
1. נרשמים ← **Create cronjob**.
2. כתובת: `https://<השרת-שלך>.onrender.com/api/health`
3. תזמון: כל **10 דקות** ← שומרים.

> ⚠️ שימי לב: התנאים של Render (וגם של Supabase) יכולים להשתנות עם הזמן — למשל מספר שעות ההפעלה החינמיות בחודש או האם מותר להשאיר שרת חינמי ער כל הזמן. כדאי לבדוק את העמוד שלהם מדי פעם. גם Supabase עשוי להשהות פרויקט חינמי שלא היה בו שימוש כשבוע — הפינג שומר גם עליו פעיל, כי השרת ניגש למסד הנתונים.

---

## 9. פתרון בעיות 🛠️

| מה קורה | מה עושים |
|---|---|
| `Invalid environment variables` כשמפעילים | חסר משהו ב-`.env` (או ב-Render). ההודעה אומרת בדיוק מה. `JWT_SECRET` חייב להיות לפחות 16 תווים. |
| `Can't reach database server` / `ECONNREFUSED` | הכתובת של מסד הנתונים לא נכונה. בדקי שהעתקת **Session pooler**, שהחלפת את `[YOUR-PASSWORD]`, ושאין רווחים. |
| `password authentication failed` | הסיסמה של מסד הנתונים לא נכונה. אפשר לאפס אותה ב-Supabase: Project Settings ← Database. |
| בסיסמה יש תווים כמו `@` או `#` | צריך לכתוב אותם בקידוד: `@` ← `%40`, `#` ← `%23`. או פשוט לבחור סיסמה עם אותיות ומספרים בלבד. |
| `The table ... does not exist` | לא הרצת `npx prisma migrate deploy`. |
| `Cannot find module '../generated/prisma/client'` | צריך להריץ `npx prisma generate` (או `npm run build`). |
| הבדיקות נכשלות עם `TEST_DATABASE_URL is not set` | הוסיפי את `TEST_DATABASE_URL` ל-`.env`. |
| הבדיקות נכשלות עם `Safety stop` | `TEST_DATABASE_URL` זהה ל-`DATABASE_URL`. זו הגנה כדי שהבדיקות לא ימחקו את מסד הנתונים האמיתי — צריך מסד נתונים נפרד לבדיקות. |
| בבדיקות: `relation "User" does not exist` | עוד לא נוצרו טבלאות במסד הבדיקות: `npm run db:migrate:test`. |
| ב-Render: האתר מחזיר 502 או טוען הרבה זמן | כנראה השרת התעורר משינה — מחכים דקה. אם זה ממשיך, נכנסים ב-Render ל-**Logs** וקוראים את השגיאה. |
| ה-React מקבל שגיאת CORS | בודקים את `CORS_ORIGIN` ב-Render. `*` מתיר לכולם. |
| 401 בכל בקשה | חסרה הכותרת `Authorization: Bearer <token>`, או שהטוקן פג (תוקף 7 ימים) — צריך להתחבר מחדש. |
| אין קונים ביריד | צריך דוכן **עם מלאי**, לא מושעה, ומחיר עד פי 1.5 ממחיר השוק. וגם — לחכות שתעבור שעת משחק (2.5 דקות). |

---

בהצלחה! 🎪
