import cron from "node-cron";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const PONDER_HEALTH_URL =
	process.env.PONDER_HEALTH_URL || "http://localhost:42069/health";
const SYNC_POLL_INTERVAL_MS = 30_000;
const INITIAL_DELAY_MS = 60_000;

let ponderReady = false;

/**
 * Poll Ponder /health until it returns 200 (historical sync complete).
 * While Ponder is catching up, child processes would spike memory and
 * risk OOM-killing the container.
 */
async function waitForPonderSync(): Promise<void> {
	console.log("[Cron] Waiting for Ponder to finish historical sync...");

	while (true) {
		try {
			const res = await fetch(PONDER_HEALTH_URL);
			if (res.ok) {
				console.log(
					"[Cron] Ponder health OK — historical sync complete"
				);
				return;
			}
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
		console.error("[Cron] ❌ Periodic event sync failed:", error);
	}
}

console.log("[Cron] Initializing cron jobs...");

// Recalculate volume24h + trades24h every 5 minutes
cron.schedule("*/5 * * * *", runRecalculation);

// Periodic event sync every 10 minutes
cron.schedule("*/10 * * * *", runEventSync);

console.log(
	"[Cron] ✅ Cron jobs scheduled (volume24h @5m, eventSync @10m)"
);

// Wait for Ponder to be fully synced before running any child processes
(async () => {
	await new Promise((r) => setTimeout(r, INITIAL_DELAY_MS));
	await waitForPonderSync();
	ponderReady = true;
	console.log("[Cron] ✅ Ponder is ready — cron jobs are now active");

	await runRecalculation();
	await runEventSync();
})();
