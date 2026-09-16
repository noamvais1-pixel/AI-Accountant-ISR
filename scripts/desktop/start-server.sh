#!/bin/zsh
# מפעיל את כל מה שהאפליקציה צריכה: מסד נתונים ושרת.
# נקרא מתוך אפליקציית המק. מקבל את תיקיית הפרויקט כארגומנט ראשון.
#
# אפליקציה שנפתחת מ-Finder לא יורשת את ה-PATH של הטרמינל, ולכן כל הנתיבים
# כאן מפורשים ולא נשענים על מה שמוגדר ב-.zshrc.

set -u
PROJECT_DIR="$1"
PORT="${PORT:-3737}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$PROJECT_DIR" || { echo "תיקיית הפרויקט לא נמצאה: $PROJECT_DIR"; exit 1; }

# קריאת הגדרות מקומיות (נתיב Postgres וכו') מ-.env.local
env_value() {
  grep -E "^$1=" .env.local 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//'
}

# --- מסד נתונים -------------------------------------------------------------
PG_BIN="$(env_value LOCAL_PG_BIN)"
PG_DATA="$(env_value LOCAL_PGDATA)"
PG_PORT="$(env_value DATABASE_URL | sed -nE 's#.*:([0-9]+)/.*#\1#p')"
PG_PORT="${PG_PORT:-5432}"

if [ -n "$PG_BIN" ] && [ -x "$PG_BIN/pg_isready" ]; then
  if ! "$PG_BIN/pg_isready" -h localhost -p "$PG_PORT" -q; then
    if [ -n "$PG_DATA" ] && [ -d "$PG_DATA" ]; then
      echo "מפעיל Postgres על פורט $PG_PORT…"
      # קובץ נעילה שנשאר מכיבוי לא נקי חוסם עלייה. מוחקים אותו רק אם
      # התהליך שרשום בו באמת לא קיים — אחרת זה שרת חי ואסור לגעת.
      if [ -f "$PG_DATA/postmaster.pid" ]; then
        stale_pid="$(head -1 "$PG_DATA/postmaster.pid")"
        if ! kill -0 "$stale_pid" 2>/dev/null; then
          rm -f "$PG_DATA/postmaster.pid"
        fi
      fi
      "$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-p $PG_PORT" -l "$PG_DATA/server.log" start
    fi
    for _ in {1..30}; do
      "$PG_BIN/pg_isready" -h localhost -p "$PG_PORT" -q && break
      sleep 1
    done
  fi
fi

# --- שרת --------------------------------------------------------------------
# הגרסה המהודרת נבנית לתיקייה נפרדת מזו של שרת הפיתוח, כדי ששניהם לא ידרסו
# זה את זה אם רצים במקביל.
export NEXT_DIST_DIR=".next-app"

needs_build=0
if [ ! -f "$NEXT_DIST_DIR/BUILD_ID" ]; then
  needs_build=1
elif [ -n "$(find app lib components prisma/schema.prisma next.config.ts package.json -newer "$NEXT_DIST_DIR/BUILD_ID" -type f 2>/dev/null | head -1)" ]; then
  # הקוד השתנה מאז הבנייה האחרונה
  needs_build=1
fi

if [ "$needs_build" = 1 ]; then
  echo "בונה את האפליקציה (פעם אחת, אחרי שינויי קוד)…"
  npx prisma generate >/dev/null
  npx next build || { echo "הבנייה נכשלה"; exit 1; }
fi

echo "מפעיל שרת על פורט $PORT…"
exec node node_modules/next/dist/bin/next start -p "$PORT"
