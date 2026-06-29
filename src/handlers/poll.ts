import { ponder } from "ponder:registry";
import { polls, positionHistory } from "ponder:schema";
import { getChainInfo, makeId } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import { processLossesForPoll, recordUserLoss } from "../services/positions";
import { PollStatus } from "../utils/constants";

ponder.on("PredictionPoll:AnswerSet", async ({ event, context }: any) => {
  const { status, setter, reason } = event.args;
  const pollAddress = event.log.address;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);
  const resolvedStatus = Number(status);

  console.log(`[${chain.chainName}] AnswerSet event received: ${pollAddress} status=${resolvedStatus}`);

  const poll = await context.db.find(polls, { id: pollAddress });
  if (poll) {
    try {
      await context.db.update(polls, { id: pollAddress }).set({
        status: resolvedStatus,
        setter: setter.toLowerCase() as `0x${string}`,
        resolutionReason: reason.slice(0, 4096),
        resolvedAt: timestamp,
      });
      console.log(`[${chain.chainName}] ✅ Poll UPDATED in DB: ${pollAddress} -> status ${resolvedStatus}`);
    } catch (err) {
      console.error(`[${chain.chainName}] ❌ Failed to update poll ${pollAddress}:`, err);
      throw err;
    }

    try {
      const losses = await processLossesForPoll(context, chain, pollAddress, resolvedStatus);
      for (const loss of losses) {
        await recordUserLoss(context, chain, loss.user);

        // Write positionHistory for losses
        const historyId = makeId(chain.chainId, loss.marketAddress, loss.user);
        const losingSideCost = loss.losingSide === "yes"
          ? loss.yesCostBasis
          : loss.noCostBasis;

        await context.db.insert(positionHistory).values({
          id: historyId,
          chainId: chain.chainId,
          user: loss.user,
          marketAddress: loss.marketAddress,
          pollAddress: pollAddress,
          marketQuestion: loss.marketQuestion,
          marketType: loss.marketType,
          side: loss.losingSide,
          result: "lost",
          pollStatus: resolvedStatus,
          yesCostBasis: loss.yesCostBasis,
          noCostBasis: loss.noCostBasis,
          yesTokens: loss.yesTokens,
          noTokens: loss.noTokens,
          collateralReceived: 0n,
          feeAmount: 0n,
          pnl: -losingSideCost,
          resolvedAt: timestamp,
        }).onConflictDoUpdate({
          result: "lost",
          pollStatus: resolvedStatus,
          collateralReceived: 0n,
          pnl: -losingSideCost,
          resolvedAt: timestamp,
        });
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

  await context.db.update(polls, { id: pollAddress }).set({
    arbitrationStarted: true,
    disputedBy: arbiter.toLowerCase(),
    disputedAt: timestamp,
    finalizationEpoch: Number(newFinalizationEpoch),
  });
});
