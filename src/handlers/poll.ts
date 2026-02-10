import { ponder } from "@/generated";
import { getChainInfo } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";

// =============================================================================
// SHARED HANDLER FUNCTIONS (used by both new and legacy contracts)
// =============================================================================

const handleAnswerSet = async ({ event, context }: any) => {
  const { status, setter, reason } = event.args;
  const pollAddress = event.log.address;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);

  const poll = await context.db.polls.findUnique({ id: pollAddress });
  if (poll) {
    await context.db.polls.update({
      id: pollAddress,
      data: {
        status: Number(status),
        setter: setter.toLowerCase() as `0x${string}`,
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
};

const handleArbitrationStarted = async ({ event, context }: any) => {
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
};

// =============================================================================
// REGISTER HANDLERS -- new contracts
// =============================================================================
ponder.on("PredictionPoll:AnswerSet", handleAnswerSet);
ponder.on("PredictionPoll:ArbitrationStarted", handleArbitrationStarted);

// =============================================================================
// REGISTER HANDLERS -- legacy contracts (old oracle, active markets with TVL)
// =============================================================================
ponder.on("PredictionPollLegacy:AnswerSet", handleAnswerSet);
ponder.on("PredictionPollLegacy:ArbitrationStarted", handleArbitrationStarted);

