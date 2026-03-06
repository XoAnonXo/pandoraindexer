import type { PonderContext, ChainInfo } from "../utils/types";
import { makeId } from "../utils/helpers";
import { withRetry } from "../utils/errors";
import { TradeSide, PollStatus } from "../utils/constants";

/**
 * Record or update a user's position in a market.
 * Called when a user buys YES or NO tokens/shares.
 * 
 * Uses findUnique + upsert pattern for Ponder compatibility:
 * - Check if record exists first to calculate new amounts
 * - Use upsert to handle concurrent writes within the same batch
 */
export async function recordPosition(
  context: PonderContext,
  chain: ChainInfo,
  marketAddress: `0x${string}`,
  pollAddress: `0x${string}`,
  userAddress: `0x${string}`,
  side: typeof TradeSide.YES | typeof TradeSide.NO,
  collateralAmount: bigint,
  tokenAmount: bigint,
  timestamp: bigint
) {
  const normalizedUser = userAddress.toLowerCase() as `0x${string}`;
  const id = makeId(chain.chainId, marketAddress, normalizedUser);

  await withRetry(async () => {
    // Check if position exists to calculate new amounts
    const existing = await context.db.userMarketPositions.findUnique({ id });
    
    // Calculate new amounts based on whether position exists
    const newYesAmount = side === TradeSide.YES 
      ? (existing?.yesAmount ?? 0n) + collateralAmount 
      : (existing?.yesAmount ?? 0n);
    const newNoAmount = side === TradeSide.NO 
      ? (existing?.noAmount ?? 0n) + collateralAmount 
      : (existing?.noAmount ?? 0n);
    const newYesTokens = side === TradeSide.YES 
      ? (existing?.yesTokens ?? 0n) + tokenAmount 
      : (existing?.yesTokens ?? 0n);
    const newNoTokens = side === TradeSide.NO 
      ? (existing?.noTokens ?? 0n) + tokenAmount 
      : (existing?.noTokens ?? 0n);
    
    // Use upsert to handle concurrent writes within the same Ponder batch
    await context.db.userMarketPositions.upsert({
      id,
      create: {
        chainId: chain.chainId,
        marketAddress,
        pollAddress,
        user: normalizedUser,
        yesAmount: side === TradeSide.YES ? collateralAmount : 0n,
        noAmount: side === TradeSide.NO ? collateralAmount : 0n,
        yesTokens: side === TradeSide.YES ? tokenAmount : 0n,
        noTokens: side === TradeSide.NO ? tokenAmount : 0n,
        hasRedeemed: false,
        lossRecorded: false,
        firstPositionAt: timestamp,
        lastUpdatedAt: timestamp,
      },
      update: {
        yesAmount: newYesAmount,
        noAmount: newNoAmount,
        yesTokens: newYesTokens,
        noTokens: newNoTokens,
        lastUpdatedAt: timestamp,
      },
    });
  });
}

/**
 * Reduce a user's position when they sell tokens.
 * Called when a user sells YES or NO tokens (AMM only).
 * 
 * Also reduces the collateral amount proportionally to the tokens sold,
 * so that win/loss detection is accurate for users who exit positions.
 */
export async function reducePosition(
  context: PonderContext,
  chain: ChainInfo,
  marketAddress: `0x${string}`,
  userAddress: `0x${string}`,
  side: typeof TradeSide.YES | typeof TradeSide.NO,
  tokenAmount: bigint,
  timestamp: bigint
) {
  const normalizedUser = userAddress.toLowerCase() as `0x${string}`;
  const id = makeId(chain.chainId, marketAddress, normalizedUser);

  await withRetry(async () => {
    const existing = await context.db.userMarketPositions.findUnique({ id });

    if (existing) {
      // Calculate proportional reduction for both tokens and collateral
      // This ensures win/loss detection is accurate for partial exits
      let newYesTokens: bigint = existing.yesTokens;
      let newYesAmount: bigint = existing.yesAmount;
      let newNoTokens: bigint = existing.noTokens;
      let newNoAmount: bigint = existing.noAmount;

      if (side === TradeSide.YES && existing.yesTokens > 0n) {
        // Calculate proportion of YES tokens being sold
        const tokensToReduce: bigint = tokenAmount > existing.yesTokens ? existing.yesTokens : tokenAmount;
        // Proportionally reduce collateral: if selling 50% of tokens, reduce 50% of collateral
        const proportionalAmountReduction: bigint = existing.yesTokens > 0n
          ? (existing.yesAmount * tokensToReduce) / existing.yesTokens
          : 0n;
        
        newYesTokens = existing.yesTokens - tokensToReduce;
        newYesAmount = existing.yesAmount > proportionalAmountReduction 
          ? existing.yesAmount - proportionalAmountReduction 
          : 0n;
      } else if (side === TradeSide.NO && existing.noTokens > 0n) {
        // Calculate proportion of NO tokens being sold
        const tokensToReduce: bigint = tokenAmount > existing.noTokens ? existing.noTokens : tokenAmount;
        // Proportionally reduce collateral
        const proportionalAmountReduction: bigint = existing.noTokens > 0n
          ? (existing.noAmount * tokensToReduce) / existing.noTokens
          : 0n;
        
        newNoTokens = existing.noTokens - tokensToReduce;
        newNoAmount = existing.noAmount > proportionalAmountReduction 
          ? existing.noAmount - proportionalAmountReduction 
          : 0n;
      }

      await context.db.userMarketPositions.update({
        id,
        data: {
          yesTokens: newYesTokens,
          yesAmount: newYesAmount,
          noTokens: newNoTokens,
          noAmount: newNoAmount,
          lastUpdatedAt: timestamp,
        },
      });
    }
  });
}

