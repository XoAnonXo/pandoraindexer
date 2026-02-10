/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                    REFERRAL SYSTEM HANDLERS                                ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Handles referral relationships, codes, and claims.                        ║
 * ║  Contracts: ReferralFactory + ReferralCampaign                             ║
 * ║                                                                            ║
 * ║  Events:                                                                   ║
 * ║  - ReferralFactory:ReferralCodeRegistered - User registers a referral code ║
 * ║  - ReferralFactory:ReferralRegistered - New referral relationship          ║
 * ║  - ReferralCampaign:Claimed - User claims rewards                          ║
 * ║  - ReferralCampaign:ClaimedBatch - User claims multiple rewards at once    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

import { ponder } from "@/generated";
import { getChainInfo } from "../utils/helpers";
import { getOrCreateUser } from "../services/db";

// =============================================================================
// REFERRAL CODE REGISTERED EVENT
// =============================================================================
/**
 * Handles when a user registers a new referral code.
 * Creates a referralCodes record for tracking.
 */
ponder.on("ReferralFactory:ReferralCodeRegistered", async ({ event, context }: any) => {
  const { referrer, codeHash, code } = event.args;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const chain = getChainInfo(context);

  const normalizedReferrer = referrer.toLowerCase() as `0x${string}`;
  const normalizedCodeHash = codeHash.toLowerCase() as `0x${string}`;

  console.log(`[${chain.chainName}] Referral code registered: "${code}" by ${normalizedReferrer}`);

  // Create referral code record
  await context.db.referralCodes.create({
    id: normalizedCodeHash,
    data: {
      ownerAddress: normalizedReferrer,
      code: code,
      totalReferrals: 0,
      totalVolumeGenerated: 0n,
      totalFeesGenerated: 0n,
      createdAt: timestamp,
      createdAtBlock: blockNumber,
    },
  });

  // Update global referral stats
  await context.db.referralStats.upsert({
    id: "global",
    create: {
      totalCodes: 1,
      totalReferrals: 0,
      totalVolumeGenerated: 0n,
      totalFeesGenerated: 0n,
      totalRewardsDistributed: 0n,
      updatedAt: timestamp,
    },
    update: ({ current }: any) => ({
      totalCodes: current.totalCodes + 1,
      updatedAt: timestamp,
    }),
  });
});

// =============================================================================
// REFERRAL REGISTERED EVENT
// =============================================================================
/**
 * Handles when a new user registers under a referrer via signature.
 * Creates a referrals record and updates both user and referrer stats.
 *
 * NOTE: In the new system, referrals use code hashes instead of direct addresses.
 * The referrer is resolved from the referral code hash.
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
      referralCodeHash: null, // Code hash not available in event args
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
      totalCodes: 0,
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

// =============================================================================
// CLAIMED EVENT (ReferralCampaign)
// =============================================================================
/**
 * Handles when a user claims referral rewards.
 *
 * Event args: { user, amount, signature }
 * - signature is the 65-byte signature that was used for the claim
 *
 * This handler:
 * 1. Updates global referralStats
 * 2. Creates a claimEvents record for backend sync
 *
 * Backend sync job reads claimEvents (finalized blocks only) and updates
 * app_internal.claim_signatures. This ensures reorg-safety.
 */
ponder.on("ReferralCampaign:Claimed", async ({ event, context }: any) => {
  const { user, amount, signature } = event.args;
  const campaignAddress = event.log.address.toLowerCase() as `0x${string}`;
  const txHash = event.transaction.hash;
  const blockNumber = event.block.number;
  const timestamp = event.block.timestamp;
  const logIndex = event.log.logIndex;
  const chain = getChainInfo(context);

  const normalizedUser = user.toLowerCase() as `0x${string}`;
  const normalizedSignature = signature?.toLowerCase() as `0x${string}`;
  const eventId = `${txHash}-${logIndex}`;

  console.log(
    `[${chain.chainName}] Claim: ${normalizedUser} claimed ${amount} from campaign ${campaignAddress}`
  );

  // Update global referral stats with distributed rewards
  await context.db.referralStats.upsert({
    id: "global",
    create: {
      totalCodes: 0,
      totalReferrals: 0,
      totalVolumeGenerated: 0n,
      totalFeesGenerated: 0n,
      totalRewardsDistributed: amount,
      updatedAt: timestamp,
    },
    update: ({ current }: any) => ({
      totalRewardsDistributed: current.totalRewardsDistributed + amount,
      updatedAt: timestamp,
    }),
  });

  // Create claimEvents record for backend sync
  // Backend will read this table and update app_internal.claim_signatures
  await context.db.claimEvents.create({
    id: eventId,
    data: {
      campaignAddress,
      userAddress: normalizedUser,
      amount,
      signature: normalizedSignature,
      blockNumber,
      timestamp,
      txHash,
      synced: false,
    },
  });
});

// =============================================================================
// CLAIMED BATCH EVENT (ReferralCampaign)
// =============================================================================
/**
 * Handles when a user claims multiple referral rewards in one transaction.
 *
 * Event args: { user, totalAmount, claimCount, signatures }
 * - signatures is an array of 65-byte signatures that were used
 *
 * Creates one claimEvents record per signature for backend sync.
 */
ponder.on("ReferralCampaign:ClaimedBatch", async ({ event, context }: any) => {
  const { user, totalAmount, claimCount, signatures } = event.args;
  const campaignAddress = event.log.address.toLowerCase() as `0x${string}`;
  const txHash = event.transaction.hash;
  const blockNumber = event.block.number;
  const timestamp = event.block.timestamp;
  const logIndex = event.log.logIndex;
  const chain = getChainInfo(context);

  const normalizedUser = user.toLowerCase() as `0x${string}`;

  console.log(
    `[${chain.chainName}] Batch Claim: ${normalizedUser} claimed ${totalAmount} (${claimCount} claims) from campaign ${campaignAddress}`
  );

  // Update global referral stats with distributed rewards
  await context.db.referralStats.upsert({
    id: "global",
    create: {
      totalCodes: 0,
      totalReferrals: 0,
      totalVolumeGenerated: 0n,
      totalFeesGenerated: 0n,
      totalRewardsDistributed: totalAmount,
      updatedAt: timestamp,
    },
    update: ({ current }: any) => ({
      totalRewardsDistributed: current.totalRewardsDistributed + totalAmount,
      updatedAt: timestamp,
    }),
  });

  // Backend will read these and update app_internal.claim_signatures
  if (signatures && Array.isArray(signatures)) {
    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      const normalizedSignature = sig?.toLowerCase() as `0x${string}`;
      const eventId = `${txHash}-${logIndex}-${i}`;

      await context.db.claimEvents.create({
        id: eventId,
        data: {
          campaignAddress,
          userAddress: normalizedUser,
          amount: 0n, // Individual amounts not available in batch event
          signature: normalizedSignature,
          blockNumber,
          timestamp,
          txHash,
          synced: false,
        },
      });
    }
  }
});

// =============================================================================
// CAMPAIGN CREATED EVENT (ReferralFactory)
// =============================================================================
/**
 * Handles when a new campaign is created.
 * Note: This is also handled in campaigns.ts, this is a secondary handler
 * for logging purposes.
 */
ponder.on("ReferralFactory:CampaignCreated", async ({ event, context }: any) => {
  const { campaign, rewardToken, operator, campaignType } = event.args;
  const chain = getChainInfo(context);

  console.log(
    `[${chain.chainName}] Campaign created: ${campaign} (type: ${campaignType}, operator: ${operator})`
  );
});
