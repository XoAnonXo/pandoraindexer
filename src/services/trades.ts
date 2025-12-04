import type { PonderContext, ChainInfo } from "../utils/types";
import { makeId, calculateRealizedPnL } from "../utils/helpers";
import { 
  TradeType, 
  TradeSide, 
  MarketType,
  ZERO_ADDRESS,
  type TradeTypeValue, 
  type MarketTypeValue 
} from "../utils/constants";
import { updateAggregateStats, recordDailyActiveUser, recordHourlyActiveUser } from "./stats";
import { getOrCreateUser, getOrCreateMinimalMarket, checkAndRecordMarketInteraction } from "./db";
import { recordPosition, reducePosition, markPositionRedeemed } from "./positions";

// =============================================================================
// TYPES
// =============================================================================

interface BaseTradeParams {
  context: PonderContext;
  chain: ChainInfo;
  trader: `0x${string}`;
  marketAddress: `0x${string}`;
  timestamp: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
  logIndex: number;
}

interface BuyTradeParams extends BaseTradeParams {
  tradeType: typeof TradeType.BUY | typeof TradeType.BET;
  marketType: MarketTypeValue;
  side: typeof TradeSide.YES | typeof TradeSide.NO;
  collateralAmount: bigint;
  tokenAmount: bigint;
  feeAmount: bigint;
}

interface SellTradeParams extends BaseTradeParams {
  tradeType: typeof TradeType.SELL;
  side: typeof TradeSide.YES | typeof TradeSide.NO;
  collateralAmount: bigint;
  tokenAmount: bigint;
  feeAmount: bigint;
}

interface SwapTradeParams extends BaseTradeParams {
  tradeType: typeof TradeType.SWAP;
  side: typeof TradeSide.YES | typeof TradeSide.NO;
  tokenAmountIn: bigint;
  tokenAmountOut: bigint;
  feeAmount: bigint;
}

// =============================================================================
// BUY/BET HANDLER
// =============================================================================

/**
 * Handle buy trades (AMM) and bet trades (PariMutuel).
 * 
 * Common logic:
 * - Create trade record
 * - Record position for win/loss tracking
 * - Update user stats (deposits, volume, trades, PnL)
 * - Update market stats (volume, TVL, trades)
 * - Update aggregate stats with proper daily active user tracking
 */
export async function handleBuyTrade(params: BuyTradeParams) {
  const { 
    context, chain, trader, marketAddress, timestamp, blockNumber, 
    txHash, logIndex, tradeType, marketType, side, collateralAmount, 
    tokenAmount, feeAmount 
  } = params;

  const tradeId = makeId(chain.chainId, txHash, logIndex);
  const normalizedTrader = trader.toLowerCase() as `0x${string}`;

  // Get or create market with backfill if missing
  const market = await getOrCreateMinimalMarket(
    context, marketAddress, chain, marketType, timestamp, blockNumber, txHash
  );
  const pollAddress = market.pollAddress ?? ZERO_ADDRESS;

  // Create trade record
  await context.db.trades.create({
    id: tradeId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: normalizedTrader,
      marketAddress,
      pollAddress,
      tradeType,
      side,
      collateralAmount,
      tokenAmount,
      feeAmount,
      txHash,
      blockNumber,
      timestamp,
    },
  });

  // Record position for win/loss tracking
  await recordPosition(
    context, chain, marketAddress, pollAddress, 
    normalizedTrader, side, collateralAmount, tokenAmount, timestamp
  );

  // Get user and check if new
  const user = await getOrCreateUser(context, trader, chain);
  const isNewUser = user.totalTrades === 0;
  
  // Atomically check and record market interaction
  const isNewTrader = await checkAndRecordMarketInteraction(
    context, marketAddress, normalizedTrader, chain, timestamp
  );

  // Track daily and hourly active user
  const isFirstActivityToday = await recordDailyActiveUser(
    context, chain, normalizedTrader, timestamp
  );
  const isFirstActivityThisHour = await recordHourlyActiveUser(
    context, chain, normalizedTrader, timestamp
  );

  // Calculate new PnL after deposit
  const newTotalDeposited = user.totalDeposited + collateralAmount;
  const newRealizedPnL = calculateRealizedPnL(
    user.totalWithdrawn ?? 0n,
    user.totalWinnings ?? 0n,
    newTotalDeposited
  );

  // Update user stats
  await context.db.users.update({
    id: makeId(chain.chainId, normalizedTrader),
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralAmount,
      totalDeposited: newTotalDeposited,
      realizedPnL: newRealizedPnL,
      firstTradeAt: user.firstTradeAt ?? timestamp,
      lastTradeAt: timestamp,
    },
  });

  // Update market stats
  await context.db.markets.update({
    id: marketAddress,
    data: {
      totalVolume: market.totalVolume + collateralAmount,
      totalTrades: market.totalTrades + 1,
      currentTvl: market.currentTvl + collateralAmount,
      uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
    },
  });

  // Update aggregate stats - activeUsers only incremented if first activity today
  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    volume: collateralAmount,
    tvlChange: collateralAmount,
    fees: feeAmount,
    users: isNewUser ? 1 : 0,
    activeUsers: isFirstActivityToday ? 1 : 0,
    hourlyUniqueTraders: isFirstActivityThisHour ? 1 : 0,
  });
}

