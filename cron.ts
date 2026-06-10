import cron from "node-cron";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const PONDER_HEALTH_URL =
	process.env.PONDER_HEALTH_URL || "http://localhost:42069/health";

const INITIAL_DELAY_MS = 60_000;
const SYNC_POLL_INTERVAL_MS = 30_000;

let ponderReady = false;

/**
 * Wait until Ponder's /health endpoint reports that historical sync is
 * complete. While Ponder is still catching up, spawning heavy child
 * processes (tsx) risks OOM-killing the whole container.
 */
async function waitForPonderSync(): Promise<void> {
	console.log("[Cron] Waiting for Ponder to finish historical sync...");

	while (true) {
		try {
			const res = await fetch(PONDER_HEALTH_URL);
			if (res.ok) {
				const body = await res.text();
				// Ponder /health returns 200 once realtime sync is reached
				console.log("[Cron] Ponder health OK — historical sync complete");
				return;
			}
			// 503 = still syncing
		} catch {
			// Connection refused — Ponder not started yet
		}
		await new Promise((r) => setTimeout(r, SYNC_POLL_INTERVAL_MS));
	}
}

async function runRecalculation() {
	if (!ponderReady) {
		console.log("[Cron] Skipping recalculation — Ponder still syncing");
		return;
	}
	console.log(
		`[Cron] Running volume24h + trades24h recalculation at ${new Date().toISOString()}`
	);
	try {
		const { stdout, stderr } = await execAsync(
			"npm run recalculate:volume24h",
			{ timeout: 120_000 }
		);
		if (stdout) console.log("[Cron] Output:", stdout);
		if (stderr && stderr.trim()) console.error("[Cron] Errors:", stderr);
		console.log("[Cron] ✅ Recalculation completed");
	} catch (error) {
		console.error("[Cron] ❌ Failed to run recalculation:", error);
	}
}

async function runEventSync() {
	if (!ponderReady) {
		console.log("[Cron] Skipping event sync — Ponder still syncing");
		return;
	}
	console.log(
		`[Cron] Running periodic event sync at ${new Date().toISOString()}`
	);
	try {
		const { stdout, stderr } = await execAsync("npm run sync:events", {
			timeout: 60_000,
		});
		if (stdout) console.log("[Cron] Event sync output:", stdout);
		if (stderr && stderr.trim())
			console.error("[Cron] Event sync errors:", stderr);
		console.log("[Cron] ✅ Periodic event sync completed");
	} catch (error) {
		console.error("[Cron] ❌ Event sync failed:", error);
	}
}

console.log("[Cron] Initializing cron jobs...");

// Schedule: recalculate volume24h every 5 minutes
cron.schedule("*/5 * * * *", runRecalculation);

// Schedule: sync events every 10 minutes
cron.schedule("*/10 * * * *", runEventSync);

console.log("[Cron] ✅ Cron jobs scheduled (volume24h @5m, eventSync @10m)");

// Wait for Ponder to be ready before allowing cron jobs to run
(async () => {
	await new Promise((r) => setTimeout(r, INITIAL_DELAY_MS));
	await waitForPonderSync();
	ponderReady = true;
	console.log("[Cron] ✅ Ponder is ready — cron jobs are now active");

	// Run initial jobs immediately
	await runRecalculation();
	await runEventSync();
})();
