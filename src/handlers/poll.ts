import { ponder } from "@/generated";
import { getChainInfo } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";

ponder.on("PredictionPoll:AnswerSet", async ({ event, context }: any) => {
  const { status, setter, reason } = event.args;
  const pollAddress = event.log.address;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);

  console.log(`[${chain.chainName}] AnswerSet event received: ${pollAddress} status=${status}`);

  const poll = await context.db.polls.findUnique({ id: pollAddress });
  if (poll) {
    try {
      await context.db.polls.update({
        id: pollAddress,
        data: {
          status: Number(status),
          setter: setter.toLowerCase() as `0x${string}`,
          resolutionReason: reason.slice(0, 4096),
          resolvedAt: timestamp,
        },
      });
      console.log(`[${chain.chainName}] ✅ Poll UPDATED in DB: ${pollAddress} -> status ${status}`);
    } catch (err) {
      console.error(`[${chain.chainName}] ❌ Failed to update poll ${pollAddress}:`, err);
      throw err;
    }
  } else {
    console.warn(`[${chain.chainName}] ⚠️ Poll not found for AnswerSet: ${pollAddress}`);
  }

  // Use centralized stats update
  await updateAggregateStats(context, chain, timestamp, {
    pollsResolved: 1
  });

  console.log(`[${chain.chainName}] Poll resolved: ${pollAddress} -> status ${status}`);
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