// =============================================================================
// SELL HANDLER
// =============================================================================

/**
 * Handle sell trades (AMM only).
 * 
 * NOTE ON FEE HANDLING:
 * The `collateralAmount` from SellTokens event is the GROSS amount before fees.
 * The `fee` parameter is the fee deducted.
 * Net proceeds = collateralAmount - fee (what user receives)
 */
export async function handleSellTrade(params: SellTradeParams) {
  const { 
    context, chain, trader, marketAddress, timestamp, blockNumber, 
    txHash, logIndex, side, collateralAmount, tokenAmount, feeAmount 
  } = params;

  const tradeId = makeId(chain.chainId, txHash, logIndex);
  const normalizedTrader = trader.toLowerCase() as `0x${string}`;

  // Get or create market
  const market = await getOrCreateMinimalMarket(
    context, marketAddress, chain, MarketType.AMM, timestamp, blockNumber, txHash
  );
  const pollAddress = market.pollAddress ?? ZERO_ADDRESS;

  // Create trade record
  await context.db.trades.create({
    id: tradeId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: normalizedTrader,
      marketAddress,
      pollAddress,
      tradeType: TradeType.SELL,
      side,
      collateralAmount,
      tokenAmount,
      feeAmount,
      txHash,
      blockNumber,
      timestamp,
    },
  });

  // Reduce position (selling tokens)
  await reducePosition(
    context, chain, marketAddress, normalizedTrader, side, tokenAmount, timestamp
  );

  // Get user and track new trader status
  const user = await getOrCreateUser(context, trader, chain);
  const isNewTrader = await checkAndRecordMarketInteraction(
    context, marketAddress, normalizedTrader, chain, timestamp
  );

  // Track daily and hourly active user
  const isFirstActivityToday = await recordDailyActiveUser(
    context, chain, normalizedTrader, timestamp
  );
  const isFirstActivityThisHour = await recordHourlyActiveUser(
    context, chain, normalizedTrader, timestamp
  );

  // Calculate PnL - user receives collateralAmount - feeAmount
  const netProceeds = collateralAmount - feeAmount;
  const newTotalWithdrawn = (user.totalWithdrawn ?? 0n) + netProceeds;
  const newRealizedPnL = calculateRealizedPnL(
    newTotalWithdrawn,
    user.totalWinnings ?? 0n,
    user.totalDeposited ?? 0n
  );

  // Update user stats
  await context.db.users.update({
    id: makeId(chain.chainId, normalizedTrader),
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralAmount,
      totalWithdrawn: newTotalWithdrawn,
      realizedPnL: newRealizedPnL,
      lastTradeAt: timestamp,
    },
  });

  // Update market stats (TVL decreases by gross amount, clamped to 0)
  // Calculate actual TVL change to keep market and platform TVL consistent
  const actualTvlDecrease: bigint = market.currentTvl > collateralAmount 
    ? collateralAmount 
    : market.currentTvl;
  const newMarketTvl = market.currentTvl - actualTvlDecrease;
    
  await context.db.markets.update({
    id: marketAddress,
    data: {
      totalVolume: market.totalVolume + collateralAmount,
      totalTrades: market.totalTrades + 1,
      currentTvl: newMarketTvl,
      uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
    },
  });

  // Update aggregate stats - use actualTvlDecrease to stay consistent with market TVL
  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    volume: collateralAmount,
    tvlChange: -actualTvlDecrease,
    fees: feeAmount,
    activeUsers: isFirstActivityToday ? 1 : 0,
    hourlyUniqueTraders: isFirstActivityThisHour ? 1 : 0,
  });
}

