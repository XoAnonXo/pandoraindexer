import { ponder } from "@/generated";
import { getChainInfo, makeId, calculateRealizedPnL } from "../utils/helpers";
import { 
  MIN_TRADE_AMOUNT, 
  TradeType, 
  TradeSide,
  MarketType,
  ZERO_ADDRESS,
} from "../utils/constants";
import { updateAggregateStats, recordDailyActiveUser, recordHourlyActiveUser } from "../services/stats";
import { getOrCreateUser, getOrCreateMinimalMarket } from "../services/db";
import { handleBuyTrade, handleWinningsRedeemed } from "../services/trades";
import { recordPosition } from "../services/positions";

// =============================================================================
// SEED INITIAL LIQUIDITY
// =============================================================================

ponder.on("PredictionPariMutuel:SeedInitialLiquidity", async ({ event, context }) => {
  const { yesAmount, noAmount } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);

  const totalLiquidity = yesAmount + noAmount;

  const market = await getOrCreateMinimalMarket(
    context, marketAddress, chain, MarketType.PARI, timestamp, event.block.number, event.transaction.hash
  );
  const pollAddress = market.pollAddress ?? ZERO_ADDRESS;
  const normalizedCreator = market.creator.toLowerCase() as `0x${string}`;

  const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);
  
  // Record seed as a special trade type
  await context.db.trades.create({
    id: tradeId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: normalizedCreator,
      marketAddress,
      pollAddress,
      tradeType: TradeType.SEED,
      side: TradeSide.BOTH,
      collateralAmount: totalLiquidity,
      tokenAmount: 0n,
      feeAmount: 0n,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  // Record positions for seed (creator gets both YES and NO positions)
  if (yesAmount > 0n) {
    await recordPosition(
      context, chain, marketAddress, pollAddress,
      normalizedCreator, TradeSide.YES, yesAmount, 0n, timestamp
    );
  }
  if (noAmount > 0n) {
    await recordPosition(
      context, chain, marketAddress, pollAddress,
      normalizedCreator, TradeSide.NO, noAmount, 0n, timestamp
    );
  }

  const user = await getOrCreateUser(context, market.creator, chain);
  
  // Track daily and hourly active user
  const isFirstActivityToday = await recordDailyActiveUser(
    context, chain, normalizedCreator, timestamp
  );
  const isFirstActivityThisHour = await recordHourlyActiveUser(
    context, chain, normalizedCreator, timestamp
  );

  // Calculate new PnL after deposit
  const newTotalDeposited = user.totalDeposited + totalLiquidity;
  const newRealizedPnL = calculateRealizedPnL(
    user.totalWithdrawn ?? 0n,
    user.totalWinnings ?? 0n,
    newTotalDeposited
  );

  await context.db.users.update({
    id: makeId(chain.chainId, normalizedCreator),
    data: {
      totalDeposited: newTotalDeposited,
      realizedPnL: newRealizedPnL,
      lastTradeAt: timestamp,
    },
  });

  await context.db.markets.update({
    id: marketAddress,
    data: {
      currentTvl: market.currentTvl + totalLiquidity,
      totalVolume: market.totalVolume + totalLiquidity,
      initialLiquidity: totalLiquidity,
    },
  });

  await updateAggregateStats(context, chain, timestamp, {
    tvlChange: totalLiquidity,
    volume: totalLiquidity,
    activeUsers: isFirstActivityToday ? 1 : 0,
    hourlyUniqueTraders: isFirstActivityThisHour ? 1 : 0,
  });

  console.log(`[${chain.chainName}] Seed liquidity (volume): ${marketAddress} - ${totalLiquidity}`);
});

// =============================================================================
// POSITION PURCHASED (Bet)
// =============================================================================

ponder.on("PredictionPariMutuel:PositionPurchased", async ({ event, context }) => {
  const { buyer, isYes, collateralIn, sharesOut } = event.args;
  
  if (collateralIn < MIN_TRADE_AMOUNT) return;
  
  const chain = getChainInfo(context);

  await handleBuyTrade({
    context,
    chain,
    trader: buyer,
    marketAddress: event.log.address,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    tradeType: TradeType.BET,
    marketType: MarketType.PARI,
    side: isYes ? TradeSide.YES : TradeSide.NO,
    collateralAmount: collateralIn,
    tokenAmount: sharesOut,
    feeAmount: 0n,
  });
});

// =============================================================================
// WINNINGS REDEEMED
// =============================================================================

ponder.on("PredictionPariMutuel:WinningsRedeemed", async ({ event, context }) => {
  const { user, collateralAmount, outcome, fee } = event.args;
  const chain = getChainInfo(context);

  await handleWinningsRedeemed({
    context,
    chain,
    user,
    marketAddress: event.log.address,
    collateralAmount,
    feeAmount: fee,
    marketType: MarketType.PARI,
    outcome: Number(outcome),
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  });
});
