import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import {
	getOrCreateUser,
	getOrCreateMinimalMarket,
	isNewTraderForMarket,
	recordMarketInteraction,
} from "../services/db";
import { updateReferralVolume } from "../services/referral";
import { updatePollTvl } from "../services/pollTvl";
import { PredictionAMMAbi } from "../../abis/PredictionAMM";
import { recordAmmPriceTickAndCandles } from "../services/candles";

function toBigInt(value: unknown): bigint {
  return typeof value === "bigint" ? value : BigInt(value as any);
}

/**
 * Helper function to read reserves from contract and update market
 * Called after each trade event to keep reserveYes/reserveNo/yesChance in sync
 * Also syncs poll TVL after updating market TVL
 */
async function updateMarketReserves(
  context: any,
  marketAddress: `0x${string}`,
  pollAddress: `0x${string}`,
  chainName: string,
  blockNumber: bigint
): Promise<{ yesChance: bigint; collateralTvl: bigint }> {
  const reserves = await context.client.readContract({
    address: marketAddress,
    abi: PredictionAMMAbi,
    functionName: "getReserves",
    blockNumber,
  });

  const reserveYes = BigInt(reserves[0]);
  const reserveNo = BigInt(reserves[1]);
  const collateralTvl = BigInt(reserves[4]);

  const totalReserves = reserveYes + reserveNo;
  const yesChance =
		totalReserves > 0n
			? (reserveNo * 1_000_000_000n) / totalReserves
			: 500_000_000n;

  await context.db.markets.update({
    id: marketAddress,
    data: {
      reserveYes,
      reserveNo,
      yesChance,
      currentTvl: collateralTvl,
    },
  });

  // Sync poll TVL after market TVL update
  await updatePollTvl(context, pollAddress);

  return { yesChance, collateralTvl };
}

ponder.on("PredictionAMM:BuyTokens", async ({ event, context }: any) => {
  const { trader, isYes, tokenAmount, collateralAmount, fee } = event.args;
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
		"amm",
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
      trader: trader.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      tradeType: "buy",
      side: isYes ? "yes" : "no",
      collateralAmount,
      tokenAmount,
      feeAmount: fee,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  // Read reserves (spot price) pinned to this block, update market, and record spot-price tick/candles.
  const { yesChance: spotYesChance } = await updateMarketReserves(
    context,
    marketAddress,
    pollAddress,
    chain.chainName,
    BigInt(event.block.number)
  );

  await recordAmmPriceTickAndCandles({
    context,
    marketAddress,
    timestamp,
    blockNumber: BigInt(event.block.number),
    logIndex: event.log.logIndex,
    isYesSide: isYes,
    collateralAmount,
    tokenAmount,
    tradeType: "buy",
    txHash: event.transaction.hash,
    yesPriceOverride: spotYesChance,
  });

  const user = await getOrCreateUser(context, trader, chain);
  const isNewUser = user.totalTrades === 0;
	const isNewTrader = await isNewTraderForMarket(
		context,
		marketAddress,
		trader,
		chain
	);
  
	await recordMarketInteraction(
		context,
		marketAddress,
		trader,
		chain,
		timestamp
	);
  
  await context.db.users.update({
    id: makeId(chain.chainId, trader.toLowerCase()),
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralAmount,
      totalDeposited: user.totalDeposited + collateralAmount,
      firstTradeAt: user.firstTradeAt ?? timestamp,
      lastTradeAt: timestamp,
    },
  });

  await context.db.markets.update({
    id: marketAddress,
    data: {
      totalVolume: market.totalVolume + collateralAmount,
      totalTrades: market.totalTrades + 1,
			uniqueTraders: isNewTrader
				? market.uniqueTraders + 1
				: market.uniqueTraders,
    },
  });

  // Market reserves already updated above (spotYesChance).

  // Use centralized stats update
  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    volume: collateralAmount,
    tvlChange: collateralAmount,
    fees: fee,
    users: isNewUser ? 1 : 0, // NEW users
    activeUsers: 1,
  });
  
  // Track referral volume if trader has a referrer
	await updateReferralVolume(
		context,
		trader,
		collateralAmount,
		fee,
		timestamp,
		event.block.number,
		chain,
		marketAddress
	);
});

