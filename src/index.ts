/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                    PONDER EVENT HANDLERS                                   ║
 * ║                    Anymarket Prediction Markets                            ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  This file processes all blockchain events and updates the database.       ║
 * ║  Each handler corresponds to a smart contract event from the ABIs.         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * HANDLER ORGANIZATION:
 * ─────────────────────
 * 1. HELPER FUNCTIONS     - Utility functions for common operations
 * 2. ORACLE HANDLERS      - Poll creation and management
 * 3. POLL HANDLERS        - Poll resolution events
 * 4. FACTORY HANDLERS     - Market deployment events
 * 5. AMM HANDLERS         - Trading and liquidity for AMM markets
 * 6. PARIMUTUEL HANDLERS  - Betting for pool-based markets
 * 
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                         VOLUME TRACKING RULES                               │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ Contract    │ Event              │ Volume?  │ Amount                        │
 * ├─────────────┼────────────────────┼──────────┼───────────────────────────────┤
 * │ AMM         │ BuyTokens          │ ✅ YES   │ collateralAmount              │
 * │ AMM         │ SellTokens         │ ✅ YES   │ collateralAmount              │
 * │ AMM         │ SwapTokens         │ ❌ NO    │ (no USDC movement)            │
 * │ AMM         │ LiquidityAdded     │ ⚠️ MAYBE │ yesToReturn + noToReturn      │
 * │ PariMutuel  │ SeedInitialLiquidity│ ✅ YES  │ yesAmount + noAmount          │
 * │ PariMutuel  │ PositionPurchased  │ ✅ YES   │ collateralIn                  │
 * └─────────────┴────────────────────┴──────────┴───────────────────────────────┘
 * 
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                           TVL TRACKING RULES                                │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ TVL = Actual USDC balance in market contracts                               │
 * │                                                                             │
 * │ INCREASES (+):                    │ DECREASES (-):                          │
 * │ • LiquidityAdded                  │ • LiquidityRemoved                      │
 * │ • BuyTokens                       │ • SellTokens                            │
 * │ • SeedInitialLiquidity            │ • WinningsRedeemed                      │
 * │ • PositionPurchased               │                                         │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * 
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                       REALIZED PnL FORMULA                                  │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │                                                                             │
 * │   realizedPnL = (totalWithdrawn + totalWinnings) - totalDeposited           │
 * │                                                                             │
 * │   • totalDeposited:  Money IN via BuyTokens / PositionPurchased             │
 * │   • totalWithdrawn:  Money OUT via SellTokens (net of fees)                 │
 * │   • totalWinnings:   Money claimed via WinningsRedeemed                     │
 * │                                                                             │
 * │   NOTE: WinningsRedeemed only fires after:                                  │
 * │   1. Poll is resolved (status != 0)                                         │
 * │   2. 24-hour finalization period passed                                     │
 * │   3. No arbitration pending                                                 │
 * │   4. User actively calls redeem()                                           │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * 
 * @module src/index
 */

import { ponder } from "@/generated";
import { getChainName } from "../config";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Chain identification data passed through event handlers.
 * Extracted from the Ponder context for each event.
 */
interface ChainInfo {
  /** EIP-155 chain ID (e.g., 146 for Sonic) */
  chainId: number;
  /** Human-readable chain name (e.g., "Sonic") */
  chainName: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
// 
// Utility functions used across all event handlers.
// These handle common patterns like ID generation, timestamps, and lookups.
// =============================================================================

/**
 * Extract chain information from Ponder event context.
 * 
 * Every event handler needs to know which chain the event came from.
 * This function extracts the chainId and resolves the human-readable name.
 * 
 * @param {any} context - Ponder event context
 * @returns {ChainInfo} Chain identification data
 * 
 * @example
 * ponder.on("SomeEvent", async ({ event, context }) => {
 *   const chain = getChainInfo(context);
 *   console.log(`Event on ${chain.chainName} (${chain.chainId})`);
 * });
 */
function getChainInfo(context: any): ChainInfo {
  const chainId = context.network.chainId;
  const chainName = getChainName(chainId);
  return { chainId, chainName };
}

/**
 * Calculate the day boundary timestamp (midnight UTC) for a given timestamp.
 * 
 * Used for grouping events into daily statistics buckets.
 * All timestamps in the same UTC day will return the same value.
 * 
 * @param {bigint} timestamp - Unix timestamp in seconds
 * @returns {bigint} Timestamp of midnight UTC for that day
 * 
 * @example
 * // All these return the same day timestamp:
 * getDayTimestamp(1733097600n); // 2024-12-02 00:00:00 UTC
 * getDayTimestamp(1733140800n); // 2024-12-02 12:00:00 UTC
 * getDayTimestamp(1733183999n); // 2024-12-02 23:59:59 UTC
 */
function getDayTimestamp(timestamp: bigint): bigint {
  // 86400 seconds = 24 hours
  const day = Number(timestamp) - (Number(timestamp) % 86400);
  return BigInt(day);
}

/**
 * Calculate the hour boundary timestamp for a given timestamp.
 * 
 * Used for grouping events into hourly statistics buckets.
 * All timestamps in the same hour will return the same value.
 * 
 * @param {bigint} timestamp - Unix timestamp in seconds
 * @returns {bigint} Timestamp of the start of that hour
 * 
 * @example
 * // All these return the same hour timestamp:
 * getHourTimestamp(1733097600n); // 2024-12-02 00:00:00 UTC
 * getHourTimestamp(1733099400n); // 2024-12-02 00:30:00 UTC
 * getHourTimestamp(1733101199n); // 2024-12-02 00:59:59 UTC
 */
function getHourTimestamp(timestamp: bigint): bigint {
  // 3600 seconds = 1 hour
  const hour = Number(timestamp) - (Number(timestamp) % 3600);
  return BigInt(hour);
}

/**
 * Check if a trader is new to a specific market.
 * 
 * Used to increment the market's uniqueTraders count only on first trade.
 * Queries the trades table to see if this trader has traded on this market before.
 * 
 * @param {any} context - Ponder database context
 * @param {`0x${string}`} marketAddress - Market contract address
 * @param {`0x${string}`} traderAddress - Trader wallet address
 * @param {ChainInfo} chain - Chain information
 * @returns {Promise<boolean>} True if trader has no previous trades on this market
 * 
 * @example
 * const isNew = await isNewTraderForMarket(context, marketAddr, trader, chain);
 * if (isNew) {
 *   market.uniqueTraders += 1;
 * }
 */
async function isNewTraderForMarket(
  context: any,
  marketAddress: `0x${string}`,
  traderAddress: `0x${string}`,
  chain: ChainInfo
): Promise<boolean> {
  // Query existing trades for this trader on this market
  // We only need to know if ANY exist, so limit to 1
  const existingTrades = await context.db.trades.findMany({
    where: {
      marketAddress: marketAddress,
      trader: traderAddress.toLowerCase(),
      chainId: chain.chainId,
    },
    limit: 1,
  });
  
  return existingTrades.items.length === 0;
}

/**
 * Generate a composite ID string for records that need chain-scoping.
 * 
 * Multi-chain support requires unique IDs across chains. This function
 * creates deterministic IDs by joining the chainId with other components.
 * 
 * @param {number} chainId - Chain ID (first component)
 * @param {...(string | number | bigint)} parts - Additional ID components
 * @returns {string} Hyphen-separated composite ID
 * 
 * @example
 * // Trade ID: "146-0x1234...-0"
 * makeId(chain.chainId, txHash, logIndex);
 * 
 * // User ID: "146-0xuser..."
 * makeId(chain.chainId, userAddress);
 * 
 * // Daily stats ID: "146-1733097600"
 * makeId(chain.chainId, dayTimestamp.toString());
 */
function makeId(chainId: number, ...parts: (string | number | bigint)[]): string {
  return [chainId, ...parts].join("-");
}

// =============================================================================
// GET-OR-CREATE FUNCTIONS
// =============================================================================
// 
// These functions implement the "upsert" pattern for database records.
// They ensure records exist before updating them, creating with defaults if needed.
// 
// IMPORTANT: These are called frequently and should be optimized for read-heavy workloads.
// =============================================================================

/**
 * Get existing user record or create a new one with default values.
 * 
 * User records are per-chain, so the same wallet address on different
 * chains will have separate records with independent statistics.
 * 
 * @param {any} context - Ponder database context
 * @param {`0x${string}`} address - User wallet address
 * @param {ChainInfo} chain - Chain information
 * @returns {Promise<User>} Existing or newly created user record
 * 
 * @example
 * const user = await getOrCreateUser(context, traderAddress, chain);
 * // Now safe to increment user.totalTrades, etc.
 */
async function getOrCreateUser(context: any, address: `0x${string}`, chain: ChainInfo) {
  // Normalize address to lowercase for consistent storage
  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  const id = makeId(chain.chainId, normalizedAddress);
  
  // Try to fetch existing user
  let user = await context.db.users.findUnique({ id });
  
  // If not found, create with zero-initialized stats
  if (!user) {
    user = await context.db.users.create({
      id,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        address: normalizedAddress,
        // Trading stats start at zero
        totalTrades: 0,
        totalVolume: 0n,
        totalWinnings: 0n,
        totalDeposited: 0n,
        totalWithdrawn: 0n,
        realizedPnL: 0n,
        // Win/loss tracking
        totalWins: 0,
        totalLosses: 0,
        currentStreak: 0,
        bestStreak: 0,
        // Creator stats
        marketsCreated: 0,
        pollsCreated: 0,
        // Timestamps left null until first trade
      },
    });
  }
  
