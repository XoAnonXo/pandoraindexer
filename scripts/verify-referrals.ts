#!/usr/bin/env tsx
/**
 * Referral System Verification Script
 * 
 * Compares indexer referral data with on-chain ReferralRegistry contract.
 * 
 * Checks:
 * - Referral codes match on-chain
 * - Referral relationships are correctly indexed
 * - Referrer addresses are accurate
 * - Global stats consistency
 */

import { type Address } from "viem";
import {
  client,
  queryIndexer,
  logHeader,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  compare,
  createSummary,
  recordResult,
  printSummary,
  type VerificationSummary,
} from "./utils.js";
import { CONTRACTS, ReferralRegistryAbi, CampaignFactoryAbi } from "./contracts.js";

// Types for GraphQL responses
interface ReferralCode {
  id: string;
  ownerAddress: string;
  code: string;
  totalReferrals: number;
}

interface Referral {
  id: string;
  referrerAddress: string;
  refereeAddress: string;
  referralCodeHash: string;
  status: string;
}

interface ReferralStats {
  id: string;
  totalCodes: number;
  totalReferrals: number;
  totalVolumeGenerated: string;
}

interface Campaign {
  id: string;
  name: string;
  creator: string;
  rewardAsset: string;
  rewardPool: string;
  status: number;
}

interface CampaignStats {
  id: string;
  totalCampaigns: number;
  activeCampaigns: number;
}

/**
 * Get all referral codes from indexer
 */
async function getIndexerReferralCodes(): Promise<ReferralCode[]> {
  const query = `
    query {
      referralCodess(limit: 100) {
        items {
          id
          ownerAddress
          code
          totalReferrals
        }
      }
    }
  `;
  const data = await queryIndexer<{ referralCodess: { items: ReferralCode[] } }>(query);
  return data.referralCodess.items;
}

/**
 * Get all referrals from indexer
 */
async function getIndexerReferrals(): Promise<Referral[]> {
  const query = `
    query {
      referralss(limit: 100) {
        items {
          id
          referrerAddress
          refereeAddress
          referralCodeHash
          status
        }
      }
    }
  `;
  const data = await queryIndexer<{ referralss: { items: Referral[] } }>(query);
  return data.referralss.items;
}

/**
 * Get referral stats from indexer
 */
async function getIndexerReferralStats(): Promise<ReferralStats | null> {
  const query = `
    query {
      referralStatss(limit: 1) {
        items {
          id
          totalCodes
          totalReferrals
          totalVolumeGenerated
        }
      }
    }
  `;
  const data = await queryIndexer<{ referralStatss: { items: ReferralStats[] } }>(query);
  return data.referralStatss.items[0] || null;
}

/**
 * Get campaigns from indexer
 */
async function getIndexerCampaigns(): Promise<Campaign[]> {
  const query = `
    query {
      campaignss(limit: 100) {
        items {
          id
          name
          creator
          rewardAsset
          rewardPool
          status
        }
      }
    }
  `;
  const data = await queryIndexer<{ campaignss: { items: Campaign[] } }>(query);
  return data.campaignss.items;
}

/**
 * Get campaign stats from indexer
 */
async function getIndexerCampaignStats(): Promise<CampaignStats | null> {
  const query = `
    query {
      campaignStatss(limit: 1) {
        items {
          id
          totalCampaigns
          activeCampaigns
        }
      }
    }
  `;
  const data = await queryIndexer<{ campaignStatss: { items: CampaignStats[] } }>(query);
  return data.campaignStatss.items[0] || null;
}

/**
 * Verify referral code against on-chain data
 */
async function verifyReferralCode(code: ReferralCode, summary: VerificationSummary): Promise<void> {
  const codeHash = code.id as `0x${string}`;
  
  try {
    const onchainOwner = await client.readContract({
      address: CONTRACTS.referralRegistry,
      abi: ReferralRegistryAbi,
      functionName: "getCodeOwner",
      args: [codeHash],
    });
    
    const result = compare(
      `Code ${code.code} owner`,
      code.ownerAddress,
      onchainOwner.toLowerCase()
    );
    recordResult(summary, result.match, result.label);
  } catch (error) {
    logWarning(`Could not verify code ${code.code}: ${error}`);
    summary.warnings++;
  }
}

