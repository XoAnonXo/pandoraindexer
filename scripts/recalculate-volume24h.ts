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
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_trades_market_timestamp
    ON trades ("marketAddress", timestamp)
  `);
  console.log(`[Recalculate] Index ensured in ${Date.now() - start}ms`);
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

    await ensureIndexes(client);

    // Single aggregated query: volume + trade count per market in one pass
    const aggregateResult = await client.query<{
      marketAddress: string;
      trade_count: number;
      volume: string;
    }>(
      `SELECT "marketAddress",
              COUNT(*)::int AS trade_count,
              COALESCE(SUM("collateralAmount"), 0)::text AS volume
       FROM trades
       WHERE timestamp >= $1
       GROUP BY "marketAddress"`,
      [timestamp24hAgo]
    );

    const volumeMap = new Map<string, { volume: bigint; trades: number }>();
    for (const row of aggregateResult.rows) {
      volumeMap.set(row.marketAddress, {
        volume: BigInt(row.volume || "0"),
        trades: row.trade_count ?? 0,
      });
    }

    console.log(
      `[Recalculate] Aggregated ${volumeMap.size} markets with recent trades`
    );

    // Fetch current values from markets
    const marketsResult = await client.query<{
      id: string;
      volume24h: string;
      trades24h: number;
    }>(
      'SELECT id, volume24h, COALESCE(trades24h, 0) AS trades24h FROM markets ORDER BY id'
    );

    const markets = marketsResult.rows;
    console.log(`[Recalculate] Found ${markets.length} total markets`);

    let updatedCount = 0;
    let unchangedCount = 0;

    // Collect rows that need updating
    const updates: { id: string; volume24h: string; trades24h: number }[] = [];

    for (const market of markets) {
      const agg = volumeMap.get(market.id);
      const newVolume = agg?.volume ?? 0n;
      const newTrades = agg?.trades ?? 0;

      const currentVolume = BigInt(market.volume24h || "0");
      const currentTrades = market.trades24h ?? 0;

      if (newVolume !== currentVolume || newTrades !== currentTrades) {
        updates.push({
          id: market.id,
          volume24h: newVolume.toString(),
          trades24h: newTrades,
        });
      } else {
        unchangedCount++;
      }
    }

    // Batch UPDATE via unnest — single round-trip for all changed rows
    if (updates.length > 0) {
      const ids = updates.map((u) => u.id);
      const volumes = updates.map((u) => u.volume24h);
      const trades = updates.map((u) => u.trades24h);

      await client.query(
        `UPDATE markets AS m
         SET volume24h = u.vol::bigint,
             trades24h = u.tc::int
         FROM unnest($1::text[], $2::text[], $3::int[])
           AS u(id, vol, tc)
         WHERE m.id = u.id`,
        [ids, volumes, trades]
      );
      updatedCount = updates.length;
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
