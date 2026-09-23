#!/bin/zsh
# בונה את אפליקציית המק ומתקינה אותה ב-~/Applications.
#   zsh scripts/desktop/build-app.sh
# צריך להריץ שוב רק אם הפרויקט עבר תיקייה או ש-App.swift השתנה.
# שינויים בקוד של האתר עצמו נבנים אוטומטית בהפעלה הבאה של האפליקציה.

set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_NAME="רואה חשבון AI"
DEST="$HOME/Applications/$APP_NAME.app"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "מהדר…"
swiftc -O -o "$WORK/AIAccountant" "$PROJECT_DIR/scripts/desktop/App.swift" \
  -framework AppKit -framework WebKit

echo "מצייר אייקון…"
cat > "$WORK/icon.html" <<'HTML'
<html><body style="margin:0;background:transparent">
<div style="width:1024px;height:1024px;display:grid;place-items:center">
  <div style="width:824px;height:824px;border-radius:185px;
    background:linear-gradient(145deg,#2cc592 0%,#138a68 55%,#0f5a47 100%);
    box-shadow:inset 0 6px 0 rgba(255,255,255,.25);
    display:grid;place-items:center;
    font:600 520px/1 -apple-system,'Helvetica Neue',sans-serif;color:#fff">₪</div>
</div></body></html>
HTML
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
if [ -x "$CHROME" ]; then
  "$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size=1024,1024 --screenshot="$WORK/icon.png" "file://$WORK/icon.html" >/dev/null 2>&1
  for size in 16 32 128 256 512; do
    sips -z $size $size "$WORK/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    sips -z $((size*2)) $((size*2)) "$WORK/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$WORK/AppIcon.icns"
else
  echo "Chrome לא נמצא — האפליקציה תיבנה בלי אייקון"
fi

echo "מרכיב את האפליקציה…"
rm -rf "$DEST"
mkdir -p "$DEST/Contents/MacOS" "$DEST/Contents/Resources"
cp "$WORK/AIAccountant" "$DEST/Contents/MacOS/AIAccountant"
[ -f "$WORK/AppIcon.icns" ] && cp "$WORK/AppIcon.icns" "$DEST/Contents/Resources/AppIcon.icns"

cat > "$DEST/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>local.ai-accountant-isr</string>
  <key>CFBundleExecutable</key><string>AIAccountant</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
  <key>ProjectDirectory</key><string>$PROJECT_DIR</string>
</dict></plist>
PLIST

# חתימה מקומית — בלעדיה macOS על מעבד Apple מסרב להריץ את הקובץ
codesign --force --deep --sign - "$DEST" >/dev/null 2>&1

echo "הותקן: $DEST"
