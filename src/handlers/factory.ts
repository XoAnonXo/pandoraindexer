import { ponder } from "@/generated";
import { getChainInfo, makeId, calculatePariMutuelYesChance } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import { getOrCreateUser } from "../services/db";
import { PredictionPariMutuelAbi } from "../../abis/PredictionPariMutuel";

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

		// No on-chain reads here; prepare values first, then DB writes.
		const normalizedCreator = creator.toLowerCase() as `0x${string}`;

		await context.db.markets.upsert({
			id: marketAddress,
			create: {
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
				totalVolume: 0n,
				totalTrades: 0,
				currentTvl: 0n,
				uniqueTraders: 0,
        initialLiquidity: 0n,
        reserveYes: 0n,
        reserveNo: 0n,
        yesChance: 500_000_000n,
        creatorFeesEarned: 0n,
        platformFeesEarned: 0n,
        createdAtBlock: event.block.number,
        createdAt: timestamp,
        createdTxHash: event.transaction.hash,
			},
			update: ({ current }: any) => ({
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
				// Preserve accumulated stats/state.
				totalVolume: current.totalVolume,
				totalTrades: current.totalTrades,
				currentTvl: current.currentTvl,
				uniqueTraders: current.uniqueTraders,
			initialLiquidity: current.initialLiquidity ?? 0n,
			reserveYes: current.reserveYes ?? 0n,
			reserveNo: current.reserveNo ?? 0n,
			yesChance: current.yesChance ?? 500_000_000n,
			creatorFeesEarned: current.creatorFeesEarned ?? 0n,
			platformFeesEarned: current.platformFeesEarned ?? 0n,
			createdAtBlock: event.block.number,
			createdAt: timestamp,
			createdTxHash: event.transaction.hash,
			}),
		});

	const user = await getOrCreateUser(context, creator, chain);
	await context.db.users.update({
			id: makeId(chain.chainId, normalizedCreator),
		data: {
			marketsCreated: user.marketsCreated + 1,
		},
	});

	await updateAggregateStats(context, chain, timestamp, {
		markets: 1,
		ammMarkets: 1,
	});

	console.log(`[${chain.chainName}] AMM market created: ${marketAddress}`);
	} catch (err) {
		console.error(
			`[MarketFactory:MarketCreated] Failed tx=${event.transaction.hash} logIndex=${event.log.logIndex}:`,
			err
		);
		return;
	}
});

ponder.on("MarketFactory:PariMutuelCreated", async ({ event, context }: any) => {
	try {
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

		await context.db.markets.upsert({
      id: marketAddress,
			create: {
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
				totalTrades: 0,
				currentTvl: 0n,
				uniqueTraders: 0,
			initialLiquidity: 0n,
			totalCollateralYes: 0n,
			totalCollateralNo: 0n,
			yesChance: 500_000_000n,
			creatorFeesEarned: 0n,
			platformFeesEarned: 0n,
			createdAtBlock: event.block.number,
			createdAt: timestamp,
			createdTxHash: event.transaction.hash,
			},
			update: ({ current }: any) => {
				const totalYes = current.totalCollateralYes ?? 0n;
				const totalNo = current.totalCollateralNo ?? 0n;
      
				let correctedYesChance: bigint = current.yesChance ?? 500_000_000n;
      if (totalYes + totalNo > 0n) {
        correctedYesChance = calculatePariMutuelYesChance({
          curveFlattener: Number(curveFlattener),
          curveOffset: Number(curveOffset),
          totalCollateralYes: totalYes,
          totalCollateralNo: totalNo,
          currentTimestamp: timestamp,
          marketStartTimestamp,
          marketCloseTimestamp,
        });
      }
  
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
					// Preserve accumulated stats/state.
					totalVolume: current.totalVolume,
					totalTrades: current.totalTrades,
					currentTvl: current.currentTvl,
					uniqueTraders: current.uniqueTraders,
				initialLiquidity: current.initialLiquidity ?? 0n,
        totalCollateralYes: totalYes,
        totalCollateralNo: totalNo,
        yesChance: correctedYesChance,
        creatorFeesEarned: current.creatorFeesEarned ?? 0n,
        platformFeesEarned: current.platformFeesEarned ?? 0n,
        createdAtBlock: event.block.number,
        createdAt: timestamp,
        createdTxHash: event.transaction.hash,
				};
        },
      });
  
    const user = await getOrCreateUser(context, creator, chain);
    await context.db.users.update({
			id: makeId(chain.chainId, normalizedCreator),
      data: {
        marketsCreated: user.marketsCreated + 1,
      },
    });
  
    await updateAggregateStats(context, chain, timestamp, {
      markets: 1,
      pariMarkets: 1,
    });
  
		console.log(`[${chain.chainName}] PariMutuel market created: ${marketAddress}`);
	} catch (err) {
		console.error(
			`[MarketFactory:PariMutuelCreated] Failed tx=${event.transaction.hash} logIndex=${event.log.logIndex}:`,
			err
		);
		return;
	}
});
