import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import { getOrCreateUser } from "../services/db";
import { PredictionPollAbi } from "../../abis/PredictionPoll";
import { PredictionOracleAbi } from "../../abis/PredictionOracle";

ponder.on("PredictionOracle:PollCreated", async ({ event, context }: any) => {
  const { pollAddress, creator, deadlineEpoch, question } = event.args;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);

  console.log(`[${chain.chainName}] PollCreated event received: ${pollAddress} block=${event.block.number}`);

  let category = 0;
  let rules = "";
  let sources = "[]";
  let finalizationEpoch = 0;
  let arbiter: `0x${string}` | undefined = undefined;
  let status = 0;
  let resolutionReason = "";
  let checkEpoch = 0;

  try {
    const [pollData, checkEpochRaw] = await Promise.all([
      context.client.readContract({
        address: pollAddress,
        abi: PredictionPollAbi,
        functionName: "getPollData",
        blockNumber: event.block.number,
      }),
      context.client.readContract({
        address: event.log.address,
        abi: PredictionOracleAbi,
        functionName: "getCurrentCheckEpoch",
        args: [pollAddress],
        blockNumber: event.block.number,
      }),
    ]);

    category = Number(pollData.category);
    rules = (pollData.rules || "").slice(0, 4096);
    sources = JSON.stringify(pollData.sources || []);
    finalizationEpoch = Number(pollData.finalizationEpoch);
    arbiter = (pollData.arbiter?.toLowerCase?.() ?? pollData.arbiter) as `0x${string}`;
    status = Number(pollData.status);
    resolutionReason = (pollData.resolutionReason || "").slice(0, 4096);
    checkEpoch = Number(checkEpochRaw);

    console.log(`[${chain.chainName}] Poll data fetched: category=${category}, status=${status}, arbiter=${arbiter}`);
  } catch (err) {
    console.error(`[${chain.chainName}] Failed to fetch poll data for ${pollAddress}:`, err);
    throw err;
  }

  try {
    await context.db.polls.create({
      id: pollAddress,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        creator: creator.toLowerCase(),
        arbiter,
        question: question.slice(0, 4096),
        rules,
        sources,
        deadlineEpoch: Number(deadlineEpoch),
        finalizationEpoch,
        checkEpoch,
        category,
        status,
        resolutionReason,
        arbitrationStarted: false,
        createdAtBlock: event.block.number,
        createdAt: timestamp,
        createdTxHash: event.transaction.hash,
      },
    });
    console.log(`[${chain.chainName}] ✅ Poll SAVED to DB: ${pollAddress} (category: ${category})`);
  } catch (err) {
    console.error(`[${chain.chainName}] ❌ Failed to save poll ${pollAddress} to DB:`, err);
    throw err;
  }

  try {
    const user = await getOrCreateUser(context, creator, chain);
    await context.db.users.update({
      id: makeId(chain.chainId, creator.toLowerCase()),
      data: {
        pollsCreated: user.pollsCreated + 1,
      },
    });

    await updateAggregateStats(context, chain, timestamp, {
      polls: 1,
    });
    console.log(`[${chain.chainName}] ✅ User & stats updated for poll ${pollAddress}`);
  } catch (err) {
    console.error(`[${chain.chainName}] ⚠️ Poll saved but failed to update user/stats:`, err);
    // Don't throw - poll is already saved
  }
});

ponder.on("PredictionOracle:PollRefreshed", async ({ event, context }: any) => {
  const { pollAddress, oldCheckEpoch, newCheckEpoch, wasFree } = event.args;
  const chain = getChainInfo(context);

  console.log(
    `[${chain.chainName}] PollRefreshed: ${pollAddress} checkEpoch ${oldCheckEpoch} -> ${newCheckEpoch} (wasFree: ${wasFree})`
  );

  const poll = await context.db.polls.findUnique({ id: pollAddress });
  if (poll) {
    await context.db.polls.update({
      id: pollAddress,
      data: {
        status: 0,
        resolvedAt: null,
        resolutionReason: "",
        setter: null,
        checkEpoch: Number(newCheckEpoch),
        lastRefreshWasFree: Boolean(wasFree),
        lastRefreshOldCheckEpoch: Number(oldCheckEpoch),
      },
    });
    console.log(
      `[${chain.chainName}] ✅ Poll reset to Pending: ${pollAddress}`
    );
  }
});

ponder.on("PredictionOracle:OperatorGasFeeUpdated", async ({ event, context }: any) => {
  try {
    const { newFee } = event.args;
    const chain = getChainInfo(context);

    await context.db.oracleFeeEvents.create({
      id: makeId(chain.chainId, event.transaction.hash, event.log.logIndex),
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        oracleAddress: event.log.address,
        eventName: "OperatorGasFeeUpdated",
        newFee,
        txHash: event.transaction.hash,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
      },
    });
  } catch (err) {
    console.error(
      `[PredictionOracle:OperatorGasFeeUpdated] Failed tx=${event.transaction.hash} logIndex=${event.log.logIndex}:`,
      err
    );
    return;
  }
});

ponder.on("PredictionOracle:ProtocolFeeUpdated", async ({ event, context }: any) => {
  try {
    const { newFee } = event.args;
    const chain = getChainInfo(context);

    await context.db.oracleFeeEvents.create({
      id: makeId(chain.chainId, event.transaction.hash, event.log.logIndex),
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        oracleAddress: event.log.address,
        eventName: "ProtocolFeeUpdated",
        newFee,
        txHash: event.transaction.hash,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
      },
    });
  } catch (err) {
    console.error(
      `[PredictionOracle:ProtocolFeeUpdated] Failed tx=${event.transaction.hash} logIndex=${event.log.logIndex}:`,
      err
    );
    return;
  }
});

ponder.on("PredictionOracle:ProtocolFeesWithdrawn", async ({ event, context }: any) => {
  try {
    const { to, amount } = event.args;
    const chain = getChainInfo(context);

    await context.db.oracleFeeEvents.create({
      id: makeId(chain.chainId, event.transaction.hash, event.log.logIndex),
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        oracleAddress: event.log.address,
        eventName: "ProtocolFeesWithdrawn",
        to: to.toLowerCase() as `0x${string}`,
        amount,
        txHash: event.transaction.hash,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
      },
    });
  } catch (err) {
    console.error(
      `[PredictionOracle:ProtocolFeesWithdrawn] Failed tx=${event.transaction.hash} logIndex=${event.log.logIndex}:`,
      err
    );
    return;
  }
});
