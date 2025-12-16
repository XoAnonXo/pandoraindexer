/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                    REFERRAL TRACKING SERVICE                               ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Handles referral volume and fee tracking for trade events.                ║
 * ║  Called by AMM and PariMutuel handlers on every trade.                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

import { ReferralRegistryAbi } from "../../abis/ReferralRegistry";
import { ChainInfo, makeId } from "../utils/helpers";
import { getOrCreateUser } from "./db";

// ReferralRegistry contract address on Sonic
const REFERRAL_REGISTRY_ADDRESS = "0xF3a3930B0FA5D0a53d1204Be1Deea638d939f04f" as `0x${string}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

/**
 * Update referral volume tracking when a trade occurs.
 * 
 * This function:
 * 1. Checks if the trader has a referrer on-chain
 * 2. If yes, updates the referral record, referrer stats, and global stats
 * 
 * @param context - Ponder event context
 * @param traderAddress - Address of the trader who made the trade
 * @param volume - Trade volume in USDC (6 decimals)
 * @param fees - Fees paid on the trade (6 decimals)
 * @param timestamp - Block timestamp
 * @param chain - Chain info object
 */
export async function updateReferralVolume(
  context: any,
  traderAddress: `0x${string}`,
  volume: bigint,
  fees: bigint,
  timestamp: bigint,
  chain: ChainInfo
): Promise<void> {
  // Skip zero volume trades
  if (volume === 0n) return;
  
  const normalizedTrader = traderAddress.toLowerCase() as `0x${string}`;
  
  // Query the ReferralRegistry contract to get the trader's referrer
  let referrer: `0x${string}`;
  try {
    referrer = await context.client.readContract({
      address: REFERRAL_REGISTRY_ADDRESS,
      abi: ReferralRegistryAbi,
      functionName: "getReferrer",
      args: [traderAddress],
    });
  } catch (error) {
    // If the contract call fails, assume no referrer
    console.warn(`Failed to get referrer for ${normalizedTrader}: ${error}`);
    return;
  }
  
  // If no referrer or zero address, nothing to track
  if (!referrer || referrer === ZERO_ADDRESS) {
    return;
  }
  
  const normalizedReferrer = referrer.toLowerCase() as `0x${string}`;
  const referralId = `${normalizedReferrer}-${normalizedTrader}`;
  
  // Update or create the referral record
  // Use upsert to handle edge cases where ReferralRegistered event might not have been indexed yet
  await context.db.referrals.upsert({
    id: referralId,
    create: {
      referrerAddress: normalizedReferrer,
      refereeAddress: normalizedTrader,
      // Unknown code hash if created via volume tracking (event not seen yet)
      referralCodeHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
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
    update: ({ current }) => ({
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
      totalReferralVolume: (referrerRecord.totalReferralVolume ?? 0n) + volume,
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
  if (referral?.referralCodeHash && referral.referralCodeHash !== ZERO_ADDRESS.replace("0x", "0x" + "0".repeat(64))) {
    const codeRecord = await context.db.referralCodes.findUnique({ id: referral.referralCodeHash });
    if (codeRecord) {
      await context.db.referralCodes.update({
        id: referral.referralCodeHash,
        data: {
          totalVolumeGenerated: codeRecord.totalVolumeGenerated + volume,
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
    update: ({ current }) => ({
      totalVolumeGenerated: current.totalVolumeGenerated + volume,
      totalFeesGenerated: current.totalFeesGenerated + fees,
      updatedAt: timestamp,
    }),
  });
}

