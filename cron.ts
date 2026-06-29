import cron from "node-cron";
import { Pool } from "pg";
import { buildSearchPath } from "./scripts/utils/discover-schema.js";

const DATABASE_URL = process.env.DATABASE_URL;
const PONDER_HEALTH_URL = process.env.PONDER_HEALTH_URL || "http://localhost:42069/health";
const SYNC_POLL_INTERVAL_MS = 30_000;
const INITIAL_DELAY_MS = 60_000;
const STATEMENT_TIMEOUT_MS = 30_000;

let ponderReady = false;
let searchPath: string | null = null;

const pool = DATABASE_URL
	? new Pool({
			connectionString: DATABASE_URL,
			max: 3,
			idleTimeoutMillis: 20_000,
			connectionTimeoutMillis: 10_000,
		})
	: null;

function normalizeHex(hex: string): string {
	const h = hex.toLowerCase();
	return h.startsWith("0x") ? h : `0x${h}`;
}

async function waitForPonderSync(): Promise<void> {
	console.log("[Cron] Waiting for Ponder to finish historical sync...");

	while (true) {
		try {
			const res = await fetch(PONDER_HEALTH_URL);
			if (res.ok) {
				console.log("[Cron] Ponder health OK — historical sync complete");
				return;
			}
		} catch {
			// Connection refused — Ponder not started yet
		}
		await new Promise((r) => setTimeout(r, SYNC_POLL_INTERVAL_MS));
	}
}

async function resolveSearchPath(): Promise<string> {
	if (searchPath) return searchPath;
	if (!pool) throw new Error("DATABASE_URL not configured");
	searchPath = await buildSearchPath(pool, "[Cron]");
	return searchPath;
}

// ─── Volume24h Recalculation ────────────────────────────────────────────────

async function runRecalculation(): Promise<void> {
	if (!ponderReady || !pool) return;

	const sp = await resolveSearchPath();
	const client = await pool.connect();
	const t0 = Date.now();

	try {
		await client.query(`SET statement_timeout = '${STATEMENT_TIMEOUT_MS}'`);
		await client.query(`SET search_path TO ${sp}`);
		await client.query(`CREATE TEMP TABLE IF NOT EXISTS live_query_tables (table_name TEXT PRIMARY KEY)`);

		try {
			await client.query(`
				CREATE INDEX IF NOT EXISTS idx_trades_market_timestamp
				ON trades (market_address, timestamp)
			`);
		} catch {
			// Views don't support indexes — non-critical, skip silently
		}

		const timestamp24hAgo = Math.floor(Date.now() / 1000) - 24 * 60 * 60;

		const updateResult = await client.query(
			`WITH agg AS (
				SELECT market_address,
					COUNT(*)::int AS trade_count,
					COALESCE(SUM(collateral_amount), 0) AS volume
				FROM trades
				WHERE timestamp >= $1
				GROUP BY market_address
			)
			UPDATE markets AS m
			SET volume24h = COALESCE(sub.volume, 0),
				trades24h = COALESCE(sub.trade_count, 0)
			FROM (
				SELECT m2.id,
					COALESCE(a.trade_count, 0) AS trade_count,
					COALESCE(a.volume, 0) AS volume
				FROM markets m2
				LEFT JOIN agg a ON m2.id = a.market_address
				WHERE m2.volume24h IS DISTINCT FROM COALESCE(a.volume, 0)
					OR COALESCE(m2.trades24h, 0) IS DISTINCT FROM COALESCE(a.trade_count, 0)
			) AS sub
			WHERE m.id = sub.id`,
			[timestamp24hAgo]
		);

		const updated = updateResult.rowCount ?? 0;
		console.log(`[Cron] Recalculation done in ${Date.now() - t0}ms | ${updated} markets updated`);
	} catch (error: any) {
		console.error(`[Cron] Recalculation failed: ${error.message}`);
	} finally {
		client.release(true);
	}
}

// ─── Event Sync ─────────────────────────────────────────────────────────────

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
		`SELECT id, title, poll_addresses, market_addresses
		 FROM app_internal.events
		 WHERE array_length(poll_addresses, 1) > 0
		 ORDER BY created_at ASC`
	);

	const events: Pick<EventRow, "id" | "title" | "poll_addresses" | "market_addresses">[] =
		eventsResult.rows;

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

async function runEventSync(): Promise<void> {
	if (!ponderReady || !pool) return;

	const sp = await resolveSearchPath();
	const client = await pool.connect();
	const t0 = Date.now();

	try {
		await client.query(`SET statement_timeout = '${STATEMENT_TIMEOUT_MS}'`);
		await client.query(`SET search_path TO ${sp}`);
		await client.query(`CREATE TEMP TABLE IF NOT EXISTS live_query_tables (table_name TEXT PRIMARY KEY)`);

		const { polls: syncedPolls, markets: syncedMarkets } = await syncCompletedEvents(client);
		const eventsSynced = await syncEventsTable(client);

		console.log(
			`[Cron] Event sync done in ${Date.now() - t0}ms | polls=${syncedPolls} markets=${syncedMarkets} events=${eventsSynced}`
		);
	} catch (error: any) {
		console.error(`[Cron] Event sync failed: ${error.message}`);
	} finally {
		client.release(true);
	}
}

// ─── Scheduling ─────────────────────────────────────────────────────────────

console.log("[Cron] Initializing cron jobs...");

// Recalculate volume24h every 5 minutes (at :00, :05, :10...)
cron.schedule("*/5 * * * *", () => {
	runRecalculation().catch((err) => console.error("[Cron] Recalculation error:", err));
});

// Event sync every 10 minutes, offset by 2 min (at :02, :12, :22...)
cron.schedule("2,12,22,32,42,52 * * * *", () => {
	runEventSync().catch((err) => console.error("[Cron] Event sync error:", err));
});

console.log("[Cron] Cron jobs scheduled (volume24h @*/5min, eventSync @*/10min+2)");

(async () => {
	await new Promise((r) => setTimeout(r, INITIAL_DELAY_MS));
	await waitForPonderSync();
	ponderReady = true;
	console.log("[Cron] Ponder is ready — cron jobs are now active");

	await runRecalculation();
	await runEventSync();
})();
