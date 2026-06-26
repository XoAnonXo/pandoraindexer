import type { Pool, PoolClient } from "pg";

/**
 * Returns the Ponder schema name to use for direct SQL queries.
 *
 * With Ponder 0.16+ and --views-schema pandora_views, scripts can
 * use the fixed "pandora_views" schema. Falls back to PONDER_SCHEMA
 * env var if set, or dynamic discovery for backward compatibility.
 */
export function getPonderSchema(): string {
	return process.env.PONDER_SCHEMA || "pandora_views";
}

/**
 * Auto-discovers the current Ponder schema name by querying the database.
 *
 * Ponder creates schemas with the pattern:
 *   {blue|green}-pandoraindexer_{8 hex chars}
 *
 * This function determines blue/green from RAILWAY_SERVICE_NAME,
 * then finds the matching schema that contains the "markets" table.
 *
 * Falls back to PONDER_SCHEMA env var if set (for local dev or overrides).
 *
 * @deprecated Use getPonderSchema() with the pandora_views fixed schema instead.
 */
export async function discoverPonderSchema(pool: Pool, logPrefix = "[Schema]"): Promise<string> {
	const fixed = getPonderSchema();
	if (fixed) {
		console.log(`${logPrefix} Using schema: ${fixed}`);
		return fixed;
	}

	const serviceName = process.env.RAILWAY_SERVICE_NAME || "";
	const prefix = serviceName.startsWith("green-") ? "green-evm-pandoraindexer_" : "blue-evm-pandoraindexer_";

	console.log(`${logPrefix} Discovering schema with prefix: ${prefix} (service: ${serviceName})`);

	const client: PoolClient = await pool.connect();
	try {
		const result = await client.query(
			`SELECT schemaname FROM pg_tables
       WHERE tablename = 'markets'
         AND schemaname LIKE $1
       ORDER BY schemaname DESC
       LIMIT 1`,
			[`${prefix}%`],
		);

		if (result.rows.length === 0) {
			throw new Error(
				`No Ponder schema found matching "${prefix}*" with a "markets" table. ` +
					`Ponder may still be syncing or the schema was not yet created.`,
			);
		}

		const schema = result.rows[0].schemaname as string;
		console.log(`${logPrefix} Discovered Ponder schema: ${schema}`);
		return schema;
	} finally {
		client.release();
	}
}