  return user;
}

/**
 * Get existing platform stats or create new record for a chain.
 * 
 * There is exactly ONE platformStats record per chain, with ID = chainId.
 * This provides global dashboard metrics for each supported chain.
 * 
 * @param {any} context - Ponder database context
 * @param {ChainInfo} chain - Chain information
 * @returns {Promise<PlatformStats>} Existing or newly created stats record
 * 
 * @example
 * const stats = await getOrCreatePlatformStats(context, chain);
 * stats.totalTrades += 1;
 * stats.totalVolume += tradeAmount;
 */
async function getOrCreatePlatformStats(context: any, chain: ChainInfo) {
  const id = chain.chainId.toString();
  let stats = await context.db.platformStats.findUnique({ id });
  
  // First event on this chain - initialize stats record
  if (!stats) {
    stats = await context.db.platformStats.create({
      id,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        // All counters start at zero
        totalPolls: 0,
        totalPollsResolved: 0,
        totalMarkets: 0,
        totalTrades: 0,
        totalUsers: 0,
        totalVolume: 0n,
        totalLiquidity: 0n,
        totalFees: 0n,
        totalWinningsPaid: 0n,
        totalAmmMarkets: 0,
        totalPariMarkets: 0,
        lastUpdatedAt: 0n,
      },
    });
  }
  
  return stats;
}

/**
 * Get existing daily stats record or create new one for a specific day.
 * 
 * Daily stats are bucketed by UTC midnight timestamp.
 * New records are created automatically when events occur on a new day.
 * 
 * @param {any} context - Ponder database context
 * @param {bigint} timestamp - Event timestamp (will be rounded to day)
 * @param {ChainInfo} chain - Chain information
 * @returns {Promise<DailyStats>} Existing or newly created daily record
 * 
 * @example
 * const daily = await getOrCreateDailyStats(context, event.block.timestamp, chain);
 * daily.tradesCount += 1;
 */
async function getOrCreateDailyStats(context: any, timestamp: bigint, chain: ChainInfo) {
  const dayTs = getDayTimestamp(timestamp);
  const id = makeId(chain.chainId, dayTs.toString());
  
  let daily = await context.db.dailyStats.findUnique({ id });
  
  // First event of this day - initialize daily stats
  if (!daily) {
    daily = await context.db.dailyStats.create({
      id,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        dayTimestamp: dayTs,
        pollsCreated: 0,
        marketsCreated: 0,
        tradesCount: 0,
        volume: 0n,
        winningsPaid: 0n,
        newUsers: 0,
        activeUsers: 0,
      },
    });
  }
  
  return daily;
}

/**
 * Get existing hourly stats record or create new one for a specific hour.
 * 
 * Hourly stats provide granular time-series data for charts and analytics.
 * Bucketed by hour timestamp (top of the hour).
 * 
 * @param {any} context - Ponder database context
 * @param {bigint} timestamp - Event timestamp (will be rounded to hour)
 * @param {ChainInfo} chain - Chain information
 * @returns {Promise<HourlyStats>} Existing or newly created hourly record
 */
async function getOrCreateHourlyStats(context: any, timestamp: bigint, chain: ChainInfo) {
  const hourTs = getHourTimestamp(timestamp);
  const id = makeId(chain.chainId, hourTs.toString());
  
  let hourly = await context.db.hourlyStats.findUnique({ id });
  
  // First event of this hour - initialize hourly stats
  if (!hourly) {
    hourly = await context.db.hourlyStats.create({
      id,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        hourTimestamp: hourTs,
        tradesCount: 0,
        volume: 0n,
        uniqueTraders: 0,
      },
    });
  }
  
  return hourly;
}

/**
 * Safely get or create a minimal market record with race condition handling.
 * 
 * RACE CONDITION PROBLEM:
 * ─────────────────────────
 * Sometimes trading events (BuyTokens, SeedInitialLiquidity) arrive BEFORE
 * the MarketCreated/PariMutuelCreated event due to block ordering or
 * parallel processing. This would cause errors when trying to update
 * a market that doesn't exist yet.
 * 
 * SOLUTION:
 * ─────────
 * Create a "minimal" market record with placeholder values. When the
 * actual MarketCreated event arrives, it will update this record with
 * the real data (poll address, creator, tokens, etc.).
 * 
 * The try/catch handles the case where two events try to create the
 * same market simultaneously (unique constraint violation).
 * 
 * @param {any} context - Ponder database context
 * @param {`0x${string}`} marketAddress - Market contract address
 * @param {ChainInfo} chain - Chain information
 * @param {"amm" | "pari"} marketType - Type of market
 * @param {bigint} timestamp - Event timestamp
 * @param {bigint} blockNumber - Block number
 * @returns {Promise<Market>} Existing or newly created market record
 */
async function getOrCreateMinimalMarket(
  context: any, 
  marketAddress: `0x${string}`, 
  chain: ChainInfo,
  marketType: "amm" | "pari",
  timestamp: bigint,
  blockNumber: bigint,
  txHash?: `0x${string}`
) {
  // Check if market already exists
  let market = await context.db.markets.findUnique({ id: marketAddress });
  
  if (!market) {
    try {
      // Create minimal record with placeholder values
      // These will be replaced when MarketCreated event is processed
      console.warn(`[${chain.chainName}] Creating minimal market record for ${marketAddress}`);
      market = await context.db.markets.create({
        id: marketAddress,
        data: {
          chainId: chain.chainId,
          chainName: chain.chainName,
          // Placeholder values - will be updated by MarketCreated handler
          pollAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
          creator: "0x0000000000000000000000000000000000000000" as `0x${string}`,
          marketType,
          collateralToken: "0x0000000000000000000000000000000000000000" as `0x${string}`,
          // Stats start at zero
          totalVolume: 0n,
          totalTrades: 0,
          currentTvl: 0n,
          uniqueTraders: 0,
          initialLiquidity: 0n,
          createdAtBlock: blockNumber,
          createdAt: timestamp,
          createdTxHash: txHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        },
      });
    } catch (e: any) {
      // Handle race condition: another handler created the market first
      if (e.message?.includes("unique constraint") || e.code === "P2002") {
        market = await context.db.markets.findUnique({ id: marketAddress });
        if (!market) {
          // This shouldn't happen, but throw if it does
          throw new Error(`Failed to get or create market ${marketAddress}: ${e.message}`);
        }
      } else {
        // Some other error - rethrow
        throw e;
      }
    }
  }
  
  return market;
}

