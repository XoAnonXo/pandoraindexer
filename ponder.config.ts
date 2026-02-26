/**
 * Ponder Configuration - Anymarket Prediction Markets
 *
 * Compatible with Ponder ^0.6.0.
 * Uses simple `network: "<name>"` format per contract.
 *
 * To add a new chain:
 * 1. Add chain config to config.ts
 * 2. Add a network entry below
 * 3. Duplicate contract definitions with the new network name
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
// TODO: Uncomment when these contracts are deployed on Ethereum
// import { ReferralFactoryAbi } from "./abis/ReferralFactory";
// import { ReferralCampaignAbi } from "./abis/ReferralCampaign";
import { DisputeResolverRemoteAbi } from "./abis/DisputeResolverRemote"; // For Ethereum (remote chain)
// import { TokensFactoryAbi } from "./abis/TokensFactory";
// import { BondingCurveAbi } from "./abis/BondingCurve";

// =============================================================================
// CHAIN CONFIGURATION
// =============================================================================

import { CHAINS } from "./config";

const ethereum = CHAINS[1];
const rpcUrl = process.env.PONDER_RPC_URL_1 ?? ethereum.rpcUrls[0];

// =============================================================================
// CONFIGURATION
// =============================================================================

export default createConfig({
  // ---------------------------------------------------------------------------
  // Networks
  // ---------------------------------------------------------------------------
  networks: {
    ethereum: {
      chainId: 1,
      transport: http(rpcUrl),
      pollingInterval: 6_000, // Ethereum L1: ~12s blocks
      maxRequestsPerSecond: 300
    },

    // To add more networks:
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
    // PREDICTION MARKET CONTRACTS (Ethereum)
    // =========================================================================

    /**
     * PredictionOracle (Ethereum) — static, emits PollCreated
     */
    PredictionOracle: {
      network: "ethereum",
      abi: PredictionOracleAbi,
      address: ethereum.contracts.oracle,
      startBlock: ethereum.startBlock,
    },

    /**
     * PredictionPoll (Ethereum) — dynamic, created by PredictionOracle:PollCreated
     */
    PredictionPoll: {
      network: "ethereum",
      abi: PredictionPollAbi,
      factory: {
        address: ethereum.contracts.oracle,
        event: PredictionOracleAbi.find(
          (e) => e.type === "event" && e.name === "PollCreated"
        )!,
        parameter: "pollAddress",
      },
      startBlock: ethereum.startBlock,
    },

    /**
     * MarketFactory (Ethereum) — static, emits MarketCreated & PariMutuelCreated
     */
    MarketFactory: {
      network: "ethereum",
      abi: MarketFactoryAbi,
      address: ethereum.contracts.marketFactory,
      startBlock: ethereum.startBlock,
    },

    /**
     * PredictionAMM (Ethereum) — dynamic, created by MarketFactory:MarketCreated
     */
    PredictionAMM: {
      network: "ethereum",
      abi: PredictionAMMAbi,
      factory: {
        address: ethereum.contracts.marketFactory,
        event: MarketFactoryAbi.find(
          (e) => e.type === "event" && e.name === "MarketCreated"
        )!,
        parameter: "marketAddress",
      },
      startBlock: ethereum.startBlock,
    },

    /**
     * PredictionPariMutuel (Ethereum) — dynamic, created by MarketFactory:PariMutuelCreated
     */
    PredictionPariMutuel: {
      network: "ethereum",
      abi: PredictionPariMutuelAbi,
      factory: {
        address: ethereum.contracts.marketFactory,
        event: MarketFactoryAbi.find(
          (e) => e.type === "event" && e.name === "PariMutuelCreated"
        )!,
        parameter: "marketAddress",
      },
      startBlock: ethereum.startBlock,
    },

    // =========================================================================
    // TODO: REFERRAL CONTRACTS — uncomment when deployed on Ethereum
    // =========================================================================

    // ReferralFactory: {
    //   network: "ethereum",
    //   abi: ReferralFactoryAbi,
    //   address: ethereum.contracts.referralFactory,
    //   startBlock: ethereum.startBlock,
    // },

    // ReferralCampaign: {
    //   network: "ethereum",
    //   abi: ReferralCampaignAbi,
    //   factory: {
    //     address: ethereum.contracts.referralFactory,
    //     event: ReferralFactoryAbi.find(
    //       (e) => e.type === "event" && e.name === "CampaignCreated"
    //     )!,
    //     parameter: "campaign",
    //   },
    //   startBlock: ethereum.startBlock,
    // },

    // =========================================================================
    // DISPUTE CONTRACTS
    // Only registered when DISPUTE_RESOLVER_REMOTE_ADDRESS_1 is set (or prod default exists).
    // =========================================================================

    ...(ethereum.contracts.disputeResolverRemote
      ? {
          DisputeResolverRemote: {
            network: "ethereum" as const,
            abi: DisputeResolverRemoteAbi,
            address: ethereum.contracts.disputeResolverRemote,
            startBlock: ethereum.startBlock,
          },
        }
      : {}),

    // =========================================================================
    // TODO: LAUNCHPAD CONTRACTS — uncomment when deployed on Ethereum
    // =========================================================================

    // TokensFactory: {
    //   network: "ethereum",
    //   abi: TokensFactoryAbi,
    //   address: ethereum.contracts.launchpadFactory,
    //   startBlock: ethereum.startBlock,
    // },

    // BondingCurve: {
    //   network: "ethereum",
    //   abi: BondingCurveAbi,
    //   factory: {
    //     address: ethereum.contracts.launchpadFactory,
    //     event: TokensFactoryAbi.find(
    //       (e) => e.type === "event" && e.name === "TokenCreated"
    //     )!,
    //     parameter: "bondingCurve",
    //   },
    //   startBlock: ethereum.startBlock,
    // },
  },
});
