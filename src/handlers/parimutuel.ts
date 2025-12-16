import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { MIN_TRADE_AMOUNT } from "../utils/constants";
import { updateAggregateStats } from "../services/stats";
import { getOrCreateUser, getOrCreateMinimalMarket, isNewTraderForMarket, recordMarketInteraction } from "../services/db";
import { updateReferralVolume } from "../services/referral";

ponder.on("PredictionPariMutuel:SeedInitialLiquidity", async ({ event, context }) => {
  const { yesAmount, noAmount } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);

  const totalLiquidity = yesAmount + noAmount;

  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "pari", timestamp, event.block.number, event.transaction.hash);
  const pollAddress = market.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);
  // Creator gets both YES and NO shares, effectively betting on both
  // We record it as a special "seed" trade
  await context.db.trades.create({
    id: tradeId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: market.creator, // Creator is the trader here
      marketAddress,
      pollAddress,
      tradeType: "seed",
      side: "both", // Special side for seeding
      collateralAmount: totalLiquidity,
      tokenAmount: 0n, // Shares calculation is complex for seed, leaving 0 for now
      feeAmount: 0n,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  const user = await getOrCreateUser(context, market.creator, chain);
  await context.db.users.update({
    id: makeId(chain.chainId, market.creator.toLowerCase()),
    data: {
      totalDeposited: user.totalDeposited + totalLiquidity,
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

  // Use centralized stats update
  await updateAggregateStats(context, chain, timestamp, {
    tvlChange: totalLiquidity,
    volume: totalLiquidity
  });
  
  // Track referral volume if creator has a referrer
  await updateReferralVolume(context, market.creator, totalLiquidity, 0n, timestamp, chain);

  console.log(`[${chain.chainName}] Seed liquidity (volume): ${marketAddress} - ${totalLiquidity}`);
});

ponder.on("PredictionPariMutuel:PositionPurchased", async ({ event, context }) => {
  const { buyer, isYes, collateralIn, sharesOut } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  
  if (collateralIn < MIN_TRADE_AMOUNT) return;
  
  const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "pari", timestamp, event.block.number, event.transaction.hash);
  const pollAddress = market.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

  await context.db.trades.create({
    id: tradeId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      trader: buyer.toLowerCase() as `0x${string}`,
      marketAddress,
      pollAddress,
      tradeType: "bet",
      side: isYes ? "yes" : "no",
      collateralAmount: collateralIn,
      tokenAmount: sharesOut,
      feeAmount: 0n,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  const user = await getOrCreateUser(context, buyer, chain);
  const isNewUser = user.totalTrades === 0;
  const isNewTrader = await isNewTraderForMarket(context, marketAddress, buyer, chain);
  
  await recordMarketInteraction(context, marketAddress, buyer, chain, timestamp);
  
  await context.db.users.update({
    id: makeId(chain.chainId, buyer.toLowerCase()),
    data: {
      totalTrades: user.totalTrades + 1,
      totalVolume: user.totalVolume + collateralIn,
      totalDeposited: user.totalDeposited + collateralIn,
      firstTradeAt: user.firstTradeAt ?? timestamp,
      lastTradeAt: timestamp,
    },
  });

  await context.db.markets.update({
    id: marketAddress,
    data: {
      totalVolume: market.totalVolume + collateralIn,
      totalTrades: market.totalTrades + 1,
      currentTvl: market.currentTvl + collateralIn,
      uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
    },
  });

  // Use centralized stats update
  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    volume: collateralIn,
    tvlChange: collateralIn,
    users: isNewUser ? 1 : 0,
    activeUsers: 1,
  });
  
  // Track referral volume if buyer has a referrer
  await updateReferralVolume(context, buyer, collateralIn, 0n, timestamp, chain);
});

ponder.on("PredictionPariMutuel:WinningsRedeemed", async ({ event, context }) => {
  const { user, collateralAmount, outcome, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  const winningId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

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
      feeAmount: fee,
      marketQuestion: poll?.question,
      marketType: "pari",
      outcome: Number(outcome),
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  if (market) {
    const newMarketTvl = market.currentTvl > collateralAmount 
      ? market.currentTvl - collateralAmount 
      : 0n;
    await context.db.markets.update({
      id: marketAddress,
      data: {
        currentTvl: newMarketTvl,
      },
    });
  }

  const userData = await getOrCreateUser(context, user, chain);
  const isWin = outcome !== 3;
  const newStreak = isWin 
    ? (userData.currentStreak >= 0 ? userData.currentStreak + 1 : 1)
    : (userData.currentStreak <= 0 ? userData.currentStreak - 1 : -1);
  const bestStreak = Math.max(userData.bestStreak, newStreak > 0 ? newStreak : 0);
  
  const newTotalWinnings = (userData.totalWinnings ?? 0n) + collateralAmount;
  const newRealizedPnL = (userData.totalWithdrawn ?? 0n) + newTotalWinnings - (userData.totalDeposited ?? 0n);
  
  await context.db.users.update({
    id: makeId(chain.chainId, user.toLowerCase()),
    data: {
      totalWinnings: newTotalWinnings,
      totalWins: isWin ? userData.totalWins + 1 : userData.totalWins,
      currentStreak: newStreak,
      bestStreak,
      realizedPnL: newRealizedPnL,
    },
  });

  // Use centralized stats update
  await updateAggregateStats(context, chain, timestamp, {
    winningsPaid: collateralAmount,
    tvlChange: -collateralAmount,
    fees: fee
  });
});





