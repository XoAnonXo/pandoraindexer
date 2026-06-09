import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import {
	getOrCreateUser,
	getOrCreateMinimalMarket,
	isNewTraderForMarket,
	recordMarketInteraction,
} from "../services/db";
import { updatePollTvl } from "../services/pollTvl";
import { recordPosition, markPositionRedeemed } from "../services/positions";
import { PredictionPariMutuelAbi } from "../../abis/PredictionPariMutuel";
import { recordPriceTickAndCandles } from "../services/candles";
import { PRICE_SCALE } from "../utils/constants";
import { handleProtocolFeesWithdrawn } from "../services/protocolFees";
import { updateReferralVolume } from "../services/referral";

function computeYesChanceFromCollateral(params: {
	totalCollateralYes: bigint;
	totalCollateralNo: bigint;
}): bigint {
	const { totalCollateralYes, totalCollateralNo } = params;
	const total = totalCollateralYes + totalCollateralNo;
	if (total <= 0n) return 500_000_000n;
	return (totalCollateralYes * PRICE_SCALE) / total;
}

ponder.on(
	"PredictionPariMutuel:SeedInitialLiquidity",
	async ({ event, context }: any) => {
		const { yesAmount, noAmount } = event.args;
		const timestamp = event.block.timestamp;
		const marketAddress = event.log.address;
		const chain = getChainInfo(context);

		const totalLiquidity = yesAmount + noAmount;

		const market = await getOrCreateMinimalMarket(
			context,
			marketAddress,
			chain,
			"pari",
			timestamp,
			event.block.number,
			event.transaction.hash
		);
		const pollAddress = market.pollAddress;

		const tradeId = makeId(
			chain.chainId,
			event.transaction.hash,
			event.log.logIndex
		);
		// Creator gets both YES and NO shares, effectively betting on both
		// We record it as a special "seed" trade
		await context.db.trades.create({
			id: tradeId,
			data: {
				chainId: chain.chainId,
				chainName: chain.chainName,
				trader: market.creator,
				marketAddress,
				pollAddress,
				tradeType: "seed",
				side: "both",
				collateralAmount: totalLiquidity,
				tokenAmount: 0n,
				feeAmount: 0n,
				txHash: event.transaction.hash,
				blockNumber: event.block.number,
				timestamp,
			},
		});

		const creatorAddr = market.creator.toLowerCase() as `0x${string}`;
		await recordPosition(
			context, chain, marketAddress, pollAddress,
			creatorAddr, "yes", yesAmount, yesAmount, timestamp
		);
		await recordPosition(
			context, chain, marketAddress, pollAddress,
			creatorAddr, "no", noAmount, noAmount, timestamp
		);

		const user = await getOrCreateUser(context, market.creator, chain);
		await context.db.users.update({
			id: market.creator.toLowerCase(),
			data: {
				totalDeposited: user.totalDeposited + totalLiquidity,
				lastTradeAt: timestamp,
			},
		});

		const yesChance = computeYesChanceFromCollateral({
			totalCollateralYes: yesAmount,
			totalCollateralNo: noAmount,
		});

		await context.db.markets.update({
			id: marketAddress,
			data: {
				currentTvl: market.currentTvl + totalLiquidity,
				totalVolume: market.totalVolume + totalLiquidity,
				initialLiquidity: totalLiquidity,

				totalCollateralYes: yesAmount,
				totalCollateralNo: noAmount,
				totalSharesYes: yesAmount,
				totalSharesNo: noAmount,
				yesChance: yesChance,
			},
		});

		// Sync poll TVL after market TVL update
		await updatePollTvl(context, pollAddress);

		// Record price tick + candles for PariMutuel using collateral-ratio yesChance (scaled 1e9).
		await recordPriceTickAndCandles({
			context,
			marketAddress,
			timestamp,
			blockNumber: BigInt(event.block.number),
			logIndex: event.log.logIndex,
			yesPrice: yesChance,
			volume: totalLiquidity,
			side: "both",
			tradeType: "seed",
			txHash: event.transaction.hash,
		});

		// Use centralized stats update
		await updateAggregateStats(context, chain, timestamp, {
			tvlChange: totalLiquidity,
			volume: totalLiquidity,
		});

		// TODO: Referral tracking disabled - volume already saved in trades table
		// await updateReferralVolume(
		// 	context,
		// 	market.creator,
		// 	totalLiquidity,
		// 	0n,
		// 	timestamp,
		// 	event.block.number,
		// 	chain,
		// 	marketAddress
		// );

		console.log(
			`[${chain.chainName}] Seed liquidity (volume): ${marketAddress} - ${totalLiquidity}`
		);
	}
);