// =============================================================================
// ██████╗ ██████╗  █████╗  ██████╗██╗     ███████╗    ██╗  ██╗ █████╗ ███╗   ██╗██████╗ ██╗     ███████╗██████╗ ███████╗
// ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██║     ██╔════╝    ██║  ██║██╔══██╗████╗  ██║██╔══██╗██║     ██╔════╝██╔══██╗██╔════╝
// ██║   ██║██████╔╝███████║██║     ██║     █████╗      ███████║███████║██╔██╗ ██║██║  ██║██║     █████╗  ██████╔╝███████╗
// ██║   ██║██╔══██╗██╔══██║██║     ██║     ██╔══╝      ██╔══██║██╔══██║██║╚██╗██║██║  ██║██║     ██╔══╝  ██╔══██╗╚════██║
// ╚██████╔╝██║  ██║██║  ██║╚██████╗███████╗███████╗    ██║  ██║██║  ██║██║ ╚████║██████╔╝███████╗███████╗██║  ██║███████║
//  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// =============================================================================
// 
// The Oracle contract is the entry point for creating prediction polls.
// These handlers track poll creation and poll refresh events.
// =============================================================================

/**
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ POLL CREATED EVENT                                                          │
 * │ Source: PredictionOracle contract                                           │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ Triggered when: A user calls Oracle.createPoll() to create a new prediction │
 * │                                                                             │
 * │ What this handler does:                                                     │
 * │ 1. Creates a new poll record in the database                                │
 * │ 2. Increments the creator's pollsCreated count                              │
 * │ 3. Updates platform-wide poll statistics                                    │
 * │ 4. Updates daily poll creation metrics                                      │
 * │                                                                             │
 * │ NOTE: Ponder uses this event as a FACTORY event to discover and start       │
 * │ indexing the dynamically deployed PredictionPoll contract.                  │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
ponder.on("PredictionOracle:PollCreated", async ({ event, context }) => {
  // Extract event arguments
  const { pollAddress, creator, deadlineEpoch, question } = event.args;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Create the poll record
  // ─────────────────────────────────────────────────────────────────────────────
  await context.db.polls.create({
    id: pollAddress,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      creator: creator.toLowerCase() as `0x${string}`,
      question,
      // These fields are not in the event - set defaults
      rules: "",
      sources: "[]",
      deadlineEpoch: Number(deadlineEpoch),
      finalizationEpoch: 0,
      checkEpoch: 0,
      category: 0,
      // Status 0 = Pending (not yet resolved)
      status: 0,
      createdAtBlock: event.block.number,
      createdAt: timestamp,
      createdTxHash: event.transaction.hash,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Update creator's user record
  // ─────────────────────────────────────────────────────────────────────────────
  const user = await getOrCreateUser(context, creator, chain);
  await context.db.users.update({
    id: makeId(chain.chainId, creator.toLowerCase()),
    data: {
      pollsCreated: user.pollsCreated + 1,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Update platform-wide statistics
  // ─────────────────────────────────────────────────────────────────────────────
  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalPolls: stats.totalPolls + 1,
      lastUpdatedAt: timestamp,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4: Update daily aggregated statistics
  // ─────────────────────────────────────────────────────────────────────────────
  const daily = await getOrCreateDailyStats(context, timestamp, chain);
  await context.db.dailyStats.update({
    id: makeId(chain.chainId, getDayTimestamp(timestamp).toString()),
    data: {
      pollsCreated: daily.pollsCreated + 1,
    },
  });

  console.log(`[${chain.chainName}] Poll created: ${pollAddress}`);
});

/**
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ POLL REFRESHED EVENT                                                        │
 * │ Source: PredictionOracle contract                                           │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ Triggered when: An operator refreshes a poll to extend its check epoch      │
 * │                                                                             │
 * │ What this handler does:                                                     │
 * │ - Updates the poll's checkEpoch to the new value                            │
 * │                                                                             │
 * │ Purpose: Allows operators to delay resolution if more time is needed        │
 * │ to verify the outcome of a prediction.                                      │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
ponder.on("PredictionOracle:PollRefreshed", async ({ event, context }) => {
  const { pollAddress, newCheckEpoch } = event.args;
  
  const poll = await context.db.polls.findUnique({ id: pollAddress });
  if (poll) {
    await context.db.polls.update({
      id: pollAddress,
      data: {
        checkEpoch: Number(newCheckEpoch),
      },
    });
  }
});

// =============================================================================
// ██████╗  ██████╗ ██╗     ██╗         ██╗  ██╗ █████╗ ███╗   ██╗██████╗ ██╗     ███████╗██████╗ ███████╗
// ██╔══██╗██╔═══██╗██║     ██║         ██║  ██║██╔══██╗████╗  ██║██╔══██╗██║     ██╔════╝██╔══██╗██╔════╝
// ██████╔╝██║   ██║██║     ██║         ███████║███████║██╔██╗ ██║██║  ██║██║     █████╗  ██████╔╝███████╗
// ██╔═══╝ ██║   ██║██║     ██║         ██╔══██║██╔══██║██║╚██╗██║██║  ██║██║     ██╔══╝  ██╔══██╗╚════██║
// ██║     ╚██████╔╝███████╗███████╗    ██║  ██║██║  ██║██║ ╚████║██████╔╝███████╗███████╗██║  ██║███████║
// ╚═╝      ╚═════╝ ╚══════╝╚══════╝    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// =============================================================================
// 
// These handlers are for DYNAMICALLY created PredictionPoll contracts.
// Ponder discovers these contracts via the factory pattern (PollCreated event).
// =============================================================================

/**
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ ANSWER SET EVENT - POLL RESOLUTION                                          │
 * │ Source: PredictionPoll contract (dynamic)                                   │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ Triggered when: An operator resolves a poll by calling setAnswer()          │
 * │                                                                             │
 * │ Status values:                                                              │
 * │   0 = Pending (should not fire with this value)                             │
 * │   1 = YES - The YES outcome is correct                                      │
 * │   2 = NO - The NO outcome is correct                                        │
 * │   3 = Unknown - Market is voided, refunds issued                            │
 * │                                                                             │
 * │ What this handler does:                                                     │
 * │ 1. Updates the poll's status, resolution reason, and timestamp              │
 * │ 2. Increments the platform's totalPollsResolved counter                     │
 * │                                                                             │
 * │ IMPACT: After resolution + 24h finalization period, users can               │
 * │ call WinningsRedeemed on linked markets to claim payouts.                   │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
ponder.on("PredictionPoll:AnswerSet", async ({ event, context }) => {
  const { status, reason } = event.args;
  // Note: For dynamic contracts, the address is in event.log.address
  const pollAddress = event.log.address;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Update the poll record with resolution data
  // ─────────────────────────────────────────────────────────────────────────────
  const poll = await context.db.polls.findUnique({ id: pollAddress });
  if (poll) {
    await context.db.polls.update({
      id: pollAddress,
      data: {
        status: Number(status),           // 1=Yes, 2=No, 3=Unknown
        resolutionReason: reason,         // Human-readable explanation
        resolvedAt: timestamp,            // When it was resolved
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Update platform statistics
  // ─────────────────────────────────────────────────────────────────────────────
  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalPollsResolved: stats.totalPollsResolved + 1,
      lastUpdatedAt: timestamp,
    },
  });

  console.log(`[${chain.chainName}] Poll resolved: ${pollAddress} -> status ${status}`);
});

// =============================================================================
// ███████╗ █████╗  ██████╗████████╗ ██████╗ ██████╗ ██╗   ██╗    ██╗  ██╗ █████╗ ███╗   ██╗██████╗ ██╗     ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗╚██╗ ██╔╝    ██║  ██║██╔══██╗████╗  ██║██╔══██╗██║     ██╔════╝██╔══██╗██╔════╝
// █████╗  ███████║██║        ██║   ██║   ██║██████╔╝ ╚████╔╝     ███████║███████║██╔██╗ ██║██║  ██║██║     █████╗  ██████╔╝███████╗
// ██╔══╝  ██╔══██║██║        ██║   ██║   ██║██╔══██╗  ╚██╔╝      ██╔══██║██╔══██║██║╚██╗██║██║  ██║██║     ██╔══╝  ██╔══██╗╚════██║
// ██║     ██║  ██║╚██████╗   ██║   ╚██████╔╝██║  ██║   ██║       ██║  ██║██║  ██║██║ ╚████║██████╔╝███████╗███████╗██║  ██║███████║
// ╚═╝     ╚═╝  ╚═╝ ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝   ╚═╝       ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// =============================================================================
// 
// The MarketFactory deploys trading markets for prediction polls.
// Each poll can have ONE market - either AMM or PariMutuel type.
// These are FACTORY events that Ponder uses to discover dynamic contracts.
// =============================================================================

/**
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ MARKET CREATED EVENT - AMM Market Deployment                                │
 * │ Source: MarketFactory contract                                              │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ Triggered when: User calls createMarket() to deploy an AMM market           │
 * │                                                                             │
 * │ What this handler does:                                                     │
 * │ 1. Creates or updates the market record with AMM-specific data              │
 * │ 2. Increments creator's marketsCreated count                                │
 * │ 3. Updates platform market counters (total + AMM-specific)                  │
 * │ 4. Updates daily market creation metrics                                    │
 * │                                                                             │
 * │ RACE CONDITION HANDLING:                                                    │
 * │ Sometimes trading events arrive BEFORE this event. We check if a minimal    │
 * │ market record exists and update it rather than failing.                     │
 * │                                                                             │
 * │ FACTORY PATTERN: Ponder uses this event to discover and start indexing      │
 * │ the dynamically deployed PredictionAMM contract.                            │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
ponder.on("MarketFactory:MarketCreated", async ({ event, context }) => {
  // Extract all event arguments
  const { 
    pollAddress, 
    marketAddress, 
    creator, 
    yesToken, 
    noToken, 
    collateral, 
    feeTier,
    maxPriceImbalancePerHour,
  } = event.args;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Create or update market record
  // Handle race condition where trading events may have created a minimal record
  // ─────────────────────────────────────────────────────────────────────────────
  const existingMarket = await context.db.markets.findUnique({ id: marketAddress });
  
  if (existingMarket) {
    // Market record exists (created by racing trading event)
    // Update with full data, preserving any accumulated stats
    await context.db.markets.update({
      id: marketAddress,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        // Link to poll
        pollAddress,
        creator: creator.toLowerCase() as `0x${string}`,
        marketType: "amm",
        // Tokens and configuration
        collateralToken: collateral,
        yesToken,
        noToken,
        feeTier: Number(feeTier),
        maxPriceImbalancePerHour: Number(maxPriceImbalancePerHour),
        // PRESERVE existing stats from racing events
        totalVolume: existingMarket.totalVolume,
        totalTrades: existingMarket.totalTrades,
        currentTvl: existingMarket.currentTvl,
        uniqueTraders: existingMarket.uniqueTraders,
        initialLiquidity: existingMarket.initialLiquidity ?? 0n,
        reserveYes: existingMarket.reserveYes ?? 0n,
        reserveNo: existingMarket.reserveNo ?? 0n,
        // Update creation metadata
        createdAtBlock: event.block.number,
        createdAt: timestamp,
        createdTxHash: event.transaction.hash,
      },
    });
  } else {
    // No existing record - create fresh with zero stats
    await context.db.markets.create({
      id: marketAddress,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        pollAddress,
        creator: creator.toLowerCase() as `0x${string}`,
        marketType: "amm",
        collateralToken: collateral,
        yesToken,
        noToken,
        feeTier: Number(feeTier),
        maxPriceImbalancePerHour: Number(maxPriceImbalancePerHour),
        // Initialize stats at zero
        totalVolume: 0n,
        totalTrades: 0,
        currentTvl: 0n,
        uniqueTraders: 0,
        initialLiquidity: 0n,
        reserveYes: 0n,
        reserveNo: 0n,
        createdAtBlock: event.block.number,
        createdAt: timestamp,
        createdTxHash: event.transaction.hash,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Update creator's user statistics
  // ─────────────────────────────────────────────────────────────────────────────
  const user = await getOrCreateUser(context, creator, chain);
  await context.db.users.update({
    id: makeId(chain.chainId, creator.toLowerCase()),
    data: {
      marketsCreated: user.marketsCreated + 1,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Update platform-wide statistics
  // ─────────────────────────────────────────────────────────────────────────────
  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalMarkets: stats.totalMarkets + 1,
      totalAmmMarkets: stats.totalAmmMarkets + 1,
      lastUpdatedAt: timestamp,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4: Update daily aggregated statistics
  // ─────────────────────────────────────────────────────────────────────────────
  const daily = await getOrCreateDailyStats(context, timestamp, chain);
  await context.db.dailyStats.update({
    id: makeId(chain.chainId, getDayTimestamp(timestamp).toString()),
    data: {
      marketsCreated: daily.marketsCreated + 1,
    },
  });

  console.log(`[${chain.chainName}] AMM market created: ${marketAddress}`);
});

/**
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ PARI-MUTUEL CREATED EVENT - Pool Market Deployment                          │
 * │ Source: MarketFactory contract                                              │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ Triggered when: User calls createPariMutuel() to deploy a pool-based market │
 * │                                                                             │
 * │ What this handler does:                                                     │
 * │ 1. Creates or updates market record with PariMutuel-specific data           │
 * │ 2. Increments creator's marketsCreated count                                │
 * │ 3. Updates platform market counters (total + pari-specific)                 │
 * │ 4. Updates daily market creation metrics                                    │
 * │                                                                             │
 * │ PariMutuel Configuration:                                                   │
 * │ - curveFlattener: Affects the odds curve steepness                          │
 * │ - curveOffset: Initial odds offset                                          │
 * │                                                                             │
 * │ FACTORY PATTERN: Ponder uses this event to discover and start indexing      │
 * │ the dynamically deployed PredictionPariMutuel contract.                     │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
ponder.on("MarketFactory:PariMutuelCreated", async ({ event, context }) => {
  // Extract event arguments
  const { 
    pollAddress, 
    marketAddress, 
    creator, 
    collateral,
    curveFlattener,
    curveOffset,
  } = event.args;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Create or update market record
  // Handle race condition where SeedInitialLiquidity may arrive first
  // ─────────────────────────────────────────────────────────────────────────────
  const existingMarket = await context.db.markets.findUnique({ id: marketAddress });
  
  if (existingMarket) {
    // Market record exists - update with full data, preserve stats
    await context.db.markets.update({
      id: marketAddress,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        pollAddress,
        creator: creator.toLowerCase() as `0x${string}`,
        marketType: "pari",
        collateralToken: collateral,
        // PariMutuel-specific configuration
        curveFlattener: Number(curveFlattener),
        curveOffset: Number(curveOffset),
        // PRESERVE existing stats from racing events
        totalVolume: existingMarket.totalVolume,
        totalTrades: existingMarket.totalTrades,
        currentTvl: existingMarket.currentTvl,
        uniqueTraders: existingMarket.uniqueTraders,
        initialLiquidity: existingMarket.initialLiquidity ?? 0n,
        createdAtBlock: event.block.number,
        createdAt: timestamp,
        createdTxHash: event.transaction.hash,
      },
    });
  } else {
    // Create fresh record
    await context.db.markets.create({
      id: marketAddress,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        pollAddress,
        creator: creator.toLowerCase() as `0x${string}`,
        marketType: "pari",
        collateralToken: collateral,
        curveFlattener: Number(curveFlattener),
        curveOffset: Number(curveOffset),
        // Initialize stats at zero
        totalVolume: 0n,
        totalTrades: 0,
        currentTvl: 0n,
        uniqueTraders: 0,
        initialLiquidity: 0n,
        createdAtBlock: event.block.number,
        createdAt: timestamp,
        createdTxHash: event.transaction.hash,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Update creator's user statistics
  // ─────────────────────────────────────────────────────────────────────────────
  const user = await getOrCreateUser(context, creator, chain);
  await context.db.users.update({
    id: makeId(chain.chainId, creator.toLowerCase()),
    data: {
      marketsCreated: user.marketsCreated + 1,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Update platform-wide statistics
  // ─────────────────────────────────────────────────────────────────────────────
  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalMarkets: stats.totalMarkets + 1,
      totalPariMarkets: stats.totalPariMarkets + 1,
      lastUpdatedAt: timestamp,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4: Update daily aggregated statistics
  // ─────────────────────────────────────────────────────────────────────────────
  const daily = await getOrCreateDailyStats(context, timestamp, chain);
  await context.db.dailyStats.update({
    id: makeId(chain.chainId, getDayTimestamp(timestamp).toString()),
    data: {
      marketsCreated: daily.marketsCreated + 1,
    },
  });

  console.log(`[${chain.chainName}] PariMutuel market created: ${marketAddress}`);
});

// =============================================================================
//  █████╗ ███╗   ███╗███╗   ███╗    ██╗  ██╗ █████╗ ███╗   ██╗██████╗ ██╗     ███████╗██████╗ ███████╗
// ██╔══██╗████╗ ████║████╗ ████║    ██║  ██║██╔══██╗████╗  ██║██╔══██╗██║     ██╔════╝██╔══██╗██╔════╝
// ███████║██╔████╔██║██╔████╔██║    ███████║███████║██╔██╗ ██║██║  ██║██║     █████╗  ██████╔╝███████╗
// ██╔══██║██║╚██╔╝██║██║╚██╔╝██║    ██╔══██║██╔══██║██║╚██╗██║██║  ██║██║     ██╔══╝  ██╔══██╗╚════██║
// ██║  ██║██║ ╚═╝ ██║██║ ╚═╝ ██║    ██║  ██║██║  ██║██║ ╚████║██████╔╝███████╗███████╗██║  ██║███████║
// ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝     ╚═╝    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// =============================================================================
// 
// AMM (Automated Market Maker) handlers for trading events.
// These handle buy/sell/swap operations on dynamically deployed PredictionAMM contracts.
// 
// IMPORTANT: Volume and TVL must be updated consistently across:
// - Individual market record
// - Platform-wide statistics
// - Daily/hourly aggregations
// =============================================================================

/**
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ BUY TOKENS EVENT - User Purchases YES or NO Tokens                          │
 * │ Source: PredictionAMM contract (dynamic)                                    │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ Triggered when: Trader calls buy() to purchase outcome tokens               │
 * │                                                                             │
 * │ MONEY FLOW:                                                                 │
 * │   Trader → [USDC] → Market Contract → [YES/NO Tokens] → Trader              │
 * │                                                                             │
 * │ VOLUME: ✅ collateralAmount counts as trading volume                        │
 * │ TVL: ➕ increases by collateralAmount (USDC enters the contract)            │
 * │ PnL: Updates user's totalDeposited (money at risk)                          │
 * │                                                                             │
 * │ What this handler does:                                                     │
 * │ 1. Creates a trade record for this transaction                              │
 * │ 2. Updates trader's statistics (trades, volume, deposits)                   │
 * │ 3. Updates market statistics (volume, TVL, unique traders)                  │
 * │ 4. Updates platform-wide statistics                                         │
 * │ 5. Updates time-series statistics (daily, hourly)                           │
 * │                                                                             │
 * │ CONSISTENCY RULE: Market and platform stats must ALWAYS be updated          │
 * │ together to prevent discrepancies in totals.                                │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
ponder.on("PredictionAMM:BuyTokens", async ({ event, context }) => {
  // Extract event data
  const { trader, isYes, tokenAmount, collateralAmount, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;  // Dynamic contract address
  const chain = getChainInfo(context);
  
  // Generate unique trade ID: chainId-txHash-logIndex
  const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Ensure market record exists (handle racing with MarketCreated)
  // ─────────────────────────────────────────────────────────────────────────────
  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "amm", timestamp, event.block.number, event.transaction.hash);
  const pollAddress = market.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Create trade record
  // ─────────────────────────────────────────────────────────────────────────────
  await context.db.trades.create({
    id: tradeId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: trader.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      tradeType: "buy",
      side: isYes ? "yes" : "no",    // Which outcome they're betting on
      collateralAmount,               // USDC spent
      tokenAmount,                    // Outcome tokens received
      feeAmount: fee,                 // Trading fee paid
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Update trader's user statistics
  // ─────────────────────────────────────────────────────────────────────────────
  const user = await getOrCreateUser(context, trader, chain);
  const isNewUser = user.totalTrades === 0;  // First trade ever on this chain?
  
  // Check if first trade on THIS market (for unique traders count)
  const isNewTrader = await isNewTraderForMarket(context, marketAddress, trader, chain);
  
  await context.db.users.update({
    id: makeId(chain.chainId, trader.toLowerCase()),
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralAmount,
      totalDeposited: user.totalDeposited + collateralAmount,  // Track money at risk
      firstTradeAt: user.firstTradeAt ?? timestamp,  // Only set on first trade
      lastTradeAt: timestamp,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4: Update market statistics
  // TVL INCREASES: Collateral flows INTO the market contract
  // ─────────────────────────────────────────────────────────────────────────────
  await context.db.markets.update({
    id: marketAddress,
    data: {
      totalVolume: market.totalVolume + collateralAmount,
      totalTrades: market.totalTrades + 1,
      currentTvl: market.currentTvl + collateralAmount,  // +TVL
      uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 5: Update platform-wide statistics
  // MUST stay in sync with market updates
  // ─────────────────────────────────────────────────────────────────────────────
  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalTrades: stats.totalTrades + 1,
      totalVolume: stats.totalVolume + collateralAmount,
      totalLiquidity: stats.totalLiquidity + collateralAmount,  // +TVL
      totalFees: stats.totalFees + fee,
      totalUsers: isNewUser ? stats.totalUsers + 1 : stats.totalUsers,
      lastUpdatedAt: timestamp,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 6: Update time-series aggregations
  // ─────────────────────────────────────────────────────────────────────────────
  const daily = await getOrCreateDailyStats(context, timestamp, chain);
  await context.db.dailyStats.update({
    id: makeId(chain.chainId, getDayTimestamp(timestamp).toString()),
    data: {
      tradesCount: daily.tradesCount + 1,
      volume: daily.volume + collateralAmount,
      newUsers: isNewUser ? daily.newUsers + 1 : daily.newUsers,
    },
  });

  const hourly = await getOrCreateHourlyStats(context, timestamp, chain);
  await context.db.hourlyStats.update({
    id: makeId(chain.chainId, getHourTimestamp(timestamp).toString()),
    data: {
      tradesCount: hourly.tradesCount + 1,
      volume: hourly.volume + collateralAmount,
    },
  });
});

/**
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ SELL TOKENS EVENT - User Sells YES or NO Tokens                             │
 * │ Source: PredictionAMM contract (dynamic)                                    │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ Triggered when: Trader calls sell() to sell their outcome tokens            │
 * │                                                                             │
 * │ MONEY FLOW:                                                                 │
 * │   Trader → [YES/NO Tokens] → Market Contract → [USDC] → Trader              │
 * │                                                                             │
 * │ VOLUME: ✅ collateralAmount counts as trading volume                        │
 * │ TVL: ➖ decreases by collateralAmount (USDC leaves the contract)            │
 * │ PnL: Updates user's totalWithdrawn and realizedPnL                          │
 * │                                                                             │
 * │ REALIZED PnL CALCULATION:                                                   │
 * │ ──────────────────────────                                                  │
 * │   netProceeds = collateralAmount - fee                                      │
 * │   totalWithdrawn += netProceeds                                             │
 * │   realizedPnL = (totalWithdrawn + totalWinnings) - totalDeposited           │
 * │                                                                             │
 * │ This tracks REALIZED profit - actual money received, not paper gains.       │
 * │ Selling at a profit increases realizedPnL, selling at a loss decreases it.  │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
ponder.on("PredictionAMM:SellTokens", async ({ event, context }) => {
  const { trader, isYes, tokenAmount, collateralAmount, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Ensure market record exists
  // ─────────────────────────────────────────────────────────────────────────────
  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "amm", timestamp, event.block.number, event.transaction.hash);
  const pollAddress = market.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Create trade record
  // ─────────────────────────────────────────────────────────────────────────────
  await context.db.trades.create({
    id: tradeId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: trader.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      tradeType: "sell",
      side: isYes ? "yes" : "no",
      collateralAmount,               // USDC received (before fees)
      tokenAmount,                    // Outcome tokens sold
      feeAmount: fee,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Update trader's user statistics with PnL calculation
  // ─────────────────────────────────────────────────────────────────────────────
  const user = await getOrCreateUser(context, trader, chain);
  const isNewTrader = await isNewTraderForMarket(context, marketAddress, trader, chain);
  
  // Calculate net proceeds (what trader actually receives after fee)
  // This is the realized exit - money taken out of markets
  const netProceeds = collateralAmount > fee ? collateralAmount - fee : 0n;
  const newTotalWithdrawn = (user.totalWithdrawn ?? 0n) + netProceeds;
  
  // Recalculate realized PnL:
  // realizedPnL = (totalWithdrawn + totalWinnings) - totalDeposited
  // Positive = net profit, Negative = net loss
  const newRealizedPnL = newTotalWithdrawn + (user.totalWinnings ?? 0n) - (user.totalDeposited ?? 0n);
  
  await context.db.users.update({
    id: makeId(chain.chainId, trader.toLowerCase()),
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralAmount,
      totalWithdrawn: newTotalWithdrawn,      // Track money taken out
      realizedPnL: newRealizedPnL,            // Update running PnL
      lastTradeAt: timestamp,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4: Update market statistics
  // TVL DECREASES: Collateral flows OUT of the market contract
  // ─────────────────────────────────────────────────────────────────────────────
  // Use max(0, tvl - amount) to prevent negative TVL from edge cases
  const newMarketTvl = market.currentTvl > collateralAmount 
    ? market.currentTvl - collateralAmount 
    : 0n;
    
  await context.db.markets.update({
    id: marketAddress,
    data: {
      totalVolume: market.totalVolume + collateralAmount,
      totalTrades: market.totalTrades + 1,
      currentTvl: newMarketTvl,  // -TVL
      uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 5: Update platform-wide statistics
  // Platform liquidity must decrease in sync with market TVL
  // ─────────────────────────────────────────────────────────────────────────────
  const stats = await getOrCreatePlatformStats(context, chain);
  const newPlatformLiquidity = stats.totalLiquidity > collateralAmount
    ? stats.totalLiquidity - collateralAmount
    : 0n;
    
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalTrades: stats.totalTrades + 1,
      totalVolume: stats.totalVolume + collateralAmount,
      totalLiquidity: newPlatformLiquidity,  // -TVL
      totalFees: stats.totalFees + fee,
      lastUpdatedAt: timestamp,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 6: Update time-series aggregations
  // ─────────────────────────────────────────────────────────────────────────────
  const daily = await getOrCreateDailyStats(context, timestamp, chain);
  await context.db.dailyStats.update({
    id: makeId(chain.chainId, getDayTimestamp(timestamp).toString()),
    data: {
      tradesCount: daily.tradesCount + 1,
      volume: daily.volume + collateralAmount,
    },
  });

  const hourly = await getOrCreateHourlyStats(context, timestamp, chain);
  await context.db.hourlyStats.update({
    id: makeId(chain.chainId, getHourTimestamp(timestamp).toString()),
    data: {
      tradesCount: hourly.tradesCount + 1,
      volume: hourly.volume + collateralAmount,
    },
  });
});

/**
 * Handle SwapTokens event from PredictionAMM
 */
