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
 *   RAILWAY_DEPLOYMENT_ID - Railway deployment ID for schema name (optional)
 */

import { Pool } from "pg";

// Get database URL from environment
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
	console.error("❌ DATABASE_URL environment variable is required");
	process.exit(1);
}

// Get Ponder schema name from Railway deployment ID
// Ponder uses format: {color}-{projectName}_{shortDeploymentId}
const deploymentId = process.env.RAILWAY_DEPLOYMENT_ID;
const schemaName = deploymentId
	? `blue-sonicmarketindexer_${deploymentId.substring(0, 8)}`
	: "public";

console.log(`[Recalculate] Using database schema: ${schemaName}`);

// Create PostgreSQL connection pool with schema
const pool = new Pool({
	connectionString: DATABASE_URL,
});

interface Market {
	id: string;
	chainId: number;
	volume24h: string;
}

async function recalculateVolume24h() {
	console.log("[Recalculate] Starting volume24h recalculation...");

	const timestamp24hAgo = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
	const startTime = Date.now();

	const client = await pool.connect();

	try {
		// Set search_path to use Ponder's schema
		await client.query(`SET search_path TO "${schemaName}", public`);
		console.log(`[Recalculate] Set search_path to: ${schemaName}`);

		console.log(`[Recalculate] Timestamp 24h ago: ${timestamp24hAgo}`);
		console.log("[Recalculate] Fetching all markets...");

		// Get all markets
		const marketsResult = await client.query<Market>(
			'SELECT id, "chainId", volume24h FROM markets ORDER BY id'
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
						// Get trades for this market in last 24h
						const tradesResult = await client.query(
							`SELECT "collateralAmount" 
							 FROM trades 
							 WHERE "marketAddress" = $1 
							 AND timestamp >= $2`,
							[market.id, timestamp24hAgo]
						);

						// Sum collateralAmount (stored as strings in Postgres)
						const volume24h = tradesResult.rows.reduce(
							(sum, row) => {
								return (
									sum + BigInt(row.collateralAmount || "0")
								);
							},
							0n
						);

						const currentVolume24h = BigInt(
							market.volume24h || "0"
						);

						// Update market if changed
						if (volume24h !== currentVolume24h) {
							await client.query(
								"UPDATE markets SET volume24h = $1 WHERE id = $2",
								[volume24h.toString(), market.id]
							);
							updatedCount++;

							if (updatedCount % 10 === 0) {
								console.log(
									`[Recalculate] Progress: ${
										i + batch.indexOf(market) + 1
									}/${
										markets.length
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
