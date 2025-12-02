/**
 * Ponder Event Handlers - Multi-Chain Support
 * 
 * This file contains all event handlers for the Anymarket indexer.
 * Each handler processes blockchain events and updates the database.
 * 
 * MULTI-CHAIN: All records include chainId and chainName for filtering.
 * 
 * IMPORTANT: Volume Tracking
 * - AMM: BuyTokens, SellTokens count as volume
 * - AMM: LiquidityAdded imbalance counts as volume (position taken)
 * - PariMutuel: SeedInitialLiquidity counts as volume (real capital entering)
 * - PariMutuel: PositionPurchased counts as volume
 * 
 * IMPORTANT: TVL (Total Value Locked) Tracking
 * TVL tracks actual USDC balance in each market contract.
 * 
 * AMM Markets:
 * - LiquidityAdded: +collateralAmount (LP deposits collateral)
 * - LiquidityRemoved: -collateralToReturn (LP withdraws collateral)
 * - BuyTokens: +collateralAmount (trader deposits collateral to buy tokens)
 * - SellTokens: -collateralAmount (trader receives collateral for tokens)
 * - WinningsRedeemed: -collateralAmount (winner withdraws collateral)
 * 
 * PariMutuel Markets:
 * - SeedInitialLiquidity: +(yesAmount + noAmount) (initial seed)
 * - PositionPurchased: +collateralIn (trader deposits collateral)
 * - WinningsRedeemed: -collateralAmount (winner withdraws collateral)
 * 
 * @module src/index
 */

import { ponder } from "@/generated";
import { getChainName } from "../config";

// =============================================================================
// TYPES
// =============================================================================

