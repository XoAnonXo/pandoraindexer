/**
 * Launchpad Event Handlers
 *
 * Handles events from:
 * - TokensFactory: TokenCreated, TokenGraduated, metadata updates
 * - BondingCurve: Buy, Sell, Graduated
 *
 * These handlers track:
 * 1. Token creation → create launchpadTokens record
 * 2. Token metadata updates → update uri, imageUri, description (optional, set by creator)
 * 3. Buy/Sell trades → TVL updates + referral volume tracking (if pandora system)
 * 4. Graduation events → switch creator's markets to localizer system
 *
 * GRADUATION FLOW:
 * - When token reaches $50k market cap → graduates to DEX
 * - Creator's prediction markets switch from 'pandora' to 'localizer' system
 * - Volume on localizer markets does NOT count toward Pandora referral rewards
 * - Creator receives 0.15% fee on all trades (handled by smart contract)
 * - 95% of creators stay in 'graduated' status forever (no further action needed)
 * - Only rare partners (~5%) manually set up their own ReferralCampaign
 */

import { ponder } from "@/generated";
import { getChainInfo } from "../utils/helpers";
import { updateReferralVolume } from "../services/referral";
import { BondingCurveAbi } from "../abis/BondingCurve";

// ===========================================================================
// TOKEN CREATED (TokensFactory)
// ===========================================================================
/**
 * Handler for TokensFactory TokenCreated event
 * Creates launchpadTokens record when a new token is launched
 */
ponder.on("TokensFactory:TokenCreated", async ({ event, context }: any) => {
  const { token, bondingCurve, creator, name, symbol } = event.args;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const chain = getChainInfo(context);

  const normalizedToken = token.toLowerCase() as `0x${string}`;
  const normalizedBondingCurve = bondingCurve.toLowerCase() as `0x${string}`;
  const normalizedCreator = creator.toLowerCase() as `0x${string}`;

  console.log(
    `[${chain.chainName}] New launchpad token created: ${name} (${symbol}) by ${creator}`
  );

  // Create launchpadTokens record
  await context.db.launchpadTokens.create({
    id: normalizedToken,
    data: {
      creator: normalizedCreator,
      bondingCurveAddress: normalizedBondingCurve,
      name,
      symbol,
      // Metadata will be set via TokenUriSet events or can be read from contract
      uri: undefined,
      imageUri: undefined,
      description: undefined,
      currentTvlNative: 0n,
      isGraduated: false,
      createdAt: timestamp,
      createdAtBlock: blockNumber,
    },
  });

  // Create tokenSystems record (default: pandora)
  await context.db.tokenSystems.create({
    id: normalizedBondingCurve,
    data: {
      creator: normalizedCreator,
      system: "pandora",
    },
  });

  console.log(
    `[${chain.chainName}] Created launchpadTokens: ${normalizedToken}`
  );
});

// ===========================================================================
// TOKEN GRADUATED (TokensFactory)
// ===========================================================================
/**
 * Handler for TokensFactory TokenGraduated event
 *
 * When a token reaches $50k market cap and graduates to DEX:
 * 1. Mark token as graduated
 * 2. Record graduation in graduatedCreators table
 * 3. Switch ALL creator's prediction markets to 'localizer' system
 * 4. Switch the graduated token to 'localizer' system
 * 5. Backend will detect this and trigger finalization process
 */
