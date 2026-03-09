import { ponder } from "@/generated";
import { getChainInfo } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import { processLossesForPoll, recordUserLoss } from "../services/positions";
import { PollStatus, PRICE_SCALE } from "../utils/constants";

function resolvedYesChance(status: number): bigint | null {
  if (status === PollStatus.YES) return PRICE_SCALE;
  if (status === PollStatus.NO) return 0n;
  // UNKNOWN: keep last real price for both AMM and PariMutuel.
  // Refund mechanics are independent of market price.
  return null;
}

ponder.on("PredictionPoll:AnswerSet", async ({ event, context }: any) => {
  const { status, setter, reason } = event.args;
  const pollAddress = event.log.address;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);
  const resolvedStatus = Number(status);

  console.log(`[${chain.chainName}] AnswerSet event received: ${pollAddress} status=${resolvedStatus}`);

  const poll = await context.db.polls.findUnique({ id: pollAddress });
  if (poll) {
    try {
      await context.db.polls.update({
        id: pollAddress,
        data: {
          status: resolvedStatus,
          setter: setter.toLowerCase() as `0x${string}`,
          resolutionReason: reason.slice(0, 4096),
          resolvedAt: timestamp,
        },
      });
      console.log(`[${chain.chainName}] ✅ Poll UPDATED in DB: ${pollAddress} -> status ${resolvedStatus}`);
    } catch (err) {
      console.error(`[${chain.chainName}] ❌ Failed to update poll ${pollAddress}:`, err);
      throw err;
    }

    // Update yesChance on all markets for this poll to reflect final payout price
    try {
      const markets = await context.db.markets.findMany({
        where: { pollAddress, chainId: chain.chainId },
      });
      let updatedCount = 0;
      for (const market of markets.items) {
        const finalYesChance = resolvedYesChance(resolvedStatus);
        if (finalYesChance !== null) {
          await context.db.markets.update({
            id: market.id,
            data: { yesChance: finalYesChance },
          });
          updatedCount++;
        }
      }
      if (updatedCount > 0) {
        console.log(`[${chain.chainName}] 💰 Updated yesChance for ${updatedCount} market(s) of poll ${pollAddress}`);
      }
    } catch (err) {
      console.error(`[${chain.chainName}] ❌ Failed to update yesChance for ${pollAddress}:`, err);
    }

    try {
      const losses = await processLossesForPoll(context, chain, pollAddress, resolvedStatus);
      for (const loss of losses) {
        await recordUserLoss(context, chain, loss.user);
      }
      if (losses.length > 0) {
        console.log(`[${chain.chainName}] 📉 Recorded ${losses.length} losses for poll ${pollAddress}`);
      }
    } catch (err) {
      console.error(`[${chain.chainName}] ❌ Failed to process losses for ${pollAddress}:`, err);
    }
  } else {
    console.warn(`[${chain.chainName}] ⚠️ Poll not found for AnswerSet: ${pollAddress}`);
  }

  await updateAggregateStats(context, chain, timestamp, {
    pollsResolved: 1
  });

  console.log(`[${chain.chainName}] Poll resolved: ${pollAddress} -> status ${resolvedStatus}`);
});

ponder.on("PredictionPoll:ArbitrationStarted", async ({ event, context }: any) => {
  const { arbiter, oldFinalizationEpoch, newFinalizationEpoch } = event.args;
  const pollAddress = event.log.address;
  const timestamp = event.block.timestamp;

  await context.db.polls.update({
    id: pollAddress,
    data: {
      arbitrationStarted: true,
      disputedBy: arbiter.toLowerCase(),
      disputedAt: timestamp,
      finalizationEpoch: Number(newFinalizationEpoch),
    },
  });
});

