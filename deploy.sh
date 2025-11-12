#!/bin/bash

# Скрипт для обновления и перезапуска бота на сервере

set -e

echo "🛑 Остановка всех процессов PM2..."
pm2 delete all || true
pm2 kill || true

echo "⏳ Ожидание 30 секунд для освобождения Telegram API..."
sleep 30

echo "📦 Обновление кода из Git..."
git pull

echo "🧹 Очистка старых файлов..."
rm -rf dist/

echo "🔨 Сборка проекта..."
npm run build

echo "✅ Проверка наличия нового кода..."
if [ ! -f "dist/utils/puppeteer.js" ]; then
    echo "❌ ОШИБКА: dist/utils/puppeteer.js не найден!"
    exit 1
fi

# Проверяем, что новый код содержит нужные строки
if ! grep -q "findBrowserExecutable" dist/utils/puppeteer.js; then
    echo "❌ ОШИБКА: Старый код в dist/utils/puppeteer.js!"
    exit 1
fi

echo "✓ Новый код найден"

echo "🔍 Проверка наличия Chromium..."
if [ -f "/snap/bin/chromium" ]; then
    echo "✓ Chromium найден: /snap/bin/chromium"
else
    echo "⚠️  ВНИМАНИЕ: /snap/bin/chromium не найден!"
    echo "Попробуем установить: sudo snap install chromium"
    which chromium > /dev/null 2>&1 && echo "✓ Chromium найден через which: $(which chromium)" || echo "✗ Chromium не найден в PATH"
fi

echo "🚀 Запуск бота через PM2..."
pm2 start ecosystem.config.cjs

echo "💾 Сохранение конфигурации PM2..."
pm2 save

echo "📋 Статус процессов:"
pm2 list

echo ""
echo "✅ Готово! Проверьте логи: pm2 logs kesha-bot --lines 50"

