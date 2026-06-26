#!/bin/sh
set -e

export NODE_OPTIONS="--max-old-space-size=4096"

echo "🚀 Starting Ponder Indexer (heap limited to 4 GB)..."

# Start cron scheduler in background
echo "⏰ Starting cron scheduler..."
npx tsx /app/cron.ts &
CRON_PID=$!
echo "✅ Cron started with PID: $CRON_PID"

# Start main Ponder process
echo "📊 Starting Ponder indexer..."
exec npx ponder start \
  --schema "$RAILWAY_DEPLOYMENT_ID" \
  --views-schema pandora_views
