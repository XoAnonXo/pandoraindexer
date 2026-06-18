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
 *   RAILWAY_SERVICE_NAME - Used to determine blue/green for schema discovery
 *   PONDER_SCHEMA - Explicit override (optional, for local dev)
 */

import { Pool } from "pg";
import { discoverPonderSchema } from "./utils/discover-schema.js";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("[SyncTopics] DATABASE_URL environment variable is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function syncTopics(): Promise<number> {
  const schemaName = await discoverPonderSchema(pool, "[SyncTopics]");

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