ponder.on(
	"PredictionPariMutuel:PositionPurchased",
	async ({ event, context }: any) => {
		const { buyer, isYes, collateralIn, sharesOut } = event.args;
		const timestamp = event.block.timestamp;
		const marketAddress = event.log.address;
		const chain = getChainInfo(context);

		const tradeId = makeId(
			chain.chainId,
			event.transaction.hash,
			event.log.logIndex
		);

		const market = await getOrCreateMinimalMarket(
			context,
			marketAddress,
			chain,
			"pari",
			timestamp,
			event.block.number,
			event.transaction.hash
		);
		const pollAddress = market.pollAddress;

		await context.db.trades.create({
			id: tradeId,
			data: {
				chainId: chain.chainId,
				chainName: chain.chainName,
				trader: buyer.toLowerCase() as `0x${string}`,
				marketAddress,
				pollAddress,
				tradeType: "bet",
				side: isYes ? "yes" : "no",
				collateralAmount: collateralIn,
				tokenAmount: sharesOut,
				feeAmount: 0n,
				txHash: event.transaction.hash,
				blockNumber: event.block.number,
				timestamp,
			},
		});

		await recordPosition(
			context, chain, marketAddress, pollAddress,
			buyer.toLowerCase() as `0x${string}`,
			isYes ? "yes" : "no", collateralIn, sharesOut, timestamp
		);

		const user = await getOrCreateUser(context, buyer, chain);
		const isNewUser = user.totalTrades === 0;
		const isNewTrader = await isNewTraderForMarket(
			context,
			marketAddress,
			buyer,
			chain
		);

		await recordMarketInteraction(
			context,
			marketAddress,
			buyer,
			chain,
			timestamp
		);

		await context.db.users.update({
			id: buyer.toLowerCase(),
			data: {
				totalTrades: user.totalTrades + 1,
				totalVolume: user.totalVolume + collateralIn,
				totalDeposited: user.totalDeposited + collateralIn,
				firstTradeAt: user.firstTradeAt ?? timestamp,
				lastTradeAt: timestamp,
			},
		});

		// Calculate updated pool values
		const currentYesCollateral = market.totalCollateralYes ?? 0n;
		const currentNoCollateral = market.totalCollateralNo ?? 0n;
		const currentYesShares = market.totalSharesYes ?? 0n;
		const currentNoShares = market.totalSharesNo ?? 0n;

		const newYesCollateral = isYes
			? currentYesCollateral + collateralIn
			: currentYesCollateral;
		const newNoCollateral = isYes
			? currentNoCollateral
			: currentNoCollateral + collateralIn;

		// Track shares purchased (sharesOut from event)
		const newYesShares = isYes
			? currentYesShares + sharesOut
			: currentYesShares;
		const newNoShares = isYes
			? currentNoShares
			: currentNoShares + sharesOut;

		const newYesChance = computeYesChanceFromCollateral({
			totalCollateralYes: newYesCollateral,
			totalCollateralNo: newNoCollateral,
		});

		await context.db.markets.update({
			id: marketAddress,
			data: {
				totalVolume: market.totalVolume + collateralIn,
				totalTrades: market.totalTrades + 1,
				currentTvl: market.currentTvl + collateralIn,
				uniqueTraders: isNewTrader
					? market.uniqueTraders + 1
					: market.uniqueTraders,
				// Update PariMutuel pool state
				totalCollateralYes: newYesCollateral,
				totalCollateralNo: newNoCollateral,
				// Update shares tracking
				totalSharesYes: newYesShares,
				totalSharesNo: newNoShares,
				yesChance: newYesChance,
			},
		});

		// Sync poll TVL after market TVL update
		await updatePollTvl(context, pollAddress);

		// Record price tick + candles for PariMutuel using collateral-ratio yesChance (scaled 1e9).
		await recordPriceTickAndCandles({
			context,
			marketAddress,
			timestamp,
			blockNumber: BigInt(event.block.number),
			logIndex: event.log.logIndex,
			yesPrice: newYesChance,
			volume: collateralIn,
			side: isYes ? "yes" : "no",
			tradeType: "bet",
			txHash: event.transaction.hash,
		});

		// Use centralized stats update
		await updateAggregateStats(context, chain, timestamp, {
			trades: 1,
			volume: collateralIn,
			tvlChange: collateralIn,
			users: isNewUser ? 1 : 0,
			activeUsers: 1,
		});

		// TODO: Referral tracking disabled - volume already saved in trades table
		// await updateReferralVolume(
		// 	context,
		// 	buyer,
		// 	collateralIn,
		// 	0n,
		// 	timestamp,
		// 	event.block.number,
		// 	chain,
		// 	marketAddress
		// );
	}
);

