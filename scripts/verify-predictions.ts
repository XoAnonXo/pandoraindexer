#!/usr/bin/env tsx
/**
 * Verify Predictions: Compare indexer trades with on-chain events
 * 
 * Checks:
 * - Total trade count matches on-chain event count
 * - Trade amounts match event data
 * - All on-chain trades are indexed
 */

import { createPublicClient, http, formatUnits, parseAbiItem, type Address, type Log } from "viem";
import { sonic } from "viem/chains";
import { CONTRACTS, PredictionAMMAbi, PredictionPariMutuelAbi, RPC_URL, USDC_DECIMALS } from "./contracts.js";
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

// GraphQL queries
const TRADES_QUERY = `
  query {
    tradess(limit: 1000, orderBy: "timestamp", orderDirection: "desc") {
      items {
        id
        trader
        marketAddress
        tradeType
        side
        collateralAmount
        tokenAmount
        feeAmount
        txHash
        timestamp
      }
    }
  }
`;

const MARKETS_QUERY = `
  query {
    marketss(limit: 1000) {
      items {
        id
        marketType
        totalTrades
        totalVolume
      }
    }
  }
`;

const PLATFORM_STATS_QUERY = `
  query {
    platformStatss(limit: 1) {
      items {
        totalTrades
        totalVolume
      }
    }
  }
`;

interface Trade {
  id: string;
  trader: string;
  marketAddress: string;
  tradeType: string;
  side: string;
  collateralAmount: string;
  tokenAmount: string;
  feeAmount: string;
  txHash: string;
  timestamp: string;
}

interface Market {
  id: string;
  marketType: string;
  totalTrades: number;
  totalVolume: string;
}

// Event signatures for on-chain verification
const BUY_TOKENS_EVENT = parseAbiItem("event BuyTokens(address indexed trader, bool indexed isYes, uint256 tokenAmount, uint256 collateralAmount, uint256 fee)");
const SELL_TOKENS_EVENT = parseAbiItem("event SellTokens(address indexed trader, bool indexed isYes, uint256 tokenAmount, uint256 collateralAmount, uint256 fee)");
const POSITION_PURCHASED_EVENT = parseAbiItem("event PositionPurchased(address indexed buyer, bool indexed isYes, uint256 collateralIn, uint256 sharesOut)");

async function getOnChainEventCount(
  marketAddress: Address,
  eventAbi: typeof BUY_TOKENS_EVENT | typeof SELL_TOKENS_EVENT | typeof POSITION_PURCHASED_EVENT,
  fromBlock: bigint = BigInt(CONTRACTS.startBlock)
): Promise<{ count: number; totalAmount: bigint }> {
  try {
    const logs = await client.getLogs({
      address: marketAddress,
      event: eventAbi,
      fromBlock,
      toBlock: "latest",
    });
    
    let totalAmount = 0n;
    for (const log of logs) {
      const args = log.args as any;
      if (args?.collateralAmount !== undefined) {
        totalAmount += BigInt(args.collateralAmount);
      } else if (args?.collateralIn !== undefined) {
        totalAmount += BigInt(args.collateralIn);
      }
    }
    
    return { count: logs.length, totalAmount };
  } catch (error) {
    console.error(`Error fetching events for ${marketAddress}:`, error);
    return { count: 0, totalAmount: 0n };
  }
}

