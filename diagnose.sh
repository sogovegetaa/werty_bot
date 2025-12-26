#!/bin/bash


echo "=== Диагностика окружения ==="
echo ""

echo "1. Проверка наличия Chromium/Chrome:"
echo "-----------------------------------"
echo "which chromium:"
which chromium 2>/dev/null || echo "  не найден"
echo ""

echo "which chromium-browser:"
which chromium-browser 2>/dev/null || echo "  не найден"
echo ""

echo "which google-chrome-stable:"
which google-chrome-stable 2>/dev/null || echo "  не найден"
echo ""

echo "which google-chrome:"
which google-chrome 2>/dev/null || echo "  не найден"
echo ""

echo "2. Проверка стандартных путей:"
echo "-----------------------------------"
PATHS=(
  "/snap/bin/chromium"
  "/usr/bin/chromium-browser"
  "/usr/bin/chromium"
  "/usr/bin/google-chrome-stable"
  "/usr/bin/google-chrome"
  "/opt/google/chrome/chrome"
  "/usr/local/bin/chromium"
)

for path in "${PATHS[@]}"; do
  if [ -f "$path" ]; then
    echo "✓ $path (существует)"
    ls -lh "$path" 2>/dev/null | awk '{print "  Размер: " $5 ", Владелец: " $3 ":" $4}'
  else
    echo "✗ $path (не найден)"
  fi
done
echo ""

echo "3. Проверка переменных окружения:"
echo "-----------------------------------"
echo "PUPPETEER_EXECUTABLE_PATH: ${PUPPETEER_EXECUTABLE_PATH:-не установлен}"
echo ""

echo "4. Проверка версии Chromium (если найден):"
echo "-----------------------------------"
CHROMIUM_PATH=""
if command -v chromium &> /dev/null; then
  CHROMIUM_PATH=$(which chromium)
elif [ -f "/snap/bin/chromium" ]; then
  CHROMIUM_PATH="/snap/bin/chromium"
elif [ -f "/usr/bin/chromium-browser" ]; then
  CHROMIUM_PATH="/usr/bin/chromium-browser"
fi

if [ -n "$CHROMIUM_PATH" ]; then
  echo "Найден Chromium: $CHROMIUM_PATH"
  $CHROMIUM_PATH --version 2>/dev/null || echo "  Не удалось получить версию"
else
  echo "Chromium не найден"
fi
echo ""

echo "5. Проверка процессов Node.js:"
echo "-----------------------------------"
ps aux | grep -E "node.*index\.(ts|js)" | grep -v grep || echo "  Нет запущенных процессов"
echo ""

echo "6. Проверка PM2 процессов:"
echo "-----------------------------------"
pm2 list 2>/dev/null || echo "  PM2 не установлен или не запущен"
echo ""

echo "7. Проверка временных каталогов Puppeteer:"
echo "-----------------------------------"
ls -la /tmp/puppeteer-profile* 2>/dev/null | head -10 || echo "  Временных каталогов не найдено"
echo ""

echo "=== Конец диагностики ==="

