import type { PonderContext, ChainInfo } from "../utils/types";
import { makeId } from "../utils/helpers";
import { withRetry } from "../utils/errors";
import { TradeSide, PollStatus } from "../utils/constants";

// =============================================================================
// POSITION TRACKING
// =============================================================================

/**
 * Record or update a user's position in a market.
 * Called when a user buys YES or NO tokens/shares.
 * 
 * Uses try-create-first pattern to avoid TOCTOU race conditions:
 * - Try to create the record
 * - If unique constraint fails, fetch and update the existing record
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
    try {
      // Try to create new position - if this succeeds, we're done
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
    } catch (error: unknown) {
      // Check if it's a unique constraint violation (position already exists)
      const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
      if (errorMessage.includes('unique constraint') || errorMessage.includes('p2002')) {
        // Position exists - fetch current values and update
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
        }
        return;
      }
      // Re-throw other errors
      throw error;
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

// =============================================================================
// LOSS DETECTION
// =============================================================================

interface LossResult {
  user: `0x${string}`;
  lostAmount: bigint;
}

/**
 * Process losses for a resolved poll.
 * 
 * Called when a poll is resolved (AnswerSet event).
 * Finds all users who had positions on the losing side and:
 * 1. Returns their loss amounts
 * 2. Marks their positions as lossRecorded
 * 
 * Performance: Uses Promise.all to parallelize position updates.
 * 
 * @param pollStatus - The resolved status (1=YES wins, 2=NO wins, 3=Unknown/refund)
 * @returns Array of users who lost and their loss amounts
 */
export async function processLossesForPoll(
  context: PonderContext,
  chain: ChainInfo,
  pollAddress: `0x${string}`,
  pollStatus: number
): Promise<LossResult[]> {
  // Skip if outcome is unknown (refund - no losses)
  if (pollStatus === PollStatus.UNKNOWN || pollStatus === PollStatus.PENDING) {
    return [];
  }

  const losses: LossResult[] = [];

  // Determine which side lost
  const losingSide = pollStatus === PollStatus.YES ? 'no' : 'yes';

  await withRetry(async () => {
    // Find all markets linked to this poll
    const markets = await context.db.markets.findMany({
      where: {
        pollAddress: pollAddress,
        chainId: chain.chainId,
      },
    });

    // Collect all positions from all markets in parallel
    const allPositionsResults = await Promise.all(
      markets.items.map((market: { id: `0x${string}` }) => 
        context.db.userMarketPositions.findMany({
          where: {
            marketAddress: market.id,
            chainId: chain.chainId,
            lossRecorded: false,
            hasRedeemed: false, // Users who redeemed are winners, not losers
          },
        })
      )
    );

    // Flatten all positions and identify losers
    const updatePromises: Promise<unknown>[] = [];
    
    for (const positionsResult of allPositionsResults) {
      for (const position of positionsResult.items) {
        // Check if user had a position on the losing side
        const lostAmount = losingSide === 'yes' 
          ? position.yesAmount 
          : position.noAmount;

        if (lostAmount > 0n) {
          losses.push({
            user: position.user,
            lostAmount,
          });

          // Queue position update for parallel execution
          updatePromises.push(
            context.db.userMarketPositions.update({
              id: position.id,
              data: {
                lossRecorded: true,
              },
            })
          );
        }
      }
    }

    // Execute all position updates in parallel
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
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