ponder.on("PredictionAMM:SwapTokens", async ({ event, context }) => {
  const { trader, yesToNo, amountIn, amountOut, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const pollAddress = market?.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  await context.db.trades.create({
    id: tradeId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: trader.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      tradeType: "swap",
      side: yesToNo ? "yes" : "no",
      collateralAmount: 0n,
      tokenAmount: amountIn,
      feeAmount: fee,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  const user = await getOrCreateUser(context, trader, chain);
  
  // Check if this is a new trader for this market
  const isNewTrader = await isNewTraderForMarket(context, marketAddress, trader, chain);
  
  await context.db.users.update({
    id: makeId(chain.chainId, trader.toLowerCase()),
    data: {
      totalTrades: user.totalTrades + 1,
      lastTradeAt: timestamp,
    },
  });

  // Update market stats (swaps count as trades but not volume since no collateral moves)
  if (market) {
    await context.db.markets.update({
      id: marketAddress,
      data: {
        totalTrades: market.totalTrades + 1,
        uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
      },
    });
  }

  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalTrades: stats.totalTrades + 1,
      totalFees: stats.totalFees + fee,
      lastUpdatedAt: timestamp,
    },
  });

  const daily = await getOrCreateDailyStats(context, timestamp, chain);
  await context.db.dailyStats.update({
    id: makeId(chain.chainId, getDayTimestamp(timestamp).toString()),
    data: {
      tradesCount: daily.tradesCount + 1,
    },
  });
});

