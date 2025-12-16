/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                    CAMPAIGN FACTORY HANDLERS                               ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Handles reward campaign creation and status changes.                      ║
 * ║  Campaigns distribute rewards to referrers based on various criteria.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

import { ponder } from "@/generated";
import { getChainInfo } from "../utils/helpers";

// =============================================================================
// CAMPAIGN CREATED EVENT
// =============================================================================
/**
 * Handles when a new reward campaign is created.
 * Creates campaign record and updates global stats.
 * 
 * Campaign types:
 * - Referral rewards (% of referee volume)
 * - Fixed rewards per signup
 * - Tiered rewards based on performance
 * - Custom reward logic
 */
ponder.on("CampaignFactory:CampaignCreated", async ({ event, context }) => {
  const {
    campaignId,
    creator,
    rewardAsset,
    assetKind,
    rewardPool,
    startTime,
    endTime,
    rewardType,
    rewardConfig,
    name,
    description,
  } = event.args;

  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const chain = getChainInfo(context);

  const normalizedCreator = creator.toLowerCase() as `0x${string}`;
  const normalizedRewardAsset = rewardAsset.toLowerCase() as `0x${string}`;
  const campaignIdStr = campaignId.toString();

  console.log(`[${chain.chainName}] Campaign created: ${name} (ID: ${campaignIdStr}) by ${normalizedCreator}`);

  // Create campaign record
  await context.db.campaigns.create({
    id: campaignIdStr,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      name: name,
      description: description,
      creator: normalizedCreator,
      rewardAsset: normalizedRewardAsset,
      assetKind: assetKind,
      rewardPool: rewardPool,
      rewardsPaid: 0n,
      rewardType: rewardType,
      rewardConfig: rewardConfig,
      startTime: startTime,
      endTime: endTime,
      status: 0, // Active by default
      totalParticipants: 0,
      totalClaims: 0,
      createdAtBlock: blockNumber,
      createdAt: timestamp,
      createdTxHash: event.transaction.hash,
      updatedAt: timestamp,
    },
  });

  // Update global campaign stats
  await context.db.campaignStats.upsert({
    id: "global",
    create: {
      totalCampaigns: 1,
      activeCampaigns: 1,
      totalRewardsDistributed: 0n,
      totalParticipants: 0,
      updatedAt: timestamp,
    },
    update: ({ current }) => ({
      totalCampaigns: current.totalCampaigns + 1,
      activeCampaigns: current.activeCampaigns + 1,
      updatedAt: timestamp,
    }),
  });
});

// =============================================================================
// CAMPAIGN STATUS CHANGED EVENT
// =============================================================================
/**
 * Handles when a campaign's status changes.
 * Status values:
 * - 0: Active
 * - 1: Paused
 * - 2: Ended
 * - 3: Cancelled
 */
ponder.on("CampaignFactory:CampaignStatusChanged", async ({ event, context }) => {
  const { campaignId, status } = event.args;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);

  const campaignIdStr = campaignId.toString();
  const statusNames = ["Active", "Paused", "Ended", "Cancelled"];
  const statusName = statusNames[status] || `Unknown(${status})`;

  console.log(`[${chain.chainName}] Campaign ${campaignIdStr} status changed to: ${statusName}`);

  // Get current campaign to track status changes
  const campaign = await context.db.campaigns.findUnique({ id: campaignIdStr });
  const wasActive = campaign?.status === 0;
  const isNowActive = status === 0;

  // Update campaign status
  await context.db.campaigns.update({
    id: campaignIdStr,
    data: {
      status: status,
      updatedAt: timestamp,
    },
  });

  // Update active campaigns count if status changed to/from active
  if (wasActive !== isNowActive) {
    await context.db.campaignStats.upsert({
      id: "global",
      create: {
        totalCampaigns: 1,
        activeCampaigns: isNowActive ? 1 : 0,
        totalRewardsDistributed: 0n,
        totalParticipants: 0,
        updatedAt: timestamp,
      },
      update: ({ current }) => ({
        activeCampaigns: isNowActive 
          ? current.activeCampaigns + 1 
          : Math.max(0, current.activeCampaigns - 1),
        updatedAt: timestamp,
      }),
    });
  }
});

