import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import {
	getOrCreateUser,
	getOrCreateMinimalMarket,
	isNewTraderForMarket,
	recordMarketInteraction,
} from "../services/db";
// TODO: Referral system disabled for now - ReferralFactory not deployed on Ethereum
// Volume is still tracked in trades/users/markets tables for future referral calculations
// import { updateReferralVolume } from "../services/referral";
import { updatePollTvl } from "../services/pollTvl";
import { PredictionPariMutuelAbi } from "../../abis/PredictionPariMutuel";
import { recordPriceTickAndCandles } from "../services/candles";

const YES_PRICE_SCALE = 1_000_000_000n; // 1e9

function computeYesChanceFromCollateral(params: {
	totalCollateralYes: bigint;
	totalCollateralNo: bigint;
}): bigint {
	const { totalCollateralYes, totalCollateralNo } = params;
	const total = totalCollateralYes + totalCollateralNo;
	if (total <= 0n) return 500_000_000n;
	return (totalCollateralYes * YES_PRICE_SCALE) / total;
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
				trader: market.creator, // Creator is the trader here
				marketAddress,
				pollAddress,
				tradeType: "seed",
				side: "both", // Special side for seeding
				collateralAmount: totalLiquidity,
				tokenAmount: 0n, // Shares calculation is complex for seed, leaving 0 for now
				feeAmount: 0n,
				txHash: event.transaction.hash,
				blockNumber: event.block.number,
				timestamp,
			},
		});

		const user = await getOrCreateUser(context, market.creator, chain);
		await context.db.users.update({
			id: makeId(chain.chainId, market.creator.toLowerCase()),
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
			id: makeId(chain.chainId, buyer.toLowerCase()),
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

		await context.db.winnings.create({
			id: winningId,
			data: {
				chainId: chain.chainId,
				chainName: chain.chainName,
				user: user.toLowerCase() as `0x${string}`,
				marketAddress,
				collateralAmount,
				feeAmount: fee,
				marketQuestion: poll?.question,
				marketType: "pari",
				outcome: Number(outcome),
				txHash: event.transaction.hash,
				timestamp,
			},
		});

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
		const newStreak = isWin
			? userData.currentStreak >= 0
				? userData.currentStreak + 1
				: 1
			: userData.currentStreak <= 0
			? userData.currentStreak - 1
			: -1;
		const bestStreak = Math.max(
			userData.bestStreak,
			newStreak > 0 ? newStreak : 0
		);

		const newTotalWinnings =
			(userData.totalWinnings ?? 0n) + collateralAmount;
		const newRealizedPnL =
			(userData.totalWithdrawn ?? 0n) +
			newTotalWinnings -
			(userData.totalDeposited ?? 0n);

		await context.db.users.update({
			id: makeId(chain.chainId, user.toLowerCase()),
			data: {
				totalWinnings: newTotalWinnings,
				totalWins: isWin ? userData.totalWins + 1 : userData.totalWins,
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
	}
);

ponder.on(
	"PredictionPariMutuel:ProtocolFeesWithdrawn",
	async ({ event, context }: any) => {
		try {
			const { platformShare, creatorShare } = event.args;
			const timestamp = event.block.timestamp;
			const marketAddress = event.log.address;
			const chain = getChainInfo(context);

			// 1) Read on-chain state first (no DB writes before this succeeds)
			const marketState = await context.client.readContract({
				address: marketAddress,
				abi: PredictionPariMutuelAbi,
				functionName: "marketState",
				blockNumber: event.block.number,
			});

			// marketState returns: (isLive, collateralTvl, yesChance, collateral)
			const tvlNow = BigInt(marketState[1]);

			// 2) Load (or create) market after successful reads
			const market =
				(await context.db.markets.findUnique({ id: marketAddress })) ??
				(await getOrCreateMinimalMarket(
					context,
					marketAddress,
					chain,
					"pari",
					timestamp,
					event.block.number,
					event.transaction.hash
				));

			const oldTvl = market.currentTvl ?? 0n;
			const delta = tvlNow - oldTvl;

			const creatorShareBigInt = BigInt(creatorShare ?? 0);
			const platformShareBigInt = BigInt(platformShare ?? 0);

			// Apply DB writes last
			await context.db.markets.update({
				id: marketAddress,
				data: {
					currentTvl: tvlNow,
					creatorFeesEarned:
						(market.creatorFeesEarned ?? 0n) + creatorShareBigInt,
					platformFeesEarned:
						(market.platformFeesEarned ?? 0n) + platformShareBigInt,
				},
			});

			// Sync poll TVL after market TVL update
			await updatePollTvl(context, market.pollAddress);

			if (delta !== 0n) {
				await updateAggregateStats(context, chain, timestamp, {
					tvlChange: delta,
				});
			}

			//  Update creator's totalCreatorFees if creatorShare > 0
			if (creatorShareBigInt > 0n && market.creator) {
				const creatorUser = await getOrCreateUser(
					context,
					market.creator,
					chain
				);
				await context.db.users.update({
					id: creatorUser.id,
					data: {
						totalCreatorFees:
							(creatorUser.totalCreatorFees ?? 0n) +
							creatorShareBigInt,
					},
				});
			}

			//  Update platform stats with platformShare
			if (platformShareBigInt > 0n) {
				await updateAggregateStats(context, chain, timestamp, {
					platformFees: platformShareBigInt,
				});
			}
		} catch (err) {
			console.error(
				`[PredictionPariMutuel:ProtocolFeesWithdrawn] Failed tx=${event.transaction.hash} logIndex=${event.log.logIndex}:`,
				err
			);
			return;
		}
	}
);
