/**
 * Sync Events to Ponder Tables
 *
 * 1. Re-applies eventId from app_internal.events into Ponder's polls and markets
 *    tables. Required after Ponder reindexing since eventId is off-chain data.
 *
 * 2. Syncs full event records into Ponder's events table for GraphQL access.
 *
 * Usage:
 *   tsx scripts/sync-events.ts
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   RAILWAY_SERVICE_NAME - Railway service name (for Ponder schema detection)
 *   RAILWAY_DEPLOYMENT_ID - Railway deployment ID (for Ponder schema detection)
 */

import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("[SyncEvents] DATABASE_URL environment variable is required");
  process.exit(1);
}

function getPonderSchemaName(): string {
  const railwayDeploymentId = process.env.RAILWAY_DEPLOYMENT_ID;
  const railwayServiceName = process.env.RAILWAY_SERVICE_NAME;

  if (!railwayServiceName || !railwayDeploymentId) {
    console.error("[SyncEvents] RAILWAY_SERVICE_NAME and RAILWAY_DEPLOYMENT_ID are required");
    process.exit(1);
  }

  const shortId = railwayDeploymentId.replace(/-/g, "").slice(0, 8);
  return `${railwayServiceName}_${shortId}`;
}

const schemaName = getPonderSchemaName();
const pool = new Pool({ connectionString: DATABASE_URL });

interface EventRow {
  id: string;
  title: string;
  creator: string;
  market_type: string;
  arbiter: string;
  sources: string;
  category: number;
  fee_tier: number | null;
  max_price_imbalance: number | null;
  curve_flattener: number | null;
  curve_offset: number | null;
  poll_addresses: string[];
  market_addresses: string[];
  status: string;
  created_at: string;
}

async function syncCompletedEvents(client: any): Promise<{ polls: number; markets: number }> {
  const eventsResult = await client.query(
    `SELECT id, poll_addresses, market_addresses
     FROM app_internal.events
     WHERE array_length(poll_addresses, 1) > 0`
  );

  const events: Pick<EventRow, "id" | "poll_addresses" | "market_addresses">[] = eventsResult.rows;
  let syncedPolls = 0;
  let syncedMarkets = 0;

  for (const event of events) {
    if (event.poll_addresses.length > 0) {
      const result = await client.query(
        `UPDATE polls SET "eventId" = $1 WHERE id = ANY($2) AND "eventId" IS DISTINCT FROM $1`,
        [event.id, event.poll_addresses]
      );
      syncedPolls += result.rowCount ?? 0;
    }

    if (event.market_addresses.length > 0) {
      const result = await client.query(
        `UPDATE markets SET "eventId" = $1 WHERE id = ANY($2) AND "eventId" IS DISTINCT FROM $1`,
        [event.id, event.market_addresses]
      );
      syncedMarkets += result.rowCount ?? 0;
    }

    if (event.poll_addresses.length > 0) {
      const result = await client.query(
        `UPDATE markets SET "eventId" = $1 WHERE "pollAddress" = ANY($2) AND "eventId" IS DISTINCT FROM $1`,
        [event.id, event.poll_addresses]
      );
      syncedMarkets += result.rowCount ?? 0;
    }
  }

  return { polls: syncedPolls, markets: syncedMarkets };
}

/**
 * Upsert all events from app_internal.events into Ponder's events table.
 * This makes event data queryable via Ponder's GraphQL API.
 */
async function syncEventsTable(client: any): Promise<number> {
  const allEventsResult = await client.query(
    `SELECT id, title, creator, market_type, arbiter, sources, category,
            fee_tier, max_price_imbalance, curve_flattener, curve_offset,
            poll_addresses, market_addresses, status, created_at
     FROM app_internal.events`
  );

  const allEvents: EventRow[] = allEventsResult.rows;

  let synced = 0;

  for (const ev of allEvents) {
    const marketCount = ev.poll_addresses?.length ?? 0;

    const pollAddressesJson = JSON.stringify(ev.poll_addresses || []);
    const marketAddressesJson = JSON.stringify(ev.market_addresses || []);
    const createdAtStr = ev.created_at
      ? new Date(ev.created_at).toISOString()
      : new Date().toISOString();

    const result = await client.query(
      `INSERT INTO events (
        id, title, creator, "marketType", arbiter, sources, category,
        "feeTier", "maxPriceImbalance", "curveFlattener", "curveOffset",
        "pollAddresses", "marketAddresses", status, "marketCount", "createdAt"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        "pollAddresses" = EXCLUDED."pollAddresses",
        "marketAddresses" = EXCLUDED."marketAddresses",
        status = EXCLUDED.status,
        "marketCount" = EXCLUDED."marketCount"`,
      [
        ev.id,
        ev.title || "",
        ev.creator,
        ev.market_type,
        ev.arbiter,
        ev.sources || "[]",
        ev.category,
        ev.fee_tier,
        ev.max_price_imbalance,
        ev.curve_flattener,
        ev.curve_offset,
        pollAddressesJson,
        marketAddressesJson,
        ev.status,
        marketCount,
        createdAtStr,
      ]
    );

    if ((result.rowCount ?? 0) > 0) synced++;
  }

  return synced;
}

async function syncEvents() {
  console.log(`[SyncEvents] Using Ponder schema: ${schemaName}`);

  const client = await pool.connect();
  const startTime = Date.now();

  try {
    await client.query(`SET search_path TO "${schemaName}", public`);

    // Phase 1: Re-apply eventId to Ponder polls/markets after reindex
    const { polls: syncedPolls, markets: syncedMarkets } = await syncCompletedEvents(client);

    // Phase 2: Sync full event records into Ponder's events table
    const eventsSynced = await syncEventsTable(client);

    const duration = Date.now() - startTime;
    console.log(`[SyncEvents] Completed in ${duration}ms`);
    console.log(
      `[SyncEvents] Polls updated: ${syncedPolls}, Markets updated: ${syncedMarkets}, ` +
      `Events table synced: ${eventsSynced}`
    );
  } catch (error) {
    console.error("[SyncEvents] Error:", error);
    throw error;
  } finally {
    client.release();
  }
}

syncEvents()
  .then(async () => {
    console.log("[SyncEvents] Done!");
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[SyncEvents] Fatal error:", error);
    await pool.end();
    process.exit(1);
  });
