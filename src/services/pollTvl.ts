import { eq } from "ponder";
import { markets, polls } from "ponder:schema";

/**
 * Updates a poll's TVL fields based on all its markets' currentTvl.
 * 
 * This function:
 * 1. Fetches all markets for the given poll
 * 2. Calculates max and total TVL
 * 3. Updates the poll record
 * 
 * @param context - Ponder context
 * @param pollAddress - Poll contract address (hex)
 */
export async function updatePollTvl(
  context: any,
  pollAddress: string
): Promise<void> {
  try {
    // Fetch all markets for this poll
    const marketRows = await context.db.sql.select().from(markets).where(
      eq(markets.pollAddress, pollAddress.toLowerCase() as `0x${string}`)
    );

    if (marketRows.length === 0) {
      // No markets yet - set TVL to 0
      await context.db.update(polls, {
        id: pollAddress.toLowerCase() as `0x${string}`,
      }).set({
        maxMarketTvl: 0n,
        totalMarketsTvl: 0n,
      });
      return;
    }

    // Calculate max and total TVL across all markets
    let maxTvl = 0n;
    let totalTvl = 0n;

    for (const market of marketRows) {
      const tvl = market.currentTvl ?? 0n;
      if (tvl > maxTvl) {
        maxTvl = tvl;
      }
      totalTvl += tvl;
    }

    // Update poll with aggregated TVL
    await context.db.update(polls, {
      id: pollAddress.toLowerCase() as `0x${string}`,
    }).set({
      maxMarketTvl: maxTvl,
      totalMarketsTvl: totalTvl,
    });
  } catch (err) {
    console.error(`[pollTvl] Failed to update TVL for poll ${pollAddress}:`, err);
    // Don't throw - this is a best-effort update
  }
}