// =============================================================================
// SWAP HANDLER
// =============================================================================

/**
 * Handle swap trades (AMM only).
 * 
 * Swaps don't affect TVL or volume significantly (token-to-token).
 * They do affect position tracking though - swapping YES for NO changes the position.
 */
export async function handleSwapTrade(params: SwapTradeParams) {
  const { 
    context, chain, trader, marketAddress, timestamp, blockNumber, 
    txHash, logIndex, side, tokenAmountIn, tokenAmountOut, feeAmount 
  } = params;

  const tradeId = makeId(chain.chainId, txHash, logIndex);
  const normalizedTrader = trader.toLowerCase() as `0x${string}`;

  // Get existing market (don't backfill for swaps - market should already exist)
  const market = await context.db.markets.findUnique({ id: marketAddress });
  const pollAddress = market?.pollAddress ?? ZERO_ADDRESS;

  // Create trade record
  await context.db.trades.create({
    id: tradeId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: normalizedTrader,
      marketAddress,
      pollAddress,
      tradeType: TradeType.SWAP,
      side,
      collateralAmount: 0n, // No collateral in swaps
      tokenAmount: tokenAmountIn,
      feeAmount,
      txHash,
      blockNumber,
      timestamp,
    },
  });

  // Update position - reduce the selling side, increase the buying side
  // If side is YES (yesToNo=true), user is selling YES and getting NO
  // If side is NO (yesToNo=false), user is selling NO and getting YES
  const sellingSide = side;
  const buyingSide = side === TradeSide.YES ? TradeSide.NO : TradeSide.YES;
  
  // Reduce selling side
  await reducePosition(context, chain, marketAddress, normalizedTrader, sellingSide, tokenAmountIn, timestamp);
  
  // Record buying side (with 0 collateral since it's a swap)
  await recordPosition(context, chain, marketAddress, pollAddress, normalizedTrader, buyingSide, 0n, tokenAmountOut, timestamp);

  // Get user and track new trader status
  const user = await getOrCreateUser(context, trader, chain);
  const isNewTrader = await checkAndRecordMarketInteraction(
    context, marketAddress, normalizedTrader, chain, timestamp
  );

  // Track daily and hourly active user
  const isFirstActivityToday = await recordDailyActiveUser(
    context, chain, normalizedTrader, timestamp
  );
  const isFirstActivityThisHour = await recordHourlyActiveUser(
    context, chain, normalizedTrader, timestamp
  );

  // Update user stats (only trade count, no volume for swaps)
  await context.db.users.update({
    id: makeId(chain.chainId, normalizedTrader),
    data: {
      totalTrades: user.totalTrades + 1,
      lastTradeAt: timestamp,
    },
  });

  // Update market stats
  if (market) {
    await context.db.markets.update({
      id: marketAddress,
      data: {
        totalTrades: market.totalTrades + 1,
        uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
      },
    });
  }

  // Update aggregate stats
  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    fees: feeAmount,
    activeUsers: isFirstActivityToday ? 1 : 0,
    hourlyUniqueTraders: isFirstActivityThisHour ? 1 : 0,
  });
}