interface ChainInfo {
  chainId: number;
  chainName: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get chain info from context
 */
function getChainInfo(context: any): ChainInfo {
  const chainId = context.network.chainId;
  const chainName = getChainName(chainId);
  return { chainId, chainName };
}

/**
 * Get the day timestamp (midnight UTC) for a given timestamp
 */
function getDayTimestamp(timestamp: bigint): bigint {
  const day = Number(timestamp) - (Number(timestamp) % 86400);
  return BigInt(day);
}

/**
 * Check if this is a new trader for a specific market
 * Returns true if this trader has no previous trades on this market
 */
async function isNewTraderForMarket(
  context: any,
  marketAddress: `0x${string}`,
  traderAddress: `0x${string}`,
  chain: ChainInfo
): Promise<boolean> {
  // Query existing trades for this trader on this market
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
 * Get the hour timestamp for a given timestamp
 */
function getHourTimestamp(timestamp: bigint): bigint {
  const hour = Number(timestamp) - (Number(timestamp) % 3600);
  return BigInt(hour);
}

/**
 * Generate composite ID for per-chain records
 */
function makeId(chainId: number, ...parts: (string | number | bigint)[]): string {
  return [chainId, ...parts].join("-");
}

/**
 * Get or create user record
 */
async function getOrCreateUser(context: any, address: `0x${string}`, chain: ChainInfo) {
  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  const id = makeId(chain.chainId, normalizedAddress);
  
  let user = await context.db.users.findUnique({ id });
  
  if (!user) {
    user = await context.db.users.create({
      id,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        address: normalizedAddress,
        totalTrades: 0,
        totalVolume: 0n,
        totalWinnings: 0n,
        totalDeposited: 0n,
        totalWins: 0,
        totalLosses: 0,
        currentStreak: 0,
        bestStreak: 0,
        marketsCreated: 0,
        pollsCreated: 0,
      },
    });
  }
  
  return user;
}

/**
 * Get or create platform stats for a chain
 */
async function getOrCreatePlatformStats(context: any, chain: ChainInfo) {
  const id = chain.chainId.toString();
  let stats = await context.db.platformStats.findUnique({ id });
  
  if (!stats) {
    stats = await context.db.platformStats.create({
      id,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
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
 * Get or create daily stats record
 */
async function getOrCreateDailyStats(context: any, timestamp: bigint, chain: ChainInfo) {
  const dayTs = getDayTimestamp(timestamp);
  const id = makeId(chain.chainId, dayTs.toString());
  
  let daily = await context.db.dailyStats.findUnique({ id });
  
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
 * Get or create hourly stats record
 */
async function getOrCreateHourlyStats(context: any, timestamp: bigint, chain: ChainInfo) {
  const hourTs = getHourTimestamp(timestamp);
  const id = makeId(chain.chainId, hourTs.toString());
  
  let hourly = await context.db.hourlyStats.findUnique({ id });
  
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
 * Safely get or create a minimal market record
 * Handles race conditions where multiple events might try to create the same market
 */
async function getOrCreateMinimalMarket(
  context: any, 
  marketAddress: `0x${string}`, 
  chain: ChainInfo,
  marketType: "amm" | "pari",
  timestamp: bigint,
  blockNumber: bigint
) {
  let market = await context.db.markets.findUnique({ id: marketAddress });
  
  if (!market) {
    try {
      console.warn(`[${chain.chainName}] Creating minimal market record for ${marketAddress}`);
      market = await context.db.markets.create({
        id: marketAddress,
        data: {
          chainId: chain.chainId,
          chainName: chain.chainName,
          pollAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
          creator: "0x0000000000000000000000000000000000000000" as `0x${string}`,
          marketType,
          collateralToken: "0x0000000000000000000000000000000000000000" as `0x${string}`,
          totalVolume: 0n,
          totalTrades: 0,
          currentTvl: 0n,
          uniqueTraders: 0,
          createdAtBlock: blockNumber,
          createdAt: timestamp,
        },
      });
    } catch (e: any) {
      // Market was created by another event handler (race condition) - fetch it
      if (e.message?.includes("unique constraint") || e.code === "P2002") {
        market = await context.db.markets.findUnique({ id: marketAddress });
        if (!market) {
          throw new Error(`Failed to get or create market ${marketAddress}: ${e.message}`);
        }
      } else {
        throw e;
      }
    }
  }
  
  return market;
}

// =============================================================================
// ORACLE EVENT HANDLERS
// =============================================================================

/**
 * Handle PollCreated event from PredictionOracle
 */
ponder.on("PredictionOracle:PollCreated", async ({ event, context }) => {
  const { pollAddress, creator, deadlineEpoch, question } = event.args;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);
  
  // Create poll record
  await context.db.polls.create({
    id: pollAddress,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      creator: creator.toLowerCase() as `0x${string}`,
      question,
      rules: "",
      sources: "[]",
      deadlineEpoch: Number(deadlineEpoch),
      finalizationEpoch: 0,
      checkEpoch: 0,
      category: 0,
      status: 0,
      createdAtBlock: event.block.number,
      createdAt: timestamp,
      createdTxHash: event.transaction.hash,
    },
  });

  // Update user stats
  const user = await getOrCreateUser(context, creator, chain);
  await context.db.users.update({
    id: makeId(chain.chainId, creator.toLowerCase()),
    data: {
      pollsCreated: user.pollsCreated + 1,
    },
  });

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalPolls: stats.totalPolls + 1,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily stats
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
 * Handle PollRefreshed event
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
// POLL EVENT HANDLERS (Dynamic - for resolution)
// =============================================================================

/**
 * Handle AnswerSet event from PredictionPoll
 */
ponder.on("PredictionPoll:AnswerSet", async ({ event, context }) => {
  const { status, reason } = event.args;
  const pollAddress = event.log.address;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);

  const poll = await context.db.polls.findUnique({ id: pollAddress });
  if (poll) {
    await context.db.polls.update({
      id: pollAddress,
      data: {
        status: Number(status),
        resolutionReason: reason,
        resolvedAt: timestamp,
      },
    });
  }

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
// MARKET FACTORY EVENT HANDLERS
// =============================================================================

/**
 * Handle MarketCreated event from MarketFactory
 * NOTE: Uses upsert pattern because other events may create minimal market records first
 */
ponder.on("MarketFactory:MarketCreated", async ({ event, context }) => {
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

  // Check if market already exists (could be created by other event handlers)
  const existingMarket = await context.db.markets.findUnique({ id: marketAddress });
  
  if (existingMarket) {
    // Update the existing minimal market record with full data
    await context.db.markets.update({
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
        // Preserve existing stats
        totalVolume: existingMarket.totalVolume,
        totalTrades: existingMarket.totalTrades,
        currentTvl: existingMarket.currentTvl,
        uniqueTraders: existingMarket.uniqueTraders,
        reserveYes: existingMarket.reserveYes ?? 0n,
        reserveNo: existingMarket.reserveNo ?? 0n,
        createdAtBlock: event.block.number,
        createdAt: timestamp,
      },
    });
  } else {
    // Create new market record
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
        totalVolume: 0n,
        totalTrades: 0,
        currentTvl: 0n,
        uniqueTraders: 0,
        reserveYes: 0n,
        reserveNo: 0n,
        createdAtBlock: event.block.number,
        createdAt: timestamp,
      },
    });
  }

  const user = await getOrCreateUser(context, creator, chain);
  await context.db.users.update({
    id: makeId(chain.chainId, creator.toLowerCase()),
    data: {
      marketsCreated: user.marketsCreated + 1,
    },
  });

  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalMarkets: stats.totalMarkets + 1,
      totalAmmMarkets: stats.totalAmmMarkets + 1,
      lastUpdatedAt: timestamp,
    },
  });

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
 * Handle PariMutuelCreated event from MarketFactory
 * NOTE: Uses upsert pattern because other events may create minimal market records first
 */
ponder.on("MarketFactory:PariMutuelCreated", async ({ event, context }) => {
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

  // Check if market already exists (could be created by other event handlers)
  const existingMarket = await context.db.markets.findUnique({ id: marketAddress });
  
  if (existingMarket) {
    // Update the existing minimal market record with full data
    await context.db.markets.update({
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
        // Preserve existing stats
        totalVolume: existingMarket.totalVolume,
        totalTrades: existingMarket.totalTrades,
        currentTvl: existingMarket.currentTvl,
        uniqueTraders: existingMarket.uniqueTraders,
        createdAtBlock: event.block.number,
        createdAt: timestamp,
      },
    });
  } else {
    // Create new market record
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
        totalVolume: 0n,
        totalTrades: 0,
        currentTvl: 0n,
        uniqueTraders: 0,
        createdAtBlock: event.block.number,
        createdAt: timestamp,
      },
    });
  }

