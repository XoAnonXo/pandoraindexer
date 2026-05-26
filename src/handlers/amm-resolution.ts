import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import { getOrCreateUser } from "../services/db";
import { markPositionRedeemed } from "../services/positions";
import { updateReferralVolume } from "../services/referral";
import { PredictionAMMAbi } from "../../abis/PredictionAMM";
import { PredictionPollAbi } from "../../abis/PredictionPoll";
import { PollStatus } from "../utils/constants";
import { updateMarketReserves, isPollResolved } from "./amm-shared";
import { handleProtocolFeesWithdrawn } from "../services/protocolFees";

const BPS_DENOMINATOR = 1_000_000n;

// The WinningsRedeemed event does not include the protocol fee.
// Reconstruct it: read protocolFeeRate from the contract at this block,
// then apply the same ceil formula as _calculateAndCollectProtocolFee:
//   totalFee = ceil(gross * rate / BPS_DENOMINATOR)
// Only the platform's half (50/50 split with market creator) counts
// toward the referral reward base.
function protocolFeeFromGross(gross: bigint, rate: bigint): bigint {
	if (gross === 0n || rate === 0n) return 0n;
	return (gross * rate + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

ponder.on("PredictionAMM:WinningsRedeemed", async ({ event, context }: any) => {
	const { user, yesAmount, noAmount, collateralAmount } = event.args;
	const timestamp = event.block.timestamp;
	const marketAddress = event.log.address;
	const chain = getChainInfo(context);
	const winningId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

	const market = await context.db.markets.findUnique({ id: marketAddress });
	const poll = market?.pollAddress ? await context.db.polls.findUnique({ id: market.pollAddress }) : null;

	const pollAddress = (await context.client.readContract({
		address: marketAddress,
		abi: PredictionAMMAbi,
		functionName: "pollAddress",
		blockNumber: event.block.number,
	})) as `0x${string}`;

	let totalProtocolFee = 0n;
	let platformShareForReferral = 0n;
	try {
		const pollStatus = await context.client.readContract({
			address: pollAddress,
			abi: PredictionPollAbi,
			functionName: "getStatus",
			blockNumber: event.block.number,
		});
		const status = Number(pollStatus);
		const yesBI = BigInt(yesAmount);
		const noBI = BigInt(noAmount);

		let gross = 0n;
		if (status === PollStatus.YES) gross = yesBI;
		else if (status === PollStatus.NO) gross = noBI;
		else if (status === PollStatus.UNKNOWN) gross = (yesBI + noBI) / 2n;

		if (status !== PollStatus.UNKNOWN && status !== PollStatus.PENDING && gross > 0n) {
			const feeRate = await context.client.readContract({
				address: marketAddress,
				abi: PredictionAMMAbi,
				functionName: "protocolFeeRate",
				blockNumber: event.block.number,
			});
			totalProtocolFee = protocolFeeFromGross(gross, BigInt(feeRate));
			platformShareForReferral = totalProtocolFee / 2n;
		}
	} catch (err) {
		console.error(
			`[PredictionAMM:WinningsRedeemed] fee derivation failed market=${marketAddress} tx=${event.transaction.hash}:`,
			err,
		);
	}

	await context.db.winnings.create({
		id: winningId,
		data: {
			chainId: chain.chainId,
			chainName: chain.chainName,
			user: user.toLowerCase() as `0x${string}`,
			marketAddress,
			collateralAmount,
			feeAmount: totalProtocolFee,
			yesTokenAmount: yesAmount,
			noTokenAmount: noAmount,
			marketQuestion: poll?.question,
			marketType: "amm",
			txHash: event.transaction.hash,
			timestamp,
		},
	});

	const normalizedUser = user.toLowerCase() as `0x${string}`;

	await markPositionRedeemed(context, chain, marketAddress, normalizedUser);

	if (market) {
		await updateMarketReserves(
			context,
			marketAddress,
			market.pollAddress,
			chain.chainName,
			BigInt(event.block.number),
		);
	}

	const userData = await getOrCreateUser(context, user, chain);
	const newStreak = userData.currentStreak >= 0 ? userData.currentStreak + 1 : 1;
	const bestStreak = Math.max(userData.bestStreak, newStreak);
	const newTotalWinnings = (userData.totalWinnings ?? 0n) + collateralAmount;
	const newRealizedPnL = (userData.totalWithdrawn ?? 0n) + newTotalWinnings - (userData.totalDeposited ?? 0n);

	await context.db.users.update({
		id: makeId(chain.chainId, user.toLowerCase()),
		data: {
			totalWinnings: newTotalWinnings,
			totalWins: userData.totalWins + 1,
			currentStreak: newStreak,
			bestStreak,
			realizedPnL: newRealizedPnL,
		},
	});

	await updateAggregateStats(context, chain, timestamp, {
		winningsPaid: collateralAmount,
		tvlChange: 0n - collateralAmount,
	});

	await updateReferralVolume(
		context,
		user.toLowerCase() as `0x${string}`,
		collateralAmount,
		platformShareForReferral,
		timestamp,
		event.block.number,
		chain,
		marketAddress,
	);
});

ponder.on("PredictionAMM:Sync", async ({ event, context }: any) => {
	const { rYes, rNo } = event.args;
	const marketAddress = event.log.address;

	const market = await context.db.markets.findUnique({ id: marketAddress });
	if (market) {
		const reserveYes = BigInt(rYes);
		const reserveNo = BigInt(rNo);
		const totalReserves = reserveYes + reserveNo;
		const yesChance = totalReserves > 0n ? (reserveNo * 1_000_000_000n) / totalReserves : 500_000_000n;

		const poll = await context.db.polls.findUnique({ id: market.pollAddress });
		const resolved = isPollResolved(poll?.status);

		await context.db.markets.update({
			id: marketAddress,
			data: {
				reserveYes,
				reserveNo,
				...(resolved ? {} : { yesChance }),
			},
		});
	}
});

ponder.on("PredictionAMM:ProtocolFeesWithdrawn", async ({ event, context }: any) => {
	try {
		const { platformShare, creatorShare } = event.args;
		const marketAddress = event.log.address;
		const chain = getChainInfo(context);

		const rawReserves = await context.client.readContract({
			address: marketAddress,
			abi: PredictionAMMAbi,
			functionName: "getReserves",
			blockNumber: event.block.number,
		});

		const reserveYes = BigInt(rawReserves[0]);
		const reserveNo = BigInt(rawReserves[1]);
		const collateralTvl = BigInt(rawReserves[4]);
		const totalReserves = reserveYes + reserveNo;
		const yesChance = totalReserves > 0n ? (reserveNo * 1_000_000_000n) / totalReserves : 500_000_000n;

		await handleProtocolFeesWithdrawn({
			context,
			chain,
			marketAddress,
			timestamp: event.block.timestamp,
			blockNumber: BigInt(event.block.number),
			txHash: event.transaction.hash,
			logIndex: event.log.logIndex,
			platformShare: BigInt(platformShare ?? 0),
			creatorShare: BigInt(creatorShare ?? 0),
			marketType: "amm",
			currentTvl: collateralTvl,
			reserves: { reserveYes, reserveNo, yesChance },
		});
	} catch (err) {
		console.error(
			`[PredictionAMM:ProtocolFeesWithdrawn] Failed tx=${event.transaction.hash} logIndex=${event.log.logIndex}:`,
			err,
		);
	}
});