// =============================================================================
// WINNINGS HANDLER
// =============================================================================

interface WinningsParams {
  context: PonderContext;
  chain: ChainInfo;
  user: `0x${string}`;
  marketAddress: `0x${string}`;
  collateralAmount: bigint;
  feeAmount: bigint;
  marketType: MarketTypeValue;
  outcome?: number; // PariMutuel only
  timestamp: bigint;
  txHash: `0x${string}`;
  logIndex: number;
}

/**
 * Handle winnings redemption for both AMM and PariMutuel.
 * 
 * Updates:
 * - Winnings record
 * - Position (marked as redeemed)
 * - Market TVL (decreases)
 * - User stats (totalWinnings, realizedPnL, streak)
 * - Aggregate stats
 */
export async function handleWinningsRedeemed(params: WinningsParams) {
  const { 
    context, chain, user, marketAddress, collateralAmount, feeAmount,
    marketType, outcome, timestamp, txHash, logIndex 
  } = params;

  const winningId = makeId(chain.chainId, txHash, logIndex);
  const normalizedUser = user.toLowerCase() as `0x${string}`;

  // Get market and poll for context
  const market = await context.db.markets.findUnique({ id: marketAddress });
  const poll = market?.pollAddress 
    ? await context.db.polls.findUnique({ id: market.pollAddress })
    : null;

  // Create winnings record
  await context.db.winnings.create({
    id: winningId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      user: normalizedUser,
      marketAddress,
      collateralAmount,
      feeAmount,
      marketQuestion: poll?.question,
      marketType,
      outcome,
      txHash,
      timestamp,
    },
  });

  // Mark position as redeemed
  await markPositionRedeemed(context, chain, marketAddress, normalizedUser);

  // Update market TVL - calculate actual decrease to keep platform TVL consistent
  let actualTvlDecrease: bigint = 0n;
  if (market) {
    actualTvlDecrease = market.currentTvl > collateralAmount 
      ? collateralAmount 
      : market.currentTvl;
    const newMarketTvl = market.currentTvl - actualTvlDecrease;
    await context.db.markets.update({
      id: marketAddress,
      data: {
        currentTvl: newMarketTvl,
      },
    });
  } else {
    console.warn(`[${chain.chainName}] WinningsRedeemed for unknown market ${marketAddress}. Market TVL not updated.`);
  }

  // Get user data and calculate new stats
  const userData = await getOrCreateUser(context, user, chain);
  
  // Determine if this is a win (for PariMutuel, outcome 3 = unknown/refund)
  const isWin = marketType === MarketType.AMM || (outcome !== undefined && outcome !== 3);
  
  // Update streak
  let newStreak: number;
  if (isWin) {
    newStreak = userData.currentStreak >= 0 ? userData.currentStreak + 1 : 1;
  } else {
    // Refund/unknown outcome - reset streak to 0
    newStreak = 0;
  }
  const bestStreak = Math.max(userData.bestStreak, newStreak > 0 ? newStreak : 0);
  
  // Calculate PnL
  const newTotalWinnings = (userData.totalWinnings ?? 0n) + collateralAmount;
  const newRealizedPnL = calculateRealizedPnL(
    userData.totalWithdrawn ?? 0n,
    newTotalWinnings,
    userData.totalDeposited ?? 0n
  );

  // Update user stats
  await context.db.users.update({
    id: makeId(chain.chainId, normalizedUser),
    data: {
      totalWinnings: newTotalWinnings,
      totalWins: isWin ? userData.totalWins + 1 : userData.totalWins,
      currentStreak: newStreak,
      bestStreak,
      realizedPnL: newRealizedPnL,
    },
  });

  // Update aggregate stats - use actualTvlDecrease to stay consistent with market TVL
  await updateAggregateStats(context, chain, timestamp, {
    winningsPaid: collateralAmount,
    tvlChange: -actualTvlDecrease,
    fees: feeAmount,
  });
}
