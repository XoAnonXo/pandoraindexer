import type { PonderContext, ChainInfo } from "../utils/types";
import { makeId } from "../utils/helpers";
import { withRetry } from "../utils/errors";
import { TradeSide, PollStatus } from "../utils/constants";

/**
 * Record or update a user's position in a market.
 * Called when a user buys YES or NO tokens/shares.
 *
 * Uses findUnique + explicit create/update instead of upsert
 * to avoid Ponder v0.6 upsert issues with the legacy Store API.
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
    const existing = await context.db.userMarketPositions.findUnique({ id });

    if (existing) {
      await context.db.userMarketPositions.update({
        id,
        data: {
          yesAmount: side === TradeSide.YES
            ? existing.yesAmount + collateralAmount
            : existing.yesAmount,
          noAmount: side === TradeSide.NO
            ? existing.noAmount + collateralAmount
            : existing.noAmount,
          yesTokens: side === TradeSide.YES
            ? existing.yesTokens + tokenAmount
            : existing.yesTokens,
          noTokens: side === TradeSide.NO
            ? existing.noTokens + tokenAmount
            : existing.noTokens,
          lastUpdatedAt: timestamp,
        },
      });
    } else {
      await context.db.userMarketPositions.create({
        id,
        data: {
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
      });
    }
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
 * Zeroes out all token/amount fields since the contract burns ALL user tokens on redeem.
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
          yesTokens: 0n,
          noTokens: 0n,
          yesAmount: 0n,
          noAmount: 0n,
        },
      });
    }
  });
}

interface LossResult {
  user: `0x${string}`;
  marketAddress: `0x${string}`;
  yesCostBasis: bigint;
  noCostBasis: bigint;
  yesTokens: bigint;
  noTokens: bigint;
  lostAmount: bigint;
  marketQuestion?: string;
  marketType: string;
  losingSide: string;
}

/**
 * Process losses for a resolved poll.
 *
 * Uses `trades` (buy-side) and `winnings` tables to determine losers:
 * users who bought on the losing side and never redeemed winnings.
 * Returns full cost basis data per user+market for positionHistory.
 *
 * @param pollStatus - The resolved status (1=YES wins, 2=NO wins, 3=Unknown/refund)
 * @returns Deduplicated array of users who lost with cost basis
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

      // Aggregate total spent per user on losing side from trades
      const userLosingSideTotals = new Map<string, bigint>();
      const userLosingTokenTotals = new Map<string, bigint>();
      for (const trade of losingTrades.items) {
        const addr = trade.trader.toLowerCase();
        if (winners.has(addr)) continue;
        const current = userLosingSideTotals.get(addr) ?? 0n;
        userLosingSideTotals.set(addr, current + trade.collateralAmount);
        const currentTokens = userLosingTokenTotals.get(addr) ?? 0n;
        userLosingTokenTotals.set(addr, currentTokens + (trade.tokenAmount ?? 0n));
      }

      // Also get all trades on winning side for these losers (they might have bet both sides)
      const winningSide = losingSide === 'yes' ? 'no' : 'yes';
      const winningSideTrades = await context.db.trades.findMany({
        where: {
          marketAddress: market.id,
          chainId: chain.chainId,
          side: winningSide,
        },
      });
      const userWinningSideTotals = new Map<string, bigint>();
      const userWinningTokenTotals = new Map<string, bigint>();
      for (const trade of winningSideTrades.items) {
        const addr = trade.trader.toLowerCase();
        if (!userLosingSideTotals.has(addr)) continue;
        const current = userWinningSideTotals.get(addr) ?? 0n;
        userWinningSideTotals.set(addr, current + trade.collateralAmount);
        const currentTokens = userWinningTokenTotals.get(addr) ?? 0n;
        userWinningTokenTotals.set(addr, currentTokens + (trade.tokenAmount ?? 0n));
      }

      const poll = await context.db.polls.findUnique({ id: pollAddress });

      for (const [addr, losingSideSpent] of userLosingSideTotals) {
        const winningSideSpent = userWinningSideTotals.get(addr) ?? 0n;
        const losingTokens = userLosingTokenTotals.get(addr) ?? 0n;
        const winningTokens = userWinningTokenTotals.get(addr) ?? 0n;

        losses.push({
          user: addr as `0x${string}`,
          marketAddress: market.id,
          yesCostBasis: losingSide === 'yes' ? losingSideSpent : winningSideSpent,
          noCostBasis: losingSide === 'no' ? losingSideSpent : winningSideSpent,
          yesTokens: losingSide === 'yes' ? losingTokens : winningTokens,
          noTokens: losingSide === 'no' ? losingTokens : winningTokens,
          lostAmount: losingSideSpent,
          marketQuestion: poll?.question,
          marketType: market.marketType,
          losingSide,
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
  await withRetry(async () => {
    const user = await context.db.users.findUnique({ id: normalizedUser });
    
    if (user) {
      const newStreak = user.currentStreak <= 0 
        ? user.currentStreak - 1 
        : -1;

      await context.db.users.update({
        id: normalizedUser,
        data: {
          totalLosses: user.totalLosses + 1,
          currentStreak: newStreak,
        },
      });
    }
  });
}

