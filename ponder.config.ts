/**
 * Ponder Configuration - Multi-Chain Support
 *
 * This file configures the Ponder indexer for Anymarket prediction markets.
 * Contract definitions are generated dynamically from config.ts.
 *
 * To add a new chain:
 * 1. Add chain config to config.ts (with contracts, startBlock, etc.)
 * 2. Set environment variable PONDER_RPC_URL_{chainId} for production
 * 3. That's it — networks and contracts are auto-generated below.
 *
 * @see https://ponder.sh/docs/getting-started/new-project
 */

import { createConfig } from "@ponder/core";
import { http } from "viem";

// =============================================================================
// CONTRACT ABIS
// =============================================================================

import { PredictionOracleAbi } from "./abis/PredictionOracle";
import { PredictionPollAbi } from "./abis/PredictionPoll";
import { MarketFactoryAbi } from "./abis/MarketFactory";
import { PredictionAMMAbi } from "./abis/PredictionAMM";
import { PredictionPariMutuelAbi } from "./abis/PredictionPariMutuel";
import { ReferralFactoryAbi } from "./abis/ReferralFactory";
import { ReferralCampaignAbi } from "./abis/ReferralCampaign";
import { DisputeResolverHomeAbi } from "./abis/DisputeResolverHome";
import { TokensFactoryAbi } from "./abis/TokensFactory";
import { BondingCurveAbi } from "./abis/BondingCurve";

// =============================================================================
// CHAIN CONFIGURATION
// =============================================================================

import { CHAINS, getEnabledChains } from "./config";

// Get all enabled chains
const enabledChains = getEnabledChains();

if (enabledChains.length === 0) {
  throw new Error("No enabled chains found in config.ts");
}

// Build Ponder networks dynamically from enabled chains
const networks: Record<string, { chainId: number; transport: ReturnType<typeof http>; pollingInterval: number }> = {};

for (const chain of enabledChains) {
  const networkName = chain.shortName ?? chain.name.toLowerCase();
  const rpcUrl = process.env[`PONDER_RPC_URL_${chain.chainId}`] ?? chain.rpcUrls[0];
  // Ethereum L1: 12s blocks → 6s polling; L2s and fast chains: 2s polling
  const pollingInterval = chain.chainId === 1 ? 6_000 : 2_000;

  networks[networkName] = {
    chainId: chain.chainId,
    transport: http(rpcUrl),
    pollingInterval,
  };
}

// =============================================================================
// HELPER: Build contract definitions for each enabled chain
// =============================================================================

// Ponder supports multi-network per contract: each contract entry can have a
// `network` object mapping network names to per-chain overrides (address,
// startBlock). When a second chain is enabled, these helpers automatically
// produce the right multi-network shape.

type NetworkOverrides = Record<string, { address: `0x${string}` | readonly `0x${string}`[]; startBlock: number }>;
type FactoryNetworkOverrides = Record<string, { factory: { address: `0x${string}`; event: any; parameter: string }; startBlock: number }>;

function staticContract(abi: any, getAddress: (c: typeof enabledChains[0]) => `0x${string}`) {
  const networkOverrides: NetworkOverrides = {};
  for (const chain of enabledChains) {
    const networkName = chain.shortName ?? chain.name.toLowerCase();
    networkOverrides[networkName] = {
      address: getAddress(chain),
      startBlock: chain.startBlock,
    };
  }
  return { abi, network: networkOverrides };
}

function factoryContract(
  abi: any,
  parentAbi: any,
  eventName: string,
  parameter: string,
  getFactoryAddress: (c: typeof enabledChains[0]) => `0x${string}`,
) {
  const networkOverrides: FactoryNetworkOverrides = {};
  for (const chain of enabledChains) {
    const networkName = chain.shortName ?? chain.name.toLowerCase();
    networkOverrides[networkName] = {
      factory: {
        address: getFactoryAddress(chain),
        event: parentAbi.find((e: any) => e.type === "event" && e.name === eventName)!,
        parameter,
      },
      startBlock: chain.startBlock,
    };
  }
  return { abi, network: networkOverrides };
}

// =============================================================================
// CONFIGURATION
// =============================================================================

export default createConfig({
  networks,

  contracts: {
    // =========================================================================
    // PREDICTION MARKET CONTRACTS
    // =========================================================================

    /** PredictionOracle — static, emits PollCreated */
    PredictionOracle: staticContract(PredictionOracleAbi, (c) => c.contracts.oracle),

    /** PredictionPoll — dynamic, created by PredictionOracle:PollCreated */
    PredictionPoll: factoryContract(
      PredictionPollAbi,
      PredictionOracleAbi,
      "PollCreated",
      "pollAddress",
      (c) => c.contracts.oracle,
    ),

    /** MarketFactory — static, emits MarketCreated & PariMutuelCreated */
    MarketFactory: staticContract(MarketFactoryAbi, (c) => c.contracts.marketFactory),

    /** PredictionAMM — dynamic, created by MarketFactory:MarketCreated */
    PredictionAMM: factoryContract(
      PredictionAMMAbi,
      MarketFactoryAbi,
      "MarketCreated",
      "marketAddress",
      (c) => c.contracts.marketFactory,
    ),

    /** PredictionPariMutuel — dynamic, created by MarketFactory:PariMutuelCreated */
    PredictionPariMutuel: factoryContract(
      PredictionPariMutuelAbi,
      MarketFactoryAbi,
      "PariMutuelCreated",
      "marketAddress",
      (c) => c.contracts.marketFactory,
    ),

    // =========================================================================
    // REFERRAL CONTRACTS
    // =========================================================================

    /** ReferralFactory — static, manages campaigns with signature verification */
    ReferralFactory: staticContract(ReferralFactoryAbi, (c) => c.contracts.referralFactory),

    /** ReferralCampaign — dynamic, created by ReferralFactory:CampaignCreated */
    ReferralCampaign: factoryContract(
      ReferralCampaignAbi,
      ReferralFactoryAbi,
      "CampaignCreated",
      "campaign",
      (c) => c.contracts.referralFactory,
    ),

    // =========================================================================
    // DISPUTE CONTRACTS
    // =========================================================================

    /** DisputeResolverHome — static, manages disputes with ERC721 voting NFTs */
    DisputeResolverHome: staticContract(DisputeResolverHomeAbi, (c) => c.contracts.disputeResolverHome),

    // =========================================================================
    // LAUNCHPAD CONTRACTS
    // =========================================================================

    /** TokensFactory — static, creates launchpad tokens with bonding curves */
    TokensFactory: staticContract(TokensFactoryAbi, (c) => c.contracts.launchpadFactory),

    /** BondingCurve — dynamic, created by TokensFactory:TokenCreated */
    BondingCurve: factoryContract(
      BondingCurveAbi,
      TokensFactoryAbi,
      "TokenCreated",
      "bondingCurve",
      (c) => c.contracts.launchpadFactory,
    ),
  },
});
