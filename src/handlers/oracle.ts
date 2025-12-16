import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import { getOrCreateUser } from "../services/db";

ponder.on("PredictionOracle:PollCreated", async ({ event, context }) => {
  const { pollAddress, creator, deadlineEpoch, question } = event.args;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);
  
  await context.db.polls.create({
    id: pollAddress,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      creator: creator.toLowerCase() as `0x${string}`,
      question: question.slice(0, 4096), // Truncate to prevent excessive storage
      rules: "",
      sources: "[]",
      deadlineEpoch: Number(deadlineEpoch),
      finalizationEpoch: 0,
      checkEpoch: 0,
      category: 0,
      status: 0,
      createdAtBlock: event.block.number,
      createdAt: timestamp,
      createdTxHash: event.transaction.hash,
    },
  });

  const user = await getOrCreateUser(context, creator, chain);
  await context.db.users.update({
    id: makeId(chain.chainId, creator.toLowerCase()),
    data: {
      pollsCreated: user.pollsCreated + 1,
    },
  });

  // Use centralized stats update
  await updateAggregateStats(context, chain, timestamp, {
    polls: 1
  });

  console.log(`[${chain.chainName}] Poll created: ${pollAddress}`);
});

ponder.on("PredictionOracle:PollRefreshed", async ({ event, context }) => {
  const { pollAddress, newCheckEpoch } = event.args;
  
  const poll = await context.db.polls.findUnique({ id: pollAddress });
  if (poll) {
    await context.db.polls.update({
      id: pollAddress,
      data: {
        checkEpoch: Number(newCheckEpoch),
      },
    });
  }
});





