import { ponder } from "ponder:registry";
import { liquidityEvents, trades, userLiquidityPositions, users, markets } from "ponder:schema";
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

  await context.db.insert(liquidityEvents).values({
    id: eventId,
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
  });

  const normalizedProvider = provider.toLowerCase() as `0x${string}`;
  const currentYesChance = realYesChance;

  const yesToReturn = BigInt(amounts.yesToReturn ?? 0);
  const noToReturn = BigInt(amounts.noToReturn ?? 0);
  const yesCost = yesToReturn > 0n ? (yesToReturn * currentYesChance) / PRICE_SCALE : 0n;
  const noCost = noToReturn > 0n ? (noToReturn * (PRICE_SCALE - currentYesChance)) / PRICE_SCALE : 0n;
  const imbalanceVolume = yesCost + noCost;

  if (yesToReturn > 0n) {
    await recordPosition(
      context, chain, marketAddress, pollAddress,
      normalizedProvider, TradeSide.YES, yesCost, yesToReturn, timestamp
    );
    await context.db.insert(trades).values({
      id: makeId(chain.chainId, event.transaction.hash, event.log.logIndex, "imbalance-yes"),
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: normalizedProvider,
      marketAddress,
      pollAddress,
      tradeType: "liquidity_imbalance",
      side: TradeSide.YES,
      collateralAmount: yesCost,
      tokenAmount: yesToReturn,
      feeAmount: 0n,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    });
  }
  if (noToReturn > 0n) {
    await recordPosition(
      context, chain, marketAddress, pollAddress,
      normalizedProvider, TradeSide.NO, noCost, noToReturn, timestamp
    );
    await context.db.insert(trades).values({
      id: makeId(chain.chainId, event.transaction.hash, event.log.logIndex, "imbalance-no"),
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: normalizedProvider,
      marketAddress,
      pollAddress,
      tradeType: "liquidity_imbalance",
      side: TradeSide.NO,
      collateralAmount: noCost,
      tokenAmount: noToReturn,
      feeAmount: 0n,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    });
  }

  const lpId = makeId(chain.chainId, marketAddress, normalizedProvider);
  const weightedChance = currentYesChance * collateralAmount;

  await context.db.insert(userLiquidityPositions).values({
    id: lpId,
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
  }).onConflictDoUpdate((row: any) => ({
    lpTokens: row.lpTokens + lpTokens,
    totalCollateralDeposited: row.totalCollateralDeposited + collateralAmount,
    yesTokensReceived: row.yesTokensReceived + yesToReturn,
    noTokensReceived: row.noTokensReceived + noToReturn,
    weightedYesChanceSum: row.weightedYesChanceSum + weightedChance,
    addCount: row.addCount + 1,
    lastUpdatedAt: timestamp,
  }));

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

  await context.db.update(users, { id: provider.toLowerCase() }).set({
    totalDeposited: user.totalDeposited + collateralAmount,
    totalVolume:
      imbalanceVolume > 0n
        ? user.totalVolume + imbalanceVolume
        : user.totalVolume,
    lastTradeAt: timestamp,
  });

  const isFirstLiquidity = (market.initialLiquidity ?? 0n) === 0n;

  await context.db.update(markets, { id: marketAddress }).set({
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

  await context.db.insert(liquidityEvents).values({
    id: eventId,
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
  const existingLp = await context.db.find(userLiquidityPositions, { id: lpId });
  if (existingLp) {
    await context.db.update(userLiquidityPositions, { id: lpId }).set({
      lpTokens: existingLp.lpTokens > lpTokens ? existingLp.lpTokens - lpTokens : 0n,
      totalCollateralWithdrawn: existingLp.totalCollateralWithdrawn + collateralToReturn,
      removeCount: existingLp.removeCount + 1,
      lastUpdatedAt: timestamp,
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

  await context.db.update(users, { id: provider.toLowerCase() }).set({
    totalWithdrawn: newTotalWithdrawn,
    realizedPnL: newRealizedPnL,
    lastTradeAt: timestamp,
  });

  await context.db.update(markets, { id: marketAddress }).set({
    uniqueTraders: isNewTrader
      ? market.uniqueTraders + 1
      : market.uniqueTraders,
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
