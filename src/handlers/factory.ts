import { ponder } from "ponder:registry";
import { polls, markets, users, graduatedCreators, marketSystems } from "ponder:schema";
import { getChainInfo, makeId } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import { getOrCreateUser, getNextMarketId } from "../services/db";
import { updatePollTvl } from "../services/pollTvl";
import { PredictionPariMutuelAbi } from "../../abis/PredictionPariMutuel";
import { PredictionAMMAbi } from "../../abis/PredictionAMM";
import { PRICE_SCALE } from "../utils/constants";

function triggerImageGeneration(context: any, pollAddress: string, chainName: string): void {
	const apiUrl = process.env.PANDORA_API_URL;
	if (!apiUrl) return;

	context.db
		.find(polls, { id: pollAddress })
		.then((poll: any) => {
			if (!poll?.question) {
				console.error(`[${chainName}] No question found for ${pollAddress}`);
				return;
			}

			fetch(`${apiUrl}/api/image-generate`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					pollId: pollAddress.toLowerCase(),
					question: poll.question.slice(0, 500),
					category: String(poll.category ?? 0),
				}),
			})
				.then((res: any) => {
					console.log(`[${chainName}] Image generation triggered for ${pollAddress}: ${res.status}`);
				})
				.catch((err: any) => {
					console.error(
						`[${chainName}] Image generation request failed for ${pollAddress}:`,
						err?.message || err,
					);
				});
		})
		.catch(() => {});
}

ponder.on("MarketFactory:MarketCreated", async ({ event, context }: any) => {
	try {
		const {
			pollAddress,
			marketAddress,
			creator,
			yesToken,
			noToken,
			collateral,
			feeTier,
			maxPriceImbalancePerHour,
		} = event.args;
		const timestamp = event.block.timestamp;
		const chain = getChainInfo(context);

		const normalizedCreator = creator.toLowerCase() as `0x${string}`;

		// Read marketCloseTimestamp from AMM contract (same as PariMutuel)
		// This is set by MarketFactory: (deadlineEpoch - bufferEpochs) * EPOCH_LENGTH
		const closeTs = await context.client.readContract({
			address: marketAddress,
			abi: PredictionAMMAbi,
			functionName: "marketCloseTimestamp",
			blockNumber: event.block.number,
		});
		const marketCloseTimestamp = BigInt(closeTs);

		// For AMM, market starts when it's created (no explicit startTimestamp in contract)
		const marketStartTimestamp = timestamp;

		const existing = await context.db.find(markets, { id: marketAddress });
		const numericId = existing?.numericId ?? (await getNextMarketId(context));

		await context.db.insert(markets).values({
			id: marketAddress,
			chainId: chain.chainId,
			chainName: chain.chainName,
			pollAddress,
			creator: normalizedCreator,
			marketType: "amm",
			isIncomplete: false,
			collateralToken: collateral,
			yesToken,
			noToken,
			feeTier: Number(feeTier),
			maxPriceImbalancePerHour: Number(maxPriceImbalancePerHour),
			marketStartTimestamp,
			marketCloseTimestamp,
			totalVolume: 0n,
			volume24h: 0n,
			trades24h: 0,
			totalTrades: 0,
			currentTvl: 0n,
			uniqueTraders: 0,
			initialLiquidity: 0n,
			reserveYes: 0n,
			reserveNo: 0n,
			totalHold: 0n,
			yesChance: 500_000_000n,
			creatorFeesEarned: 0n,
			platformFeesEarned: 0n,
			numericId,
			createdAtBlock: event.block.number,
			createdAt: timestamp,
			createdTxHash: event.transaction.hash,
		}).onConflictDoUpdate((row: any) => ({
			chainId: chain.chainId,
			chainName: chain.chainName,
			pollAddress,
			creator: normalizedCreator,
			marketType: "amm",
			isIncomplete: false,
			collateralToken: collateral,
			yesToken,
			noToken,
			feeTier: Number(feeTier),
			maxPriceImbalancePerHour: Number(maxPriceImbalancePerHour),
			marketStartTimestamp,
			marketCloseTimestamp,
			totalVolume: row.totalVolume,
			volume24h: row.volume24h ?? 0n,
			trades24h: row.trades24h ?? 0,
			totalTrades: row.totalTrades,
			currentTvl: row.currentTvl,
			uniqueTraders: row.uniqueTraders,
			initialLiquidity: row.initialLiquidity ?? 0n,
			reserveYes: row.reserveYes ?? 0n,
			reserveNo: row.reserveNo ?? 0n,
			totalHold: (row.reserveYes ?? 0n) + (row.reserveNo ?? 0n),
			yesChance: row.yesChance ?? 500_000_000n,
			creatorFeesEarned: row.creatorFeesEarned ?? 0n,
			platformFeesEarned: row.platformFeesEarned ?? 0n,
			numericId,
			createdAtBlock: event.block.number,
			createdAt: timestamp,
			createdTxHash: event.transaction.hash,
		}));

		const user = await getOrCreateUser(context, creator, chain);
		await context.db.update(users, { id: normalizedCreator }).set({
			marketsCreated: user.marketsCreated + 1,
		});

		await updateAggregateStats(context, chain, timestamp, {
			markets: 1,
			ammMarkets: 1,
		});

		// Sync poll TVL (will be 0 initially, but sets up the fields)
		await updatePollTvl(context, pollAddress);

		// Check if creator is graduated (has Launchpad token that reached $50k TVL)
		const isGraduated = await context.db.find(graduatedCreators, {
			id: normalizedCreator,
		});

		// Create marketSystems entry to track referral system
		await context.db.insert(marketSystems).values({
			id: marketAddress.toLowerCase() as `0x${string}`,
			creator: normalizedCreator,
			system: isGraduated ? "localizer" : "pandora",
			switchedAt: isGraduated ? timestamp : undefined,
		});

		console.log(
			`[${chain.chainName}] AMM market created: ${marketAddress} (system: ${
				isGraduated ? "localizer" : "pandora"
			})`,
		);

		triggerImageGeneration(context, pollAddress, chain.chainName);
	} catch (err) {
		console.error(
			`[MarketFactory:MarketCreated] Failed tx=${event.transaction.hash} logIndex=${event.log.logIndex}:`,
			err,
		);
		return;
	}
});

