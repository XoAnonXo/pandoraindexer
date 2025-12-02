/**
 * Verify Volume: Compare indexer volume with on-chain event data
 * 
 * This script fetches all trading events from the blockchain and
 * compares the summed volume against what the indexer reports.
 * 
 * Volume sources:
 * - AMM: BuyTokens.collateralAmount + SellTokens.collateralAmount + LiquidityAdded imbalance
 * - PariMutuel: SeedInitialLiquidity + PositionPurchased.collateralIn
 */

import { type Address, parseAbiItem, formatUnits } from "viem";
import {
  client,
  queryIndexer,
  logHeader,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  formatUSDC,
  compareBigInt,
  createSummary,
  recordResult,
  printSummary,
  sleep,
  type VerificationSummary,
} from "./utils.js";
import { CONTRACTS } from "./contracts.js";

// Start block for indexing
const START_BLOCK = 56_000_000n;

// GraphQL queries
const MARKETS_QUERY = `
  query GetMarkets {
    marketss(limit: 1000, orderBy: "createdAt", orderDirection: "desc") {
      items {
        id
        marketType
        totalVolume
        totalTrades
        createdAtBlock
      }
    }
  }
`;

const PLATFORM_STATS_QUERY = `
  query GetPlatformStats {
    platformStatss(limit: 1) {
      items {
        id
        chainId
        totalVolume
        totalTrades
        totalFees
        totalMarkets
        totalAmmMarkets
        totalPariMarkets
      }
    }
  }
`;

const TRADES_QUERY = `
  query GetTrades($limit: Int) {
    tradess(limit: $limit, orderBy: "timestamp", orderDirection: "desc") {
      items {
        id
        marketAddress
        tradeType
        collateralAmount
        feeAmount
        timestamp
      }
    }
  }
`;

interface IndexerMarket {
  id: string;
  marketType: "amm" | "pari";
  totalVolume: string;
  totalTrades: number;
  createdAtBlock: string;
}

interface IndexerPlatformStats {
  id: string;
  chainId: number;
  totalVolume: string;
  totalTrades: number;
  totalFees: string;
  totalMarkets: number;
  totalAmmMarkets: number;
  totalPariMarkets: number;
}

interface IndexerTrade {
  id: string;
  marketAddress: string;
  tradeType: string;
  collateralAmount: string;
  feeAmount: string;
  timestamp: string;
}

// Event ABIs
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

/**
 * Fetch AMM volume from on-chain events for a specific market
 * Includes LiquidityAdded imbalance as volume
 */
async function fetchAMMVolumeFromEvents(
  marketAddress: Address,
  fromBlock: bigint
): Promise<{ volume: bigint; trades: number; fees: bigint }> {
  let volume = 0n;
  let trades = 0;
  let fees = 0n;
  
  const toBlock = await client.getBlockNumber();
  const blockRange = 50000n; // Process in chunks
  
  for (let start = fromBlock; start <= toBlock; start += blockRange) {
    const end = start + blockRange > toBlock ? toBlock : start + blockRange;
    
    // Fetch BuyTokens events
    const buyLogs = await client.getLogs({
      address: marketAddress,
      event: BuyTokensEvent,
      fromBlock: start,
      toBlock: end,
    });
    
    for (const log of buyLogs) {
      volume += log.args.collateralAmount ?? 0n;
      fees += log.args.fee ?? 0n;
      trades++;
    }
    
    // Fetch SellTokens events
    const sellLogs = await client.getLogs({
      address: marketAddress,
      event: SellTokensEvent,
      fromBlock: start,
      toBlock: end,
    });
    
    for (const log of sellLogs) {
      volume += log.args.collateralAmount ?? 0n;
      fees += log.args.fee ?? 0n;
      trades++;
    }
    
    // Fetch LiquidityAdded events (imbalance counts as volume)
    const liquidityLogs = await client.getLogs({
      address: marketAddress,
      event: LiquidityAddedEvent,
      fromBlock: start,
      toBlock: end,
    });
    
    for (const log of liquidityLogs) {
      const amounts = log.args.amounts;
      if (amounts) {
        const imbalance = (amounts.yesToReturn ?? 0n) + (amounts.noToReturn ?? 0n);
        volume += imbalance;
      }
    }
    
    await sleep(50); // Rate limit
  }
  
  return { volume, trades, fees };
}