ponder.on(
	"PredictionPariMutuel:WinningsRedeemed",
	async ({ event, context }: any) => {
		const { user, collateralAmount, outcome, fee } = event.args;
		const timestamp = event.block.timestamp;
		const marketAddress = event.log.address;
		const chain = getChainInfo(context);
		const winningId = makeId(
			chain.chainId,
			event.transaction.hash,
			event.log.logIndex
		);

		const market = await context.db.markets.findUnique({
			id: marketAddress,
		});
		const poll = market?.pollAddress
			? await context.db.polls.findUnique({ id: market.pollAddress })
			: null;

		// Read user's cost basis BEFORE marking redeemed (which zeroes amounts)
		const normalizedUser = user.toLowerCase() as `0x${string}`;
		const positionId = makeId(chain.chainId, marketAddress, normalizedUser);
		const position = await context.db.userMarketPositions.findUnique({ id: positionId });

		// For pari-mutuel: outcome 0=Unknown(refund), 1=Yes, 2=No, 3=Unknown
		const outcomeNum = Number(outcome);
		let winningSide: string;
		if (outcomeNum === 0 || outcomeNum === 3) {
			winningSide = "both";
		} else if (outcomeNum === 1) {
			winningSide = "yes";
		} else {
			winningSide = "no";
		}

		await context.db.winnings.create({
			id: winningId,
			data: {
				chainId: chain.chainId,
				chainName: chain.chainName,
				user: normalizedUser,
				marketAddress,
				collateralAmount,
				feeAmount: fee,
				yesCostBasis: position?.yesAmount ?? 0n,
				noCostBasis: position?.noAmount ?? 0n,
				side: winningSide,
				pollStatus: outcomeNum === 0 ? 3 : outcomeNum,
				marketQuestion: poll?.question,
				marketType: "pari",
				outcome: outcomeNum,
				txHash: event.transaction.hash,
				timestamp,
			},
		});

		// Write positionHistory — single source for History tab
		const yesCost = position?.yesAmount ?? 0n;
		const noCost = position?.noAmount ?? 0n;
		const yesTokensHeld = position?.yesTokens ?? 0n;
		const noTokensHeld = position?.noTokens ?? 0n;
		const historyResult = (outcomeNum === 0 || outcomeNum === 3) ? "refunded" : "won";
		const resolvedPollStatus = outcomeNum === 0 ? 3 : outcomeNum;
		const computedPnl = collateralAmount - yesCost - noCost;

		await context.db.positionHistory.upsert({
			id: positionId,
			create: {
				chainId: chain.chainId,
				user: normalizedUser,
				marketAddress,
				pollAddress: market?.pollAddress ?? undefined,
				marketQuestion: poll?.question,
				marketType: "pari",
				side: winningSide,
				result: historyResult,
				pollStatus: resolvedPollStatus,
				yesCostBasis: yesCost,
				noCostBasis: noCost,
				yesTokens: yesTokensHeld,
				noTokens: noTokensHeld,
				collateralReceived: collateralAmount,
				feeAmount: fee,
				pnl: computedPnl,
				resolvedAt: timestamp,
				txHash: event.transaction.hash,
			},
			update: {
				collateralReceived: collateralAmount,
				feeAmount: fee,
				pnl: computedPnl,
				result: historyResult,
				resolvedAt: timestamp,
				txHash: event.transaction.hash,
			},
		});

		await markPositionRedeemed(context, chain, marketAddress, normalizedUser);

		if (market) {
			const newMarketTvl =
				market.currentTvl > collateralAmount
					? market.currentTvl - collateralAmount
					: 0n;
			await context.db.markets.update({
				id: marketAddress,
				data: {
					currentTvl: newMarketTvl,
				},
			});

			// Sync poll TVL after market TVL update
			await updatePollTvl(context, market.pollAddress);
		}

		const userData = await getOrCreateUser(context, user, chain);
		const isWin = outcome !== 3;

		const newTotalWinnings =
			(userData.totalWinnings ?? 0n) + collateralAmount;
		const newRealizedPnL =
			(userData.totalWithdrawn ?? 0n) +
			newTotalWinnings -
			(userData.totalDeposited ?? 0n);

		const priorWinnings = await context.db.winnings.findMany({
			where: {
				user: user.toLowerCase() as `0x${string}`,
				marketAddress,
				chainId: chain.chainId,
			},
		});
		const isFirstWinForMarket = isWin && priorWinnings.items.length <= 1;

		const newStreak = isFirstWinForMarket
			? (userData.currentStreak >= 0 ? userData.currentStreak + 1 : 1)
			: !isWin
			? (userData.currentStreak <= 0 ? userData.currentStreak - 1 : -1)
			: userData.currentStreak;
		const bestStreak = Math.max(
			userData.bestStreak,
			newStreak > 0 ? newStreak : 0
		);

		await context.db.users.update({
			id: user.toLowerCase(),
			data: {
				totalWinnings: newTotalWinnings,
				totalWins: isFirstWinForMarket ? userData.totalWins + 1 : userData.totalWins,
				currentStreak: newStreak,
				bestStreak,
				realizedPnL: newRealizedPnL,
			},
		});

		// Use centralized stats update
		await updateAggregateStats(context, chain, timestamp, {
			winningsPaid: collateralAmount,
			tvlChange: 0n - collateralAmount,
			fees: fee,
		});

		const platformShare = fee / 2n;
		await updateReferralVolume(
			context,
			user.toLowerCase() as `0x${string}`,
			collateralAmount,
			platformShare,
			timestamp,
			event.block.number,
			chain,
			marketAddress
		);
	}
);

ponder.on(
	"PredictionPariMutuel:ProtocolFeesWithdrawn",
	async ({ event, context }: any) => {
		try {
			const { platformShare, creatorShare } = event.args;
			const marketAddress = event.log.address;
			const chain = getChainInfo(context);

			const marketState = await context.client.readContract({
				address: marketAddress,
				abi: PredictionPariMutuelAbi,
				functionName: "marketState",
				blockNumber: event.block.number,
			});

			const tvlNow = BigInt(marketState[1]);

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
				marketType: "pari",
				currentTvl: tvlNow,
			});
		} catch (err) {
			console.error(
				`[PredictionPariMutuel:ProtocolFeesWithdrawn] Failed tx=${event.transaction.hash} logIndex=${event.log.logIndex}:`,
				err
			);
		}
	}
);