/**
 * Verify referral relationship against on-chain data
 */
async function verifyReferral(referral: Referral, summary: VerificationSummary): Promise<void> {
  try {
    const onchainReferrer = await client.readContract({
      address: CONTRACTS.referralRegistry,
      abi: ReferralRegistryAbi,
      functionName: "getReferrer",
      args: [referral.refereeAddress as Address],
    });
    
    const result = compare(
      `Referral ${referral.refereeAddress.slice(0, 10)}... referrer`,
      referral.referrerAddress,
      onchainReferrer.toLowerCase()
    );
    recordResult(summary, result.match, result.label);
  } catch (error) {
    logWarning(`Could not verify referral for ${referral.refereeAddress}: ${error}`);
    summary.warnings++;
  }
}

/**
 * Count on-chain events for verification
 */
async function countOnchainEvents(): Promise<{ codes: number; referrals: number }> {
  try {
    const codeEvents = await client.getLogs({
      address: CONTRACTS.referralRegistry,
      event: {
        type: "event",
        name: "CodeRegistered",
        inputs: [
          { name: "owner", type: "address", indexed: true },
          { name: "codeHash", type: "bytes32", indexed: true },
        ],
      },
      fromBlock: BigInt(CONTRACTS.startBlock),
      toBlock: "latest",
    });
    
    const referralEvents = await client.getLogs({
      address: CONTRACTS.referralRegistry,
      event: {
        type: "event",
        name: "ReferralRegistered",
        inputs: [
          { name: "referee", type: "address", indexed: true },
          { name: "referrer", type: "address", indexed: true },
          { name: "codeHash", type: "bytes32", indexed: true },
        ],
      },
      fromBlock: BigInt(CONTRACTS.startBlock),
      toBlock: "latest",
    });
    
    return {
      codes: codeEvents.length,
      referrals: referralEvents.length,
    };
  } catch (error) {
    logWarning(`Could not count on-chain events: ${error}`);
    return { codes: -1, referrals: -1 };
  }
}

/**
 * Count on-chain campaign events
 */
async function countOnchainCampaigns(): Promise<number> {
  try {
    const campaignCount = await client.readContract({
      address: CONTRACTS.campaignFactory,
      abi: CampaignFactoryAbi,
      functionName: "campaignCount",
    });
    return Number(campaignCount);
  } catch (error) {
    logWarning(`Could not read campaign count: ${error}`);
    return -1;
  }
}

/**
 * Main verification function
 */
