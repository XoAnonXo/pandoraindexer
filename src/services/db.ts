import { ChainInfo, makeId } from "../utils/helpers";
import { withRetry } from "../utils/errors";
import { PredictionAMMAbi } from "../../abis/PredictionAMM";
import { PredictionPariMutuelAbi } from "../../abis/PredictionPariMutuel";

/**
 * Check if a trader is new to a specific market using the optimized marketUsers table.
 */
export async function isNewTraderForMarket(
  context: any,
  marketAddress: `0x${string}`,
  traderAddress: `0x${string}`,
  chain: ChainInfo
): Promise<boolean> {
  const id = makeId(chain.chainId, marketAddress, traderAddress);
  // This is a simple read, might not strictly need retry but good for consistency
  return withRetry(async () => {
    const record = await context.db.marketUsers.findUnique({ id });
    return !record;
  });
}

/**
 * Record a user's interaction with a market.
 * Creates or updates the marketUsers record.
 */
export async function recordMarketInteraction(
  context: any,
  marketAddress: `0x${string}`,
  traderAddress: `0x${string}`,
  chain: ChainInfo,
  timestamp: bigint
) {
  const id = makeId(chain.chainId, marketAddress, traderAddress);
  await withRetry(async () => {
    await context.db.marketUsers.upsert({
      id,
      create: {
        chainId: chain.chainId,
        marketAddress,
        user: traderAddress,
        lastTradeAt: timestamp,
      },
      update: {
        lastTradeAt: timestamp,
      },
    });
  });
}

/**
 * Get existing user record or create a new one with default values.
 */
export async function getOrCreateUser(context: any, address: `0x${string}`, chain: ChainInfo) {
  // Normalize address to lowercase for consistent storage
  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  const id = makeId(chain.chainId, normalizedAddress);
  
  return withRetry(async () => {
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
          // Referral stats (all start at zero/null)
          totalReferrals: 0,
          totalReferralVolume: 0n,
          totalReferralFees: 0n,
          totalReferralRewards: 0n,
          // Timestamps left null until first trade
        },
      });
    }
    return user;
  });
}

/**
 * Safely get or create a minimal market record with race condition handling.
 * If market doesn't exist, fetches data on-chain to avoid placeholder/fake addresses.
 */
export async function getOrCreateMinimalMarket(
  context: any, 
  marketAddress: `0x${string}`, 
  chain: ChainInfo,
  marketType: "amm" | "pari",
  timestamp: bigint,
  blockNumber: bigint,
  txHash?: `0x${string}`
) {
  return withRetry(async () => {
    // Check if market already exists
    let market = await context.db.markets.findUnique({ id: marketAddress });
    
    if (!market) {
      // Create incomplete market record immediately without on-chain fetches
      // This avoids blocking the indexer when contracts don't exist at historical blocks
      // The MarketFactory events will create complete records for valid markets
      console.log(`[${chain.chainName}] Creating incomplete market record for ${marketAddress} (no factory event found)`);
      
      const zeroAddr = "0x0000000000000000000000000000000000000000" as `0x${string}`;
      const pollAddress = zeroAddr;
      const creator = zeroAddr;
      const collateralToken = zeroAddr;
      const yesToken: `0x${string}` | undefined = undefined;
      const noToken: `0x${string}` | undefined = undefined;
      const feeTier: number | undefined = undefined;
      const maxPriceImbalancePerHour: number | undefined = undefined;
      const curveFlattener: number | undefined = undefined;
      const curveOffset: number | undefined = undefined;
      const fetchFailed = true;

      try {
        market = await context.db.markets.create({
          id: marketAddress,
          data: {
            chainId: chain.chainId,
            chainName: chain.chainName,
            // Flag as incomplete if on-chain fetch failed
            isIncomplete: fetchFailed, 
            pollAddress: pollAddress.toLowerCase() as `0x${string}`,
            creator: creator.toLowerCase() as `0x${string}`,
            marketType,
            collateralToken: collateralToken.toLowerCase() as `0x${string}`,
            yesToken: yesToken?.toLowerCase() as `0x${string}`,
            noToken: noToken?.toLowerCase() as `0x${string}`,
            feeTier,
            maxPriceImbalancePerHour,
            curveFlattener,
            curveOffset,
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
        if (fetchFailed) {
          console.log(`[${chain.chainName}] Created incomplete market record for ${marketAddress}.`);
        } else {
          console.log(`[${chain.chainName}] Successfully backfilled market ${marketAddress} from on-chain data.`);
        }
      } catch (e: any) {
        // Handle race condition: another handler created the market first (e.g. factory event processed in parallel?)
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
  });
}