  const user = await getOrCreateUser(context, creator, chain);
  await context.db.users.update({
    id: makeId(chain.chainId, creator.toLowerCase()),
    data: {
      marketsCreated: user.marketsCreated + 1,
    },
  });

  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalMarkets: stats.totalMarkets + 1,
      totalPariMarkets: stats.totalPariMarkets + 1,
      lastUpdatedAt: timestamp,
    },
  });

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
// AMM EVENT HANDLERS
// =============================================================================

/**
 * Handle BuyTokens event from PredictionAMM
 * NOTE: Always update both market AND platform stats together for consistency
 */
ponder.on("PredictionAMM:BuyTokens", async ({ event, context }) => {
  const { trader, isYes, tokenAmount, collateralAmount, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  // Get or create market (handle race conditions safely)
  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "amm", timestamp, event.block.number);
  const pollAddress = market.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  // Create trade record
  await context.db.trades.create({
    id: tradeId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: trader.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      tradeType: "buy",
      side: isYes ? "yes" : "no",
      collateralAmount,
      tokenAmount,
      feeAmount: fee,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  // Update user stats
  const user = await getOrCreateUser(context, trader, chain);
  const isNewUser = user.totalTrades === 0;
  
  // Check if this is a new trader for this market (before creating trade record counts)
  const isNewTrader = await isNewTraderForMarket(context, marketAddress, trader, chain);
  
  await context.db.users.update({
    id: makeId(chain.chainId, trader.toLowerCase()),
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralAmount,
      totalDeposited: user.totalDeposited + collateralAmount,
      firstTradeAt: user.firstTradeAt ?? timestamp,
      lastTradeAt: timestamp,
    },
  });

  // Update market stats (including TVL - collateral flows INTO market on buy)
  await context.db.markets.update({
    id: marketAddress,
    data: {
      totalVolume: market.totalVolume + collateralAmount,
      totalTrades: market.totalTrades + 1,
      currentTvl: market.currentTvl + collateralAmount,
      uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
    },
  });

  // Update platform stats (including liquidity/TVL)
  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalTrades: stats.totalTrades + 1,
      totalVolume: stats.totalVolume + collateralAmount,
      totalLiquidity: stats.totalLiquidity + collateralAmount,
      totalFees: stats.totalFees + fee,
      totalUsers: isNewUser ? stats.totalUsers + 1 : stats.totalUsers,
      lastUpdatedAt: timestamp,
    },
  });

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
 * Handle SellTokens event from PredictionAMM
 * NOTE: Always update both market AND platform stats together for consistency
 * NOTE: Collateral flows OUT of market - TVL decreases
 */
