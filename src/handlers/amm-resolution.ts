import { ponder } from "ponder:registry";
import { markets, polls, userMarketPositions, winnings, positionHistory, users } from "ponder:schema";
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

	const market = await context.db.find(markets, { id: marketAddress });
	const poll = market?.pollAddress ? await context.db.find(polls, { id: market.pollAddress }) : null;

	const pollAddress = (await context.client.readContract({
		address: marketAddress,
		abi: PredictionAMMAbi,
		functionName: "pollAddress",
		blockNumber: event.block.number,
	})) as `0x${string}`;

	let totalProtocolFee = 0n;
	let platformShareForReferral = 0n;
	let resolvedPollStatus: number | undefined;
	const yesBI = BigInt(yesAmount);
	const noBI = BigInt(noAmount);

	try {
		const pollStatus = await context.client.readContract({
			address: pollAddress,
			abi: PredictionPollAbi,
			functionName: "getStatus",
			blockNumber: event.block.number,
		});
		const status = Number(pollStatus);
		resolvedPollStatus = status;

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

	// Read user's cost basis BEFORE marking redeemed (which zeroes amounts)
	const normalizedUser = user.toLowerCase() as `0x${string}`;
	const positionId = makeId(chain.chainId, marketAddress, normalizedUser);
	const position = await context.db.find(userMarketPositions, { id: positionId });

	// Determine which side the user was on
	let winningSide: string;
	if (resolvedPollStatus === PollStatus.UNKNOWN) {
		winningSide = "both";
	} else if (yesBI > 0n && noBI === 0n) {
		winningSide = "yes";
	} else if (noBI > 0n && yesBI === 0n) {
		winningSide = "no";
	} else {
		winningSide = "both";
	}

	await context.db.insert(winnings).values({
		id: winningId,
		chainId: chain.chainId,
		chainName: chain.chainName,
		user: normalizedUser,
		marketAddress,
		collateralAmount,
		feeAmount: totalProtocolFee,
		yesTokenAmount: yesAmount,
		noTokenAmount: noAmount,
		yesCostBasis: position?.yesAmount ?? 0n,
		noCostBasis: position?.noAmount ?? 0n,
		side: winningSide,
		pollStatus: resolvedPollStatus,
		marketQuestion: poll?.question,
		marketType: "amm",
		txHash: event.transaction.hash,
		timestamp,
	});

	// Write positionHistory — single source for History tab
	const yesCost = position?.yesAmount ?? 0n;
	const noCost = position?.noAmount ?? 0n;
	const yesTokensHeld = position?.yesTokens ?? 0n;
	const noTokensHeld = position?.noTokens ?? 0n;
	const historyResult = resolvedPollStatus === PollStatus.UNKNOWN ? "refunded" : "won";
	const computedPnl = collateralAmount - yesCost - noCost;

	await context.db.insert(positionHistory).values({
		id: positionId,
		chainId: chain.chainId,
		user: normalizedUser,
		marketAddress,
		pollAddress: market?.pollAddress ?? undefined,
		marketQuestion: poll?.question,
		marketType: "amm",
		side: winningSide,
		result: historyResult,
		pollStatus: resolvedPollStatus ?? 0,
		yesCostBasis: yesCost,
		noCostBasis: noCost,
		yesTokens: yesTokensHeld,
		noTokens: noTokensHeld,
		collateralReceived: collateralAmount,
		feeAmount: totalProtocolFee,
		pnl: computedPnl,
		resolvedAt: timestamp,
		txHash: event.transaction.hash,
	}).onConflictDoUpdate({
		collateralReceived: collateralAmount,
		feeAmount: totalProtocolFee,
		pnl: computedPnl,
		result: historyResult,
		resolvedAt: timestamp,
		txHash: event.transaction.hash,
	});

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

	await context.db.update(users, { id: user.toLowerCase() }).set({
		totalWinnings: newTotalWinnings,
		totalWins: userData.totalWins + 1,
		currentStreak: newStreak,
		bestStreak,
		realizedPnL: newRealizedPnL,
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

	const market = await context.db.find(markets, { id: marketAddress });
	if (market) {
		const reserveYes = BigInt(rYes);
		const reserveNo = BigInt(rNo);
		const totalReserves = reserveYes + reserveNo;
		const yesChance = totalReserves > 0n ? (reserveNo * 1_000_000_000n) / totalReserves : 500_000_000n;

		const poll = await context.db.find(polls, { id: market.pollAddress });
		const resolved = isPollResolved(poll?.status);

		await context.db.update(markets, { id: marketAddress }).set({
			reserveYes,
			reserveNo,
			...(resolved ? {} : { yesChance }),
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
