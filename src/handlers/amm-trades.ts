import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { updateAggregateStats } from "../services/stats";
import {
  getOrCreateUser,
  getOrCreateMinimalMarket,
  isNewTraderForMarket,
  recordMarketInteraction,
} from "../services/db";
import { recordPosition, reducePosition } from "../services/positions";
import { recordAmmPriceTickAndCandles } from "../services/candles";
import { toBigInt, updateMarketReserves } from "./amm-shared";

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

  const buyPrice = tokenAmount > 0n
    ? (collateralAmount * 1_000_000_000n) / tokenAmount
    : 0n;

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
      buyPrice,
      feeAmount: fee,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  await recordPosition(
    context, chain, marketAddress, pollAddress,
    trader.toLowerCase() as `0x${string}`,
    isYes ? "yes" : "no", collateralAmount, tokenAmount, timestamp
  );

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

  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    volume: collateralAmount,
    tvlChange: collateralAmount,
    fees: fee,
    users: isNewUser ? 1 : 0,
    activeUsers: 1,
  });
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

  await reducePosition(
    context, chain, marketAddress,
    trader.toLowerCase() as `0x${string}`,
    isYes ? "yes" : "no", tokenAmount, timestamp
  );

  const { yesChance: spotYesChance } = await updateMarketReserves(
    context,
    marketAddress,
    pollAddress,
    chain.chainName,
    BigInt(event.block.number)
  );

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

  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    volume: collateralAmount,
    tvlChange: 0n - collateralAmount,
    fees: fee,
    activeUsers: 1,
  });
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

  const normalizedTrader = trader.toLowerCase() as `0x${string}`;
  const sellingSide = yesToNo ? "yes" : "no";
  const buyingSide = yesToNo ? "no" : "yes";
  await reducePosition(context, chain, marketAddress, normalizedTrader, sellingSide, amountIn, timestamp);
  await recordPosition(context, chain, marketAddress, pollAddress, normalizedTrader, buyingSide, 0n, amountOut, timestamp);

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
    volumeOverride: amountIn,
    sideOverride: "swap",
  });

  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    fees: fee,
    activeUsers: 1,
  });
});
