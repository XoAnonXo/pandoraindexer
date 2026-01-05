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

	let category = 0;
	let rules = "";
	let sources = "[]";
	let finalizationEpoch = 0;
	let arbiter: `0x${string}` | undefined = undefined;
	let status = 0;
	let resolutionReason = "";
  let checkEpoch = 0;

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

	console.log(
		`[${chain.chainName}] Poll created: ${pollAddress} (category: ${category})`
	);
});

ponder.on("PredictionOracle:PollRefreshed", async ({ event, context }: any) => {
  const { pollAddress, oldCheckEpoch, newCheckEpoch, wasFree } = event.args;
  const chain = getChainInfo(context);
  
  const poll = await context.db.polls.findUnique({ id: pollAddress });
  if (poll) {
    await context.db.polls.update({
      id: pollAddress,
      data: {
        checkEpoch: Number(newCheckEpoch),
        lastRefreshWasFree: Boolean(wasFree),
        lastRefreshOldCheckEpoch: Number(oldCheckEpoch),
      },
    });
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