ponder.on("TokensFactory:TokenGraduated", async ({ event, context }: any) => {
  const { token, bondingCurve, creator } = event.args;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const chain = getChainInfo(context);

  const normalizedCreator = creator.toLowerCase() as `0x${string}`;
  const normalizedToken = token.toLowerCase() as `0x${string}`;
  const normalizedBondingCurve = bondingCurve.toLowerCase() as `0x${string}`;

  console.log(
    `[${chain.chainName}] Token graduated: ${token} by ${creator}`
  );

  // 1. Update launchpadTokens (mark as graduated)
  await context.db.launchpadTokens.update({
    id: normalizedToken,
    data: {
      isGraduated: true,
      graduatedAt: timestamp,
      graduatedAtBlock: blockNumber,
    },
  });

  // 2. Record graduated creator
  // NOTE: Most creators (95%) will stay in 'graduated' status forever.
  // They don't need to "set up" anything - graduation just means their
  // markets switched to localizer system and they receive 0.15% creator fee.
  await context.db.graduatedCreators.create({
    id: normalizedCreator,
    data: {
      tokenAddress: normalizedToken,
      bondingCurveAddress: normalizedBondingCurve,
      graduatedAtBlock: blockNumber,
      graduatedAt: timestamp,
      graduatedTxHash: event.transaction.hash,
      status: "graduated",
    },
  });

  // 3. Switch ALL prediction markets to localizer system
  const creatorMarkets = await context.db.markets.findMany({
    where: {
      creator: normalizedCreator,
      chainId: chain.chainId,
    },
  });

  console.log(
    `[${chain.chainName}] Switching ${creatorMarkets.items.length} markets to localizer`
  );

  for (const market of creatorMarkets.items) {
    await context.db.marketSystems.upsert({
      id: market.id,
      create: {
        creator: normalizedCreator,
        system: "localizer",
        switchedAt: timestamp,
      },
      update: {
        system: "localizer",
        switchedAt: timestamp,
      },
    });
  }

  // 4. Switch Launchpad token to localizer system
  await context.db.tokenSystems.upsert({
    id: normalizedBondingCurve,
    create: {
      creator: normalizedCreator,
      system: "localizer",
      switchedAt: timestamp,
    },
    update: {
      system: "localizer",
      switchedAt: timestamp,
    },
  });

  console.log(`[${chain.chainName}] Graduation processed for ${creator}`);

  // What happens after graduation:
  // 1. Creator's markets are now in 'localizer' system (done above)
  // 2. Volume on their markets no longer counts toward Pandora referral rewards
  // 3. Creator receives 0.15% fee on all trades (handled by smart contract)
  //
  // Backend MAY poll graduatedCreators to:
  // - Finalize Pandora referral rewards (calculate final amounts)
  // - Update status to 'finalized'
  //
  // NOTE: 95% of creators will stay in 'graduated' status forever.
  // Only rare partners (~5%) will manually set up their own ReferralCampaign.
});

// ===========================================================================
// TOKEN METADATA UPDATES (TokensFactory)
// ===========================================================================
/**
 * Handler for TokensFactory TokenUriSet event
 */
ponder.on("TokensFactory:TokenUriSet", async ({ event, context }: any) => {
  const { token, uri } = event.args;
  const normalizedToken = token.toLowerCase() as `0x${string}`;
  const chain = getChainInfo(context);

  await context.db.launchpadTokens.update({
    id: normalizedToken,
    data: { uri },
  });

  console.log(`[${chain.chainName}] Token URI set for ${normalizedToken}`);
});

/**
 * Handler for TokensFactory TokenImageUriSet event
 */
ponder.on("TokensFactory:TokenImageUriSet", async ({ event, context }: any) => {
  const { token, imageUri } = event.args;
  const normalizedToken = token.toLowerCase() as `0x${string}`;
  const chain = getChainInfo(context);

  await context.db.launchpadTokens.update({
    id: normalizedToken,
    data: { imageUri },
  });

  console.log(`[${chain.chainName}] Token image URI set for ${normalizedToken}`);
});

/**
 * Handler for TokensFactory TokenDescriptionSet event
 */
ponder.on("TokensFactory:TokenDescriptionSet", async ({ event, context }: any) => {
  const { token, description } = event.args;
  const normalizedToken = token.toLowerCase() as `0x${string}`;
  const chain = getChainInfo(context);

  await context.db.launchpadTokens.update({
    id: normalizedToken,
    data: { description },
  });

  console.log(`[${chain.chainName}] Token description set for ${normalizedToken}`);
});

// ===========================================================================
// BUY TOKENS (BondingCurve)
// ===========================================================================
/**
 * Handler for BondingCurve Buy event
 * Tracks token purchases, updates TVL, and updates referral volume (if pandora system)
 */
ponder.on("BondingCurve:Buy", async ({ event, context }: any) => {
  const { buyer, nativeAmount, tokensReceived } = event.args;
  const bondingCurveAddress =
    event.log.address.toLowerCase() as `0x${string}`;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const chain = getChainInfo(context);

  // Get token address from contract
  const tokenAddress = await context.client.readContract({
    address: bondingCurveAddress,
    abi: BondingCurveAbi,
    functionName: "token",
  });
  const normalizedToken = tokenAddress.toLowerCase() as `0x${string}`;

  // Check system (pandora or localizer)
  const systemMapping = await context.db.tokenSystems.findUnique({
    id: bondingCurveAddress,
  });

  const system = systemMapping?.system || "pandora";

  // Calculate fee (0.3% = 30 BPS)
  const fee = (nativeAmount * 30n) / 10000n;
  const nativeAfterFee = nativeAmount - fee;

  // Update TVL in launchpadTokens
  const tokenRecord = await context.db.launchpadTokens.findUnique({
    id: normalizedToken,
  });

  if (tokenRecord) {
    await context.db.launchpadTokens.update({
      id: normalizedToken,
      data: {
        currentTvlNative: tokenRecord.currentTvlNative + nativeAfterFee,
      },
    });
  }

  // Save trade for finalization
  await context.db.launchpadTrades.create({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    data: {
      bondingCurveAddress,
      trader: buyer.toLowerCase() as `0x${string}`,
      tradeType: "buy",
      nativeAmount,
      tokenAmount: tokensReceived,
      fee,
      timestamp,
      blockNumber,
      processedForReferral: false,
    },
  });

  // If pandora system - track referral volume
  if (system === "pandora") {
    await updateReferralVolume(
      context,
      buyer,
      nativeAmount,
      fee,
      timestamp,
      blockNumber,
      chain,
      bondingCurveAddress
    );
  }

  console.log(
    `[${chain.chainName}] Launchpad Buy: ${buyer} - ${nativeAmount} (system: ${system})`
  );
});

