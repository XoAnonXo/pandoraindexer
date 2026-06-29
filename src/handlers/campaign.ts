import { ponder } from "ponder:registry";
import { campaigns, campaignStats } from "ponder:schema";
import { getChainInfo } from "../utils/helpers";

ponder.on("ReferralFactory:CampaignCreated", async ({ event, context }: any) => {
  const { campaign, rewardToken, operator, campaignType } = event.args;

  const chain = getChainInfo(context);
  const campaignId = campaign.toLowerCase() as `0x${string}`;

  console.log(`[${chain.chainName}] Campaign created: ${campaignId} (operator: ${operator}, type: ${campaignType})`);

  await context.db.insert(campaigns).values({
    id: campaignId,
    chainId: chain.chainId,
    chainName: chain.chainName,
    operator: operator.toLowerCase() as `0x${string}`,
    rewardToken: rewardToken.toLowerCase() as `0x${string}`,
    campaignType: BigInt(campaignType),
    status: 1,
    createdAtBlock: event.block.number,
    createdAt: event.block.timestamp,
    createdTxHash: event.transaction.hash,
  });

  await context.db.insert(campaignStats).values({
    id: "global",
    totalCampaigns: 1,
    activeCampaigns: 1,
    updatedAt: event.block.timestamp,
  }).onConflictDoUpdate((row: any) => ({
    totalCampaigns: row.totalCampaigns + 1,
    activeCampaigns: row.activeCampaigns + 1,
    updatedAt: event.block.timestamp,
  }));
});
