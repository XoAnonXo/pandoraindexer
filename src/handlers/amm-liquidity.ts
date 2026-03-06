import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import {
  getOrCreateUser,
  getOrCreateMinimalMarket,
  isNewTraderForMarket,
  recordMarketInteraction,
} from "../services/db";
import { recordPosition } from "../services/positions";
import { TradeSide, PRICE_SCALE } from "../utils/constants";
import { updateMarketReserves } from "./amm-shared";

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

  const { yesChance: realYesChance } = await updateMarketReserves(
    context,
    marketAddress,
    pollAddress,
    chain.chainName,
    BigInt(event.block.number)
  );

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

  const normalizedProvider = provider.toLowerCase() as `0x${string}`;
  const currentYesChance = realYesChance;

  const yesToReturn = BigInt(amounts.yesToReturn ?? 0);
  const noToReturn = BigInt(amounts.noToReturn ?? 0);

  if (yesToReturn > 0n) {
    const yesCost = (yesToReturn * currentYesChance) / PRICE_SCALE;
    await recordPosition(
      context, chain, marketAddress, pollAddress,
      normalizedProvider, TradeSide.YES, yesCost, yesToReturn, timestamp
    );
  }
  if (noToReturn > 0n) {
    const noCost = (noToReturn * (PRICE_SCALE - currentYesChance)) / PRICE_SCALE;
    await recordPosition(
      context, chain, marketAddress, pollAddress,
      normalizedProvider, TradeSide.NO, noCost, noToReturn, timestamp
    );
  }

  const lpId = makeId(chain.chainId, marketAddress, normalizedProvider);
  const existingLp = await context.db.userLiquidityPositions.findUnique({ id: lpId });
  const weightedChance = currentYesChance * collateralAmount;

  await context.db.userLiquidityPositions.upsert({
    id: lpId,
    create: {
      chainId: chain.chainId,
      marketAddress,
      pollAddress,
      user: normalizedProvider,
      lpTokens,
      totalCollateralDeposited: collateralAmount,
      totalCollateralWithdrawn: 0n,
      yesTokensReceived: yesToReturn,
      noTokensReceived: noToReturn,
      initialYesChance: currentYesChance,
      weightedYesChanceSum: weightedChance,
      addCount: 1,
      removeCount: 0,
      firstAddAt: timestamp,
      lastUpdatedAt: timestamp,
    },
    update: {
      lpTokens: (existingLp?.lpTokens ?? 0n) + lpTokens,
      totalCollateralDeposited: (existingLp?.totalCollateralDeposited ?? 0n) + collateralAmount,
      yesTokensReceived: (existingLp?.yesTokensReceived ?? 0n) + yesToReturn,
      noTokensReceived: (existingLp?.noTokensReceived ?? 0n) + noToReturn,
      weightedYesChanceSum: (existingLp?.weightedYesChanceSum ?? 0n) + weightedChance,
      addCount: (existingLp?.addCount ?? 0) + 1,
      lastUpdatedAt: timestamp,
    },
  });

  const user = await getOrCreateUser(context, provider, chain);
  const isNewUser = user.totalTrades === 0 && user.totalDeposited === 0n;

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
      totalDeposited: user.totalDeposited + collateralAmount,
      totalVolume:
        imbalanceVolume > 0n
          ? user.totalVolume + imbalanceVolume
          : user.totalVolume,
      lastTradeAt: timestamp,
    },
  });

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
        tradeType: "liquidity_imbalance",
        side: "imbalance",
        collateralAmount: imbalanceVolume,
        tokenAmount: 0n,
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

  await updateAggregateStats(context, chain, timestamp, {
    tvlChange: collateralAmount,
    volume: imbalanceVolume > 0n ? imbalanceVolume : 0n,
    users: isNewUser ? 1 : 0,
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

  const normalizedProvider = provider.toLowerCase() as `0x${string}`;
  const currentYesChance = market.yesChance ?? (PRICE_SCALE / 2n);

  const yesAmountBI = BigInt(yesAmount ?? 0);
  const noAmountBI = BigInt(noAmount ?? 0);

  if (yesAmountBI > 0n) {
    const yesCost = (yesAmountBI * currentYesChance) / PRICE_SCALE;
    await recordPosition(
      context, chain, marketAddress, pollAddress,
      normalizedProvider, TradeSide.YES, yesCost, yesAmountBI, timestamp
    );
  }
  if (noAmountBI > 0n) {
    const noCost = (noAmountBI * (PRICE_SCALE - currentYesChance)) / PRICE_SCALE;
    await recordPosition(
      context, chain, marketAddress, pollAddress,
      normalizedProvider, TradeSide.NO, noCost, noAmountBI, timestamp
    );
  }

  const lpId = makeId(chain.chainId, marketAddress, normalizedProvider);
  const existingLp = await context.db.userLiquidityPositions.findUnique({ id: lpId });
  if (existingLp) {
    await context.db.userLiquidityPositions.update({
      id: lpId,
      data: {
        lpTokens: existingLp.lpTokens > lpTokens ? existingLp.lpTokens - lpTokens : 0n,
        totalCollateralWithdrawn: existingLp.totalCollateralWithdrawn + collateralToReturn,
        removeCount: existingLp.removeCount + 1,
        lastUpdatedAt: timestamp,
      },
    });
  }

  const user = await getOrCreateUser(context, provider, chain);
  const newTotalWithdrawn = user.totalWithdrawn + collateralToReturn;
  const newRealizedPnL =
    newTotalWithdrawn +
    (user.totalWinnings ?? 0n) -
    (user.totalDeposited ?? 0n);

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

  await updateMarketReserves(
    context,
    marketAddress,
    pollAddress,
    chain.chainName,
    BigInt(event.block.number)
  );

  await updateAggregateStats(context, chain, timestamp, {
    tvlChange: 0n - collateralToReturn,
    activeUsers: 1,
  });
});
