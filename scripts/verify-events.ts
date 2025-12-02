#!/usr/bin/env tsx
/**
 * Event-Based Verification Script
 * 
 * Compares indexer data with on-chain events (not view functions).
 * This is more reliable since it uses the same data source as the indexer.
 * 
 * Verifies:
 * - Poll counts match PollCreated events
 * - Market counts match MarketCreated + PariMutuelCreated events
 * - Trade volumes match sum of trading events
 * - Platform totals are consistent
 */

import { createPublicClient, http, parseAbiItem, formatUnits, type Address, type Log } from "viem";
import { sonic } from "viem/chains";
import { CONTRACTS, RPC_URL, USDC_DECIMALS } from "./contracts.js";
import {
  queryIndexer,
  logHeader,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  compare,
  compareBigInt,
  createSummary,
  recordResult,
  printSummary,
  type VerificationSummary,
} from "./utils.js";

// Create client
const client = createPublicClient({
  chain: sonic,
  transport: http(RPC_URL),
});

const START_BLOCK = 56_000_000n;

// Event ABIs
const PollCreatedEvent = parseAbiItem(
  "event PollCreated(address indexed pollAddress, address indexed creator, uint32 deadlineEpoch, string question)"
);

const MarketCreatedEvent = parseAbiItem(
  "event MarketCreated(address indexed pollAddress, address indexed marketAddress, address indexed creator, address yesToken, address noToken, address collateral, uint24 feeTier, uint24 maxPriceImbalancePerHour)"
);

const PariMutuelCreatedEvent = parseAbiItem(
  "event PariMutuelCreated(address indexed pollAddress, address indexed marketAddress, address indexed creator, address collateral, uint8 curveFlattener, uint24 curveOffset)"
);

const BuyTokensEvent = parseAbiItem(
  "event BuyTokens(address indexed trader, bool indexed isYes, uint256 tokenAmount, uint256 collateralAmount, uint256 fee)"
);

const SellTokensEvent = parseAbiItem(
  "event SellTokens(address indexed trader, bool indexed isYes, uint256 tokenAmount, uint256 collateralAmount, uint256 fee)"
);

const PositionPurchasedEvent = parseAbiItem(
  "event PositionPurchased(address indexed buyer, bool indexed isYes, uint256 collateralIn, uint256 sharesOut)"
);

const LiquidityAddedEvent = parseAbiItem(
  "event LiquidityAdded(address indexed provider, uint256 collateralAmount, uint256 lpTokens, (uint256 yesToAdd, uint256 noToAdd, uint256 yesToReturn, uint256 noToReturn) amounts)"
);

const SeedInitialLiquidityEvent = parseAbiItem(
  "event SeedInitialLiquidity(uint256 yesAmount, uint256 noAmount)"
);

// Indexer queries
const PLATFORM_STATS_QUERY = `
  query {
    platformStatss(limit: 1) {
      items {
        totalPolls
        totalMarkets
        totalAmmMarkets
        totalPariMarkets
        totalTrades
        totalVolume
        totalFees
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
        totalVolume
        totalTrades
      }
    }
  }
`;

interface PlatformStats {
  totalPolls: number;
  totalMarkets: number;
  totalAmmMarkets: number;
  totalPariMarkets: number;
  totalTrades: number;
  totalVolume: string;
  totalFees: string;
}

interface Market {
  id: string;
  marketType: string;
  totalVolume: string;
  totalTrades: number;
}

