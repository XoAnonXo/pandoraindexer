import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import { getOrCreateUser } from "../services/db";
import { createPublicClient, http } from "viem";
import { PredictionPollAbi } from "../../abis/PredictionPoll";

const latestClient = createPublicClient({
	transport: http("https://rpc.soniclabs.com"),
});

ponder.on("PredictionOracle:PollCreated", async ({ event, context }) => {
	const { pollAddress, creator, deadlineEpoch, question } = event.args;
	const timestamp = event.block.timestamp;
	const chain = getChainInfo(context);

	let category = 0;
	let rules = "";
	let sources = "[]";
	let checkEpoch = 0;

	try {
		const pollData = await latestClient.readContract({
			address: pollAddress,
			abi: PredictionPollAbi,
			functionName: "getPollData",
		});

		category = Number(pollData.category);
		rules = (pollData.rules || "").slice(0, 4096);
		sources = JSON.stringify(pollData.sources || []);
		checkEpoch = Number(pollData.finalizationEpoch);
	} catch (err) {
		console.error(`Error getting poll data for ${pollAddress}:`, err);
	}

	await context.db.polls.create({
		id: pollAddress,
		data: {
			chainId: chain.chainId,
			chainName: chain.chainName,
			creator: creator.toLowerCase() as `0x${string}`,
			question: question.slice(0, 4096),
			rules,
			sources,
			deadlineEpoch: Number(deadlineEpoch),
			finalizationEpoch: 0,
			checkEpoch,
			category,
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

	await updateAggregateStats(context, chain, timestamp, {
		polls: 1,
	});

	console.log(
		`[${chain.chainName}] Poll created: ${pollAddress} (category: ${category})`
	);
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
