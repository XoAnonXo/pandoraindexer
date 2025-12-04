import { ponder } from "@/generated";
import { getChainInfo, makeId, calculateRealizedPnL } from "../utils/helpers";
import { 
  MIN_TRADE_AMOUNT, 
  MIN_TOKEN_AMOUNT, 
  TradeType, 
  TradeSide,
  MarketType,
  LiquidityEventType,
  ZERO_ADDRESS,
} from "../utils/constants";
import { updateAggregateStats, recordDailyActiveUser, recordHourlyActiveUser } from "../services/stats";
import { getOrCreateUser, getOrCreateMinimalMarket, checkAndRecordMarketInteraction } from "../services/db";
import { handleBuyTrade, handleSellTrade, handleSwapTrade, handleWinningsRedeemed } from "../services/trades";
import { recordPosition } from "../services/positions";

// =============================================================================
// BUY TOKENS
// =============================================================================

ponder.on("PredictionAMM:BuyTokens", async ({ event, context }) => {
  const { trader, isYes, tokenAmount, collateralAmount, fee } = event.args;
  
  if (collateralAmount < MIN_TRADE_AMOUNT) return;
  
  const chain = getChainInfo(context);

  await handleBuyTrade({
    context,
    chain,
    trader,
    marketAddress: event.log.address,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    tradeType: TradeType.BUY,
    marketType: MarketType.AMM,
    side: isYes ? TradeSide.YES : TradeSide.NO,
    collateralAmount,
    tokenAmount,
    feeAmount: fee,
  });
});

// =============================================================================
// SELL TOKENS
// =============================================================================

ponder.on("PredictionAMM:SellTokens", async ({ event, context }) => {
  const { trader, isYes, tokenAmount, collateralAmount, fee } = event.args;
  
  if (collateralAmount < MIN_TRADE_AMOUNT) return;
  
  const chain = getChainInfo(context);

  await handleSellTrade({
    context,
    chain,
    trader,
    marketAddress: event.log.address,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    tradeType: TradeType.SELL,
    side: isYes ? TradeSide.YES : TradeSide.NO,
    collateralAmount,
    tokenAmount,
    feeAmount: fee,
  });
});

// =============================================================================
// SWAP TOKENS
// =============================================================================

ponder.on("PredictionAMM:SwapTokens", async ({ event, context }) => {
  const { trader, yesToNo, amountIn, amountOut, fee } = event.args;
  
  if (amountIn < MIN_TOKEN_AMOUNT) return;

  const chain = getChainInfo(context);

  await handleSwapTrade({
    context,
    chain,
    trader,
    marketAddress: event.log.address,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    tradeType: TradeType.SWAP,
    side: yesToNo ? TradeSide.YES : TradeSide.NO,
    tokenAmountIn: amountIn,
    tokenAmountOut: amountOut,
    feeAmount: fee,
  });
});

// =============================================================================
// WINNINGS REDEEMED
// =============================================================================

ponder.on("PredictionAMM:WinningsRedeemed", async ({ event, context }) => {
  const { user, collateralAmount } = event.args;
  const chain = getChainInfo(context);

  await handleWinningsRedeemed({
    context,
    chain,
    user,
    marketAddress: event.log.address,
    collateralAmount,
    feeAmount: 0n,
    marketType: MarketType.AMM,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  });
});

// =============================================================================
// LIQUIDITY ADDED
// =============================================================================