ponder.on("PredictionAMM:SellTokens", async ({ event, context }: any) => {
  const { trader, isYes, tokenAmount, collateralAmount, fee } = event.args;
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
		"amm",
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
      trader: trader.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      tradeType: "sell",
      side: isYes ? "yes" : "no",
      collateralAmount,
      tokenAmount,
      feeAmount: fee,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  // Read reserves (spot price) pinned to this block, update market, and record spot-price tick/candles.
  const { yesChance: spotYesChance } = await updateMarketReserves(
    context,
    marketAddress,
    pollAddress,
    chain.chainName,
    BigInt(event.block.number)
  );

  // Candle volume should match contract semantics: amountIn of the internal YES↔NO swap.
  // For sell: soldAmount = amountToSwap + pairsToBurn, and pairsToBurn = netCollateralOut + protocolFee.
  const tokenAmountBI = toBigInt(tokenAmount);
  const pairsToBurn = toBigInt(collateralAmount) + toBigInt(fee);
	const amountInForCandle =
		tokenAmountBI > pairsToBurn ? tokenAmountBI - pairsToBurn : 0n;

  await recordAmmPriceTickAndCandles({
    context,
    marketAddress,
    timestamp,
    blockNumber: BigInt(event.block.number),
    logIndex: event.log.logIndex,
    isYesSide: isYes,
    collateralAmount,
    tokenAmount,
    tradeType: "sell",
    txHash: event.transaction.hash,
    yesPriceOverride: spotYesChance,
    volumeOverride: amountInForCandle,
  });

  const user = await getOrCreateUser(context, trader, chain);
	const isNewTrader = await isNewTraderForMarket(
		context,
		marketAddress,
		trader,
		chain
	);
  
	await recordMarketInteraction(
		context,
		marketAddress,
		trader,
		chain,
		timestamp
	);
  
  // NOTE: SellTokens collateralAmount is already net-of-protocol-fee (what the user receives).
  const netProceeds = collateralAmount;
  const newTotalWithdrawn = (user.totalWithdrawn ?? 0n) + collateralAmount;
	const newRealizedPnL =
		newTotalWithdrawn +
		(user.totalWinnings ?? 0n) -
		(user.totalDeposited ?? 0n);
  
  await context.db.users.update({
    id: makeId(chain.chainId, trader.toLowerCase()),
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralAmount,
      totalWithdrawn: newTotalWithdrawn,
      realizedPnL: newRealizedPnL,
      lastTradeAt: timestamp,
    },
  });

  await context.db.markets.update({
    id: marketAddress,
    data: {
      totalVolume: market.totalVolume + collateralAmount,
      totalTrades: market.totalTrades + 1,
			uniqueTraders: isNewTrader
				? market.uniqueTraders + 1
				: market.uniqueTraders,
    },
  });

  // Market reserves already updated above (spotYesChance).

  // Use centralized stats update
  // TVL decreases by collateralAmount (money flowing out)
  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    volume: collateralAmount,
    tvlChange: 0n - collateralAmount,
    fees: fee,
    activeUsers: 1,
  });
  
  // Track referral volume if trader has a referrer
	await updateReferralVolume(
		context,
		trader,
		collateralAmount,
		fee,
		timestamp,
		event.block.number,
		chain,
		marketAddress
	);
});

