# פריסה לענן

האתר רץ על Vercel, ומסד הנתונים, אחסון הקבצים וההתחברות על Supabase.

## משתני סביבה

| משתנה | מה זה | מאיפה |
|---|---|---|
| `DATABASE_URL` | חיבור למסד דרך מאגר חיבורים (פורט 6543) | Supabase → Project Settings → Database → Connection pooling |
| `DIRECT_URL` | חיבור ישיר (פורט 5432), לשינויי סכימה בלבד | אותו מסך, Direct connection |
| `NEXT_PUBLIC_SUPABASE_URL` | כתובת הפרויקט | Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | מפתח ציבורי, מגיע גם לדפדפן | Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | מפתח שירות. **עוקף הרשאות — צד שרת בלבד** | Project Settings → API |
| `SUPABASE_STORAGE_BUCKET` | שם הדלי לקבצים. ברירת מחדל `documents` | — |
| `ALLOWED_EMAILS` | כתובות מורשות להתחבר, מופרדות בפסיק | את קובעת |
| `GEMINI_API_KEY` | קריאת קבלות מצילום | Google AI Studio |
| `CARDCOM_*` | משיכת חשבוניות והפקתן | משרד הנהלת החשבונות בקארדקום |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | חיבור לדרייב | Google Cloud Console |
| `DRIVE_IMPORT_ENABLED` | `true` כדי לאפשר קליטה מתיקייה קיימת | — |
| `APP_URL` | כתובת האתר, לבניית ה-redirect של גוגל | אחרי הפריסה |

`ALLOWED_EMAILS` ריק חוסם את כל הכניסות. זה מכוון: עדיף אתר נעול מאתר פתוח.

## סדר הפעולות

1. יצירת פרויקט ב-Supabase, ובתוכו דלי אחסון פרטי בשם `documents`.
2. הגדרת משתני הסביבה ב-Vercel.
3. `npx prisma db push` מול `DIRECT_URL` — יוצר את הטבלאות.
4. `npm run db:secure` — **חובה אחרי כל `db push` שיוצר טבלה חדשה.** בלי זה הטבלה
   חשופה לקריאה דרך ה-REST של Supabase עם המפתח הציבורי.
5. `npm run migrate:cloud` — מעביר את הנתונים והקבצים מהמחשב.
6. פריסה, ואז הוספת `<כתובת האתר>/api/drive/callback` ל-redirect URIs בגוגל.

## אחרי הפריסה

חיבור הדרייב צריך אישור מחדש: הרשאת הקריאה לתיקייה קיימת רחבה מזו של הגיבוי,
וגוגל מבקשת אותה רק בהתחברות חדשה.
