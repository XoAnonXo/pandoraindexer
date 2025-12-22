import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import { getOrCreateUser } from "../services/db";

ponder.on("MarketFactory:MarketCreated", async ({ event, context }) => {
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

	const existingMarket = await context.db.markets.findUnique({
		id: marketAddress,
	});

	if (existingMarket) {
		await context.db.markets.update({
			id: marketAddress,
			data: {
				chainId: chain.chainId,
				chainName: chain.chainName,
				pollAddress,
				creator: creator.toLowerCase() as `0x${string}`,
				marketType: "amm",
				// Valid record now
				isIncomplete: false,
				collateralToken: collateral,
				yesToken,
				noToken,
				feeTier: Number(feeTier),
				maxPriceImbalancePerHour: Number(maxPriceImbalancePerHour),
				totalVolume: existingMarket.totalVolume,
				totalTrades: existingMarket.totalTrades,
				currentTvl: existingMarket.currentTvl,
				uniqueTraders: existingMarket.uniqueTraders,
				initialLiquidity: existingMarket.initialLiquidity ?? 0n,
				reserveYes: existingMarket.reserveYes ?? 0n,
				reserveNo: existingMarket.reserveNo ?? 0n,
				yesChance: existingMarket.yesChance ?? 500_000_000n, // Default 50%
				createdAtBlock: event.block.number,
				createdAt: timestamp,
				createdTxHash: event.transaction.hash,
			},
		});
	} else {
		await context.db.markets.create({
			id: marketAddress,
			data: {
				chainId: chain.chainId,
				chainName: chain.chainName,
				pollAddress,
				creator: creator.toLowerCase() as `0x${string}`,
				marketType: "amm",
				isIncomplete: false,
				collateralToken: collateral,
				yesToken,
				noToken,
				feeTier: Number(feeTier),
				maxPriceImbalancePerHour: Number(maxPriceImbalancePerHour),
				totalVolume: 0n,
				totalTrades: 0,
				currentTvl: 0n,
				uniqueTraders: 0,
				initialLiquidity: 0n,
				reserveYes: 0n,
				reserveNo: 0n,
				yesChance: 500_000_000n, // Default 50% before liquidity
				createdAtBlock: event.block.number,
				createdAt: timestamp,
				createdTxHash: event.transaction.hash,
			},
		});
	}

	const user = await getOrCreateUser(context, creator, chain);
	await context.db.users.update({
		id: makeId(chain.chainId, creator.toLowerCase()),
		data: {
			marketsCreated: user.marketsCreated + 1,
		},
	});

	// Use centralized stats update
	await updateAggregateStats(context, chain, timestamp, {
		markets: 1,
		ammMarkets: 1,
	});

	console.log(`[${chain.chainName}] AMM market created: ${marketAddress}`);
});

ponder.on("MarketFactory:PariMutuelCreated", async ({ event, context }) => {
	const {
		pollAddress,
		marketAddress,
		creator,
		collateral,
		curveFlattener,
		curveOffset,
	} = event.args;
	const timestamp = event.block.timestamp;
	const chain = getChainInfo(context);

	const existingMarket = await context.db.markets.findUnique({
		id: marketAddress,
	});

	if (existingMarket) {
		await context.db.markets.update({
			id: marketAddress,
			data: {
				chainId: chain.chainId,
				chainName: chain.chainName,
				pollAddress,
				creator: creator.toLowerCase() as `0x${string}`,
				marketType: "pari",
				// Valid record now
				isIncomplete: false,
				collateralToken: collateral,
				curveFlattener: Number(curveFlattener),
				curveOffset: Number(curveOffset),
				totalVolume: existingMarket.totalVolume,
				totalTrades: existingMarket.totalTrades,
				currentTvl: existingMarket.currentTvl,
				uniqueTraders: existingMarket.uniqueTraders,
				initialLiquidity: existingMarket.initialLiquidity ?? 0n,
				// Preserve existing PariMutuel pool state if already set
				totalCollateralYes: existingMarket.totalCollateralYes ?? 0n,
				totalCollateralNo: existingMarket.totalCollateralNo ?? 0n,
				yesChance: existingMarket.yesChance ?? 500_000_000n, // Default 50%
				createdAtBlock: event.block.number,
				createdAt: timestamp,
				createdTxHash: event.transaction.hash,
			},
		});
	} else {
		await context.db.markets.create({
			id: marketAddress,
			data: {
				chainId: chain.chainId,
				chainName: chain.chainName,
				pollAddress,
				creator: creator.toLowerCase() as `0x${string}`,
				marketType: "pari",
				isIncomplete: false,
				collateralToken: collateral,
				curveFlattener: Number(curveFlattener),
				curveOffset: Number(curveOffset),
				totalVolume: 0n,
				totalTrades: 0,
				currentTvl: 0n,
				uniqueTraders: 0,
				initialLiquidity: 0n,
				// Initialize PariMutuel pool state
				totalCollateralYes: 0n,
				totalCollateralNo: 0n,
				yesChance: 500_000_000n, // Default 50% before seeding
				createdAtBlock: event.block.number,
				createdAt: timestamp,
				createdTxHash: event.transaction.hash,
			},
		});
	}

	const user = await getOrCreateUser(context, creator, chain);
	await context.db.users.update({
		id: makeId(chain.chainId, creator.toLowerCase()),
		data: {
			marketsCreated: user.marketsCreated + 1,
		},
	});

	// Use centralized stats update
	await updateAggregateStats(context, chain, timestamp, {
		markets: 1,
		pariMarkets: 1,
	});

	console.log(
		`[${chain.chainName}] PariMutuel market created: ${marketAddress}`
	);
});