ponder.on("PredictionAMM:SwapTokens", async ({ event, context }: any) => {
  const { trader, yesToNo, amountIn, amountOut, fee } = event.args;
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
    "amm",
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
      trader: trader.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      tradeType: "swap",
      side: yesToNo ? "yes" : "no",
      collateralAmount: 0n,
      tokenAmount: amountIn,
      tokenAmountOut: amountOut,
      feeAmount: fee,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  const user = await getOrCreateUser(context, trader, chain);
	const isNewTrader = await isNewTraderForMarket(
		context,
		marketAddress,
		trader,
		chain
	);
  
	await recordMarketInteraction(
		context,
		marketAddress,
		trader,
		chain,
		timestamp
	);
  
  await context.db.users.update({
    id: makeId(chain.chainId, trader.toLowerCase()),
    data: {
      totalTrades: user.totalTrades + 1,
      lastTradeAt: timestamp,
    },
  });

  await context.db.markets.update({
    id: marketAddress,
    data: {
      totalTrades: market.totalTrades + 1,
			uniqueTraders: isNewTrader
				? market.uniqueTraders + 1
				: market.uniqueTraders,
    },
  });

  // Update reserves (and currentTvl) and record a 0-volume spot-price tick so candles match yesChance.
  const { yesChance: spotYesChance } = await updateMarketReserves(
    context,
    marketAddress,
    pollAddress,
    chain.chainName,
    BigInt(event.block.number)
  );

  await recordAmmPriceTickAndCandles({
    context,
    marketAddress,
    timestamp,
    blockNumber: BigInt(event.block.number),
    logIndex: event.log.logIndex,
    isYesSide: true,
    collateralAmount: 0n,
    tokenAmount: 1n,
    tradeType: "swap",
    txHash: event.transaction.hash,
    yesPriceOverride: spotYesChance,
    // Candle volume should match contract semantics: amountIn of the swap (in outcome tokens).
    volumeOverride: amountIn,
    sideOverride: "swap",
  });

  // Use centralized stats update
  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    fees: fee,
    activeUsers: 1,
  });
});

ponder.on("PredictionAMM:WinningsRedeemed", async ({ event, context }: any) => {
  const { user, yesAmount, noAmount, collateralAmount } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
	const winningId = makeId(
		chain.chainId,
		event.transaction.hash,
		event.log.logIndex
	);

  const market = await context.db.markets.findUnique({ id: marketAddress });
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
      feeAmount: 0n,
      yesTokenAmount: yesAmount,
      noTokenAmount: noAmount,
      marketQuestion: poll?.question,
      marketType: "amm",
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  if (market) {
    // Update reserves + currentTvl from contract state at this block.
		await updateMarketReserves(
			context,
			marketAddress,
			market.pollAddress,
			chain.chainName,
			BigInt(event.block.number)
		);
  }

  const userData = await getOrCreateUser(context, user, chain);
	const newStreak =
		userData.currentStreak >= 0 ? userData.currentStreak + 1 : 1;
  const bestStreak = Math.max(userData.bestStreak, newStreak);
  const newTotalWinnings = (userData.totalWinnings ?? 0n) + collateralAmount;
	const newRealizedPnL =
		(userData.totalWithdrawn ?? 0n) +
		newTotalWinnings -
		(userData.totalDeposited ?? 0n);
  
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

  // Use centralized stats update
  await updateAggregateStats(context, chain, timestamp, {
    winningsPaid: collateralAmount,
		tvlChange: 0n - collateralAmount, // Money leaves the system
  });
});

