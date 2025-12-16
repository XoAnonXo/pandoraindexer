import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { MIN_TRADE_AMOUNT, MIN_TOKEN_AMOUNT } from "../utils/constants";
import { updateAggregateStats } from "../services/stats";
import { getOrCreateUser, getOrCreateMinimalMarket, isNewTraderForMarket, recordMarketInteraction } from "../services/db";
import { updateReferralVolume } from "../services/referral";

ponder.on("PredictionAMM:BuyTokens", async ({ event, context }) => {
  const { trader, isYes, tokenAmount, collateralAmount, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  
  if (collateralAmount < MIN_TRADE_AMOUNT) return;
  
  const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "amm", timestamp, event.block.number, event.transaction.hash);
  const pollAddress = market.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

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

  const user = await getOrCreateUser(context, trader, chain);
  const isNewUser = user.totalTrades === 0;
  const isNewTrader = await isNewTraderForMarket(context, marketAddress, trader, chain);
  
  await recordMarketInteraction(context, marketAddress, trader, chain, timestamp);
  
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
      currentTvl: market.currentTvl + collateralAmount,
      uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
    },
  });

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
  await updateReferralVolume(context, trader, collateralAmount, fee, timestamp, chain);
});

ponder.on("PredictionAMM:SellTokens", async ({ event, context }) => {
  const { trader, isYes, tokenAmount, collateralAmount, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  
  if (collateralAmount < MIN_TRADE_AMOUNT) return;
  
  const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "amm", timestamp, event.block.number, event.transaction.hash);
  const pollAddress = market.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

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

  const user = await getOrCreateUser(context, trader, chain);
  const isNewTrader = await isNewTraderForMarket(context, marketAddress, trader, chain);
  
  await recordMarketInteraction(context, marketAddress, trader, chain, timestamp);
  
  // NOTE: Assuming collateralAmount is NET of fees based on logic in original code
  const netProceeds = collateralAmount > fee ? collateralAmount - fee : 0n;
  const newTotalWithdrawn = (user.totalWithdrawn ?? 0n) + netProceeds;
  const newRealizedPnL = newTotalWithdrawn + (user.totalWinnings ?? 0n) - (user.totalDeposited ?? 0n);
  
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

  const newMarketTvl = market.currentTvl > collateralAmount 
    ? market.currentTvl - collateralAmount 
    : 0n;
    
  await context.db.markets.update({
    id: marketAddress,
    data: {
      totalVolume: market.totalVolume + collateralAmount,
      totalTrades: market.totalTrades + 1,
      currentTvl: newMarketTvl,
      uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
    },
  });

  // Use centralized stats update
  // TVL decreases by collateralAmount (money flowing out)
  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    volume: collateralAmount,
    tvlChange: -collateralAmount,
    fees: fee,
    activeUsers: 1,
  });
  
  // Track referral volume if trader has a referrer
  await updateReferralVolume(context, trader, collateralAmount, fee, timestamp, chain);
});

ponder.on("PredictionAMM:SwapTokens", async ({ event, context }) => {
  const { trader, yesToNo, amountIn, amountOut, fee } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  
  // Filter dust swaps
  if (amountIn < MIN_TOKEN_AMOUNT) return;

  const tradeId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const pollAddress = market?.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

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
      feeAmount: fee,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp,
    },
  });

  const user = await getOrCreateUser(context, trader, chain);
  const isNewTrader = await isNewTraderForMarket(context, marketAddress, trader, chain);
  
  await recordMarketInteraction(context, marketAddress, trader, chain, timestamp);
  
  await context.db.users.update({
    id: makeId(chain.chainId, trader.toLowerCase()),
    data: {
      totalTrades: user.totalTrades + 1,
      lastTradeAt: timestamp,
    },
  });

  if (market) {
    await context.db.markets.update({
      id: marketAddress,
      data: {
        totalTrades: market.totalTrades + 1,
        uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
      },
    });
  }

  // Use centralized stats update
  await updateAggregateStats(context, chain, timestamp, {
    trades: 1,
    fees: fee,
    activeUsers: 1,
  });
});

ponder.on("PredictionAMM:WinningsRedeemed", async ({ event, context }) => {
  const { user, collateralAmount } = event.args;
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
      feeAmount: 0n,
      marketQuestion: poll?.question,
      marketType: "amm",
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
  const newStreak = userData.currentStreak >= 0 ? userData.currentStreak + 1 : 1;
  const bestStreak = Math.max(userData.bestStreak, newStreak);
  const newTotalWinnings = (userData.totalWinnings ?? 0n) + collateralAmount;
  const newRealizedPnL = (userData.totalWithdrawn ?? 0n) + newTotalWinnings - (userData.totalDeposited ?? 0n);
  
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
    tvlChange: -collateralAmount // Money leaves the system
  });
});

