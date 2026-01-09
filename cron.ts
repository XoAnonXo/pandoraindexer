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

console.log("[Cron] ✅ Cron jobs scheduled (runs every hour at :00)");

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