/**
 * Handle WinningsRedeemed event from PredictionAMM
 * NOTE: Collateral flows OUT of market - TVL decreases
 */
ponder.on("PredictionAMM:WinningsRedeemed", async ({ event, context }) => {
  const { user, collateralAmount } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  const winningId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const poll = market?.pollAddress 
    ? await context.db.polls.findUnique({ id: market.pollAddress })
    : null;

  await context.db.winnings.create({
    id: winningId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      user: user.toLowerCase() as `0x${string}`,
      marketAddress,
      collateralAmount,
      feeAmount: 0n,
      marketQuestion: poll?.question,
      marketType: "amm",
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  // Update market TVL (collateral leaving the market)
  if (market) {
    const newMarketTvl = market.currentTvl > collateralAmount 
      ? market.currentTvl - collateralAmount 
      : 0n;
    await context.db.markets.update({
      id: marketAddress,
      data: {
        currentTvl: newMarketTvl,
      },
    });
  }

  const userData = await getOrCreateUser(context, user, chain);
  const newStreak = userData.currentStreak >= 0 ? userData.currentStreak + 1 : 1;
  const bestStreak = Math.max(userData.bestStreak, newStreak);
  
  // Calculate new totalWinnings and update realizedPnL
  // WinningsRedeemed only fires after market is resolved AND finalization period (24h) passed
  const newTotalWinnings = (userData.totalWinnings ?? 0n) + collateralAmount;
  // realizedPnL = (totalWithdrawn + totalWinnings) - totalDeposited
  const newRealizedPnL = (userData.totalWithdrawn ?? 0n) + newTotalWinnings - (userData.totalDeposited ?? 0n);
  
  await context.db.users.update({
    id: makeId(chain.chainId, user.toLowerCase()),
    data: {
      totalWinnings: newTotalWinnings,
      totalWins: userData.totalWins + 1,
      currentStreak: newStreak,
      bestStreak,
      realizedPnL: newRealizedPnL,
    },
  });

  const stats = await getOrCreatePlatformStats(context, chain);
  const newPlatformLiquidity = stats.totalLiquidity > collateralAmount
    ? stats.totalLiquidity - collateralAmount
    : 0n;
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalWinningsPaid: stats.totalWinningsPaid + collateralAmount,
      totalLiquidity: newPlatformLiquidity,
      lastUpdatedAt: timestamp,
    },
  });

  const daily = await getOrCreateDailyStats(context, timestamp, chain);
  await context.db.dailyStats.update({
    id: makeId(chain.chainId, getDayTimestamp(timestamp).toString()),
    data: {
      winningsPaid: daily.winningsPaid + collateralAmount,
    },
  });
});

