import type { PonderContext, ChainInfo, StatsUpdate } from "../utils/types";
import { makeId, getDayTimestamp, getHourTimestamp } from "../utils/helpers";
import { withRetry } from "../utils/errors";

// =============================================================================
// STATS RECORD HELPERS
// =============================================================================

/**
 * Get or create platform stats record
 */
async function getOrCreatePlatformStats(context: PonderContext, chain: ChainInfo) {
  const platformId = chain.chainId.toString();
  let platformStats = await context.db.platformStats.findUnique({ id: platformId });

  if (!platformStats) {
    platformStats = await context.db.platformStats.create({
      id: platformId,
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
        totalPlatformFeesEarned: 0n,
        totalAmmMarkets: 0,
        totalPariMarkets: 0,
        lastUpdatedAt: 0n,
      },
    });
  }

  return platformStats;
}

/**
 * Get or create daily stats record
 */
async function getOrCreateDailyStats(context: PonderContext, chain: ChainInfo, dayTs: bigint) {
  const dailyId = makeId(chain.chainId, dayTs.toString());
  let dailyStats = await context.db.dailyStats.findUnique({ id: dailyId });

  if (!dailyStats) {
    dailyStats = await context.db.dailyStats.create({
      id: dailyId,
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

  return dailyStats;
}

/**
 * Get or create hourly stats record
 */
async function getOrCreateHourlyStats(context: PonderContext, chain: ChainInfo, hourTs: bigint) {
  const hourlyId = makeId(chain.chainId, hourTs.toString());
  let hourlyStats = await context.db.hourlyStats.findUnique({ id: hourlyId });

  if (!hourlyStats) {
    hourlyStats = await context.db.hourlyStats.create({
      id: hourlyId,
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

  return hourlyStats;
}

// =============================================================================
// ACTIVE USER TRACKING
// =============================================================================

/**
 * Record a user as active for a specific hour.
 * Returns true if this is the first activity for this user this hour.
 * 
 * Note: We reuse the dailyActiveUsers table with hour-based IDs for simplicity.
 * This avoids adding a new schema table while still tracking hourly uniqueness.
 */
export async function recordHourlyActiveUser(
  context: PonderContext,
  chain: ChainInfo,
  userAddress: `0x${string}`,
  timestamp: bigint
): Promise<boolean> {
  const hourTs = getHourTimestamp(timestamp);
  const normalizedUser = userAddress.toLowerCase() as `0x${string}`;
  // Use a different prefix to distinguish from daily records
  const id = makeId(chain.chainId, `hour-${hourTs.toString()}`, normalizedUser);

  return withRetry(async () => {
    // Check if record exists first
    const existing = await context.db.dailyActiveUsers.findUnique({ id });
    const isFirstActivity = !existing;
    
    // Use upsert to handle concurrent writes within the same Ponder batch
    await context.db.dailyActiveUsers.upsert({
      id,
      create: {
        chainId: chain.chainId,
        dayTimestamp: hourTs, // Reusing field for hour timestamp
        user: normalizedUser,
        firstActivityAt: timestamp,
        tradesCount: 1,
      },
      update: {
        // No-op update - we just need to ensure the record exists
      },
    });
    
    return isFirstActivity;
  });
}

/**
 * Record a user as active for a specific day.
 * Returns true if this is the first activity for this user today.
 * 
 * Uses findUnique + upsert pattern for Ponder compatibility:
 * - Check if record exists first
 * - Use upsert to handle concurrent writes within the same batch
 */
export async function recordDailyActiveUser(
  context: PonderContext,
  chain: ChainInfo,
  userAddress: `0x${string}`,
  timestamp: bigint
): Promise<boolean> {
  const dayTs = getDayTimestamp(timestamp);
  const normalizedUser = userAddress.toLowerCase() as `0x${string}`;
  const id = makeId(chain.chainId, dayTs.toString(), normalizedUser);

  return withRetry(async () => {
    // Check if record exists first
    const existing = await context.db.dailyActiveUsers.findUnique({ id });
    const isFirstActivity = !existing;
    
    // Use upsert to handle concurrent writes within the same Ponder batch
    await context.db.dailyActiveUsers.upsert({
      id,
      create: {
        chainId: chain.chainId,
        dayTimestamp: dayTs,
        user: normalizedUser,
        firstActivityAt: timestamp,
        tradesCount: 1,
      },
      update: {
        // Increment trade count for returning users
        tradesCount: (existing?.tradesCount ?? 0) + 1,
      },
    });
    
    return isFirstActivity;
  });
}

// =============================================================================
// AGGREGATE STATS UPDATER
// =============================================================================

/**
 * Centralized stats updater.
 * Updates PlatformStats, DailyStats, and HourlyStats in parallel where possible.
 * 
 * IMPORTANT: This function now expects `activeUsers` to be passed as 0 or 1 based on
 * whether the user is newly active TODAY (determined by recordDailyActiveUser).
 * 
 * Performance: Parallelizes read operations and update operations for ~3x speedup.
 */
export async function updateAggregateStats(
  context: PonderContext,
  chain: ChainInfo,
  timestamp: bigint,
  metrics: StatsUpdate
) {
  await withRetry(async () => {
    const dayTs = getDayTimestamp(timestamp);
    const hourTs = getHourTimestamp(timestamp);
    const shouldUpdateHourly = (metrics.trades ?? 0) > 0 || (metrics.volume ?? 0n) > 0n;

    // 1. Parallel fetch all stats records
    const [platformStats, dailyStats, hourlyStats] = await Promise.all([
      getOrCreatePlatformStats(context, chain),
      getOrCreateDailyStats(context, chain, dayTs),
      shouldUpdateHourly ? getOrCreateHourlyStats(context, chain, hourTs) : null,
    ]);

    // 2. Calculate new TVL (prevent negative)
    const currentLiquidity = platformStats.totalLiquidity ?? 0n;
    const tvlChange = metrics.tvlChange ?? 0n;
    let newLiquidity = currentLiquidity + tvlChange;
    if (newLiquidity < 0n) newLiquidity = 0n;

    // 3. Parallel update all stats records
    const updatePromises: Promise<unknown>[] = [
      // Platform stats update
      context.db.platformStats.update({
        id: chain.chainId.toString(),
        data: {
          totalPolls: (platformStats.totalPolls ?? 0) + (metrics.polls ?? 0),
          totalPollsResolved: (platformStats.totalPollsResolved ?? 0) + (metrics.pollsResolved ?? 0),
          totalMarkets: (platformStats.totalMarkets ?? 0) + (metrics.markets ?? 0),
          totalAmmMarkets: (platformStats.totalAmmMarkets ?? 0) + (metrics.ammMarkets ?? 0),
          totalPariMarkets: (platformStats.totalPariMarkets ?? 0) + (metrics.pariMarkets ?? 0),
          totalTrades: (platformStats.totalTrades ?? 0) + (metrics.trades ?? 0),
          totalUsers: (platformStats.totalUsers ?? 0) + (metrics.users ?? 0),
          totalVolume: (platformStats.totalVolume ?? 0n) + (metrics.volume ?? 0n),
          totalLiquidity: newLiquidity,
          totalFees: (platformStats.totalFees ?? 0n) + (metrics.fees ?? 0n),
          totalWinningsPaid: (platformStats.totalWinningsPaid ?? 0n) + (metrics.winningsPaid ?? 0n),
          totalPlatformFeesEarned: (platformStats.totalPlatformFeesEarned ?? 0n) + (metrics.platformFees ?? 0n),
          lastUpdatedAt: timestamp,
        },
      }),

      // Daily stats update
      // Note: activeUsers is now only incremented when user is first active today
      context.db.dailyStats.update({
        id: makeId(chain.chainId, dayTs.toString()),
        data: {
          pollsCreated: (dailyStats.pollsCreated ?? 0) + (metrics.polls ?? 0),
          marketsCreated: (dailyStats.marketsCreated ?? 0) + (metrics.markets ?? 0),
          tradesCount: (dailyStats.tradesCount ?? 0) + (metrics.trades ?? 0),
          volume: (dailyStats.volume ?? 0n) + (metrics.volume ?? 0n),
          winningsPaid: (dailyStats.winningsPaid ?? 0n) + (metrics.winningsPaid ?? 0n),
          newUsers: (dailyStats.newUsers ?? 0) + (metrics.users ?? 0),
          activeUsers: (dailyStats.activeUsers ?? 0) + (metrics.activeUsers ?? 0),
        },
      }),
    ];

    // Conditionally add hourly stats update
    if (shouldUpdateHourly && hourlyStats) {
      updatePromises.push(
        context.db.hourlyStats.update({
          id: makeId(chain.chainId, hourTs.toString()),
          data: {
            tradesCount: (hourlyStats.tradesCount ?? 0) + (metrics.trades ?? 0),
            volume: (hourlyStats.volume ?? 0n) + (metrics.volume ?? 0n),
            uniqueTraders: (hourlyStats.uniqueTraders ?? 0) + (metrics.hourlyUniqueTraders ?? 0),
          },
        })
      );
    }

    await Promise.all(updatePromises);
  });
}