/**
 * Fetch PariMutuel volume from on-chain events for a specific market
 * NOTE: SeedInitialLiquidity IS counted as volume
 */
async function fetchPariVolumeFromEvents(
  marketAddress: Address,
  fromBlock: bigint
): Promise<{ volume: bigint; trades: number }> {
  let volume = 0n;
  let trades = 0;
  
  const toBlock = await client.getBlockNumber();
  const blockRange = 50000n;
  
  for (let start = fromBlock; start <= toBlock; start += blockRange) {
    const end = start + blockRange > toBlock ? toBlock : start + blockRange;
    
    // Fetch SeedInitialLiquidity events (counts as volume)
    const seedLogs = await client.getLogs({
      address: marketAddress,
      event: SeedInitialLiquidityEvent,
      fromBlock: start,
      toBlock: end,
    });
    
    for (const log of seedLogs) {
      const yesAmount = log.args.yesAmount ?? 0n;
      const noAmount = log.args.noAmount ?? 0n;
      volume += yesAmount + noAmount;
    }
    
    // Fetch PositionPurchased events
    const posLogs = await client.getLogs({
      address: marketAddress,
      event: PositionPurchasedEvent,
      fromBlock: start,
      toBlock: end,
    });
    
    for (const log of posLogs) {
      volume += log.args.collateralIn ?? 0n;
      trades++;
    }
    
    await sleep(50);
  }
  
  return { volume, trades };
}

/**
 * Verify volume for a single market
 */
async function verifyMarketVolume(
  market: IndexerMarket,
  summary: VerificationSummary
): Promise<{ indexerVolume: bigint; onchainVolume: bigint }> {
  const marketAddress = market.id as Address;
  const fromBlock = BigInt(market.createdAtBlock);
  const indexerVolume = BigInt(market.totalVolume);
  
  console.log(`\n📈 Market: ${marketAddress} (${market.marketType.toUpperCase()})`);
  console.log(`   Created at block: ${market.createdAtBlock}`);
  console.log(`   Indexer trades: ${market.totalTrades}`);
  
  let onchainData: { volume: bigint; trades: number };
  
  if (market.marketType === "amm") {
    onchainData = await fetchAMMVolumeFromEvents(marketAddress, fromBlock);
  } else {
    onchainData = await fetchPariVolumeFromEvents(marketAddress, fromBlock);
  }
  
  console.log(`   On-chain trades: ${onchainData.trades}`);
  
  // Compare volume
  const volumeMatch = compareBigInt(
    "Volume",
    indexerVolume,
    onchainData.volume,
    0.1 // 0.1% tolerance
  );
  recordResult(summary, volumeMatch.match, `${marketAddress}: volume`);
  
  // Compare trade count
  if (market.totalTrades !== onchainData.trades) {
    logWarning(`Trade count mismatch: indexer=${market.totalTrades}, onchain=${onchainData.trades}`);
    summary.warnings++;
  }
  
  return { indexerVolume, onchainVolume: onchainData.volume };
}

/**
 * Verify total platform volume by summing all market volumes
 */