/**
 * Handle LiquidityAdded event from PredictionAMM
 * NOTE: Imbalance tokens returned to LP count as volume (position taken)
 * NOTE: Always update both market AND platform stats together for consistency
 */
ponder.on("PredictionAMM:LiquidityAdded", async ({ event, context }) => {
  const { provider, collateralAmount, lpTokens, amounts } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  const eventId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  // Imbalance volume = tokens returned to LP (represents position taken)
  const imbalanceVolume = (amounts.yesToReturn ?? 0n) + (amounts.noToReturn ?? 0n);

  // Get or create market (handle race conditions safely)
  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "amm", timestamp, event.block.number, event.transaction.hash);
  const pollAddress = market.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  // Create liquidity event record
  await context.db.liquidityEvents.create({
    id: eventId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      provider: provider.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      eventType: "add",
      collateralAmount,
      lpTokens,
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  // Check if this is the first liquidity event (initialLiquidity not yet set)
  const isFirstLiquidity = (market.initialLiquidity ?? 0n) === 0n;

  // Update market TVL, volume (if imbalanced), and initialLiquidity (if first)
  await context.db.markets.update({
    id: marketAddress,
    data: {
      currentTvl: market.currentTvl + collateralAmount,
      totalVolume: imbalanceVolume > 0n 
        ? market.totalVolume + imbalanceVolume 
        : market.totalVolume,
      // Set initialLiquidity only on the first liquidity add
      initialLiquidity: isFirstLiquidity ? collateralAmount : market.initialLiquidity,
    },
  });

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalLiquidity: stats.totalLiquidity + collateralAmount,
      totalVolume: imbalanceVolume > 0n 
        ? stats.totalVolume + imbalanceVolume 
        : stats.totalVolume,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily stats if there's imbalance volume
  if (imbalanceVolume > 0n) {
    const daily = await getOrCreateDailyStats(context, timestamp, chain);
    await context.db.dailyStats.update({
      id: makeId(chain.chainId, getDayTimestamp(timestamp).toString()),
      data: {
        volume: daily.volume + imbalanceVolume,
      },
    });
  }
});

/**
 * Handle LiquidityRemoved event from PredictionAMM
 */
ponder.on("PredictionAMM:LiquidityRemoved", async ({ event, context }) => {
  const { provider, lpTokens, collateralToReturn } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  const eventId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const pollAddress = market?.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  await context.db.liquidityEvents.create({
    id: eventId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      provider: provider.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      eventType: "remove",
      collateralAmount: collateralToReturn,
      lpTokens,
      txHash: event.transaction.hash,
      timestamp,
    },
  });
  if (market) {
    const newTvl = market.currentTvl > collateralToReturn 
      ? market.currentTvl - collateralToReturn 
      : 0n;
    await context.db.markets.update({
      id: marketAddress,
      data: {
        currentTvl: newTvl,
      },
    });
  }

  const stats = await getOrCreatePlatformStats(context, chain);
  const newLiquidity = stats.totalLiquidity > collateralToReturn
    ? stats.totalLiquidity - collateralToReturn
    : 0n;
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalLiquidity: newLiquidity,
      lastUpdatedAt: timestamp,
    },
  });
});

