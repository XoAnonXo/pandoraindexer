import type { Pool, PoolClient } from "pg";

/**
 * Returns the fixed views schema name.
 */
export function getPonderSchema(): string {
	return process.env.PONDER_SCHEMA || "pandora_views";
}

/**
 * Discovers the views schema. Always returns "pandora_views".
 */
export async function discoverPonderSchema(pool: Pool, logPrefix = "[Schema]"): Promise<string> {
	const schema = getPonderSchema();
	console.log(`${logPrefix} Using schema: ${schema}`);
	return schema;
}

/**
 * Finds the real Ponder deployment schema (e.g. "blue-pandoraindexer_a1b2c3d4")
 * by looking for the _ponder_meta table. Needed for search_path so that
 * triggers (live_query_tables) resolve correctly when UPDATing through views.
 */
export async function discoverDeploymentSchema(pool: Pool, logPrefix = "[Schema]"): Promise<string | null> {
	const client: PoolClient = await pool.connect();
	try {
		const result = await client.query(
			`SELECT schemaname FROM pg_tables
			 WHERE tablename = '_ponder_meta'
			   AND schemaname NOT IN ('public', 'pandora_views', 'ponder_sync')
			 ORDER BY schemaname DESC
			 LIMIT 1`,
		);

		if (result.rows.length === 0) {
			console.log(`${logPrefix} No deployment schema found`);
			return null;
		}

		const schema = result.rows[0].schemaname as string;
		console.log(`${logPrefix} Deployment schema: ${schema}`);
		return schema;
	} finally {
		client.release();
	}
}

/**
 * Builds a SET search_path statement that includes the deployment schema
 * (for trigger resolution) and the views schema (for table access).
 */
export async function buildSearchPath(pool: Pool, logPrefix = "[Schema]"): Promise<string> {
	const viewsSchema = getPonderSchema();
	const deploySchema = await discoverDeploymentSchema(pool, logPrefix);

	const parts = [];
	if (deploySchema) parts.push(`"${deploySchema}"`);
	parts.push(`"${viewsSchema}"`, "public");

	return parts.join(", ");
}