// ===========================================================================
// SELL TOKENS (BondingCurve)
// ===========================================================================
/**
 * Handler for BondingCurve Sell event
 * Tracks token sales, updates TVL, and updates referral volume (if pandora system)
 */
ponder.on("BondingCurve:Sell", async ({ event, context }: any) => {
  const { seller, tokensAmount, nativeReceived } = event.args;
  const bondingCurveAddress =
    event.log.address.toLowerCase() as `0x${string}`;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const chain = getChainInfo(context);

  // Get token address from contract
  const tokenAddress = await context.client.readContract({
    address: bondingCurveAddress,
    abi: BondingCurveAbi,
    functionName: "token",
  });
  const normalizedToken = tokenAddress.toLowerCase() as `0x${string}`;

  // Check system (pandora or localizer)
  const systemMapping = await context.db.tokenSystems.findUnique({
    id: bondingCurveAddress,
  });

  const system = systemMapping?.system || "pandora";

  // Calculate fee (0.3% = 30 BPS) - fee is on nativeReceived for sells
  const fee = (nativeReceived * 30n) / 10000n;

  // Update TVL in launchpadTokens (decrease)
  // Note: nativeReceived is after fee, so we add back the fee to get the actual decrease
  const tokenRecord = await context.db.launchpadTokens.findUnique({
    id: normalizedToken,
  });

  if (tokenRecord) {
    // The native that left the curve = nativeReceived + fee (before distribution)
    const nativeDecrease = nativeReceived + fee;
    const newTvl = tokenRecord.currentTvlNative > nativeDecrease
      ? tokenRecord.currentTvlNative - nativeDecrease
      : 0n;

    await context.db.launchpadTokens.update({
      id: normalizedToken,
      data: {
        currentTvlNative: newTvl,
      },
    });
  }

  // Save trade for finalization
  await context.db.launchpadTrades.create({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    data: {
      bondingCurveAddress,
      trader: seller.toLowerCase() as `0x${string}`,
      tradeType: "sell",
      nativeAmount: nativeReceived,
      tokenAmount: tokensAmount,
      fee,
      timestamp,
      blockNumber,
      processedForReferral: false,
    },
  });

  // If pandora system - track referral volume
  if (system === "pandora") {
    await updateReferralVolume(
      context,
      seller,
      nativeReceived,
      fee,
      timestamp,
      blockNumber,
      chain,
      bondingCurveAddress
    );
  }

  console.log(
    `[${chain.chainName}] Launchpad Sell: ${seller} - ${nativeReceived} (system: ${system})`
  );
});

// ===========================================================================
// GRADUATED (BondingCurve) - Internal event
// ===========================================================================
/**
 * Handler for BondingCurve Graduated event
 * This is the internal event when liquidity is added to DEX
 * The main graduation logic is in TokensFactory:TokenGraduated
 */
ponder.on("BondingCurve:Graduated", async ({ event, context }: any) => {
  const { pair, nativeAmount, tokenAmount } = event.args;
  const bondingCurveAddress =
    event.log.address.toLowerCase() as `0x${string}`;
  const chain = getChainInfo(context);

  console.log(
    `[${chain.chainName}] BondingCurve graduated to DEX: pair=${pair}, native=${nativeAmount}, tokens=${tokenAmount}`
  );
});

// ===========================================================================
// GRADUATION FAILED (BondingCurve)
// ===========================================================================
/**
 * Handler for BondingCurve GraduationFailed event
 * Logs when graduation attempt fails (e.g., slippage)
 */
ponder.on("BondingCurve:GraduationFailed", async ({ event, context }: any) => {
  const { nativeAmount, tokenAmount } = event.args;
  const bondingCurveAddress =
    event.log.address.toLowerCase() as `0x${string}`;
  const chain = getChainInfo(context);

  console.warn(
    `[${chain.chainName}] BondingCurve graduation FAILED: bondingCurve=${bondingCurveAddress}, native=${nativeAmount}, tokens=${tokenAmount}`
  );
});