ponder.on("PredictionAMM:SellTokens", async ({ event, context }) => {
  const { trader, isYes, tokenAmount, collateralAmount, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  // Get or create market (handle race conditions safely)
  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "amm", timestamp, event.block.number);
  const pollAddress = market.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  // Create trade record
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
      collateralAmount,
      tokenAmount,
      feeAmount: fee,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  // Update user stats
  const user = await getOrCreateUser(context, trader, chain);
  
  // Check if this is a new trader for this market
  const isNewTrader = await isNewTraderForMarket(context, marketAddress, trader, chain);
  
  await context.db.users.update({
    id: makeId(chain.chainId, trader.toLowerCase()),
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralAmount,
      lastTradeAt: timestamp,
    },
  });

  // Update market stats (TVL decreases - collateral flows OUT on sell)
  const newMarketTvl = market.currentTvl > collateralAmount 
    ? market.currentTvl - collateralAmount 
    : 0n;
  await context.db.markets.update({
    id: marketAddress,
    data: {
      totalVolume: market.totalVolume + collateralAmount,
      totalTrades: market.totalTrades + 1,
      currentTvl: newMarketTvl,
      uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
    },
  });

  // Update platform stats (liquidity/TVL decreases)
  const stats = await getOrCreatePlatformStats(context, chain);
  const newPlatformLiquidity = stats.totalLiquidity > collateralAmount
    ? stats.totalLiquidity - collateralAmount
    : 0n;
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalTrades: stats.totalTrades + 1,
      totalVolume: stats.totalVolume + collateralAmount,
      totalLiquidity: newPlatformLiquidity,
      totalFees: stats.totalFees + fee,
      lastUpdatedAt: timestamp,
    },
  });

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
  
  await context.db.users.update({
    id: makeId(chain.chainId, user.toLowerCase()),
    data: {
      totalWinnings: userData.totalWinnings + collateralAmount,
      totalWins: userData.totalWins + 1,
      currentStreak: newStreak,
      bestStreak,
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

  // Create liquidity event record
  await context.db.liquidityEvents.create({
    id: eventId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      provider: provider.toLowerCase() as `0x${string}`,
      marketAddress,
      eventType: "add",
      collateralAmount,
      lpTokens,
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  // Get or create market (handle race conditions safely)
  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "amm", timestamp, event.block.number);

  // Update market TVL and volume (if imbalanced)
  await context.db.markets.update({
    id: marketAddress,
    data: {
      currentTvl: market.currentTvl + collateralAmount,
      totalVolume: imbalanceVolume > 0n 
        ? market.totalVolume + imbalanceVolume 
        : market.totalVolume,
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

  await context.db.liquidityEvents.create({
    id: eventId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      provider: provider.toLowerCase() as `0x${string}`,
      marketAddress,
      eventType: "remove",
      collateralAmount: collateralToReturn,
      lpTokens,
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  const market = await context.db.markets.findUnique({ id: marketAddress });
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
// PARI-MUTUEL EVENT HANDLERS
// =============================================================================

/**
 * Handle SeedInitialLiquidity event from PredictionPariMutuel
 * NOTE: Seed liquidity COUNTS as volume - it's real capital entering the market
 * NOTE: Always update both market AND platform stats together for consistency
 */
ponder.on("PredictionPariMutuel:SeedInitialLiquidity", async ({ event, context }) => {
  const { yesAmount, noAmount } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);

  const totalLiquidity = yesAmount + noAmount;

  // Get or create market (handle race conditions safely)
  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "pari", timestamp, event.block.number);

  // Update market TVL AND volume (seed liquidity is real capital entering the market)
  await context.db.markets.update({
    id: marketAddress,
    data: {
      currentTvl: market.currentTvl + totalLiquidity,
      totalVolume: market.totalVolume + totalLiquidity,
    },
  });

  // Update platform stats - both liquidity AND volume
  const stats = await getOrCreatePlatformStats(context, chain);
  await context.db.platformStats.update({
    id: chain.chainId.toString(),
    data: {
      totalLiquidity: stats.totalLiquidity + totalLiquidity,
      totalVolume: stats.totalVolume + totalLiquidity,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily stats with seed liquidity volume
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
  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "pari", timestamp, event.block.number);
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
  
  await context.db.users.update({
    id: makeId(chain.chainId, user.toLowerCase()),
    data: {
      totalWinnings: userData.totalWinnings + collateralAmount,
      totalWins: isWin ? userData.totalWins + 1 : userData.totalWins,
      currentStreak: newStreak,
      bestStreak,
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