ponder.on("PredictionAMM:LiquidityAdded", async ({ event, context }) => {
  const { provider, collateralAmount, lpTokens, amounts } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  
  if (collateralAmount < MIN_TRADE_AMOUNT) return;

  const eventId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  const imbalanceVolume = (amounts.yesToReturn ?? 0n) + (amounts.noToReturn ?? 0n);

  const market = await getOrCreateMinimalMarket(context, marketAddress, chain, "amm", timestamp, event.block.number, event.transaction.hash);
  const pollAddress = market.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

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
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  // Update User Stats (LP logic)
  const user = await getOrCreateUser(context, provider, chain);
  const isNewUser = user.totalTrades === 0 && user.totalDeposited === 0n; // Is new if no activity before
  
  // Track unique trader status for LP
  const isNewTrader = await isNewTraderForMarket(context, marketAddress, provider, chain);
  await recordMarketInteraction(context, marketAddress, provider, chain, timestamp);

  // Update deposited amount (Capital at risk)
  await context.db.users.update({
    id: makeId(chain.chainId, provider.toLowerCase()),
    data: {
      totalDeposited: user.totalDeposited + collateralAmount,
      totalVolume: imbalanceVolume > 0n ? user.totalVolume + imbalanceVolume : user.totalVolume,
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
      currentTvl: market.currentTvl + collateralAmount,
      totalVolume: imbalanceVolume > 0n 
        ? market.totalVolume + imbalanceVolume 
        : market.totalVolume,
      initialLiquidity: isFirstLiquidity ? collateralAmount : market.initialLiquidity,
      uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
    },
  });

  // Use centralized stats update
  // NOTE: Liquidity adds are NOT trades - they're LP actions
  await updateAggregateStats(context, chain, timestamp, {
    tvlChange: collateralAmount,
    volume: imbalanceVolume > 0n ? imbalanceVolume : 0n,
    users: isNewUser ? 1 : 0, // Count LPs as users
    activeUsers: 1,
  });
});

ponder.on("PredictionAMM:LiquidityRemoved", async ({ event, context }) => {
  const { provider, lpTokens, collateralToReturn } = event.args;
  const timestamp = event.block.timestamp;
  const marketAddress = event.log.address;
  const chain = getChainInfo(context);
  
  if (collateralToReturn < MIN_TRADE_AMOUNT) return;

  const eventId = makeId(chain.chainId, event.transaction.hash, event.log.logIndex);

  const market = await context.db.markets.findUnique({ id: marketAddress });
  const pollAddress = market?.pollAddress ?? ("0x" + "0".repeat(40)) as `0x${string}`;

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
      txHash: event.transaction.hash,
      timestamp,
    },
  });

  // Update User Stats (LP Exit)
  const user = await getOrCreateUser(context, provider, chain);
  const newTotalWithdrawn = user.totalWithdrawn + collateralToReturn;
  const newRealizedPnL = newTotalWithdrawn + (user.totalWinnings ?? 0n) - (user.totalDeposited ?? 0n);

  // Track unique trader status for LP (even on removal, if they somehow removed without adding? unlikely but possible if transferred LP tokens)
  const isNewTrader = await isNewTraderForMarket(context, marketAddress, provider, chain);
  await recordMarketInteraction(context, marketAddress, provider, chain, timestamp);

  await context.db.users.update({
    id: makeId(chain.chainId, provider.toLowerCase()),
    data: {
      totalWithdrawn: newTotalWithdrawn,
      realizedPnL: newRealizedPnL,
      lastTradeAt: timestamp,
    },
  });

  if (market) {
    const newTvl = market.currentTvl > collateralToReturn 
      ? market.currentTvl - collateralToReturn 
      : 0n;
    await context.db.markets.update({
      id: marketAddress,
      data: {
        currentTvl: newTvl,
        uniqueTraders: isNewTrader ? market.uniqueTraders + 1 : market.uniqueTraders,
      },
    });
  }

  // Use centralized stats update
  // NOTE: Liquidity removes are NOT trades - they're LP actions
  await updateAggregateStats(context, chain, timestamp, {
    tvlChange: -collateralToReturn,
    activeUsers: 1,
  });
});

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
