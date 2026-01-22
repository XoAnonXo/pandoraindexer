/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                    REFERRAL FACTORY HANDLERS (NEW)                         ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Handles referral relationships with signature-based verification.         ║
 * ║  New system: ReferralFactory + ReferralCampaign contracts                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { getOrCreateUser } from "../services/db";

// =============================================================================
// REFERRAL REGISTERED EVENT (NEW)
// =============================================================================
/**
 * Handles when a new user registers under a referrer via signature.
 * Creates a referrals record and updates both user and referrer stats.
 * 
 * NOTE: In the new system, there are no referral codes (codeHash).
 * Referrals are tracked directly by referee => referrer mapping.
 */
ponder.on("ReferralFactory:ReferralRegistered", async ({ event, context }: any) => {
  const { referrer, referee } = event.args;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const chain = getChainInfo(context);
  
  const normalizedReferee = referee.toLowerCase() as `0x${string}`;
  const normalizedReferrer = referrer.toLowerCase() as `0x${string}`;
  const referralId = `${normalizedReferrer}-${normalizedReferee}`;
  
  console.log(`[${chain.chainName}] Referral registered: ${normalizedReferee} referred by ${normalizedReferrer}`);
  
  // Create referral relationship record
  await context.db.referrals.create({
    id: referralId,
    data: {
      referrerAddress: normalizedReferrer,
      refereeAddress: normalizedReferee,
      referralCodeHash: null, // NEW: No code hash in new system
      status: "pending", // Will become "active" on first trade
      totalVolumeGenerated: 0n,
      totalFeesGenerated: 0n,
      totalTradesCount: 0,
      totalRewardsEarned: 0n,
      referredAt: timestamp,
      referredAtBlock: blockNumber,
    },
  });
  
  // Update referee's user record
  const refereeRecord = await getOrCreateUser(context, referee, chain);
  await context.db.users.update({
    id: refereeRecord.id,
    data: {
      referrerAddress: normalizedReferrer,
      referredAt: timestamp,
    },
  });
  
  // Update referrer's stats
  const referrerRecord = await getOrCreateUser(context, referrer, chain);
  await context.db.users.update({
    id: referrerRecord.id,
    data: {
      totalReferrals: referrerRecord.totalReferrals + 1,
    },
  });
  
  // Update global referral stats
  await context.db.referralStats.upsert({
    id: "global",
    create: {
      totalCodes: 0, // No codes in new system
      totalReferrals: 1,
      totalVolumeGenerated: 0n,
      totalFeesGenerated: 0n,
      totalRewardsDistributed: 0n,
      updatedAt: timestamp,
    },
    update: ({ current }: any) => ({
      totalReferrals: current.totalReferrals + 1,
      updatedAt: timestamp,
    }),
  });
});
