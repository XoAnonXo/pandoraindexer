import { graphql } from "ponder";
import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
	.split(",")
	.map((o) => o.trim())
	.filter(Boolean);

app.use(
	"*",
	cors({
		origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type"],
		maxAge: 600,
	}),
);

// ---------------------------------------------------------------------------
// Request analytics middleware
// ---------------------------------------------------------------------------
const STATS_INTERVAL_MS = Number(process.env.API_STATS_INTERVAL_MS) || 300_000;

interface RequestBucket {
	total: number;
	byStatus: Record<number, number>;
	totalDurationMs: number;
	maxDurationMs: number;
	errors: number;
}

let bucket: RequestBucket = {
	total: 0,
	byStatus: {},
	totalDurationMs: 0,
	maxDurationMs: 0,
	errors: 0,
};

function resetBucket(): RequestBucket {
	const snap = { ...bucket, byStatus: { ...bucket.byStatus } };
	bucket = { total: 0, byStatus: {}, totalDurationMs: 0, maxDurationMs: 0, errors: 0 };
	return snap;
}

const statsTimer = setInterval(() => {
	if (bucket.total === 0) return;
	const snap = resetBucket();
	const avgMs = snap.total ? (snap.totalDurationMs / snap.total).toFixed(1) : "0";
	const statusStr = Object.entries(snap.byStatus)
		.map(([code, count]) => `${code}:${count}`)
		.join(" ");
	console.log(
		`[API Stats] reqs=${snap.total} avg=${avgMs}ms max=${snap.maxDurationMs.toFixed(1)}ms errors=${snap.errors} status=[${statusStr}]`,
	);
}, STATS_INTERVAL_MS);

if (typeof statsTimer === "object" && "unref" in statsTimer) {
	statsTimer.unref();
}

app.use("*", async (c, next) => {
	if (c.req.method === "OPTIONS") return next();

	const start = performance.now();
	await next();
	const durationMs = performance.now() - start;

	const status = c.res.status;
	bucket.total++;
	bucket.byStatus[status] = (bucket.byStatus[status] || 0) + 1;
	bucket.totalDurationMs += durationMs;
	if (durationMs > bucket.maxDurationMs) bucket.maxDurationMs = durationMs;
	if (status >= 400) bucket.errors++;
});

app.use("/graphql", graphql({ db, schema }));
app.use("/", graphql({ db, schema }));

export default app;
