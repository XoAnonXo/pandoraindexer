/**
 * Launchpad (BondingCurve) Event Handlers
 *
 * Handles:
 * - TokenGraduated: When a token reaches $50k TVL and graduates to DEX
 * - Buy: Token purchases on bonding curve
 * - Sell: Token sales on bonding curve
 *
 * These handlers track:
 * 1. Graduation events → switch creator's markets to localizer system
 * 2. Buy/Sell trades → referral volume tracking (filtered by system)
 */

import { ponder } from "@/generated";
import { getChainInfo } from "../utils/helpers";
import { updateReferralVolume } from "../services/referral";
import { BondingCurveAbi } from "../../abis/BondingCurve";

// ===========================================================================
// BUY TOKENS
// ===========================================================================
/**
 * Handler for BondingCurve Buy event
 * Tracks token purchases and updates referral volume (if pandora system)
 */
ponder.on("BondingCurve:Buy", async ({ event, context }) => {
  const { buyer, nativeAmount, tokensReceived } = event.args;
  const bondingCurveAddress =
    event.log.address.toLowerCase() as `0x${string}`;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const chain = getChainInfo(context);

  // Get creator from contract
  const creator = await context.client.readContract({
    address: bondingCurveAddress,
    abi: BondingCurveAbi,
    functionName: "creator",
  });
  const normalizedCreator = creator.toLowerCase() as `0x${string}`;

  // Check system (pandora or localizer)
  const systemMapping = await context.db.tokenSystems.findUnique({
    id: bondingCurveAddress,
  });

  const system = systemMapping?.system || "pandora";

  // Calculate fee (0.3% = 30 BPS)
  const fee = (nativeAmount * 30n) / 10000n;

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
// SELL TOKENS
// ===========================================================================
/**
 * Handler for BondingCurve Sell event
 * Tracks token sales and updates referral volume (if pandora system)
 */
ponder.on("BondingCurve:Sell", async ({ event, context }) => {
  const { seller, tokensAmount, nativeReceived } = event.args;
  const bondingCurveAddress =
    event.log.address.toLowerCase() as `0x${string}`;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const chain = getChainInfo(context);

  // Get creator from contract
  const creator = await context.client.readContract({
    address: bondingCurveAddress,
    abi: BondingCurveAbi,
    functionName: "creator",
  });
  const normalizedCreator = creator.toLowerCase() as `0x${string}`;

  // Check system (pandora or localizer)
  const systemMapping = await context.db.tokenSystems.findUnique({
    id: bondingCurveAddress,
  });

  const system = systemMapping?.system || "pandora";

  // Calculate fee (0.3% = 30 BPS)
  const fee = (nativeReceived * 30n) / 10000n;

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
// TOKEN GRADUATED
// ===========================================================================
/**
 * Handler for BondingCurve TokenGraduated event
 *
 * When a token reaches $50k TVL, creator becomes a "localizer":
 * 1. Record graduation in graduatedCreators table
 * 2. Switch ALL creator's prediction markets to 'localizer' system
 * 3. Switch the graduated token to 'localizer' system
 * 4. Backend will detect this and trigger finalization process
 */
ponder.on("BondingCurve:TokenGraduated", async ({ event, context }) => {
  const { creator, token, bondingCurve, tvlUsd } = event.args;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const chain = getChainInfo(context);

  const normalizedCreator = creator.toLowerCase() as `0x${string}`;
  const normalizedToken = token.toLowerCase() as `0x${string}`;
  const normalizedBondingCurve = bondingCurve.toLowerCase() as `0x${string}`;

  console.log(
    `[${chain.chainName}] 🎓 Token graduated: ${token} by ${creator} (TVL: $${tvlUsd})`
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
  await context.db.graduatedCreators.create({
    id: normalizedCreator,
    data: {
      tokenAddress: normalizedToken,
      bondingCurveAddress: normalizedBondingCurve,
      graduationTvl: tvlUsd,
      graduatedAtBlock: blockNumber,
      graduatedAt: timestamp,
      graduatedTxHash: event.transaction.hash,
      status: "pending_setup", // Backend will deploy ReferralFactory
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
    `[${chain.chainName}] Switching ${creatorMarkets.length} markets to localizer`
  );

  for (const market of creatorMarkets) {
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

  console.log(`[${chain.chainName}] ✅ Graduation processed for ${creator}`);
  console.log(
    `[${chain.chainName}] 🔔 Backend should now trigger finalization for creator ${creator}`
  );

  // Backend will poll graduatedCreators table and:
  // 1. Run finalization: calculate final Pandora referral rewards
  // 2. Deploy ReferralFactory for localizer
  // 3. Deploy ReferralCampaign for localizer
  // 4. Update status to 'active'
});
