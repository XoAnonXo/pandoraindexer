/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                    REFERRAL REGISTRY HANDLERS                              ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Handles referral code registration and referrer-referee relationships.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { getOrCreateUser } from "../services/db";

/**
 * Decode a bytes32 code hash to a human-readable string.
 * The code is packed as UTF-8 bytes, null-terminated.
 */
function decodeCodeBytes32(codeHash: `0x${string}`): string {
  const hex = codeHash.slice(2); // Remove 0x prefix
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    const charCode = parseInt(hex.slice(i, i + 2), 16);
    if (charCode === 0) break; // Stop at null terminator
    str += String.fromCharCode(charCode);
  }
  return str;
}

// =============================================================================
// CODE REGISTERED EVENT
// =============================================================================
/**
 * Handles when a user registers a new referral code.
 * Creates a referralCodes record and updates user's referralCodeHash.
 */
ponder.on("ReferralRegistry:CodeRegistered", async ({ event, context }) => {
  const { owner, codeHash } = event.args;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const chain = getChainInfo(context);
  
  const code = decodeCodeBytes32(codeHash);
  const normalizedUser = owner.toLowerCase() as `0x${string}`;
  
  console.log(`[${chain.chainName}] Referral code registered: ${code} by ${normalizedUser}`);
  
  // Create referral code record
  await context.db.referralCodes.create({
    id: codeHash,
    data: {
      ownerAddress: normalizedUser,
      code: code,
      totalReferrals: 0,
      totalVolumeGenerated: 0n,
      totalFeesGenerated: 0n,
      createdAt: timestamp,
      createdAtBlock: blockNumber,
    },
  });
  
  // Update or create user record with their referral code
  const userRecord = await getOrCreateUser(context, owner, chain);
  await context.db.users.update({
    id: userRecord.id,
    data: {
      referralCodeHash: codeHash,
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
    update: ({ current }) => ({
      totalCodes: current.totalCodes + 1,
      updatedAt: timestamp,
    }),
  });
});

// =============================================================================
// REFERRAL REGISTERED EVENT
// =============================================================================
/**
 * Handles when a new user registers under a referrer.
 * Creates a referrals record and updates both user and referrer stats.
 */
ponder.on("ReferralRegistry:ReferralRegistered", async ({ event, context }) => {
  const { referee, referrer, codeHash } = event.args;
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
      referralCodeHash: codeHash,
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
  
  // Update referral code stats (if code exists)
  const codeRecord = await context.db.referralCodes.findUnique({ id: codeHash });
  if (codeRecord) {
    await context.db.referralCodes.update({
      id: codeHash,
      data: {
        totalReferrals: codeRecord.totalReferrals + 1,
      },
    });
  }
  
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
    update: ({ current }) => ({
      totalReferrals: current.totalReferrals + 1,
      updatedAt: timestamp,
    }),
  });
});

