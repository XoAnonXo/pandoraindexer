/**
 * Recalculate 24h Volume for All Markets
 *
 * Uses a single aggregated query instead of per-market queries,
 * then batch-updates only changed rows.
 *
 * Usage:
 *   tsx scripts/recalculate-volume24h.ts
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   RAILWAY_SERVICE_NAME - Used to determine blue/green for schema discovery
 *   PONDER_SCHEMA - Explicit override (optional, for local dev)
 */

import { Pool } from "pg";
import { discoverPonderSchema } from "./utils/discover-schema.js";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function ensureIndexes(client: import("pg").PoolClient) {
  const start = Date.now();

  // Views don't support indexes -- find the real table schema
  const { rows } = await client.query(
    `SELECT schemaname FROM pg_tables
     WHERE tablename = 'trades' AND schemaname NOT IN ('public', 'pandora_views')
     ORDER BY schemaname DESC LIMIT 1`
  );

  if (rows.length > 0) {
    const realSchema = rows[0].schemaname;
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trades_market_timestamp
      ON "${realSchema}".trades ("marketAddress", timestamp)
    `);
    console.log(`[Recalculate] Index ensured on ${realSchema}.trades in ${Date.now() - start}ms`);
  } else {
    console.log(`[Recalculate] Skipped index creation — no real trades table found`);
  }
}

async function recalculateVolume24h() {
  console.log("[Recalculate] Starting volume24h + trades24h recalculation...");

  const schemaName = await discoverPonderSchema(pool, "[Recalculate]");

  const timestamp24hAgo = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const startTime = Date.now();

  const client = await pool.connect();

  try {
    await client.query(`SET search_path TO "${schemaName}", public`);
    console.log(`[Recalculate] Set search_path to: ${schemaName}`);
    console.log(`[Recalculate] Timestamp 24h ago: ${timestamp24hAgo}`);

    try {
      await ensureIndexes(client);
    } catch (indexErr: any) {
      console.warn(`[Recalculate] Index creation skipped: ${indexErr.message}`);
    }

    const countResult = await client.query(
      "SELECT COUNT(*)::int AS total FROM markets"
    );
    const totalMarkets: number = countResult.rows[0].total;
    console.log(`[Recalculate] Found ${totalMarkets} total markets`);

    // Single CTE: aggregate 24h trades, LEFT JOIN markets, update only changed rows.
    const updateResult = await client.query(
      `WITH agg AS (
         SELECT "marketAddress",
                COUNT(*)::int AS trade_count,
                COALESCE(SUM("collateralAmount"), 0) AS volume
         FROM trades
         WHERE timestamp >= $1
         GROUP BY "marketAddress"
       )
       UPDATE markets AS m
       SET volume24h = COALESCE(sub.volume, 0),
           trades24h = COALESCE(sub.trade_count, 0)
       FROM (
         SELECT m2.id,
                COALESCE(a.trade_count, 0) AS trade_count,
                COALESCE(a.volume, 0) AS volume
         FROM markets m2
         LEFT JOIN agg a ON m2.id = a."marketAddress"
         WHERE m2.volume24h IS DISTINCT FROM COALESCE(a.volume, 0)
            OR COALESCE(m2.trades24h, 0) IS DISTINCT FROM COALESCE(a.trade_count, 0)
       ) AS sub
       WHERE m.id = sub.id`,
      [timestamp24hAgo]
    );

    const updatedCount = updateResult.rowCount ?? 0;
    const unchangedCount = totalMarkets - updatedCount;
    const duration = Date.now() - startTime;

    console.log(`\n[Recalculate] ✅ Completed in ${duration}ms`);
    console.log(`[Recalculate] Total markets: ${totalMarkets}`);
    console.log(`[Recalculate] Updated: ${updatedCount}`);
    console.log(`[Recalculate] Unchanged: ${unchangedCount}`);
  } catch (error) {
    console.error("[Recalculate] ❌ Error:", error);
    throw error;
  } finally {
    client.release();
  }
}

recalculateVolume24h()
  .then(async () => {
    console.log("[Recalculate] Done!");
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[Recalculate] Fatal error:", error);
    await pool.end();
    process.exit(1);
  });