/**
 * Handle Sync event from PredictionAMM
 */
ponder.on("PredictionAMM:Sync", async ({ event, context }) => {
  const { rYes, rNo } = event.args;
  const marketAddress = event.log.address;

  const market = await context.db.markets.findUnique({ id: marketAddress });
  if (market) {
    await context.db.markets.update({
      id: marketAddress,
      data: {
        reserveYes: BigInt(rYes),
        reserveNo: BigInt(rNo),
      },
    });
  }
});

// =============================================================================
// ██████╗  █████╗ ██████╗ ██╗      ███╗   ███╗██╗   ██╗████████╗██╗   ██╗███████╗██╗
// ██╔══██╗██╔══██╗██╔══██╗██║      ████╗ ████║██║   ██║╚══██╔══╝██║   ██║██╔════╝██║
// ██████╔╝███████║██████╔╝██║█████╗██╔████╔██║██║   ██║   ██║   ██║   ██║█████╗  ██║
// ██╔═══╝ ██╔══██║██╔══██╗██║╚════╝██║╚██╔╝██║██║   ██║   ██║   ██║   ██║██╔══╝  ██║
// ██║     ██║  ██║██║  ██║██║      ██║ ╚═╝ ██║╚██████╔╝   ██║   ╚██████╔╝███████╗███████╗
// ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝      ╚═╝     ╚═╝ ╚═════╝    ╚═╝    ╚═════╝ ╚══════╝╚══════╝
// =============================================================================
// 
// PariMutuel (Pool-based) market handlers.
// All bets go into a shared pool - winners split the entire pot proportionally.
// 
// KEY DIFFERENCES FROM AMM:
// - No selling/swapping - positions held until resolution
// - SeedInitialLiquidity is VOLUME (not just TVL)
// - Odds are dynamic based on pool distribution
// =============================================================================