ponder.on("PredictionAMM:LiquidityAdded", async ({ event, context }) => {
  const { provider, collateralAmount, lpTokens, amounts } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  
  if (collateralAmount < MIN_TRADE_AMOUNT) return;

  const eventId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);
  const imbalanceVolume = (amounts.yesToReturn ?? 0n) + (amounts.noToReturn ?? 0n);
  const normalizedProvider = provider.toLowerCase() as `0x${string}`;

  const market = await getOrCreateMinimalMarket(
    context, marketAddress, chain, MarketType.AMM, timestamp, event.block.number, event.transaction.hash
  );
  const pollAddress = market.pollAddress ?? ZERO_ADDRESS;

  // Create liquidity event record
  await context.db.liquidityEvents.create({
    id: eventId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      provider: normalizedProvider,
      marketAddress,
      pollAddress,
      eventType: LiquidityEventType.ADD,
      collateralAmount,
      lpTokens,
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  // Record position for imbalance tokens (LP gets both YES and NO tokens)
  // The imbalance returned represents their net position
  if (amounts.yesToReturn && amounts.yesToReturn > 0n) {
    await recordPosition(
      context, chain, marketAddress, pollAddress,
      normalizedProvider, TradeSide.YES, 0n, amounts.yesToReturn, timestamp
    );
  }
  if (amounts.noToReturn && amounts.noToReturn > 0n) {
    await recordPosition(
      context, chain, marketAddress, pollAddress,
      normalizedProvider, TradeSide.NO, 0n, amounts.noToReturn, timestamp
    );
  }

  // Update User Stats (LP logic)
  const user = await getOrCreateUser(context, provider, chain);
  const isNewUser = user.totalTrades === 0 && user.totalDeposited === 0n;
  
  // Atomically check and record market interaction
  const isNewTrader = await checkAndRecordMarketInteraction(
    context, marketAddress, normalizedProvider, chain, timestamp
  );

  // Track daily and hourly active user
  const isFirstActivityToday = await recordDailyActiveUser(
    context, chain, normalizedProvider, timestamp
  );
  const isFirstActivityThisHour = await recordHourlyActiveUser(
    context, chain, normalizedProvider, timestamp
  );

  // Calculate new PnL after deposit
  const newTotalDeposited = user.totalDeposited + collateralAmount;
  const newRealizedPnL = calculateRealizedPnL(
    user.totalWithdrawn ?? 0n,
    user.totalWinnings ?? 0n,
    newTotalDeposited
  );

  await context.db.users.update({
    id: makeId(chain.chainId, normalizedProvider),
    data: {
      totalDeposited: newTotalDeposited,
      totalVolume: imbalanceVolume > 0n ? user.totalVolume + imbalanceVolume : user.totalVolume,
      realizedPnL: newRealizedPnL,
      lastTradeAt: timestamp,
    },
  });

  // If imbalance exists, record as a synthetic trade
  if (imbalanceVolume > 0n) {
    const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex, "imbalance");
    await context.db.trades.create({
      id: tradeId,
      data: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        trader: normalizedProvider,
        marketAddress,
        pollAddress,
        tradeType: TradeType.LIQUIDITY_IMBALANCE,
        side: TradeSide.IMBALANCE,
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
      currentTvl: market.currentTvl + collateralAmount,
      totalVolume: imbalanceVolume > 0n 
        ? market.totalVolume + imbalanceVolume 
        : market.totalVolume,
      initialLiquidity: isFirstLiquidity ? collateralAmount : market.initialLiquidity,
      uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
    },
  });

  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    tvlChange: collateralAmount,
    volume: imbalanceVolume > 0n ? imbalanceVolume : 0n,
    users: isNewUser ? 1 : 0,
    activeUsers: isFirstActivityToday ? 1 : 0,
    hourlyUniqueTraders: isFirstActivityThisHour ? 1 : 0,
  });
});

// =============================================================================
// LIQUIDITY REMOVED
// =============================================================================

ponder.on("PredictionAMM:LiquidityRemoved", async ({ event, context }) => {
  const { provider, lpTokens, collateralToReturn } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  
  if (collateralToReturn < MIN_TRADE_AMOUNT) return;

  const eventId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);
  const normalizedProvider = provider.toLowerCase() as `0x${string}`;

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const pollAddress = market?.pollAddress ?? ZERO_ADDRESS;

  await context.db.liquidityEvents.create({
    id: eventId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      provider: normalizedProvider,
      marketAddress,
      pollAddress,
      eventType: LiquidityEventType.REMOVE,
      collateralAmount: collateralToReturn,
      lpTokens,
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  // Update User Stats (LP Exit)
  const user = await getOrCreateUser(context, provider, chain);
  const newTotalWithdrawn = user.totalWithdrawn + collateralToReturn;
  const newRealizedPnL = calculateRealizedPnL(
    newTotalWithdrawn,
    user.totalWinnings ?? 0n,
    user.totalDeposited ?? 0n
  );

  // Atomically check and record market interaction
  const isNewTrader = await checkAndRecordMarketInteraction(
    context, marketAddress, normalizedProvider, chain, timestamp
  );

  // Track daily and hourly active user
  const isFirstActivityToday = await recordDailyActiveUser(
    context, chain, normalizedProvider, timestamp
  );
  const isFirstActivityThisHour = await recordHourlyActiveUser(
    context, chain, normalizedProvider, timestamp
  );

  await context.db.users.update({
    id: makeId(chain.chainId, normalizedProvider),
    data: {
      totalWithdrawn: newTotalWithdrawn,
      realizedPnL: newRealizedPnL,
      lastTradeAt: timestamp,
    },
  });

  // Calculate actual TVL decrease to keep platform TVL consistent with market TVL
  let actualTvlDecrease: bigint = 0n;
  if (market) {
    actualTvlDecrease = market.currentTvl > collateralToReturn 
      ? collateralToReturn 
      : market.currentTvl;
    const newTvl = market.currentTvl - actualTvlDecrease;
    await context.db.markets.update({
      id: marketAddress,
      data: {
        currentTvl: newTvl,
        uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
      },
    });
  }

  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    tvlChange: -actualTvlDecrease,
    activeUsers: isFirstActivityToday ? 1 : 0,
    hourlyUniqueTraders: isFirstActivityThisHour ? 1 : 0,
  });
});

// =============================================================================
// SYNC (Reserve Updates)
// =============================================================================

ponder.on("PredictionAMM:Sync", async ({ event, context }) => {
  const { rYes, rNo } = event.args;
  const marketAddress = event.log.address;

  const market = await context.db.markets.findUnique({ id: marketAddress });
  if (market) {
    await context.db.markets.update({
      id: marketAddress,
      data: {
        reserveYes: BigInt(rYes),
        reserveNo: BigInt(rNo),
      },
    });
  }
});
