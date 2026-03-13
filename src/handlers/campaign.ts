import { ponder } from "@/generated";
import { getChainInfo } from "../utils/helpers";

ponder.on("ReferralFactory:CampaignCreated", async ({ event, context }: any) => {
  const { campaign, rewardToken, operator, campaignType } = event.args;

  const chain = getChainInfo(context);
  const campaignId = campaign.toLowerCase() as `0x${string}`;

  console.log(`[${chain.chainName}] Campaign created: ${campaignId} (operator: ${operator}, type: ${campaignType})`);

  await context.db.campaigns.create({
    id: campaignId,
    data: {
      chainId: chain.chainId,
      chainName: chain.chainName,
      operator: operator.toLowerCase() as `0x${string}`,
      rewardToken: rewardToken.toLowerCase() as `0x${string}`,
      campaignType: BigInt(campaignType),
      status: 1,
      createdAtBlock: event.block.number,
      createdAt: event.block.timestamp,
      createdTxHash: event.transaction.hash,
    },
  });

  await context.db.campaignStats.upsert({
    id: "global",
    create: {
      totalCampaigns: 1,
      activeCampaigns: 1,
      totalRewardsDistributed: 0n,
      totalParticipants: 0,
      updatedAt: event.block.timestamp,
    },
    update: ({ current }: any) => ({
      totalCampaigns: current.totalCampaigns + 1,
      activeCampaigns: current.activeCampaigns + 1,
      updatedAt: event.block.timestamp,
    }),
  });
});
