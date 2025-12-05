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
        event: PredictionOracleAbi.find((e) => e.type === "event" && e.name === "PollCreated")!,
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
        event: MarketFactoryAbi.find((e) => e.type === "event" && e.name === "MarketCreated")!,
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
        event: MarketFactoryAbi.find((e) => e.type === "event" && e.name === "PariMutuelCreated")!,
        parameter: "marketAddress",
      },
      startBlock: sonic.startBlock,
    },

    // =========================================================================
    // BASE CHAIN CONTRACTS (Example - uncomment when deploying)
    // =========================================================================
    
    // PredictionOracle_Base: {
    //   network: "base",
    //   abi: PredictionOracleAbi,
    //   address: CHAINS[8453].contracts.oracle,
    //   startBlock: CHAINS[8453].startBlock,
    // },
    // ... add other Base contracts
  },
});