/**
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ SEED INITIAL LIQUIDITY EVENT - Market Seeding                               │
 * │ Source: PredictionPariMutuel contract (dynamic)                             │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ Triggered when: Market creator seeds the initial betting pool               │
 * │                                                                             │
 * │ ⚠️ CRITICAL: This IS trading volume, not just TVL!                          │
 * │ The seed capital is AT RISK - it's equivalent to placing bets.              │
 * │ Missing this event causes significant volume under-counting.                │
 * │                                                                             │
 * │ MONEY FLOW:                                                                 │
 * │   Creator → [USDC] → YES Pool + NO Pool                                     │
 * │                                                                             │
 * │ VOLUME: ✅ yesAmount + noAmount (full seed amount)                          │
 * │ TVL: ➕ increases by (yesAmount + noAmount)                                 │
 * │                                                                             │
 * │ Example: Creator seeds $500 YES + $500 NO = $1000 volume                    │
 * │ This sets initial 50/50 odds that will shift as bets come in.               │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
ponder.on("PredictionPariMutuel:SeedInitialLiquidity", async ({ event, context }) => {
  const { yesAmount, noAmount } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);

  // Total seed = YES pool + NO pool
  // This entire amount is AT RISK and counts as volume
  const totalLiquidity = yesAmount + noAmount;

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Ensure market record exists (may race with PariMutuelCreated)
  // ─────────────────────────────────────────────────────────────────────────────
  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "pari", timestamp, event.block.number, event.transaction.hash);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Update market with BOTH TVL, volume, and initialLiquidity
  // Seed liquidity is real capital entering → counts as volume
  // ─────────────────────────────────────────────────────────────────────────────
  await context.db.markets.update({
    id: marketAddress,
    data: {
      currentTvl: market.currentTvl + totalLiquidity,      // +TVL
      totalVolume: market.totalVolume + totalLiquidity,    // +Volume (IMPORTANT!)
      initialLiquidity: totalLiquidity,                     // Set initial liquidity for PariMutuel
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Update platform statistics (both liquidity AND volume)
  // ─────────────────────────────────────────────────────────────────────────────
  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalLiquidity: stats.totalLiquidity + totalLiquidity,  // +TVL
      totalVolume: stats.totalVolume + totalLiquidity,        // +Volume
      lastUpdatedAt: timestamp,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4: Update daily volume aggregation
  // ─────────────────────────────────────────────────────────────────────────────
  const daily = await getOrCreateDailyStats(context, timestamp, chain);
  await context.db.dailyStats.update({
    id: makeId(chain.chainId, getDayTimestamp(timestamp).toString()),
    data: {
      volume: daily.volume + totalLiquidity,
    },
  });

  console.log(`[${chain.chainName}] Seed liquidity (volume): ${marketAddress} - ${totalLiquidity}`);
});

/**
 * Handle PositionPurchased event from PredictionPariMutuel
 * NOTE: Always update both market AND platform stats together for consistency
 */
ponder.on("PredictionPariMutuel:PositionPurchased", async ({ event, context }) => {
  const { buyer, isYes, collateralIn, sharesOut } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  // Get or create market (handle race conditions safely)
  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "pari", timestamp, event.block.number, event.transaction.hash);
  const pollAddress = market.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  // Create trade record
  await context.db.trades.create({
    id: tradeId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: buyer.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      tradeType: "bet",
      side: isYes ? "yes" : "no",
      collateralAmount: collateralIn,
      tokenAmount: sharesOut,
      feeAmount: 0n,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  // Update user stats
  const user = await getOrCreateUser(context, buyer, chain);
  const isNewUser = user.totalTrades === 0;
  
  // Check if this is a new trader for this market
  const isNewTrader = await isNewTraderForMarket(context, marketAddress, buyer, chain);
  
  await context.db.users.update({
    id: makeId(chain.chainId, buyer.toLowerCase()),
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralIn,
      totalDeposited: user.totalDeposited + collateralIn,
      firstTradeAt: user.firstTradeAt ?? timestamp,
      lastTradeAt: timestamp,
    },
  });

  // Update market stats
  await context.db.markets.update({
    id: marketAddress,
    data: {
      totalVolume: market.totalVolume + collateralIn,
      totalTrades: market.totalTrades + 1,
      currentTvl: market.currentTvl + collateralIn,
      uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
    },
  });

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalTrades: stats.totalTrades + 1,
      totalVolume: stats.totalVolume + collateralIn,
      totalLiquidity: stats.totalLiquidity + collateralIn,
      totalUsers: isNewUser ? stats.totalUsers + 1 : stats.totalUsers,
      lastUpdatedAt: timestamp,
    },
  });

  const daily = await getOrCreateDailyStats(context, timestamp, chain);
  await context.db.dailyStats.update({
    id: makeId(chain.chainId, getDayTimestamp(timestamp).toString()),
    data: {
      tradesCount: daily.tradesCount + 1,
      volume: daily.volume + collateralIn,
      newUsers: isNewUser ? daily.newUsers + 1 : daily.newUsers,
    },
  });

  const hourly = await getOrCreateHourlyStats(context, timestamp, chain);
  await context.db.hourlyStats.update({
    id: makeId(chain.chainId, getHourTimestamp(timestamp).toString()),
    data: {
      tradesCount: hourly.tradesCount + 1,
      volume: hourly.volume + collateralIn,
    },
  });
});

/**
 * Handle WinningsRedeemed event from PredictionPariMutuel
 * NOTE: Collateral flows OUT of market - TVL decreases
 */
ponder.on("PredictionPariMutuel:WinningsRedeemed", async ({ event, context }) => {
  const { user, collateralAmount, outcome, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  const winningId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const poll = market?.pollAddress 
    ? await context.db.polls.findUnique({ id: market.pollAddress })
    : null;

  await context.db.winnings.create({
    id: winningId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      user: user.toLowerCase() as `0x${string}`,
      marketAddress,
      collateralAmount,
      feeAmount: fee,
      marketQuestion: poll?.question,
      marketType: "pari",
      outcome: Number(outcome),
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  // Update market TVL (collateral leaving the market)
  if (market) {
    const newMarketTvl = market.currentTvl > collateralAmount 
      ? market.currentTvl - collateralAmount 
      : 0n;
    await context.db.markets.update({
      id: marketAddress,
      data: {
        currentTvl: newMarketTvl,
      },
    });
  }

  const userData = await getOrCreateUser(context, user, chain);
  const isWin = outcome !== 3;
  const newStreak = isWin 
    ? (userData.currentStreak >= 0 ? userData.currentStreak + 1 : 1)
    : (userData.currentStreak <= 0 ? userData.currentStreak - 1 : -1);
  const bestStreak = Math.max(userData.bestStreak, newStreak > 0 ? newStreak : 0);
  
  // Calculate new totalWinnings and update realizedPnL
  // WinningsRedeemed only fires after market is resolved AND finalization period (24h) passed
  // Note: PariMutuel winnings are net of fees (fee already deducted by contract)
  const newTotalWinnings = (userData.totalWinnings ?? 0n) + collateralAmount;
  // realizedPnL = (totalWithdrawn + totalWinnings) - totalDeposited
  const newRealizedPnL = (userData.totalWithdrawn ?? 0n) + newTotalWinnings - (userData.totalDeposited ?? 0n);
  
  await context.db.users.update({
    id: makeId(chain.chainId, user.toLowerCase()),
    data: {
      totalWinnings: newTotalWinnings,
      totalWins: isWin ? userData.totalWins + 1 : userData.totalWins,
      currentStreak: newStreak,
      bestStreak,
      realizedPnL: newRealizedPnL,
    },
  });

  const stats = await getOrCreatePlatformStats(context, chain);
  const newPlatformLiquidity = stats.totalLiquidity > collateralAmount
    ? stats.totalLiquidity - collateralAmount
    : 0n;
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalWinningsPaid: stats.totalWinningsPaid + collateralAmount,
      totalLiquidity: newPlatformLiquidity,
      totalFees: stats.totalFees + fee,
      lastUpdatedAt: timestamp,
    },
  });

  const daily = await getOrCreateDailyStats(context, timestamp, chain);
  await context.db.dailyStats.update({
    id: makeId(chain.chainId, getDayTimestamp(timestamp).toString()),
    data: {
      winningsPaid: daily.winningsPaid + collateralAmount,
    },
  });
});
