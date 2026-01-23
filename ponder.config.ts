/**
 * Ponder Configuration - Multi-Chain Support
 *
 * This file configures the Ponder indexer for Anymarket prediction markets.
 * Supports multiple EVM chains - add new chains in config.ts
 *
 * To add a new chain:
 * 1. Add chain config to config.ts
 * 2. Add network definition below
 * 3. Add contract definitions for that chain
 * 4. Set environment variable PONDER_RPC_URL_{chainId}
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

import { CHAINS } from "./config";

// Get Sonic config
const sonic = CHAINS[146];

// =============================================================================
// CONFIGURATION
// =============================================================================

export default createConfig({
  // ---------------------------------------------------------------------------
  // Networks
  // ---------------------------------------------------------------------------
  networks: {
    // Sonic Mainnet (Chain ID: 146)
    sonic: {
      chainId: 146,
      transport: http(sonic.rpcUrls[0]),
      pollingInterval: 2_000,
    },

    // Add more networks here when deploying to other chains:
    // base: {
    //   chainId: 8453,
    //   transport: http(process.env.PONDER_RPC_URL_8453 ?? "https://mainnet.base.org"),
    //   pollingInterval: 2_000,
    // },
  },

  // ---------------------------------------------------------------------------
  // Contracts
  // ---------------------------------------------------------------------------
  contracts: {
    // =========================================================================
    // SONIC CHAIN CONTRACTS
    // =========================================================================

    /**
     * PredictionOracle (Sonic)
     */
    PredictionOracle: {
      network: "sonic",
      abi: PredictionOracleAbi,
      address: sonic.contracts.oracle,
      startBlock: sonic.startBlock,
    },

    /**
     * PredictionPoll (Sonic) - Dynamic
     */
    PredictionPoll: {
      network: "sonic",
      abi: PredictionPollAbi,
      factory: {
        address: sonic.contracts.oracle,
        event: PredictionOracleAbi.find(
          (e) => e.type === "event" && e.name === "PollCreated"
        )!,
        parameter: "pollAddress",
      },
      startBlock: sonic.startBlock,
    },

    /**
     * MarketFactory (Sonic)
     */
    MarketFactory: {
      network: "sonic",
      abi: MarketFactoryAbi,
      address: sonic.contracts.marketFactory,
      startBlock: sonic.startBlock,
    },

    /**
     * PredictionAMM (Sonic) - Dynamic
     */
    PredictionAMM: {
      network: "sonic",
      abi: PredictionAMMAbi,
      factory: {
        address: sonic.contracts.marketFactory,
        event: MarketFactoryAbi.find(
          (e) => e.type === "event" && e.name === "MarketCreated"
        )!,
        parameter: "marketAddress",
      },
      startBlock: sonic.startBlock,
    },

    /**
     * PredictionPariMutuel (Sonic) - Dynamic
     */
    PredictionPariMutuel: {
      network: "sonic",
      abi: PredictionPariMutuelAbi,
      factory: {
        address: sonic.contracts.marketFactory,
        event: MarketFactoryAbi.find(
          (e) => e.type === "event" && e.name === "PariMutuelCreated"
        )!,
        parameter: "marketAddress",
      },
      startBlock: sonic.startBlock,
    },

    /**
     * ReferralFactory (Sonic) - Static contract
     * Manages referral campaigns and relationships with signature verification
     */
    ReferralFactory: {
      network: "sonic",
      abi: ReferralFactoryAbi,
      address: sonic.contracts.referralFactory,
      startBlock: sonic.startBlock,
    },

    /**
     * ReferralCampaign (Sonic) - Dynamic contracts
     * Handles reward distribution via operator signatures
     * Created by ReferralFactory via CampaignCreated event
     */
    ReferralCampaign: {
      network: "sonic",
      abi: ReferralCampaignAbi,
      factory: {
        address: sonic.contracts.referralFactory,
        event: ReferralFactoryAbi.find(
          (e) => e.type === "event" && e.name === "CampaignCreated"
        )!,
        parameter: "campaign",
      },
      startBlock: sonic.startBlock,
    },

    /**
     * DisputeResolverHome (Sonic) - Static contract
     * Manages disputes on home chain with ERC721 voting NFTs
     */
    DisputeResolverHome: {
      network: "sonic",
      abi: DisputeResolverHomeAbi,
      address: sonic.contracts.disputeResolverHome,
      startBlock: sonic.startBlock,
    },

    // =========================================================================
    // LAUNCHPAD CONTRACTS (Sonic)
    // =========================================================================

    /**
     * TokensFactory (Sonic) - Static contract
     * Creates launchpad tokens with bonding curves (pump.fun style)
     * Emits: TokenCreated, TokenGraduated, TokenUriSet, etc.
     */
    TokensFactory: {
      network: "sonic",
      abi: TokensFactoryAbi,
      address: sonic.contracts.launchpadFactory,
      startBlock: sonic.startBlock,
    },

    /**
     * BondingCurve (Sonic) - Dynamic contract via TokensFactory
     * Created for each new launchpad token via TokenCreated event
     * Handles buy/sell trades with constant product formula
     * Graduates to DEX at $50k market cap
     */
    BondingCurve: {
      network: "sonic",
      abi: BondingCurveAbi,
      factory: {
        address: sonic.contracts.launchpadFactory,
        event: TokensFactoryAbi.find(
          (e) => e.type === "event" && e.name === "TokenCreated"
        )!,
        parameter: "bondingCurve",
      },
      startBlock: sonic.startBlock,
    },
  },
});
