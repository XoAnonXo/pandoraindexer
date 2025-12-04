import { ponder } from "@/generated";
import { getChainInfo } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import { processLossesForPoll, recordUserLoss } from "../services/positions";
import { PollStatus } from "../utils/constants";

// =============================================================================
// POLL ANSWER SET (Resolution)
// =============================================================================

ponder.on("PredictionPoll:AnswerSet", async ({ event, context }) => {
  const { status, reason } = event.args;
  const pollAddress = event.log.address;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);
  const pollStatus = Number(status);

  // Update poll record
  const poll = await context.db.polls.findUnique({ id: pollAddress });
  if (poll) {
    await context.db.polls.update({
      id: pollAddress,
      data: {
        status: pollStatus,
        resolutionReason: reason.slice(0, 4096), // Truncate to prevent excessive storage
        resolvedAt: timestamp,
      },
    });
  }

  // Process losses for all users who bet on the losing side
  // Skip if outcome is unknown (refund) or pending
  if (pollStatus !== PollStatus.UNKNOWN && pollStatus !== PollStatus.PENDING) {
    const losses = await processLossesForPoll(context, chain, pollAddress, pollStatus);
    
    // Record loss for each user in parallel for better performance
    if (losses.length > 0) {
      await Promise.all(
        losses.map(loss => recordUserLoss(context, chain, loss.user))
      );
      console.log(`[${chain.chainName}] Processed ${losses.length} losses for poll ${pollAddress} (status=${pollStatus})`);
    }
  }

  // Update aggregate stats
  await updateAggregateStats(context, chain, timestamp, {
    pollsResolved: 1,
  });

  console.log(`[${chain.chainName}] Poll resolved: ${pollAddress} -> status ${status}`);
});