export async function verifyReferrals(): Promise<VerificationSummary> {
  const summary = createSummary();
  
  logHeader("REFERRAL SYSTEM VERIFICATION");
  
  // 1. Get indexer data
  logInfo("Fetching indexer data...");
  const [codes, referrals, stats, campaigns, campaignStats] = await Promise.all([
    getIndexerReferralCodes(),
    getIndexerReferrals(),
    getIndexerReferralStats(),
    getIndexerCampaigns(),
    getIndexerCampaignStats(),
  ]);
  
  console.log(`   Found ${codes.length} referral codes in indexer`);
  console.log(`   Found ${referrals.length} referral relationships in indexer`);
  console.log(`   Found ${campaigns.length} campaigns in indexer`);
  
  // 2. Count on-chain events
  logInfo("Counting on-chain events...");
  const onchainCounts = await countOnchainEvents();
  const onchainCampaignCount = await countOnchainCampaigns();
  
  console.log(`   Found ${onchainCounts.codes} CodeRegistered events on-chain`);
  console.log(`   Found ${onchainCounts.referrals} ReferralRegistered events on-chain`);
  console.log(`   Found ${onchainCampaignCount} campaigns on-chain`);
  
  // 3. Verify event counts match
  logHeader("EVENT COUNT VERIFICATION");
  
  if (onchainCounts.codes >= 0) {
    const codesMatch = codes.length === onchainCounts.codes;
    if (codesMatch) {
      logSuccess(`Referral codes count: ${codes.length}`);
    } else {
      logError(`Referral codes MISMATCH: Indexer=${codes.length}, On-chain=${onchainCounts.codes}`);
    }
    recordResult(summary, codesMatch, "Referral codes count");
  }
  
  if (onchainCounts.referrals >= 0) {
    const referralsMatch = referrals.length === onchainCounts.referrals;
    if (referralsMatch) {
      logSuccess(`Referral relationships count: ${referrals.length}`);
    } else {
      logError(`Referral relationships MISMATCH: Indexer=${referrals.length}, On-chain=${onchainCounts.referrals}`);
    }
    recordResult(summary, referralsMatch, "Referral relationships count");
  }
  
  if (onchainCampaignCount >= 0) {
    const campaignsMatch = campaigns.length === onchainCampaignCount;
    if (campaignsMatch) {
      logSuccess(`Campaigns count: ${campaigns.length}`);
    } else {
      logError(`Campaigns MISMATCH: Indexer=${campaigns.length}, On-chain=${onchainCampaignCount}`);
    }
    recordResult(summary, campaignsMatch, "Campaigns count");
  }
  
  // 4. Verify stats consistency
  logHeader("STATS CONSISTENCY");
  
  if (stats) {
    const statsCodeMatch = stats.totalCodes === codes.length;
    if (statsCodeMatch) {
      logSuccess(`Stats totalCodes matches actual: ${stats.totalCodes}`);
    } else {
      logError(`Stats totalCodes MISMATCH: Stats=${stats.totalCodes}, Actual=${codes.length}`);
    }
    recordResult(summary, statsCodeMatch, "Stats totalCodes consistency");
    
    const statsReferralMatch = stats.totalReferrals === referrals.length;
    if (statsReferralMatch) {
      logSuccess(`Stats totalReferrals matches actual: ${stats.totalReferrals}`);
    } else {
      logError(`Stats totalReferrals MISMATCH: Stats=${stats.totalReferrals}, Actual=${referrals.length}`);
    }
    recordResult(summary, statsReferralMatch, "Stats totalReferrals consistency");
  }
  
  if (campaignStats) {
    const campaignStatsMatch = campaignStats.totalCampaigns === campaigns.length;
    if (campaignStatsMatch) {
      logSuccess(`Campaign stats totalCampaigns matches actual: ${campaignStats.totalCampaigns}`);
    } else {
      logError(`Campaign stats MISMATCH: Stats=${campaignStats.totalCampaigns}, Actual=${campaigns.length}`);
    }
    recordResult(summary, campaignStatsMatch, "Campaign stats totalCampaigns consistency");
  }
  
  // 5. Verify individual codes against on-chain
  if (codes.length > 0) {
    logHeader("REFERRAL CODE VERIFICATION");
    logInfo(`Verifying ${codes.length} referral codes...`);
    
    for (const code of codes) {
      await verifyReferralCode(code, summary);
    }
  }
  
  // 6. Verify individual referrals against on-chain
  if (referrals.length > 0) {
    logHeader("REFERRAL RELATIONSHIP VERIFICATION");
    logInfo(`Verifying ${referrals.length} referral relationships...`);
    
    for (const referral of referrals) {
      await verifyReferral(referral, summary);
    }
  }
  
  // Print summary
  printSummary(summary);
  
  return summary;
}

// Run if called directly
const isMain = process.argv[1]?.endsWith("verify-referrals.ts") || 
               process.argv[1]?.endsWith("verify-referrals.js");

if (isMain) {
  verifyReferrals()
    .then((summary) => {
      process.exit(summary.failed > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

