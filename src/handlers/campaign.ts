/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                REFERRAL CAMPAIGN HANDLERS (NEW)                            ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Handles reward campaign creation via ReferralFactory.                     ║
 * ║  New system: Signature-based reward distribution with operator             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

import { ponder } from "@/generated";
import { getChainInfo } from "../utils/helpers";

// =============================================================================
// CAMPAIGN CREATED EVENT (NEW)
// =============================================================================
/**
 * Handles when a new reward campaign is created by ReferralFactory.
 * Creates campaign record and updates global stats.
 * 
 * NEW SYSTEM:
 * - Campaigns are created by ReferralFactory.createCampaign()
 * - Each campaign has an operator that signs claim messages
 * - Rewards distributed via EIP-712 signatures
 * - Campaign address is emitted in event (not campaignId)
 */
ponder.on("ReferralFactory:CampaignCreated", async ({ event, context }: any) => {
  const {
    campaign,
    rewardToken,
    operator,
    version,
  } = event.args;

  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const chain = getChainInfo(context);

  const normalizedCampaign = campaign.toLowerCase() as `0x${string}`;
  const normalizedRewardToken = rewardToken.toLowerCase() as `0x${string}`;
  const normalizedOperator = operator.toLowerCase() as `0x${string}`;
  
  // Use campaign address as ID (instead of campaignId)
  const campaignId = normalizedCampaign;

  console.log(`[${chain.chainName}] Campaign created: ${campaignId} (operator: ${normalizedOperator}, version: ${version})`);

  // Create campaign record
  await context.db.campaigns.create({
    id: campaignId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      name: `Campaign ${campaignId.slice(0, 10)}...`, // Default name (can be updated manually)
      description: `Signature-based referral rewards v${version}`,
      creator: normalizedOperator, // Operator acts as creator
      rewardAsset: normalizedRewardToken,
      assetKind: 0, // ERC20 (assuming)
      rewardPool: 0n, // Not tracked on-chain in new system
      rewardsPaid: 0n,
      rewardType: 0, // Custom (signature-based)
      rewardConfig: "0x", // Not used in new system
      startTime: BigInt(timestamp), // Campaign starts immediately
      endTime: 0n, // No end time (perpetual)
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
    update: ({ current }: any) => ({
      totalCampaigns: current.totalCampaigns + 1,
      activeCampaigns: current.activeCampaigns + 1,
      updatedAt: timestamp,
    }),
  });
});

// NOTE: CampaignStatusChanged event does not exist in new system
// Status changes would need to be tracked via ReferralCampaign contract state reads
