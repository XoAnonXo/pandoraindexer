#!/bin/sh
set -e

echo "🚀 Starting Ponder Indexer with cron jobs..."

# Запустить cron в фоне
echo "⏰ Starting cron scheduler..."
node /app/cron.js &
CRON_PID=$!
echo "✅ Cron started with PID: $CRON_PID"

# Запустить основной процесс
echo "📊 Starting Ponder indexer..."
exec npm run start