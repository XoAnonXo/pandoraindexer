/**
 * Recalculate 24h Volume for All Markets
 *
 * This script recalculates the volume24h field for all markets by summing
 * trades from the last 24 hours. Should be run periodically (e.g., every hour).
 *
 * Usage:
 *   tsx scripts/recalculate-volume24h.ts
 *
 * Or as a cron job (every hour):
 *   0 * * * * cd /path/to/pandoraindexer-1 && tsx scripts/recalculate-volume24h.ts
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   RAILWAY_SERVICE_NAME - Used to determine blue/green for schema discovery
 *   PONDER_SCHEMA - Explicit override (optional, for local dev)
 */

import { Pool } from "pg";
import { discoverPonderSchema } from "./utils/discover-schema.js";

// Get database URL from environment
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

interface Market {
  id: string;
  chainId: number;
  volume24h: string;
  trades24h: number;
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
    console.log("[Recalculate] Fetching all markets...");

    // Get all markets
    const marketsResult = await client.query<Market>(
      'SELECT id, "chainId", volume24h, COALESCE(trades24h, 0) AS trades24h FROM markets ORDER BY id'
    );

    const markets = marketsResult.rows;
    console.log(`[Recalculate] Found ${markets.length} markets`);

    let updatedCount = 0;
    let unchangedCount = 0;

    // Process markets in batches to avoid overwhelming the database
    const BATCH_SIZE = 100;

    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (market) => {
          try {
            const tradesResult = await client.query(
              `SELECT COUNT(*)::int AS trade_count,
                      COALESCE(SUM("collateralAmount"), 0) AS volume
               FROM trades
               WHERE "marketAddress" = $1
               AND timestamp >= $2`,
              [market.id, timestamp24hAgo]
            );

            const row = tradesResult.rows[0];
            const volume24h = BigInt(row.volume || "0");
            const trades24h: number = row.trade_count ?? 0;

            const currentVolume24h = BigInt(market.volume24h || "0");
            const currentTrades24h = market.trades24h ?? 0;

            if (volume24h !== currentVolume24h || trades24h !== currentTrades24h) {
              await client.query(
                'UPDATE markets SET volume24h = $1, trades24h = $2 WHERE id = $3',
                [volume24h.toString(), trades24h, market.id]
              );
              updatedCount++;

              if (updatedCount % 10 === 0) {
                console.log(
                  `[Recalculate] Progress: ${i + batch.indexOf(market) + 1
                  }/${markets.length
                  } (${updatedCount} updated)`
                );
              }
            } else {
              unchangedCount++;
            }
          } catch (error) {
            console.error(
              `[Recalculate] Error processing market ${market.id}:`,
              error
            );
          }
        })
      );
    }

    const duration = Date.now() - startTime;

    console.log(`\n[Recalculate] ✅ Completed in ${duration}ms`);
    console.log(`[Recalculate] Total markets: ${markets.length}`);
    console.log(`[Recalculate] Updated: ${updatedCount}`);
    console.log(`[Recalculate] Unchanged: ${unchangedCount}`);
  } catch (error) {
    console.error("[Recalculate] ❌ Error:", error);
    throw error;
  } finally {
    client.release();
  }
}

// Run immediately
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
