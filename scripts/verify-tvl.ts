#!/usr/bin/env tsx
/**
 * Verify TVL: Compare indexer TVL with actual on-chain USDC balances
 * 
 * For each market, fetches the USDC balance directly from the collateral token
 * contract and compares with the indexer's currentTvl value.
 */

import { createPublicClient, http, formatUnits, getContract, type Address } from "viem";
import { sonic } from "viem/chains";
import { CONTRACTS, ERC20Abi, RPC_URL, USDC_DECIMALS } from "./contracts.js";
import { queryIndexer } from "./utils.js";

// Create client
const client = createPublicClient({
  chain: sonic,
  transport: http(RPC_URL),
});

// Colors
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(msg: string, color?: string) {
  console.log(color ? `${color}${msg}${colors.reset}` : msg);
}

function formatUSDC(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

// GraphQL query
const MARKETS_QUERY = `
  query {
    marketss(limit: 1000, orderBy: "currentTvl", orderDirection: "desc") {
      items {
        id
        marketType
        collateralToken
        currentTvl
        totalVolume
        totalTrades
      }
    }
  }
`;

const PLATFORM_STATS_QUERY = `
  query {
    platformStatss(limit: 1) {
      items {
        totalLiquidity
      }
    }
  }
`;

interface Market {
  id: string;
  marketType: string;
  collateralToken: string;
  currentTvl: string;
  totalVolume: string;
  totalTrades: number;
}

interface TvlComparison {
  market: string;
  marketType: string;
  indexerTvl: bigint;
  onchainBalance: bigint;
  diff: bigint;
  match: boolean;
}

async function getOnChainBalance(marketAddress: Address, collateralToken: Address): Promise<bigint> {
  try {
    const contract = getContract({
      address: collateralToken,
      abi: ERC20Abi,
      client,
    });
    
    return await contract.read.balanceOf([marketAddress]);
  } catch (error) {
    console.error(`Error fetching balance for ${marketAddress}:`, error);
    return 0n;
  }
}

async function main() {
  log("\n" + "=".repeat(70), colors.bright);
  log("  TVL VERIFICATION - Indexer vs On-Chain Balances", colors.bright);
  log("=".repeat(70), colors.bright);
  
  log(`\nRPC: ${RPC_URL}`, colors.cyan);
  log(`Indexer: ${process.env.INDEXER_URL ?? "http://localhost:42069"}`, colors.cyan);
  log(`USDC: ${CONTRACTS.usdc}\n`, colors.cyan);

  // Fetch markets from indexer
  log("Fetching markets from indexer...", colors.yellow);
  
  let markets: Market[];
  let platformTotalLiquidity: bigint;
  
  try {
    const [marketsData, statsData] = await Promise.all([
      queryIndexer<{ marketss: { items: Market[] } }>(MARKETS_QUERY),
      queryIndexer<{ platformStatss: { items: { totalLiquidity: string }[] } }>(PLATFORM_STATS_QUERY),
    ]);
    
    markets = marketsData.marketss.items;
    platformTotalLiquidity = BigInt(statsData.platformStatss.items[0]?.totalLiquidity ?? "0");
  } catch (error) {
    log(`❌ Failed to fetch from indexer: ${error}`, colors.red);
    return;
  }
  
  log(`Found ${markets.length} markets\n`, colors.green);

  // Compare TVL for each market
  const comparisons: TvlComparison[] = [];
  let totalIndexerTvl = 0n;
  let totalOnchainTvl = 0n;
  
  log("Checking each market...\n", colors.yellow);
  
  for (const market of markets) {
    const marketAddress = market.id as Address;
    const collateralToken = (market.collateralToken || CONTRACTS.usdc) as Address;
    const indexerTvl = BigInt(market.currentTvl);
    
    // Get on-chain balance
    const onchainBalance = await getOnChainBalance(marketAddress, collateralToken);
    
    const diff = indexerTvl > onchainBalance 
      ? indexerTvl - onchainBalance 
      : onchainBalance - indexerTvl;
    
    // Allow small tolerance (0.01 USDC) for rounding
    const match = diff <= 10000n; // 0.01 USDC in 6 decimals
    
    comparisons.push({
      market: marketAddress,
      marketType: market.marketType,
      indexerTvl,
      onchainBalance,
      diff,
      match,
    });
    
    totalIndexerTvl += indexerTvl;
    totalOnchainTvl += onchainBalance;
    
    // Print result
    const typeLabel = market.marketType.toUpperCase().padEnd(4);
    const status = match ? "✅" : "❌";
    
    console.log(`${status} [${typeLabel}] ${marketAddress}`);
    console.log(`      Indexer:  ${formatUSDC(indexerTvl).padStart(15)} USDC`);
    console.log(`      On-chain: ${formatUSDC(onchainBalance).padStart(15)} USDC`);
    
    if (!match) {
      const diffSign = indexerTvl > onchainBalance ? "+" : "-";
      log(`      Diff:     ${diffSign}${formatUSDC(diff).padStart(14)} USDC`, colors.red);
    }
    console.log();
  }

  // Summary
  log("=".repeat(70), colors.bright);
  log("  SUMMARY", colors.bright);
  log("=".repeat(70), colors.bright);
  
  const matched = comparisons.filter(c => c.match).length;
  const mismatched = comparisons.filter(c => !c.match).length;
  
  console.log(`\nMarkets checked: ${comparisons.length}`);
  log(`✅ Matched:      ${matched}`, colors.green);
  if (mismatched > 0) {
    log(`❌ Mismatched:   ${mismatched}`, colors.red);
  }
  
  console.log(`\n📊 Total TVL Comparison:`);
  console.log(`   Indexer Total TVL:    ${formatUSDC(totalIndexerTvl).padStart(15)} USDC`);
  console.log(`   On-chain Total:       ${formatUSDC(totalOnchainTvl).padStart(15)} USDC`);
  console.log(`   Platform Liquidity:   ${formatUSDC(platformTotalLiquidity).padStart(15)} USDC`);
  
  const totalDiff = totalIndexerTvl > totalOnchainTvl 
    ? totalIndexerTvl - totalOnchainTvl 
    : totalOnchainTvl - totalIndexerTvl;
  
  if (totalDiff > 0n) {
    const diffSign = totalIndexerTvl > totalOnchainTvl ? "+" : "-";
    console.log(`   Difference:           ${diffSign}${formatUSDC(totalDiff).padStart(14)} USDC`);
  }
  
  // Check if platform liquidity matches sum of TVLs
  const platformDiff = platformTotalLiquidity > totalIndexerTvl
    ? platformTotalLiquidity - totalIndexerTvl
    : totalIndexerTvl - platformTotalLiquidity;
  
  if (platformDiff > 10000n) {
    log(`\n⚠️  Platform totalLiquidity doesn't match sum of market TVLs!`, colors.yellow);
    console.log(`   Platform says: ${formatUSDC(platformTotalLiquidity)} USDC`);
    console.log(`   Sum of TVLs:   ${formatUSDC(totalIndexerTvl)} USDC`);
  }
  
  // List mismatches
  if (mismatched > 0) {
    log("\n❌ Mismatched Markets:", colors.red);
    for (const c of comparisons.filter(c => !c.match)) {
      const diffSign = c.indexerTvl > c.onchainBalance ? "+" : "-";
      console.log(`   ${c.market} (${c.marketType}): ${diffSign}${formatUSDC(c.diff)} USDC`);
    }
  }
  
  console.log();
}

main().catch(console.error);

