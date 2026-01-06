import { ChainInfo, makeId } from "../utils/helpers";
import { withRetry } from "../utils/errors";
import { PredictionAMMAbi } from "../../abis/PredictionAMM";
import { PredictionPariMutuelAbi } from "../../abis/PredictionPariMutuel";

/**
 * Check if a trader is new to a specific market using the optimized marketUsers table.
 */
export async function isNewTraderForMarket(
	context: any,
	marketAddress: `0x${string}`,
	traderAddress: `0x${string}`,
	chain: ChainInfo
): Promise<boolean> {
	const id = makeId(chain.chainId, marketAddress, traderAddress);
	// This is a simple read, might not strictly need retry but good for consistency
	return withRetry(async () => {
		const record = await context.db.marketUsers.findUnique({ id });
		return !record;
	});
}

/**
 * Record a user's interaction with a market.
 * Creates or updates the marketUsers record.
 */
export async function recordMarketInteraction(
	context: any,
	marketAddress: `0x${string}`,
	traderAddress: `0x${string}`,
	chain: ChainInfo,
	timestamp: bigint
) {
	const id = makeId(chain.chainId, marketAddress, traderAddress);
	await withRetry(async () => {
		await context.db.marketUsers.upsert({
			id,
			create: {
				chainId: chain.chainId,
				marketAddress,
				user: traderAddress,
				lastTradeAt: timestamp,
			},
			update: {
				lastTradeAt: timestamp,
			},
		});
	});
}

/**
 * Convenience helper used by some services: returns whether this is a user's
 * first interaction with a market, and records the interaction.
 */
export async function checkAndRecordMarketInteraction(
	context: any,
	marketAddress: `0x${string}`,
	traderAddress: `0x${string}`,
	chain: ChainInfo,
	timestamp: bigint
): Promise<boolean> {
	const isNewTrader = await isNewTraderForMarket(
		context,
		marketAddress,
		traderAddress,
		chain
	);
	await recordMarketInteraction(context, marketAddress, traderAddress, chain, timestamp);
	return isNewTrader;
}

/**
 * Get existing user record or create a new one with default values.
 */
export async function getOrCreateUser(
	context: any,
	address: `0x${string}`,
	chain: ChainInfo
) {
	// Normalize address to lowercase for consistent storage
	const normalizedAddress = address.toLowerCase() as `0x${string}`;
	const id = makeId(chain.chainId, normalizedAddress);

	return withRetry(async () => {
		// Try to fetch existing user
		let user = await context.db.users.findUnique({ id });

		// If not found, create with zero-initialized stats
		if (!user) {
			user = await context.db.users.create({
				id,
				data: {
					chainId: chain.chainId,
					chainName: chain.chainName,
					address: normalizedAddress,
					// Trading stats start at zero
					totalTrades: 0,
					totalVolume: 0n,
					totalWinnings: 0n,
					totalDeposited: 0n,
					totalWithdrawn: 0n,
					realizedPnL: 0n,
					// Win/loss tracking
					totalWins: 0,
					totalLosses: 0,
					currentStreak: 0,
					bestStreak: 0,
					// Creator stats
					marketsCreated: 0,
					pollsCreated: 0,
					totalCreatorFees: 0n,
					// Referral stats (all start at zero/null)
					totalReferrals: 0,
					totalReferralVolume: 0n,
					totalReferralFees: 0n,
					totalReferralRewards: 0n,
					// Timestamps left null until first trade
				},
			});
		}
		return user;
	});
}

/**
 * Safely get or create a minimal market record with race condition handling.
 * If market doesn't exist, fetches data on-chain to avoid placeholder/fake addresses.
 */
