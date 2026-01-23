/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                    REFERRAL TRACKING SERVICE                               ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Handles referral volume and fee tracking for trade events.                ║
 * ║  Called by AMM and PariMutuel handlers on every trade.                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

import { ReferralFactoryAbi } from "../../abis/ReferralFactory";
import { getChainConfig } from "../../config";
import { ChainInfo, makeId } from "../utils/helpers";
import { ZERO_ADDRESS } from "../utils/constants";
import { getOrCreateUser } from "./db";

/**
 * Update referral volume tracking when a trade occurs.
 *
 * This function:
 * 1. Checks the entity's referral system (pandora or localizer)
 * 2. Skips tracking if it's a localizer system (they have their own referral system)
 * 3. Checks if the trader has a referrer on-chain
 * 4. If yes, updates the referral record, referrer stats, and global stats
 *
 * @param context - Ponder event context
 * @param traderAddress - Address of the trader who made the trade
 * @param volume - Trade volume in USDC (6 decimals) or native tokens (18 decimals for Launchpad)
 * @param fees - Fees paid on the trade
 * @param timestamp - Block timestamp
 * @param blockNumber - Event block number (used to pin on-chain reads to "state-at-emit")
 * @param chain - Chain info object
 * @param entityAddress - Market address (prediction market) OR BondingCurve address (Launchpad token)
 */
export async function updateReferralVolume(
  context: any,
  traderAddress: `0x${string}`,
  volume: bigint,
  fees: bigint,
  timestamp: bigint,
  blockNumber: bigint | number,
  chain: ChainInfo,
  entityAddress: `0x${string}`
): Promise<void> {

  if (volume === 0n) return;

  const normalizedEntity = entityAddress.toLowerCase() as `0x${string}`;
  let system = "pandora"; // Default to pandora

  const marketSystem = await context.db.marketSystems.findUnique({
    id: normalizedEntity,
  });

  if (marketSystem) {
    system = marketSystem.system;
  } else {
    const tokenSystem = await context.db.tokenSystems.findUnique({
      id: normalizedEntity,
    });
    if (tokenSystem) {
      system = tokenSystem.system;
    }
  }

  if (system === "localizer") {
    console.log(
      `[Referral] Skipping localizer entity ${normalizedEntity.slice(
        0,
        10
      )}... - not tracked in Pandora system`
    );
    return;
  }

  const normalizedTrader = traderAddress.toLowerCase() as `0x${string}`;
  const bn =
    typeof blockNumber === "bigint" ? blockNumber : BigInt(blockNumber);
  const referralFactoryAddress = getChainConfig(chain.chainId)!.contracts
    .referralFactory;

  let referrer: `0x${string}` | null = null;
  try {
    referrer = await context.client.readContract({
      address: referralFactoryAddress,
      abi: ReferralFactoryAbi,
      functionName: "getReferrer",
      args: [traderAddress],
      blockNumber: bn,
    });
  } catch (error: any) {
    const errorMsg = String(error?.message || error);
    const isExpectedError =
      errorMsg.includes("returned no data") ||
      errorMsg.includes("execution reverted") ||
      errorMsg.includes("0x");

    if (!isExpectedError) {
      console.warn(
        `[Referral] Unexpected error getting referrer for ${normalizedTrader.slice(
          0,
          10
        )}...: ${errorMsg.slice(0, 100)}`
      );
    }
    return;
  }

  if (!referrer || referrer === ZERO_ADDRESS) {
    return;
  }

  const normalizedReferrer = referrer.toLowerCase() as `0x${string}`;
  const referralId = `${normalizedReferrer}-${normalizedTrader}`;

  await context.db.referrals.upsert({
    id: referralId,
    create: {
      referrerAddress: normalizedReferrer,
      refereeAddress: normalizedTrader,
      // Unknown code hash if created via volume tracking (event not seen yet)
      referralCodeHash:
        "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      status: "active",
      totalVolumeGenerated: volume,
      totalFeesGenerated: fees,
      totalTradesCount: 1,
      totalRewardsEarned: 0n,
      referredAt: timestamp,
      referredAtBlock: 0n, // Unknown if created here
      firstTradeAt: timestamp,
      lastTradeAt: timestamp,
    },
    update: ({ current }: any) => ({
      status: "active", // Mark as active once they trade
      totalVolumeGenerated: current.totalVolumeGenerated + volume,
      totalFeesGenerated: current.totalFeesGenerated + fees,
      totalTradesCount: current.totalTradesCount + 1,
      firstTradeAt: current.firstTradeAt ?? timestamp,
      lastTradeAt: timestamp,
    }),
  });

  // Update the referrer's user stats
  const referrerRecord = await getOrCreateUser(context, referrer, chain);
  await context.db.users.update({
    id: referrerRecord.id,
    data: {
      totalReferralVolume:
        (referrerRecord.totalReferralVolume ?? 0n) + volume,
      totalReferralFees: (referrerRecord.totalReferralFees ?? 0n) + fees,
    },
  });

  // Update the referee's user record (ensure referrerAddress is set)
  const refereeRecord = await getOrCreateUser(context, traderAddress, chain);
  if (!refereeRecord.referrerAddress) {
    await context.db.users.update({
      id: refereeRecord.id,
      data: {
        referrerAddress: normalizedReferrer,
      },
    });
  }

  // Get the referral code hash to update code stats
  const referral = await context.db.referrals.findUnique({ id: referralId });
  if (
    referral?.referralCodeHash &&
    referral.referralCodeHash !==
    ZERO_ADDRESS.replace("0x", "0x" + "0".repeat(64))
  ) {
    const codeRecord = await context.db.referralCodes.findUnique({
      id: referral.referralCodeHash,
    });
    if (codeRecord) {
      await context.db.referralCodes.update({
        id: referral.referralCodeHash,
        data: {
          totalVolumeGenerated:
            codeRecord.totalVolumeGenerated + volume,
          totalFeesGenerated: codeRecord.totalFeesGenerated + fees,
        },
      });
    }
  }

  // Update global referral stats
  await context.db.referralStats.upsert({
    id: "global",
    create: {
      totalCodes: 0,
      totalReferrals: 0,
      totalVolumeGenerated: volume,
      totalFeesGenerated: fees,
      totalRewardsDistributed: 0n,
      updatedAt: timestamp,
    },
    update: ({ current }: any) => ({
      totalVolumeGenerated: current.totalVolumeGenerated + volume,
      totalFeesGenerated: current.totalFeesGenerated + fees,
      updatedAt: timestamp,
    }),
  });
}
