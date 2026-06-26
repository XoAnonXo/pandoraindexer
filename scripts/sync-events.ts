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
 *   RAILWAY_SERVICE_NAME - Used to determine blue/green for schema discovery
 *   PONDER_SCHEMA - Explicit override (optional, for local dev)
 */

import { Pool } from "pg";
import { buildSearchPath } from "./utils/discover-schema.js";

const DATABASE_URL = process.env.DATABASE_URL;

function normalizeHex(hex: string): string {
  const h = hex.toLowerCase();
  return h.startsWith("0x") ? h : `0x${h}`;
}

if (!DATABASE_URL) {
  console.error("[SyncEvents] DATABASE_URL environment variable is required");
  process.exit(1);
}

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
  // For each poll/market, only the most recent event (by created_at) wins.
  // This prevents stale events from overwriting the correct eventId.
  const eventsResult = await client.query(
    `SELECT id, title, poll_addresses, market_addresses
     FROM app_internal.events
     WHERE array_length(poll_addresses, 1) > 0
     ORDER BY created_at ASC`
  );

  const events: Pick<EventRow, "id" | "title" | "poll_addresses" | "market_addresses">[] =
    eventsResult.rows;

  // Build a map: poll_address → newest event (last write wins with ASC order)
  const pollToEvent = new Map<string, { eventId: string; title: string }>();
  const marketToEvent = new Map<string, string>();

  for (const event of events) {
    const isSolana = event.poll_addresses.length > 0 && !event.poll_addresses[0].startsWith("0x");
    if (isSolana) continue;

    for (const poll of event.poll_addresses) {
      pollToEvent.set(poll.toLowerCase(), { eventId: event.id, title: event.title ?? "" });
    }
    for (const market of event.market_addresses) {
      marketToEvent.set(market.toLowerCase(), event.id);
    }
  }

  let syncedPolls = 0;
  let syncedMarkets = 0;

  // Group polls by eventId to batch updates
  const pollsByEvent = new Map<string, { addresses: string[]; title: string }>();
  for (const [pollHex, { eventId, title }] of pollToEvent) {
    const entry = pollsByEvent.get(eventId);
    if (entry) {
      entry.addresses.push(normalizeHex(pollHex));
    } else {
      pollsByEvent.set(eventId, { addresses: [normalizeHex(pollHex)], title });
    }
  }

  for (const [eventId, { addresses, title }] of pollsByEvent) {
    const result = await client.query(
      `UPDATE polls SET event_id = $1 WHERE id = ANY($2::text[]) AND event_id IS DISTINCT FROM $1`,
      [eventId, addresses]
    );
    syncedPolls += result.rowCount ?? 0;

    const mResult = await client.query(
      `UPDATE markets SET event_id = $1 WHERE poll_address = ANY($2::text[]) AND event_id IS DISTINCT FROM $1`,
      [eventId, addresses]
    );
    syncedMarkets += mResult.rowCount ?? 0;

    if (title) {
      await client.query(
        `UPDATE polls SET display_title = COALESCE(question, '') || ' — ' || $1
         WHERE id = ANY($2::text[])
           AND (display_title IS NULL OR display_title = '')`,
        [title, addresses]
      );
    }
  }

  // Sync markets by direct market_addresses
  const marketsByEvent = new Map<string, string[]>();
  for (const [marketHex, eventId] of marketToEvent) {
    const entry = marketsByEvent.get(eventId);
    if (entry) {
      entry.push(normalizeHex(marketHex));
    } else {
      marketsByEvent.set(eventId, [normalizeHex(marketHex)]);
    }
  }

  for (const [eventId, addresses] of marketsByEvent) {
    const result = await client.query(
      `UPDATE markets SET event_id = $1 WHERE id = ANY($2::text[]) AND event_id IS DISTINCT FROM $1`,
      [eventId, addresses]
    );
    syncedMarkets += result.rowCount ?? 0;
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
        id, title, creator, market_type, arbiter, sources, category,
        fee_tier, max_price_imbalance, curve_flattener, curve_offset,
        poll_addresses, market_addresses, status, market_count, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        poll_addresses = EXCLUDED.poll_addresses,
        market_addresses = EXCLUDED.market_addresses,
        status = EXCLUDED.status,
        market_count = EXCLUDED.market_count`,
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
  const sp = await buildSearchPath(pool, "[SyncEvents]");

  const client = await pool.connect();
  const startTime = Date.now();

  try {
    await client.query(`SET search_path TO ${sp}`);

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
