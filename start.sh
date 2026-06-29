#!/bin/sh
set -e

export NODE_OPTIONS="--max-old-space-size=4096"

echo "🚀 Starting Ponder Indexer (heap limited to 4 GB)..."

# Start cron scheduler in background
echo "⏰ Starting cron scheduler..."
npx tsx /app/cron.ts &
CRON_PID=$!
echo "✅ Cron started with PID: $CRON_PID"

# Build schema name: {service_name}_{short_deploy_id} (max 45 chars)
SERVICE="${RAILWAY_SERVICE_NAME:-pandoraindexer}"
DEPLOY_SHORT=$(echo "${RAILWAY_DEPLOYMENT_ID:-local}" | cut -c1-8)
SCHEMA_NAME="${SERVICE}_${DEPLOY_SHORT}"

# Drop stale schemas from previous deploys of THIS service (keep other service intact)
if [ -n "$DATABASE_URL" ]; then
  echo "🧹 Cleaning old schemas for service: ${SERVICE}..."
  OLD_SCHEMAS=$(psql "$DATABASE_URL" -t -A -c \
    "SELECT schema_name FROM information_schema.schemata
     WHERE schema_name LIKE '${SERVICE}_%'
       AND schema_name != '${SCHEMA_NAME}'
       AND schema_name != 'pandora_views'")

  for s in $OLD_SCHEMAS; do
    echo "   Dropping old schema: $s"
    psql "$DATABASE_URL" -c "DROP SCHEMA \"$s\" CASCADE" 2>/dev/null || true
  done
  echo "✅ Cleanup done"
fi

echo "📊 Starting Ponder indexer..."
echo "   Schema: ${SCHEMA_NAME}"
echo "   Views:  pandora_views"
exec npx ponder start \
  --schema "$SCHEMA_NAME" \
  --views-schema pandora_views
