/**
 * Sync Topics to Ponder Tables
 *
 * Re-applies topicSlug from app_internal.market_topics into Ponder's polls
 * table. Required after Ponder reindexing since topicSlug is off-chain data.
 *
 * Usage:
 *   tsx scripts/sync-topics.ts
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   RAILWAY_SERVICE_NAME - Railway service name (for Ponder schema detection)
 *   RAILWAY_DEPLOYMENT_ID - Railway deployment ID (for Ponder schema detection)
 *   PONDER_SCHEMA - Explicit Ponder schema name (alternative to RAILWAY_* vars)
 */

import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("[SyncTopics] DATABASE_URL environment variable is required");
  process.exit(1);
}

function getPonderSchemaName(): string {
  if (process.env.PONDER_SCHEMA) {
    return process.env.PONDER_SCHEMA;
  }

  const railwayDeploymentId = process.env.RAILWAY_DEPLOYMENT_ID;
  const railwayServiceName = process.env.RAILWAY_SERVICE_NAME;

  if (!railwayServiceName || !railwayDeploymentId) {
    console.error(
      "[SyncTopics] PONDER_SCHEMA or (RAILWAY_SERVICE_NAME + RAILWAY_DEPLOYMENT_ID) is required"
    );
    process.exit(1);
  }

  const shortId = railwayDeploymentId.replace(/-/g, "").slice(0, 8);
  return `${railwayServiceName}_${shortId}`;
}

const schemaName = getPonderSchemaName();
const pool = new Pool({ connectionString: DATABASE_URL });

async function syncTopics(): Promise<number> {
  console.log(`[SyncTopics] Using Ponder schema: ${schemaName}`);

  const client = await pool.connect();
  const startTime = Date.now();

  try {
    await client.query(`SET search_path TO "${schemaName}", public`);

    const result = await client.query(
      `UPDATE polls AS p
       SET "topicSlug" = mt.topic_slug
       FROM app_internal.market_topics mt
       WHERE encode(p.id, 'hex') = mt.market_id
         AND (p."topicSlug" IS DISTINCT FROM mt.topic_slug)`
    );

    const synced = result.rowCount ?? 0;
    const duration = Date.now() - startTime;
    console.log(`[SyncTopics] Completed in ${duration}ms — ${synced} polls updated`);
    return synced;
  } catch (error) {
    console.error("[SyncTopics] Error:", error);
    throw error;
  } finally {
    client.release();
  }
}

syncTopics()
  .then(async () => {
    console.log("[SyncTopics] Done!");
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[SyncTopics] Fatal error:", error);
    await pool.end();
    process.exit(1);
  });