ponder.on("MarketFactory:PariMutuelCreated", async ({ event, context }: any) => {
	try {
		const { pollAddress, marketAddress, creator, collateral, curveFlattener, curveOffset } = event.args;
		const timestamp = event.block.timestamp;
		const chain = getChainInfo(context);
		const normalizedCreator = creator.toLowerCase() as `0x${string}`;

		// Reads first (no DB writes before these succeed).
		const [startTs, closeTs] = await Promise.all([
			context.client.readContract({
				address: marketAddress,
				abi: PredictionPariMutuelAbi,
				functionName: "marketStartTimestamp",
				blockNumber: event.block.number,
			}),
			context.client.readContract({
				address: marketAddress,
				abi: PredictionPariMutuelAbi,
				functionName: "marketCloseTimestamp",
				blockNumber: event.block.number,
			}),
		]);
		const marketStartTimestamp = BigInt(startTs);
		const marketCloseTimestamp = BigInt(closeTs);

		const existing = await context.db.find(markets, { id: marketAddress });
		const numericId = existing?.numericId ?? (await getNextMarketId(context));

		await context.db.insert(markets).values({
			id: marketAddress,
			chainId: chain.chainId,
			chainName: chain.chainName,
			pollAddress,
			creator: normalizedCreator,
			marketType: "pari",
			isIncomplete: false,
			collateralToken: collateral,
			curveFlattener: Number(curveFlattener),
			curveOffset: Number(curveOffset),
			marketStartTimestamp,
			marketCloseTimestamp,
			totalVolume: 0n,
			volume24h: 0n,
			trades24h: 0,
			totalTrades: 0,
			currentTvl: 0n,
			uniqueTraders: 0,
			initialLiquidity: 0n,
			totalCollateralYes: 0n,
			totalCollateralNo: 0n,
			yesChance: 500_000_000n,
			creatorFeesEarned: 0n,
			platformFeesEarned: 0n,
			numericId,
			createdAtBlock: event.block.number,
			createdAt: timestamp,
			createdTxHash: event.transaction.hash,
		}).onConflictDoUpdate((row: any) => {
			const totalYes = row.totalCollateralYes ?? 0n;
			const totalNo = row.totalCollateralNo ?? 0n;

			const total = totalYes + totalNo;
			const correctedYesChance = total > 0n ? (totalYes * PRICE_SCALE) / total : 500_000_000n;

			return {
				chainId: chain.chainId,
				chainName: chain.chainName,
				pollAddress,
				creator: normalizedCreator,
				marketType: "pari",
				isIncomplete: false,
				collateralToken: collateral,
				curveFlattener: Number(curveFlattener),
				curveOffset: Number(curveOffset),
				marketStartTimestamp,
				marketCloseTimestamp,
				totalVolume: row.totalVolume,
				volume24h: row.volume24h ?? 0n,
				trades24h: row.trades24h ?? 0,
				totalTrades: row.totalTrades,
				currentTvl: row.currentTvl,
				uniqueTraders: row.uniqueTraders,
				initialLiquidity: row.initialLiquidity ?? 0n,
				totalCollateralYes: totalYes,
				totalCollateralNo: totalNo,
				yesChance: correctedYesChance,
				creatorFeesEarned: row.creatorFeesEarned ?? 0n,
				platformFeesEarned: row.platformFeesEarned ?? 0n,
				numericId,
				createdAtBlock: event.block.number,
				createdAt: timestamp,
				createdTxHash: event.transaction.hash,
			};
		});

		const user = await getOrCreateUser(context, creator, chain);
		await context.db.update(users, { id: normalizedCreator }).set({
			marketsCreated: user.marketsCreated + 1,
		});

		await updateAggregateStats(context, chain, timestamp, {
			markets: 1,
			pariMarkets: 1,
		});

		// Sync poll TVL (will be 0 initially, but sets up the fields)
		await updatePollTvl(context, pollAddress);

		// Check if creator is graduated (has Launchpad token that reached $50k TVL)
		const isGraduated = await context.db.find(graduatedCreators, {
			id: normalizedCreator,
		});

		// Create marketSystems entry to track referral system
		await context.db.insert(marketSystems).values({
			id: marketAddress.toLowerCase() as `0x${string}`,
			creator: normalizedCreator,
			system: isGraduated ? "localizer" : "pandora",
			switchedAt: isGraduated ? timestamp : undefined,
		});

		console.log(
			`[${chain.chainName}] PariMutuel market created: ${marketAddress} (system: ${
				isGraduated ? "localizer" : "pandora"
			})`,
		);

		triggerImageGeneration(context, pollAddress, chain.chainName);
	} catch (err) {
		console.error(
			`[MarketFactory:PariMutuelCreated] Failed tx=${event.transaction.hash} logIndex=${event.log.logIndex}:`,
			err,
		);
		return;
	}
});