ponder.on("PredictionAMM:LiquidityAdded", async ({ event, context }: any) => {
  const { provider, collateralAmount, lpTokens, amounts } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  
	const eventId = makeId(
		chain.chainId,
		event.transaction.hash,
		event.log.logIndex
	);

	const imbalanceVolume =
		(amounts.yesToReturn ?? 0n) + (amounts.noToReturn ?? 0n);

	const market = await getOrCreateMinimalMarket(
		context,
		marketAddress,
		chain,
		"amm",
		timestamp,
		event.block.number,
		event.transaction.hash
	);
  const pollAddress = market.pollAddress;

  await context.db.liquidityEvents.create({
    id: eventId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      provider: provider.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      eventType: "add",
      collateralAmount,
      lpTokens,
      yesTokenAmount: amounts.yesToAdd ?? 0n,
      noTokenAmount: amounts.noToAdd ?? 0n,
      yesTokensReturned: amounts.yesToReturn ?? 0n,
      noTokensReturned: amounts.noToReturn ?? 0n,
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  // Update User Stats (LP logic)
  const user = await getOrCreateUser(context, provider, chain);
  const isNewUser = user.totalTrades === 0 && user.totalDeposited === 0n; // Is new if no activity before
  
  // Track unique trader status for LP
	const isNewTrader = await isNewTraderForMarket(
		context,
		marketAddress,
		provider,
		chain
	);
	await recordMarketInteraction(
		context,
		marketAddress,
		provider,
		chain,
		timestamp
	);

  // Update deposited amount (Capital at risk)
  await context.db.users.update({
    id: makeId(chain.chainId, provider.toLowerCase()),
    data: {
      totalDeposited: user.totalDeposited + collateralAmount,
			totalVolume:
				imbalanceVolume > 0n
					? user.totalVolume + imbalanceVolume
					: user.totalVolume,
      lastTradeAt: timestamp,
    },
  });

  // If imbalance exists, record as a synthetic trade
  if (imbalanceVolume > 0n) {
		const tradeId = makeId(
			chain.chainId,
			event.transaction.hash,
			event.log.logIndex,
			"imbalance"
		);
    await context.db.trades.create({
      id: tradeId,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        trader: provider.toLowerCase() as `0x${string}`,
        marketAddress,
        pollAddress,
        tradeType: "liquidity_imbalance", // Explicit type
        side: "imbalance", // Or infer direction if we cared, but "imbalance" is fine
        collateralAmount: imbalanceVolume,
        tokenAmount: 0n, // Approximate
        feeAmount: 0n,
        txHash: event.transaction.hash,
        blockNumber: event.block.number,
        timestamp,
      },
    });
  }

  const isFirstLiquidity = (market.initialLiquidity ?? 0n) === 0n;

  await context.db.markets.update({
    id: marketAddress,
    data: {
			totalVolume:
				imbalanceVolume > 0n
        ? market.totalVolume + imbalanceVolume 
        : market.totalVolume,
			initialLiquidity: isFirstLiquidity
				? collateralAmount
				: market.initialLiquidity,
			uniqueTraders: isNewTrader
				? market.uniqueTraders + 1
				: market.uniqueTraders,
    },
  });

  // Update reserves + currentTvl from contract state at this block.
	await updateMarketReserves(
		context,
		marketAddress,
		pollAddress,
		chain.chainName,
		BigInt(event.block.number)
	);

  // Use centralized stats update
  // NOTE: Liquidity adds are NOT trades - they're LP actions
  await updateAggregateStats(context, chain, timestamp, {
    tvlChange: collateralAmount,
    volume: imbalanceVolume > 0n ? imbalanceVolume : 0n,
    users: isNewUser ? 1 : 0, // Count LPs as users
    activeUsers: 1,
  });
});

ponder.on("PredictionAMM:LiquidityRemoved", async ({ event, context }: any) => {
	const { provider, lpTokens, yesAmount, noAmount, collateralToReturn } =
		event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  
	const eventId = makeId(
		chain.chainId,
		event.transaction.hash,
		event.log.logIndex
	);

  const market = await getOrCreateMinimalMarket(
    context,
    marketAddress,
    chain,
    "amm",
    timestamp,
    event.block.number,
    event.transaction.hash
  );
  const pollAddress = market.pollAddress;

  await context.db.liquidityEvents.create({
    id: eventId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      provider: provider.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      eventType: "remove",
      collateralAmount: collateralToReturn,
      lpTokens,
      yesTokenAmount: yesAmount,
      noTokenAmount: noAmount,
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  // Update User Stats (LP Exit)
  const user = await getOrCreateUser(context, provider, chain);
  const newTotalWithdrawn = user.totalWithdrawn + collateralToReturn;
	const newRealizedPnL =
		newTotalWithdrawn +
		(user.totalWinnings ?? 0n) -
		(user.totalDeposited ?? 0n);

  // Track unique trader status for LP (even on removal, if they somehow removed without adding? unlikely but possible if transferred LP tokens)
	const isNewTrader = await isNewTraderForMarket(
		context,
		marketAddress,
		provider,
		chain
	);
	await recordMarketInteraction(
		context,
		marketAddress,
		provider,
		chain,
		timestamp
	);

  await context.db.users.update({
    id: makeId(chain.chainId, provider.toLowerCase()),
    data: {
      totalWithdrawn: newTotalWithdrawn,
      realizedPnL: newRealizedPnL,
      lastTradeAt: timestamp,
    },
  });

  await context.db.markets.update({
    id: marketAddress,
    data: {
			uniqueTraders: isNewTrader
				? market.uniqueTraders + 1
				: market.uniqueTraders,
    },
  });

  // Update reserves + currentTvl from contract state at this block.
	await updateMarketReserves(
		context,
		marketAddress,
		pollAddress,
		chain.chainName,
		BigInt(event.block.number)
	);

  // Use centralized stats update
  // NOTE: Liquidity removes are NOT trades - they're LP actions
  await updateAggregateStats(context, chain, timestamp, {
    tvlChange: 0n - collateralToReturn,
    activeUsers: 1,
  });
});

// Sync event is a fallback - only fires when sync() is called manually
// Reserve updates are now done via contract reads in trade handlers
ponder.on("PredictionAMM:Sync", async ({ event, context }: any) => {
	const { rYes, rNo } = event.args;
	const marketAddress = event.log.address;
  const chain = getChainInfo(context);

	const market = await context.db.markets.findUnique({ id: marketAddress });
	if (market) {
		const reserveYes = BigInt(rYes);
		const reserveNo = BigInt(rNo);
		const totalReserves = reserveYes + reserveNo;
		const yesChance =
			totalReserves > 0n
				? (reserveNo * 1_000_000_000n) / totalReserves
				: 500_000_000n; // Default 50% if no reserves

		await context.db.markets.update({
			id: marketAddress,
			data: {
				reserveYes,
				reserveNo,
				yesChance,
			},
		});
	}
});

ponder.on(
	"PredictionAMM:ProtocolFeesWithdrawn",
	async ({ event, context }: any) => {
  try {
    const { platformShare, creatorShare } = event.args;
    const marketAddress = event.log.address;
    const timestamp = event.block.timestamp;
    const chain = getChainInfo(context);

    // 1) Read on-chain state first (no DB writes before this succeeds)
    const reserves = await context.client.readContract({
      address: marketAddress,
      abi: PredictionAMMAbi,
      functionName: "getReserves",
      blockNumber: event.block.number,
    });

    const reserveYes = BigInt(reserves[0]);
    const reserveNo = BigInt(reserves[1]);
    const collateralTvl = BigInt(reserves[4]);

    const totalReserves = reserveYes + reserveNo;
    const yesChance =
				totalReserves > 0n
					? (reserveNo * 1_000_000_000n) / totalReserves
					: 500_000_000n;

    // 2) Load (or create) market after successful reads
    const market =
      (await context.db.markets.findUnique({ id: marketAddress })) ??
      (await getOrCreateMinimalMarket(
        context,
        marketAddress,
        chain,
        "amm",
        timestamp,
        event.block.number,
        event.transaction.hash
      ));

    const oldTvl = market.currentTvl ?? 0n;
    const delta = collateralTvl - oldTvl;

    const creatorShareBigInt = BigInt(creatorShare ?? 0);
    const platformShareBigInt = BigInt(platformShare ?? 0);

    // 3) Apply DB writes last
    await context.db.markets.update({
      id: marketAddress,
      data: {
        reserveYes,
        reserveNo,
        yesChance,
        currentTvl: collateralTvl,
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

    // 4) Update creator's totalCreatorFees if creatorShare > 0
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

    // 5) Update platform stats with platformShare
    if (platformShareBigInt > 0n) {
				await updateAggregateStats(context, chain, timestamp, {
					platformFees: platformShareBigInt,
				});
    }
  } catch (err) {
    console.error(
      `[PredictionAMM:ProtocolFeesWithdrawn] Failed tx=${event.transaction.hash} logIndex=${event.log.logIndex}:`,
      err
    );
    return;
  }
	}
);