async function verifyTotalVolume(
  markets: IndexerMarket[],
  platformStats: IndexerPlatformStats,
  summary: VerificationSummary
): Promise<void> {
  logHeader("TOTAL VOLUME VERIFICATION");
  
  const indexerTotalVolume = BigInt(platformStats.totalVolume);
  
  // Sum volumes from all markets (from indexer)
  let summedMarketVolume = 0n;
  for (const market of markets) {
    summedMarketVolume += BigInt(market.totalVolume);
  }
  
  console.log(`Platform totalVolume: ${formatUSDC(indexerTotalVolume)} USDC`);
  console.log(`Sum of market volumes: ${formatUSDC(summedMarketVolume)} USDC`);
  
  // These should match
  const sumMatch = compareBigInt(
    "Platform vs Sum of Markets",
    indexerTotalVolume,
    summedMarketVolume,
    0.01 // 0.01% tolerance
  );
  recordResult(summary, sumMatch.match, "Platform totalVolume vs market sum");
}

/**
 * Main verification function
 */
export async function verifyVolume(): Promise<VerificationSummary> {
  logHeader("VOLUME VERIFICATION");
  
  const summary = createSummary();
  
  // Fetch data from indexer
  logInfo("Fetching data from indexer...");
  
  let markets: IndexerMarket[] = [];
  let platformStats: IndexerPlatformStats | null = null;
  
  try {
    const [marketsData, statsData] = await Promise.all([
      queryIndexer<{ marketss: { items: IndexerMarket[] } }>(MARKETS_QUERY),
      queryIndexer<{ platformStatss: { items: IndexerPlatformStats[] } }>(PLATFORM_STATS_QUERY),
    ]);
    
    markets = marketsData.marketss.items;
    platformStats = statsData.platformStatss.items[0] ?? null;
  } catch (error) {
    logError(`Failed to fetch from indexer: ${error}`);
    return summary;
  }
  
  if (!platformStats) {
    logError("No platform stats found");
    return summary;
  }
  
  logInfo(`Found ${markets.length} markets`);
  logInfo(`Platform stats: ${formatUSDC(BigInt(platformStats.totalVolume))} USDC total volume`);
  
  // First verify sum consistency
  await verifyTotalVolume(markets, platformStats, summary);
  
  // Select sample markets to verify against on-chain
  logHeader("INDIVIDUAL MARKET VOLUME VERIFICATION");
  logInfo("Verifying sample markets against on-chain events...");
  
  // Get markets with most volume for verification
  const sortedMarkets = [...markets].sort(
    (a, b) => Number(BigInt(b.totalVolume) - BigInt(a.totalVolume))
  );
  
  const marketsToVerify = sortedMarkets.slice(0, 10); // Top 10 by volume
  
  let totalIndexerVolume = 0n;
  let totalOnchainVolume = 0n;
  
  for (const market of marketsToVerify) {
    try {
      const { indexerVolume, onchainVolume } = await verifyMarketVolume(market, summary);
      totalIndexerVolume += indexerVolume;
      totalOnchainVolume += onchainVolume;
    } catch (error) {
      logError(`Failed to verify market ${market.id}: ${error}`);
    }
  }
  
  // Summary of verified markets
  logHeader("VERIFIED MARKETS SUMMARY");
  console.log(`Total verified indexer volume: ${formatUSDC(totalIndexerVolume)} USDC`);
  console.log(`Total verified on-chain volume: ${formatUSDC(totalOnchainVolume)} USDC`);
  
  if (totalOnchainVolume > 0n) {
    const diff = totalIndexerVolume > totalOnchainVolume
      ? totalIndexerVolume - totalOnchainVolume
      : totalOnchainVolume - totalIndexerVolume;
    const percentDiff = Number(diff * 10000n / totalOnchainVolume) / 100;
    console.log(`Difference: ${formatUSDC(diff)} USDC (${percentDiff.toFixed(2)}%)`);
  }
  
  return summary;
}

// Run if called directly
const scriptPath = process.argv[1];
const isMainModule = import.meta.url.endsWith(scriptPath.split('/').pop()!) || 
                     import.meta.url.includes('verify-volume');
if (isMainModule) {
  verifyVolume()
    .then(printSummary)
    .catch(console.error);
}

