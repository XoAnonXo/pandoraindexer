import type { Pool } from "pg";

/**
 * Returns the fixed views schema name.
 */
export function getPonderSchema(): string {
	return process.env.PONDER_SCHEMA || "pandora_views";
}

/**
 * Computes the current deployment schema name from env vars.
 * Mirrors the logic in start.sh:
 *   SERVICE="${RAILWAY_SERVICE_NAME:-pandoraindexer}"
 *   DEPLOY_SHORT=$(echo "${RAILWAY_DEPLOYMENT_ID:-local}" | cut -c1-8)
 *   SCHEMA_NAME="${SERVICE}_${DEPLOY_SHORT}"
 */
export function getDeploymentSchema(): string | null {
	const service = process.env.RAILWAY_SERVICE_NAME;
	const deployId = process.env.RAILWAY_DEPLOYMENT_ID;
	if (!service || !deployId) return null;
	return `${service}_${deployId.substring(0, 8)}`;
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
 * Builds a search_path that includes:
 * 1. The deployment schema (for trigger/internal table resolution)
 * 2. The views schema (for table access)
 * 3. public
 */
export async function buildSearchPath(pool: Pool, logPrefix = "[Schema]"): Promise<string> {
	const viewsSchema = getPonderSchema();
	const deploySchema = getDeploymentSchema();

	const parts = [];
	if (deploySchema) {
		parts.push(`"${deploySchema}"`);
		console.log(`${logPrefix} Deployment schema: ${deploySchema}`);
	}
	parts.push(`"${viewsSchema}"`, "public");

	const sp = parts.join(", ");
	console.log(`${logPrefix} search_path: ${sp}`);
	return sp;
}