function formatUSDC(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch all events from a contract
 */
async function fetchAllEvents<T>(
  address: Address,
  event: any,
  label: string
): Promise<Log[]> {
  const toBlock = await client.getBlockNumber();
  const blockRange = 100000n;
  const allLogs: Log[] = [];
  
  for (let start = START_BLOCK; start <= toBlock; start += blockRange) {
    const end = start + blockRange > toBlock ? toBlock : start + blockRange;
    
    try {
      const logs = await client.getLogs({
        address,
        event,
        fromBlock: start,
        toBlock: end,
      });
      allLogs.push(...logs);
      
      if (logs.length > 0) {
        process.stdout.write(`\r   Fetching ${label}... ${allLogs.length} events (block ${end})`);
      }
    } catch (error) {
      logWarning(`Error fetching ${label} logs from ${start}: ${error}`);
    }
    
    await sleep(100);
  }
  
  console.log(); // newline after progress
  return allLogs;
}

/**
 * Fetch trading events from market contracts
 * 
 * Volume sources:
 * - AMM: BuyTokens + SellTokens + LiquidityAdded imbalance
 * - Pari: SeedInitialLiquidity + PositionPurchased
 */
async function fetchMarketTradingEvents(
  marketAddress: Address,
  marketType: "amm" | "pari"
): Promise<{ volume: bigint; trades: number; fees: bigint }> {
  const toBlock = await client.getBlockNumber();
  const blockRange = 100000n;
  
  let volume = 0n;
  let trades = 0;
  let fees = 0n;
  
  for (let start = START_BLOCK; start <= toBlock; start += blockRange) {
    const end = start + blockRange > toBlock ? toBlock : start + blockRange;
    
    try {
      if (marketType === "amm") {
        // Fetch BuyTokens
        const buyLogs = await client.getLogs({
          address: marketAddress,
          event: BuyTokensEvent,
          fromBlock: start,
          toBlock: end,
        });
        
        for (const log of buyLogs) {
          volume += (log as any).args.collateralAmount ?? 0n;
          fees += (log as any).args.fee ?? 0n;
          trades++;
        }
        
        // Fetch SellTokens
        const sellLogs = await client.getLogs({
          address: marketAddress,
          event: SellTokensEvent,
          fromBlock: start,
          toBlock: end,
        });
        
        for (const log of sellLogs) {
          volume += (log as any).args.collateralAmount ?? 0n;
          fees += (log as any).args.fee ?? 0n;
          trades++;
        }
        
        // Fetch LiquidityAdded for imbalance volume
        const liqLogs = await client.getLogs({
          address: marketAddress,
          event: LiquidityAddedEvent,
          fromBlock: start,
          toBlock: end,
        });
        
        for (const log of liqLogs) {
          const amounts = (log as any).args.amounts;
          if (amounts) {
            const imbalance = (amounts.yesToReturn ?? 0n) + (amounts.noToReturn ?? 0n);
            volume += imbalance;
          }
        }
      } else {
        // Fetch SeedInitialLiquidity (counts as volume)
        const seedLogs = await client.getLogs({
          address: marketAddress,
          event: SeedInitialLiquidityEvent,
          fromBlock: start,
          toBlock: end,
        });
        
        for (const log of seedLogs) {
          const yesAmount = (log as any).args.yesAmount ?? 0n;
          const noAmount = (log as any).args.noAmount ?? 0n;
          volume += yesAmount + noAmount;
        }
        
        // Fetch PositionPurchased
        const posLogs = await client.getLogs({
          address: marketAddress,
          event: PositionPurchasedEvent,
          fromBlock: start,
          toBlock: end,
        });
        
        for (const log of posLogs) {
          volume += (log as any).args.collateralIn ?? 0n;
          trades++;
        }
      }
    } catch (error) {
      // Ignore errors for individual markets
    }
    
    await sleep(50);
  }
  
  return { volume, trades, fees };
}

async function main(): Promise<void> {
  const summary = createSummary();
  
  logHeader("EVENT-BASED VERIFICATION");
  
  logInfo(`RPC: ${RPC_URL}`);
  logInfo(`Indexer: ${process.env.INDEXER_URL ?? "http://localhost:42069"}`);
  console.log();
  
  // Fetch indexer data
  logInfo("Fetching indexer data...");
  
  let indexerStats: PlatformStats;
  let indexerMarkets: Market[];
  
  try {
    const [statsData, marketsData] = await Promise.all([
      queryIndexer<{ platformStatss: { items: PlatformStats[] } }>(PLATFORM_STATS_QUERY),
      queryIndexer<{ marketss: { items: Market[] } }>(MARKETS_QUERY),
    ]);
    
    indexerStats = statsData.platformStatss.items[0];
    indexerMarkets = marketsData.marketss.items;
  } catch (error) {
    logError(`Failed to fetch indexer data: ${error}`);
    return;
  }
  
  console.log();
  console.log("📊 Indexer Stats:");
  console.log(`   Polls:   ${indexerStats.totalPolls}`);
  console.log(`   Markets: ${indexerStats.totalMarkets} (AMM: ${indexerStats.totalAmmMarkets}, Pari: ${indexerStats.totalPariMarkets})`);
  console.log(`   Trades:  ${indexerStats.totalTrades}`);
  console.log(`   Volume:  ${formatUSDC(BigInt(indexerStats.totalVolume))} USDC`);
  console.log(`   Fees:    ${formatUSDC(BigInt(indexerStats.totalFees))} USDC`);
  
  // Fetch on-chain events
  logHeader("ON-CHAIN EVENT COUNTS");
  
  // Poll events
  const pollLogs = await fetchAllEvents(
    CONTRACTS.oracle as Address,
    PollCreatedEvent,
    "PollCreated"
  );
  
  const pollMatch = compare("Polls", indexerStats.totalPolls, pollLogs.length);
  recordResult(summary, pollMatch.match, "polls count");
  
  // AMM Market events
  const ammLogs = await fetchAllEvents(
    CONTRACTS.marketFactory as Address,
    MarketCreatedEvent,
    "MarketCreated"
  );
  
  const ammMatch = compare("AMM Markets", indexerStats.totalAmmMarkets, ammLogs.length);
  recordResult(summary, ammMatch.match, "AMM markets count");
  
  // PariMutuel Market events
  const pariLogs = await fetchAllEvents(
    CONTRACTS.marketFactory as Address,
    PariMutuelCreatedEvent,
    "PariMutuelCreated"
  );
  
  const pariMatch = compare("Pari Markets", indexerStats.totalPariMarkets, pariLogs.length);
  recordResult(summary, pariMatch.match, "Pari markets count");
  
  // Total markets
  const totalOnChainMarkets = ammLogs.length + pariLogs.length;
  const marketsMatch = compare("Total Markets", indexerStats.totalMarkets, totalOnChainMarkets);
  recordResult(summary, marketsMatch.match, "total markets count");
  
  // Verify sample market volumes
  logHeader("SAMPLE MARKET VOLUME VERIFICATION");
  
  // Get top markets by volume
  const sortedMarkets = [...indexerMarkets]
    .sort((a, b) => Number(BigInt(b.totalVolume) - BigInt(a.totalVolume)))
    .slice(0, 5);
  
  logInfo(`Verifying top ${sortedMarkets.length} markets by volume...`);
  
  let totalIndexerVolume = 0n;
  let totalOnchainVolume = 0n;
  let totalIndexerTrades = 0;
  let totalOnchainTrades = 0;
  
  for (const market of sortedMarkets) {
    const marketType = market.marketType as "amm" | "pari";
    const indexerVolume = BigInt(market.totalVolume);
    
    console.log(`\n📈 ${market.id.substring(0, 10)}... (${marketType.toUpperCase()})`);
    console.log(`   Indexer: ${formatUSDC(indexerVolume)} USDC, ${market.totalTrades} trades`);
    
    const onchain = await fetchMarketTradingEvents(market.id as Address, marketType);
    
    console.log(`   On-chain: ${formatUSDC(onchain.volume)} USDC, ${onchain.trades} trades`);
    
    const volumeDiff = indexerVolume > onchain.volume 
      ? indexerVolume - onchain.volume 
      : onchain.volume - indexerVolume;
    
    if (volumeDiff > 0n) {
      const percentDiff = onchain.volume > 0n 
        ? Number(volumeDiff * 10000n / onchain.volume) / 100 
        : 100;
      
      if (percentDiff > 1) {
        logWarning(`Volume diff: ${formatUSDC(volumeDiff)} USDC (${percentDiff.toFixed(2)}%)`);
        summary.warnings++;
      } else {
        logSuccess(`Volume within tolerance`);
      }
    } else {
      logSuccess(`Volume exact match`);
    }
    
    totalIndexerVolume += indexerVolume;
    totalOnchainVolume += onchain.volume;
    totalIndexerTrades += market.totalTrades;
    totalOnchainTrades += onchain.trades;
  }
  
  // Summary
  logHeader("VOLUME SUMMARY (Sampled Markets)");
  
  console.log(`Indexer Total:  ${formatUSDC(totalIndexerVolume)} USDC (${totalIndexerTrades} trades)`);
  console.log(`On-chain Total: ${formatUSDC(totalOnchainVolume)} USDC (${totalOnchainTrades} trades)`);
  
  const overallVolumeDiff = totalIndexerVolume > totalOnchainVolume
    ? totalIndexerVolume - totalOnchainVolume
    : totalOnchainVolume - totalIndexerVolume;
  
  if (totalOnchainVolume > 0n) {
    const percentDiff = Number(overallVolumeDiff * 10000n / totalOnchainVolume) / 100;
    console.log(`Difference: ${formatUSDC(overallVolumeDiff)} USDC (${percentDiff.toFixed(2)}%)`);
    
    if (percentDiff <= 1) {
      logSuccess("Volume verification PASSED (within 1% tolerance)");
      recordResult(summary, true, "sample volume accuracy");
    } else {
      logWarning(`Volume differs by ${percentDiff.toFixed(2)}%`);
      recordResult(summary, false, "sample volume accuracy");
    }
  }
  
  // Print summary
  printSummary(summary);
}

// Run
const scriptPath = process.argv[1];
const isMainModule = import.meta.url.includes('verify-events');
if (isMainModule) {
  main().catch(console.error);
}