async function main() {
  log("\n" + "=".repeat(70), colors.bright);
  log("  PREDICTIONS VERIFICATION - Indexer vs On-Chain", colors.bright);
  log("=".repeat(70), colors.bright);
  
  log(`\nRPC: ${RPC_URL}`, colors.cyan);
  log(`Indexer: ${process.env.INDEXER_URL ?? "http://localhost:42069"}`, colors.cyan);

  // Fetch data from indexer
  log("\n📊 Fetching data from indexer...", colors.yellow);
  
  let trades: Trade[];
  let markets: Market[];
  let platformTrades: number;
  let platformVolume: bigint;
  
  try {
    const [tradesData, marketsData, statsData] = await Promise.all([
      queryIndexer<{ tradess: { items: Trade[] } }>(TRADES_QUERY),
      queryIndexer<{ marketss: { items: Market[] } }>(MARKETS_QUERY),
      queryIndexer<{ platformStatss: { items: { totalTrades: number; totalVolume: string }[] } }>(PLATFORM_STATS_QUERY),
    ]);
    
    trades = tradesData.tradess.items;
    markets = marketsData.marketss.items;
    platformTrades = statsData.platformStatss.items[0]?.totalTrades ?? 0;
    platformVolume = BigInt(statsData.platformStatss.items[0]?.totalVolume ?? "0");
  } catch (error) {
    log(`❌ Failed to fetch from indexer: ${error}`, colors.red);
    return;
  }
  
  log(`\n✅ Fetched ${trades.length} trades from indexer`, colors.green);
  log(`   Platform reports: ${platformTrades} total trades`, colors.cyan);
  log(`   Markets: ${markets.length}`, colors.cyan);

  // Group trades by market
  const tradesByMarket: Map<string, Trade[]> = new Map();
  for (const trade of trades) {
    const marketTrades = tradesByMarket.get(trade.marketAddress) ?? [];
    marketTrades.push(trade);
    tradesByMarket.set(trade.marketAddress, marketTrades);
  }

  // Verify each market's trades
  log("\n" + "=".repeat(70), colors.bright);
  log("  PER-MARKET VERIFICATION", colors.bright);
  log("=".repeat(70), colors.bright);
  
  let totalIndexerTrades = 0;
  let totalOnchainTrades = 0;
  let totalIndexerVolume = 0n;
  let totalOnchainVolume = 0n;
  let matchedMarkets = 0;
  let mismatchedMarkets = 0;
  
  const ammMarkets = markets.filter(m => m.marketType === "amm");
  const pariMarkets = markets.filter(m => m.marketType === "pari");
  
  log(`\n📈 Checking ${ammMarkets.length} AMM markets...`, colors.yellow);
  
  for (const market of ammMarkets) {
    const marketAddress = market.id as Address;
    const indexerTrades = tradesByMarket.get(marketAddress) ?? [];
    const indexerTradeCount = market.totalTrades;
    const indexerVolume = BigInt(market.totalVolume);
    
    // Get on-chain counts
    const [buyResult, sellResult] = await Promise.all([
      getOnChainEventCount(marketAddress, BUY_TOKENS_EVENT),
      getOnChainEventCount(marketAddress, SELL_TOKENS_EVENT),
    ]);
    
    const onchainTradeCount = buyResult.count + sellResult.count;
    const onchainVolume = buyResult.totalAmount + sellResult.totalAmount;
    
    totalIndexerTrades += indexerTradeCount;
    totalOnchainTrades += onchainTradeCount;
    totalIndexerVolume += indexerVolume;
    totalOnchainVolume += onchainVolume;
    
    const tradesMatch = indexerTradeCount === onchainTradeCount;
    
    if (tradesMatch) {
      matchedMarkets++;
      console.log(`✅ [AMM] ${marketAddress}`);
      console.log(`      Trades: ${indexerTradeCount} (Buy: ${buyResult.count}, Sell: ${sellResult.count})`);
    } else {
      mismatchedMarkets++;
      log(`❌ [AMM] ${marketAddress}`, colors.red);
      console.log(`      Indexer trades:  ${indexerTradeCount}`);
      console.log(`      On-chain trades: ${onchainTradeCount} (Buy: ${buyResult.count}, Sell: ${sellResult.count})`);
      console.log(`      Diff: ${indexerTradeCount - onchainTradeCount}`);
    }
    console.log(`      Volume - Indexer: ${formatUSDC(indexerVolume)} | On-chain: ${formatUSDC(onchainVolume)} USDC`);
    console.log();
  }
  
  log(`\n📊 Checking ${pariMarkets.length} PariMutuel markets...`, colors.yellow);
  
  for (const market of pariMarkets) {
    const marketAddress = market.id as Address;
    const indexerTradeCount = market.totalTrades;
    const indexerVolume = BigInt(market.totalVolume);
    
    // Get on-chain position purchases
    const posResult = await getOnChainEventCount(marketAddress, POSITION_PURCHASED_EVENT);
    
    // Note: PariMutuel totalTrades includes PositionPurchased only (not SeedInitialLiquidity)
    const onchainTradeCount = posResult.count;
    const onchainVolume = posResult.totalAmount;
    
    totalIndexerTrades += indexerTradeCount;
    totalOnchainTrades += onchainTradeCount;
    // Note: PariMutuel volume also includes SeedInitialLiquidity, which we track separately
    
    const tradesMatch = indexerTradeCount === onchainTradeCount;
    
    if (tradesMatch) {
      matchedMarkets++;
      console.log(`✅ [PARI] ${marketAddress}`);
      console.log(`      Trades: ${indexerTradeCount}`);
    } else {
      mismatchedMarkets++;
      log(`❌ [PARI] ${marketAddress}`, colors.red);
      console.log(`      Indexer trades:  ${indexerTradeCount}`);
      console.log(`      On-chain trades: ${onchainTradeCount}`);
      console.log(`      Diff: ${indexerTradeCount - onchainTradeCount}`);
    }
    console.log(`      Volume - Indexer: ${formatUSDC(indexerVolume)} USDC`);
    console.log();
  }

  // Summary
  log("=".repeat(70), colors.bright);
  log("  SUMMARY", colors.bright);
  log("=".repeat(70), colors.bright);
  
  console.log(`\n📊 Market Verification:`);
  log(`   ✅ Matched:    ${matchedMarkets}`, colors.green);
  if (mismatchedMarkets > 0) {
    log(`   ❌ Mismatched: ${mismatchedMarkets}`, colors.red);
  }
  
  console.log(`\n📈 Trade Counts:`);
  console.log(`   Indexer total trades (from GraphQL):   ${trades.length}`);
  console.log(`   Platform stats totalTrades:            ${platformTrades}`);
  console.log(`   Sum of market totalTrades:             ${totalIndexerTrades}`);
  console.log(`   On-chain events (Buy+Sell+Position):   ${totalOnchainTrades}`);
  
  const tradeCountDiff = platformTrades - totalOnchainTrades;
  if (Math.abs(tradeCountDiff) > 0) {
    const sign = tradeCountDiff > 0 ? "+" : "";
    log(`   Difference: ${sign}${tradeCountDiff}`, tradeCountDiff === 0 ? colors.green : colors.yellow);
  }
  
  console.log(`\n💰 Volume:`);
  console.log(`   AMM Indexer volume:           ${formatUSDC(totalIndexerVolume)} USDC`);
  console.log(`   AMM On-chain (Buy+Sell):      ${formatUSDC(totalOnchainVolume)} USDC`);
  console.log(`   Platform totalVolume:         ${formatUSDC(platformVolume)} USDC`);
  console.log(`\n   Note: Indexer volume includes SeedInitialLiquidity and LiquidityAdded imbalance,`);
  console.log(`         which aren't counted in pure Buy/Sell event totals.`);
  
  // Trade type breakdown
  const buyTrades = trades.filter(t => t.tradeType === "buy");
  const sellTrades = trades.filter(t => t.tradeType === "sell");
  const otherTrades = trades.filter(t => t.tradeType !== "buy" && t.tradeType !== "sell");
  
  console.log(`\n📋 Trade Breakdown (from indexer):`);
  console.log(`   Buy trades:   ${buyTrades.length}`);
  console.log(`   Sell trades:  ${sellTrades.length}`);
  if (otherTrades.length > 0) {
    console.log(`   Other:        ${otherTrades.length}`);
  }
  
  // Recent trades sample
  log(`\n📝 Recent 5 trades:`, colors.cyan);
  const recentTrades = trades.slice(0, 5);
  for (const trade of recentTrades) {
    const side = trade.side.toUpperCase();
    const type = trade.tradeType.toUpperCase();
    const amount = formatUSDC(BigInt(trade.collateralAmount));
    console.log(`   ${type} ${side} - ${amount} USDC - ${trade.marketAddress.slice(0, 10)}...`);
  }
  
  console.log();
}

main().catch(console.error);