/**
 * Mark a position as redeemed when user claims winnings.
 */
export async function markPositionRedeemed(
  context: PonderContext,
  chain: ChainInfo,
  marketAddress: `0x${string}`,
  userAddress: `0x${string}`
) {
  const normalizedUser = userAddress.toLowerCase() as `0x${string}`;
  const id = makeId(chain.chainId, marketAddress, normalizedUser);

  await withRetry(async () => {
    const existing = await context.db.userMarketPositions.findUnique({ id });
    if (existing && !existing.hasRedeemed) {
      await context.db.userMarketPositions.update({
        id,
        data: {
          hasRedeemed: true,
        },
      });
    }
  });
}

interface LossResult {
  user: `0x${string}`;
  lostAmount: bigint;
}

/**
 * Process losses for a resolved poll.
 *
 * Uses `trades` (buy-side) and `winnings` tables to determine losers:
 * users who bought on the losing side and never redeemed winnings.
 *
 * @param pollStatus - The resolved status (1=YES wins, 2=NO wins, 3=Unknown/refund)
 * @returns Deduplicated array of users who lost
 */
export async function processLossesForPoll(
  context: PonderContext,
  chain: ChainInfo,
  pollAddress: `0x${string}`,
  pollStatus: number
): Promise<LossResult[]> {
  if (pollStatus === PollStatus.UNKNOWN || pollStatus === PollStatus.PENDING) {
    return [];
  }

  const losingSide = pollStatus === PollStatus.YES ? 'no' : 'yes';
  const losses: LossResult[] = [];

  await withRetry(async () => {
    const markets = await context.db.markets.findMany({
      where: { pollAddress, chainId: chain.chainId },
    });

    for (const market of markets.items) {
      const losingTrades = await context.db.trades.findMany({
        where: {
          marketAddress: market.id,
          chainId: chain.chainId,
          side: losingSide,
        },
      });

      const winningsForMarket = await context.db.winnings.findMany({
        where: {
          marketAddress: market.id,
          chainId: chain.chainId,
        },
      });

      const winners = new Set(
        winningsForMarket.items.map((w: { user: string }) => w.user.toLowerCase()),
      );

      const seenUsers = new Set<string>();
      for (const trade of losingTrades.items) {
        const addr = trade.trader.toLowerCase();
        if (winners.has(addr) || seenUsers.has(addr)) continue;
        seenUsers.add(addr);

        losses.push({
          user: addr as `0x${string}`,
          lostAmount: trade.collateralAmount,
        });
      }
    }
  });

  return losses;
}

/**
 * Update user stats for a loss.
 */
export async function recordUserLoss(
  context: PonderContext,
  chain: ChainInfo,
  userAddress: `0x${string}`
) {
  const normalizedUser = userAddress.toLowerCase() as `0x${string}`;
  const userId = makeId(chain.chainId, normalizedUser);

  await withRetry(async () => {
    const user = await context.db.users.findUnique({ id: userId });
    
    if (user) {
      // Update streak (goes negative for consecutive losses)
      const newStreak = user.currentStreak <= 0 
        ? user.currentStreak - 1 
        : -1;

      await context.db.users.update({
        id: userId,
        data: {
          totalLosses: user.totalLosses + 1,
          currentStreak: newStreak,
        },
      });
    }
  });
}

