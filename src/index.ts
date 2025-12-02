/**
 * Ponder Event Handlers
 * 
 * This file contains all event handlers for the Anymarket indexer.
 * Each handler processes blockchain events and updates the database.
 * 
 * IMPORTANT: Volume Tracking
 * - AMM: BuyTokens, SellTokens count as volume
 * - AMM: First LiquidityAdded has IMBALANCE that counts as volume
 * - PariMutuel: SeedInitialLiquidity counts as volume
 * - PariMutuel: PositionPurchased counts as volume
 * 
 * @module src/index
 */

import { ponder } from "@/generated";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the day timestamp (midnight UTC) for a given timestamp
 */
function getDayTimestamp(timestamp: bigint): string {
  const day = Number(timestamp) - (Number(timestamp) % 86400);
  return day.toString();
}

/**
 * Get the hour timestamp for a given timestamp
 */
function getHourTimestamp(timestamp: bigint): string {
  const hour = Number(timestamp) - (Number(timestamp) % 3600);
  return hour.toString();
}

/**
 * Get or create user record
 */
async function getOrCreateUser(context: any, address: `0x${string}`) {
  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  let user = await context.db.users.findUnique({ id: normalizedAddress });
  
  if (!user) {
    user = await context.db.users.create({
      id: normalizedAddress,
      data: {
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
 * Get or create platform stats singleton
 */
async function getOrCreatePlatformStats(context: any) {
  let stats = await context.db.platformStats.findUnique({ id: "global" });
  
  if (!stats) {
    stats = await context.db.platformStats.create({
      id: "global",
      data: {
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
async function getOrCreateDailyStats(context: any, timestamp: bigint) {
  const dayId = getDayTimestamp(timestamp);
  let daily = await context.db.dailyStats.findUnique({ id: dayId });
  
  if (!daily) {
    daily = await context.db.dailyStats.create({
      id: dayId,
      data: {
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
async function getOrCreateHourlyStats(context: any, timestamp: bigint) {
  const hourId = getHourTimestamp(timestamp);
  let hourly = await context.db.hourlyStats.findUnique({ id: hourId });
  
  if (!hourly) {
    hourly = await context.db.hourlyStats.create({
      id: hourId,
      data: {
        tradesCount: 0,
        volume: 0n,
        uniqueTraders: 0,
      },
    });
  }
  
  return hourly;
}

// =============================================================================
// ORACLE EVENT HANDLERS
// =============================================================================

/**
 * Handle PollCreated event from PredictionOracle
 * Creates a new poll record and updates platform/user stats
 */
ponder.on("PredictionOracle:PollCreated", async ({ event, context }) => {
  const { pollAddress, creator, deadlineEpoch, question } = event.args;
  const timestamp = event.block.timestamp;
  
  // Create poll record
  await context.db.polls.create({
    id: pollAddress,
    data: {
      creator: creator.toLowerCase() as `0x${string}`,
      question,
      rules: "",
      sources: "[]",
      deadlineEpoch: Number(deadlineEpoch),
      finalizationEpoch: 0,
      checkEpoch: 0,
      category: 0,
      status: 0, // Pending
      createdAtBlock: event.block.number,
      createdAt: timestamp,
      createdTxHash: event.transaction.hash,
    },
  });

  // Update user stats
  const user = await getOrCreateUser(context, creator);
  await context.db.users.update({
    id: creator.toLowerCase() as `0x${string}`,
    data: {
      pollsCreated: user.pollsCreated + 1,
    },
  });

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context);
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalPolls: stats.totalPolls + 1,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily stats
  const daily = await getOrCreateDailyStats(context, timestamp);
  await context.db.dailyStats.update({
    id: getDayTimestamp(timestamp),
    data: {
      pollsCreated: daily.pollsCreated + 1,
    },
  });

  console.log(`[Oracle] Poll created: ${pollAddress}`);
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
 * Updates poll status when resolved
 */
ponder.on("PredictionPoll:AnswerSet", async ({ event, context }) => {
  const { status, reason } = event.args;
  const pollAddress = event.log.address;
  const timestamp = event.block.timestamp;

  // Update poll status
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

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context);
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalPollsResolved: stats.totalPollsResolved + 1,
      lastUpdatedAt: timestamp,
    },
  });

  console.log(`[Poll] Resolved: ${pollAddress} -> status ${status}`);
});

// =============================================================================
// MARKET FACTORY EVENT HANDLERS
// =============================================================================

/**
 * Handle MarketCreated event from MarketFactory
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

  // Create market record
  await context.db.markets.create({
    id: marketAddress,
    data: {
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

  // Update user stats
  const user = await getOrCreateUser(context, creator);
  await context.db.users.update({
    id: creator.toLowerCase() as `0x${string}`,
    data: {
      marketsCreated: user.marketsCreated + 1,
    },
  });

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context);
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalMarkets: stats.totalMarkets + 1,
      totalAmmMarkets: stats.totalAmmMarkets + 1,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily stats
  const daily = await getOrCreateDailyStats(context, timestamp);
  await context.db.dailyStats.update({
    id: getDayTimestamp(timestamp),
    data: {
      marketsCreated: daily.marketsCreated + 1,
    },
  });

  console.log(`[Factory] AMM market created: ${marketAddress}`);
});

/**
 * Handle PariMutuelCreated event from MarketFactory
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

  // Create market record
  await context.db.markets.create({
    id: marketAddress,
    data: {
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

  // Update user stats
  const user = await getOrCreateUser(context, creator);
  await context.db.users.update({
    id: creator.toLowerCase() as `0x${string}`,
    data: {
      marketsCreated: user.marketsCreated + 1,
    },
  });

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context);
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalMarkets: stats.totalMarkets + 1,
      totalPariMarkets: stats.totalPariMarkets + 1,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily stats
  const daily = await getOrCreateDailyStats(context, timestamp);
  await context.db.dailyStats.update({
    id: getDayTimestamp(timestamp),
    data: {
      marketsCreated: daily.marketsCreated + 1,
    },
  });

  console.log(`[Factory] PariMutuel market created: ${marketAddress}`);
});

// =============================================================================
// AMM EVENT HANDLERS
// =============================================================================

/**
 * Handle BuyTokens event from PredictionAMM
 * Records trade and updates stats - THIS IS VOLUME
 */
ponder.on("PredictionAMM:BuyTokens", async ({ event, context }) => {
  const { trader, isYes, tokenAmount, collateralAmount, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const tradeId = `${event.transaction.hash}-${event.log.logIndex}`;

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const pollAddress = market?.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  // Create trade record
  await context.db.trades.create({
    id: tradeId,
    data: {
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
  const user = await getOrCreateUser(context, trader);
  const isNewUser = user.totalTrades === 0;
  
  await context.db.users.update({
    id: trader.toLowerCase() as `0x${string}`,
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralAmount,
      totalDeposited: user.totalDeposited + collateralAmount,
      firstTradeAt: user.firstTradeAt ?? timestamp,
      lastTradeAt: timestamp,
    },
  });

  // Update market stats
  if (market) {
    await context.db.markets.update({
      id: marketAddress,
      data: {
        totalVolume: market.totalVolume + collateralAmount,
        totalTrades: market.totalTrades + 1,
      },
    });
  }

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context);
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalTrades: stats.totalTrades + 1,
      totalVolume: stats.totalVolume + collateralAmount,
      totalFees: stats.totalFees + fee,
      totalUsers: isNewUser ? stats.totalUsers + 1 : stats.totalUsers,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily stats
  const daily = await getOrCreateDailyStats(context, timestamp);
  await context.db.dailyStats.update({
    id: getDayTimestamp(timestamp),
    data: {
      tradesCount: daily.tradesCount + 1,
      volume: daily.volume + collateralAmount,
      newUsers: isNewUser ? daily.newUsers + 1 : daily.newUsers,
    },
  });

  // Update hourly stats
  const hourly = await getOrCreateHourlyStats(context, timestamp);
  await context.db.hourlyStats.update({
    id: getHourTimestamp(timestamp),
    data: {
      tradesCount: hourly.tradesCount + 1,
      volume: hourly.volume + collateralAmount,
    },
  });
});

/**
 * Handle SellTokens event from PredictionAMM
 * Records trade - THIS IS VOLUME
 */
ponder.on("PredictionAMM:SellTokens", async ({ event, context }) => {
  const { trader, isYes, tokenAmount, collateralAmount, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const tradeId = `${event.transaction.hash}-${event.log.logIndex}`;

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const pollAddress = market?.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  // Create trade record
  await context.db.trades.create({
    id: tradeId,
    data: {
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
  const user = await getOrCreateUser(context, trader);
  await context.db.users.update({
    id: trader.toLowerCase() as `0x${string}`,
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralAmount,
      lastTradeAt: timestamp,
    },
  });

  // Update market stats
  if (market) {
    await context.db.markets.update({
      id: marketAddress,
      data: {
        totalVolume: market.totalVolume + collateralAmount,
        totalTrades: market.totalTrades + 1,
      },
    });
  }

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context);
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalTrades: stats.totalTrades + 1,
      totalVolume: stats.totalVolume + collateralAmount,
      totalFees: stats.totalFees + fee,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily/hourly stats
  const daily = await getOrCreateDailyStats(context, timestamp);
  await context.db.dailyStats.update({
    id: getDayTimestamp(timestamp),
    data: {
      tradesCount: daily.tradesCount + 1,
      volume: daily.volume + collateralAmount,
    },
  });

  const hourly = await getOrCreateHourlyStats(context, timestamp);
  await context.db.hourlyStats.update({
    id: getHourTimestamp(timestamp),
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
  const tradeId = `${event.transaction.hash}-${event.log.logIndex}`;

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const pollAddress = market?.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  // Create trade record
  await context.db.trades.create({
    id: tradeId,
    data: {
      trader: trader.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      tradeType: "swap",
      side: yesToNo ? "yes" : "no",
      collateralAmount: 0n, // Swaps don't add collateral
      tokenAmount: amountIn,
      feeAmount: fee,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  // Update user stats (swaps don't add to volume)
  const user = await getOrCreateUser(context, trader);
  await context.db.users.update({
    id: trader.toLowerCase() as `0x${string}`,
    data: {
      totalTrades: user.totalTrades + 1,
      lastTradeAt: timestamp,
    },
  });

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context);
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalTrades: stats.totalTrades + 1,
      totalFees: stats.totalFees + fee,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily stats
  const daily = await getOrCreateDailyStats(context, timestamp);
  await context.db.dailyStats.update({
    id: getDayTimestamp(timestamp),
    data: {
      tradesCount: daily.tradesCount + 1,
    },
  });
});

/**
 * Handle WinningsRedeemed event from PredictionAMM
 */
ponder.on("PredictionAMM:WinningsRedeemed", async ({ event, context }) => {
  const { user, collateralAmount } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const winningId = `${event.transaction.hash}-${event.log.logIndex}`;

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const poll = market?.pollAddress 
    ? await context.db.polls.findUnique({ id: market.pollAddress })
    : null;

  // Create winning record
  await context.db.winnings.create({
    id: winningId,
    data: {
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

  // Update user stats
  const userData = await getOrCreateUser(context, user);
  const newStreak = userData.currentStreak >= 0 ? userData.currentStreak + 1 : 1;
  const bestStreak = Math.max(userData.bestStreak, newStreak);
  
  await context.db.users.update({
    id: user.toLowerCase() as `0x${string}`,
    data: {
      totalWinnings: userData.totalWinnings + collateralAmount,
      totalWins: userData.totalWins + 1,
      currentStreak: newStreak,
      bestStreak,
    },
  });

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context);
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalWinningsPaid: stats.totalWinningsPaid + collateralAmount,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily stats
  const daily = await getOrCreateDailyStats(context, timestamp);
  await context.db.dailyStats.update({
    id: getDayTimestamp(timestamp),
    data: {
      winningsPaid: daily.winningsPaid + collateralAmount,
    },
  });
});

/**
 * Handle LiquidityAdded event from PredictionAMM
 * IMPORTANT: First liquidity add has IMBALANCE that counts as volume!
 */
ponder.on("PredictionAMM:LiquidityAdded", async ({ event, context }) => {
  const { provider, collateralAmount, lpTokens, amounts } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const eventId = `${event.transaction.hash}-${event.log.logIndex}`;

  // Calculate imbalance volume (tokens returned to provider)
  // This represents the "bet" direction that was placed via liquidity
  const imbalanceVolume = (amounts.yesToReturn ?? 0n) + (amounts.noToReturn ?? 0n);

  // Create liquidity event record
  await context.db.liquidityEvents.create({
    id: eventId,
    data: {
      provider: provider.toLowerCase() as `0x${string}`,
      marketAddress,
      eventType: "add",
      collateralAmount,
      lpTokens,
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  // Update market TVL
  const market = await context.db.markets.findUnique({ id: marketAddress });
  if (market) {
    await context.db.markets.update({
      id: marketAddress,
      data: {
        currentTvl: market.currentTvl + collateralAmount,
        // If there's imbalance, add to volume
        totalVolume: imbalanceVolume > 0n 
          ? market.totalVolume + imbalanceVolume 
          : market.totalVolume,
      },
    });
  }

  // Update platform liquidity and volume (if imbalance)
  const stats = await getOrCreatePlatformStats(context);
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalLiquidity: stats.totalLiquidity + collateralAmount,
      totalVolume: imbalanceVolume > 0n 
        ? stats.totalVolume + imbalanceVolume 
        : stats.totalVolume,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily volume if imbalance
  if (imbalanceVolume > 0n) {
    const daily = await getOrCreateDailyStats(context, timestamp);
    await context.db.dailyStats.update({
      id: getDayTimestamp(timestamp),
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
  const eventId = `${event.transaction.hash}-${event.log.logIndex}`;

  // Create liquidity event record
  await context.db.liquidityEvents.create({
    id: eventId,
    data: {
      provider: provider.toLowerCase() as `0x${string}`,
      marketAddress,
      eventType: "remove",
      collateralAmount: collateralToReturn,
      lpTokens,
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  // Update market TVL
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

  // Update platform liquidity
  const stats = await getOrCreatePlatformStats(context);
  const newLiquidity = stats.totalLiquidity > collateralToReturn
    ? stats.totalLiquidity - collateralToReturn
    : 0n;
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalLiquidity: newLiquidity,
      lastUpdatedAt: timestamp,
    },
  });
});

/**
 * Handle Sync event from PredictionAMM
 * Updates reserve values for price tracking
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
 * CRITICAL: This is VOLUME! Initial liquidity counts as bets.
 */
ponder.on("PredictionPariMutuel:SeedInitialLiquidity", async ({ event, context }) => {
  const { yesAmount, noAmount } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;

  // Total initial liquidity is volume
  const totalVolume = yesAmount + noAmount;

  // Update market stats
  const market = await context.db.markets.findUnique({ id: marketAddress });
  if (market) {
    await context.db.markets.update({
      id: marketAddress,
      data: {
        totalVolume: market.totalVolume + totalVolume,
        currentTvl: market.currentTvl + totalVolume,
      },
    });
  }

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context);
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalVolume: stats.totalVolume + totalVolume,
      totalLiquidity: stats.totalLiquidity + totalVolume,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily stats
  const daily = await getOrCreateDailyStats(context, timestamp);
  await context.db.dailyStats.update({
    id: getDayTimestamp(timestamp),
    data: {
      volume: daily.volume + totalVolume,
    },
  });

  console.log(`[PariMutuel] Seed liquidity: ${marketAddress} - ${totalVolume}`);
});

/**
 * Handle PositionPurchased event from PredictionPariMutuel
 * Records bet and updates stats - THIS IS VOLUME
 */
ponder.on("PredictionPariMutuel:PositionPurchased", async ({ event, context }) => {
  const { buyer, isYes, collateralIn, sharesOut } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const tradeId = `${event.transaction.hash}-${event.log.logIndex}`;

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const pollAddress = market?.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  // Create trade record (bet)
  await context.db.trades.create({
    id: tradeId,
    data: {
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
  const user = await getOrCreateUser(context, buyer);
  const isNewUser = user.totalTrades === 0;
  
  await context.db.users.update({
    id: buyer.toLowerCase() as `0x${string}`,
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralIn,
      totalDeposited: user.totalDeposited + collateralIn,
      firstTradeAt: user.firstTradeAt ?? timestamp,
      lastTradeAt: timestamp,
    },
  });

  // Update market stats
  if (market) {
    await context.db.markets.update({
      id: marketAddress,
      data: {
        totalVolume: market.totalVolume + collateralIn,
        totalTrades: market.totalTrades + 1,
        currentTvl: market.currentTvl + collateralIn,
      },
    });
  }

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context);
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalTrades: stats.totalTrades + 1,
      totalVolume: stats.totalVolume + collateralIn,
      totalLiquidity: stats.totalLiquidity + collateralIn,
      totalUsers: isNewUser ? stats.totalUsers + 1 : stats.totalUsers,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily stats
  const daily = await getOrCreateDailyStats(context, timestamp);
  await context.db.dailyStats.update({
    id: getDayTimestamp(timestamp),
    data: {
      tradesCount: daily.tradesCount + 1,
      volume: daily.volume + collateralIn,
      newUsers: isNewUser ? daily.newUsers + 1 : daily.newUsers,
    },
  });

  // Update hourly stats
  const hourly = await getOrCreateHourlyStats(context, timestamp);
  await context.db.hourlyStats.update({
    id: getHourTimestamp(timestamp),
    data: {
      tradesCount: hourly.tradesCount + 1,
      volume: hourly.volume + collateralIn,
    },
  });
});

/**
 * Handle WinningsRedeemed event from PredictionPariMutuel
 */
ponder.on("PredictionPariMutuel:WinningsRedeemed", async ({ event, context }) => {
  const { user, collateralAmount, outcome, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const winningId = `${event.transaction.hash}-${event.log.logIndex}`;

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const poll = market?.pollAddress 
    ? await context.db.polls.findUnique({ id: market.pollAddress })
    : null;

  // Create winning record
  await context.db.winnings.create({
    id: winningId,
    data: {
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

  // Update user stats
  const userData = await getOrCreateUser(context, user);
  const isWin = outcome !== 3; // 3 = Unknown = refund
  const newStreak = isWin 
    ? (userData.currentStreak >= 0 ? userData.currentStreak + 1 : 1)
    : (userData.currentStreak <= 0 ? userData.currentStreak - 1 : -1);
  const bestStreak = Math.max(userData.bestStreak, newStreak > 0 ? newStreak : 0);
  
  await context.db.users.update({
    id: user.toLowerCase() as `0x${string}`,
    data: {
      totalWinnings: userData.totalWinnings + collateralAmount,
      totalWins: isWin ? userData.totalWins + 1 : userData.totalWins,
      currentStreak: newStreak,
      bestStreak,
    },
  });

  // Update platform stats
  const stats = await getOrCreatePlatformStats(context);
  await context.db.platformStats.update({
    id: "global",
    data: {
      totalWinningsPaid: stats.totalWinningsPaid + collateralAmount,
      totalFees: stats.totalFees + fee,
      lastUpdatedAt: timestamp,
    },
  });

  // Update daily stats
  const daily = await getOrCreateDailyStats(context, timestamp);
  await context.db.dailyStats.update({
    id: getDayTimestamp(timestamp),
    data: {
      winningsPaid: daily.winningsPaid + collateralAmount,
    },
  });
});
