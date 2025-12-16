/**
 * Compare Local vs Production Indexer
 * 
 * Usage: npx tsx scripts/compare-prod.ts
 */

import { request, gql } from 'graphql-request';
import { formatUnits } from 'viem';

const LOCAL_URL = process.env.LOCAL_URL ?? "http://localhost:5009";
const PROD_URL = process.env.PROD_URL ?? "https://sonicmarketindexer-production.up.railway.app";

const STATS_QUERY = gql`
  query GetStats {
    platformStatss(limit: 1) {
      items {
        id
        totalPolls
        totalMarkets
        totalTrades
        totalVolume
        totalLiquidity
        totalUsers
      }
    }
    _meta {
      status
    }
  }
`;

const MARKETS_QUERY = gql`
  query GetMarkets {
    marketss(limit: 5, orderBy: "totalVolume", orderDirection: "desc") {
      items {
        id
        totalVolume
        totalTrades
      }
    }
  }
`;

function formatUSDC(val: string): string {
  return Number(formatUnits(BigInt(val), 6)).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

async function main() {
  console.log("🔍 Comparing Local vs Production Indexer\n");

  try {
    const [localStats, prodStats] = await Promise.all([
      request(LOCAL_URL, STATS_QUERY),
      request(PROD_URL, STATS_QUERY)
    ]);

    const localMeta = (localStats as any)._meta;
    const prodMeta = (prodStats as any)._meta;
    
    console.log("--- SYNC STATUS ---");
    console.log(`Local Status: ${JSON.stringify(localMeta)}`);
    console.log(`Prod Status:  ${JSON.stringify(prodMeta)}`);
    console.log("");

    const localP = (localStats as any).platformStatss.items[0] || {};
    const prodP = (prodStats as any).platformStatss.items[0] || {};

    console.log("--- PLATFORM STATS ---");
    console.table({
      "Total Polls": { Local: localP.totalPolls, Prod: prodP.totalPolls },
      "Total Markets": { Local: localP.totalMarkets, Prod: prodP.totalMarkets },
      "Total Trades": { Local: localP.totalTrades, Prod: prodP.totalTrades },
      "Total Volume": { Local: formatUSDC(localP.totalVolume || '0'), Prod: formatUSDC(prodP.totalVolume || '0') },
      "Total Liquidity": { Local: formatUSDC(localP.totalLiquidity || '0'), Prod: formatUSDC(prodP.totalLiquidity || '0') },
      "Total Users": { Local: localP.totalUsers, Prod: prodP.totalUsers },
    });

    console.log("\n--- TOP MARKETS (by Volume in respective DB) ---");
    
    // Fetch top markets to compare logic
    const [localMarkets, prodMarkets] = await Promise.all([
      request(LOCAL_URL, MARKETS_QUERY),
      request(PROD_URL, MARKETS_QUERY)
    ]);

    const lMarkets = (localMarkets as any).marketss.items;
    const pMarkets = (prodMarkets as any).marketss.items;

    console.log("Top 5 Local Markets:");
    console.table(lMarkets.map((m: any) => ({
      ID: m.id,
      Volume: formatUSDC(m.totalVolume),
      Trades: m.totalTrades
    })));

    console.log("Top 5 Prod Markets:");
    console.table(pMarkets.map((m: any) => ({
      ID: m.id,
      Volume: formatUSDC(m.totalVolume),
      Trades: m.totalTrades
    })));

  } catch (e: any) {
    console.error("Error running comparison:", e.message);
    console.error("Ensure both indexers are reachable.");
  }
}

main();





