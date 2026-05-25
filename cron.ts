import cron from "node-cron";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

console.log("[Cron] Initializing cron jobs...");

// Recalculate volume24h + trades24h every 5 minutes
cron.schedule("*/5 * * * *", async () => {
	console.log(
		`[Cron] Running volume24h + trades24h recalculation at ${new Date().toISOString()}`
	);

	try {
		const { stdout, stderr } = await execAsync(
			"npm run recalculate:volume24h"
		);
		if (stdout) console.log("[Cron] Output:", stdout);
		if (stderr) console.error("[Cron] Errors:", stderr);
		console.log("[Cron] ✅ Recalculation completed");
	} catch (error) {
		console.error("[Cron] ❌ Failed to run recalculation:", error);
	}
});

console.log("[Cron] ✅ Cron jobs scheduled (volume24h + trades24h every 5 min)");

// Запустить первую инициализацию с задержкой 60 секунд
// чтобы Ponder успел создать таблицы в БД
console.log("[Cron] Waiting 60 seconds for Ponder to initialize database...");
setTimeout(async () => {
	console.log("[Cron] Running initial volume24h calculation...");
	try {
		const { stdout, stderr } = await execAsync(
			"npm run recalculate:volume24h"
		);
		if (stdout) console.log("[Cron] Initial calculation output:", stdout);
		if (stderr && stderr.trim()) console.error("[Cron] Errors:", stderr);
		console.log("[Cron] ✅ Initial calculation completed");
	} catch (error) {
		console.error("[Cron] ❌ Initial calculation failed:", error);
	}
}, 60000); // 60 секунд = 1 минута

// Sync event IDs after Ponder tables are ready (90s delay)
setTimeout(async () => {
	console.log("[Cron] Running initial event sync...");
	try {
		const { stdout, stderr } = await execAsync("npm run sync:events");
		if (stdout) console.log("[Cron] Event sync output:", stdout);
		if (stderr && stderr.trim()) console.error("[Cron] Event sync errors:", stderr);
		console.log("[Cron] ✅ Event sync completed");
	} catch (error) {
		console.error("[Cron] ❌ Event sync failed:", error);
	}
}, 90000); // 90 секунд

// Periodic event sync every 10 minutes (catches missed syncs after retries expire)
cron.schedule("*/10 * * * *", async () => {
	console.log(`[Cron] Running periodic event sync at ${new Date().toISOString()}`);
	try {
		const { stdout, stderr } = await execAsync("npm run sync:events");
		if (stdout) console.log("[Cron] Event sync output:", stdout);
		if (stderr && stderr.trim()) console.error("[Cron] Event sync errors:", stderr);
		console.log("[Cron] ✅ Periodic event sync completed");
	} catch (error) {
		console.error("[Cron] ❌ Periodic event sync failed:", error);
	}
});
