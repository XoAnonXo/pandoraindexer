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
  })
);

// ─── Request Analytics ───────────────────────────────────────────────

interface RequestStats {
  count: number;
  totalDurationMs: number;
  totalResponseBytes: number;
}

const operationStats = new Map<string, RequestStats>();
const ipStats = new Map<string, RequestStats>();
const SUMMARY_INTERVAL_MS = 5 * 60 * 1000;
const HEAVY_RESPONSE_THRESHOLD = 1024 * 1024; // 1 MB
const SLOW_REQUEST_THRESHOLD_MS = 3000;

function trackRequest(
  operation: string,
  ip: string,
  durationMs: number,
  responseBytes: number,
) {
  const bump = (map: Map<string, RequestStats>, key: string) => {
    const s = map.get(key) ?? { count: 0, totalDurationMs: 0, totalResponseBytes: 0 };
    s.count++;
    s.totalDurationMs += durationMs;
    s.totalResponseBytes += responseBytes;
    map.set(key, s);
  };
  bump(operationStats, operation);
  bump(ipStats, ip);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function printAndResetSummary() {
  if (operationStats.size === 0) return;

  const sortedOps = [...operationStats.entries()].sort(
    (a, b) => b[1].totalResponseBytes - a[1].totalResponseBytes,
  );
  const sortedIPs = [...ipStats.entries()].sort(
    (a, b) => b[1].totalResponseBytes - a[1].totalResponseBytes,
  );

  const totalReqs = sortedOps.reduce((s, [, v]) => s + v.count, 0);
  const totalEgress = sortedOps.reduce((s, [, v]) => s + v.totalResponseBytes, 0);

  console.log("\n[API Stats] ═══ Summary (last 5 min) ═══");
  console.log(
    `[API Stats] Total: ${totalReqs} reqs | ${formatBytes(totalEgress)} egress`,
  );

  console.log("[API Stats] ── Top operations by egress ──");
  for (const [op, st] of sortedOps.slice(0, 15)) {
    const avg = Math.round(st.totalDurationMs / st.count);
    console.log(
      `[API Stats]   ${op}: ${st.count} reqs | ${formatBytes(st.totalResponseBytes)} egress | avg ${avg}ms`,
    );
  }

  console.log("[API Stats] ── Top IPs by egress ──");
  for (const [ip, st] of sortedIPs.slice(0, 10)) {
    console.log(
      `[API Stats]   ${ip}: ${st.count} reqs | ${formatBytes(st.totalResponseBytes)} egress`,
    );
  }

  console.log("[API Stats] ═══════════════════════════\n");

  operationStats.clear();
  ipStats.clear();
}

setInterval(printAndResetSummary, SUMMARY_INTERVAL_MS);

// ─── Logging Middleware ──────────────────────────────────────────────

app.use("*", async (c, next) => {
  const isGraphQL =
    c.req.path === "/" ||
    c.req.path === "/graphql" ||
    c.req.path.includes("graphql");
  if (c.req.method === "OPTIONS" || !isGraphQL) {
    return next();
  }

  const start = Date.now();
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";

  let operationName = "anonymous";

  if (c.req.method === "POST") {
    try {
      const body = await c.req.raw.clone().json();
      operationName =
        body.operationName ||
        body.query?.match(/(?:query|mutation)\s+(\w+)/)?.[1] ||
        "anonymous";
    } catch {}
  } else if (c.req.method === "GET") {
    operationName = new URL(c.req.url).searchParams.get("operationName") || "anonymous";
  }

  await next();

  const duration = Date.now() - start;
  const contentLength = parseInt(c.res.headers.get("content-length") || "0", 10);

  trackRequest(operationName, ip, duration, contentLength);

  if (contentLength > HEAVY_RESPONSE_THRESHOLD) {
    console.log(
      `[API Heavy] ${ip} | ${operationName} | ${formatBytes(contentLength)} | ${duration}ms`,
    );
  }
  if (duration > SLOW_REQUEST_THRESHOLD_MS) {
    console.log(
      `[API Slow] ${ip} | ${operationName} | ${duration}ms | ${formatBytes(contentLength)}`,
    );
  }
});

export default app;