export async function getOrCreateMinimalMarket(
	context: any,
	marketAddress: `0x${string}`,
	chain: ChainInfo,
	marketType: "amm" | "pari",
	timestamp: bigint,
	blockNumber: bigint,
	txHash?: `0x${string}`
) {
	return withRetry(async () => {
		// Check if market already exists
		let market = await context.db.markets.findUnique({ id: marketAddress });

		if (!market) {
			// Contract is assumed valid. Always backfill minimal metadata from onchain state at this block.
			if (marketType === "amm") {
				const [pollAddress, creator, collateralToken, yesToken, noToken] =
					await Promise.all([
						context.client.readContract({
							address: marketAddress,
							abi: PredictionAMMAbi,
							functionName: "pollAddress",
							blockNumber,
						}),
						context.client.readContract({
							address: marketAddress,
							abi: PredictionAMMAbi,
							functionName: "creator",
							blockNumber,
						}),
						context.client.readContract({
							address: marketAddress,
							abi: PredictionAMMAbi,
							functionName: "collateralToken",
							blockNumber,
						}),
						context.client.readContract({
							address: marketAddress,
							abi: PredictionAMMAbi,
							functionName: "yesToken",
							blockNumber,
						}),
						context.client.readContract({
							address: marketAddress,
							abi: PredictionAMMAbi,
							functionName: "noToken",
							blockNumber,
						}),
					]);

				market = await context.db.markets.upsert({
					id: marketAddress,
					create: {
						chainId: chain.chainId,
						chainName: chain.chainName,
						isIncomplete: false,
						pollAddress: (pollAddress as string).toLowerCase() as `0x${string}`,
						creator: (creator as string).toLowerCase() as `0x${string}`,
						marketType,
						collateralToken: (collateralToken as string).toLowerCase() as `0x${string}`,
						yesToken: (yesToken as string).toLowerCase() as `0x${string}`,
						noToken: (noToken as string).toLowerCase() as `0x${string}`,
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
            createdAtBlock: blockNumber,
            createdAt: timestamp,
            createdTxHash: txHash as `0x${string}`,
					},
					update: {},
				});
			} else {
				const [pollAddress, creator, collateralToken, curveFlattener, curveOffset, marketStartTimestamp, marketCloseTimestamp] =
					await Promise.all([
						context.client.readContract({
							address: marketAddress,
							abi: PredictionPariMutuelAbi,
							functionName: "pollAddress",
							blockNumber,
						}),
						context.client.readContract({
							address: marketAddress,
							abi: PredictionPariMutuelAbi,
							functionName: "creator",
							blockNumber,
						}),
						context.client.readContract({
							address: marketAddress,
							abi: PredictionPariMutuelAbi,
							functionName: "collateralToken",
							blockNumber,
						}),
						context.client.readContract({
							address: marketAddress,
							abi: PredictionPariMutuelAbi,
							functionName: "curveFlattener",
							blockNumber,
						}),
						context.client.readContract({
							address: marketAddress,
							abi: PredictionPariMutuelAbi,
							functionName: "curveOffset",
							blockNumber,
						}),
						context.client.readContract({
							address: marketAddress,
							abi: PredictionPariMutuelAbi,
							functionName: "marketStartTimestamp",
							blockNumber,
						}),
						context.client.readContract({
							address: marketAddress,
							abi: PredictionPariMutuelAbi,
							functionName: "marketCloseTimestamp",
							blockNumber,
						}),
					]);

				market = await context.db.markets.upsert({
					id: marketAddress,
					create: {
						chainId: chain.chainId,
						chainName: chain.chainName,
						isIncomplete: false,
						pollAddress: (pollAddress as string).toLowerCase() as `0x${string}`,
						creator: (creator as string).toLowerCase() as `0x${string}`,
						marketType,
						collateralToken: (collateralToken as string).toLowerCase() as `0x${string}`,
						curveFlattener: Number(curveFlattener),
						curveOffset: Number(curveOffset),
						marketStartTimestamp: BigInt(marketStartTimestamp),
						marketCloseTimestamp: BigInt(marketCloseTimestamp),
						totalVolume: 0n,
						totalTrades: 0,
						currentTvl: 0n,
						uniqueTraders: 0,
					initialLiquidity: 0n,
					yesChance: 500_000_000n,
					totalCollateralYes: 0n,
					totalCollateralNo: 0n,
					creatorFeesEarned: 0n,
					platformFeesEarned: 0n,
					createdAtBlock: blockNumber,
					createdAt: timestamp,
					createdTxHash: txHash as `0x${string}`,
					},
					update: {},
				});
			}
		}

		return market;
	});
}
