import { ponder } from "@/generated";
import { getChainInfo } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";

ponder.on("PredictionPoll:AnswerSet", async ({ event, context }) => {
  const { status, reason } = event.args;
  const pollAddress = event.log.address;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);

  const poll = await context.db.polls.findUnique({ id: pollAddress });
  if (poll) {
    await context.db.polls.update({
      id: pollAddress,
      data: {
        status: Number(status),
        resolutionReason: reason.slice(0, 4096), // Truncate to prevent excessive storage
        resolvedAt: timestamp,
      },
    });
  }

  // Use centralized stats update
  await updateAggregateStats(context, chain, timestamp, {
    pollsResolved: 1
  });

  console.log(`[${chain.chainName}] Poll resolved: ${pollAddress} -> status ${status}`);
});





