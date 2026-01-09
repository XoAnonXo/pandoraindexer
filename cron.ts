import cron from "node-cron";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

console.log("[Cron] Initializing cron jobs...");

// Запускать пересчет volume24h каждый час (в 0 минут)
cron.schedule("0 * * * *", async () => {
	console.log(
		`[Cron] Running volume24h recalculation at ${new Date().toISOString()}`
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

// Запустить сразу при старте (первая инициализация)
console.log("[Cron] Running initial volume24h calculation...");
execAsync("npm run recalculate:volume24h")
	.then(({ stdout }) => {
		if (stdout) console.log("[Cron] Initial calculation output:", stdout);
		console.log("[Cron] ✅ Initial calculation completed");
	})
	.catch((error) => {
		console.error("[Cron] ❌ Initial calculation failed:", error);
	});

console.log("[Cron] ✅ Cron jobs scheduled (runs every hour at :00)");
