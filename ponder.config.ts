/**
 * Ponder Configuration
 * 
 * This file configures the Ponder indexer for Anymarket prediction markets.
 * It defines which contracts to index, on which network, and starting blocks.
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
// CONTRACT ADDRESSES (Sonic Mainnet - Chain ID: 146)
// =============================================================================

const CONTRACTS = {
  ORACLE: "0x9492a0c32Fb22d1b8940e44C4D69f82B6C3cb298",
  MARKET_FACTORY: "0x017277d36f80422a5d0aA5B8C93f5ae57BA2A317",
} as const;

/**
 * Start block for indexing
 * Set this to the block when contracts were deployed to avoid
 * unnecessary historical scanning
 */
const START_BLOCK = 56_000_000;

// =============================================================================
// CONFIGURATION
// =============================================================================

export default createConfig({
  // ---------------------------------------------------------------------------
  // Network Configuration
  // ---------------------------------------------------------------------------
  networks: {
    sonic: {
      chainId: 146,
      transport: http(process.env.PONDER_RPC_URL_146 ?? "https://rpc.soniclabs.com"),
      // Polling interval for new blocks (ms)
      pollingInterval: 2_000,
    },
  },

  // ---------------------------------------------------------------------------
  // Contract Definitions
  // ---------------------------------------------------------------------------
  contracts: {
    /**
     * PredictionOracle
     * Creates and manages prediction polls
     * Events: PollCreated, PollRefreshed
     */
    PredictionOracle: {
      network: "sonic",
      abi: PredictionOracleAbi,
      address: CONTRACTS.ORACLE,
      startBlock: START_BLOCK,
    },

    /**
     * PredictionPoll (Dynamic)
     * Individual poll contracts created by Oracle
     * Events: AnswerSet (resolution), ArbitrationStarted
     * Uses factory pattern - polls are created dynamically via PollCreated
     */
    PredictionPoll: {
      network: "sonic",
      abi: PredictionPollAbi,
      factory: {
        address: CONTRACTS.ORACLE,
        event: PredictionOracleAbi.find((e) => e.type === "event" && e.name === "PollCreated")!,
        parameter: "pollAddress",
      },
      startBlock: START_BLOCK,
    },

    /**
     * MarketFactory
     * Creates AMM and PariMutuel markets for polls
     * Events: MarketCreated, PariMutuelCreated
     */
    MarketFactory: {
      network: "sonic",
      abi: MarketFactoryAbi,
      address: CONTRACTS.MARKET_FACTORY,
      startBlock: START_BLOCK,
    },

    /**
     * PredictionAMM (Dynamic)
     * AMM-style prediction market contracts
     * Events: BuyTokens, SellTokens, SwapTokens, WinningsRedeemed, 
     *         LiquidityAdded, LiquidityRemoved, Sync
     */
    PredictionAMM: {
      network: "sonic",
      abi: PredictionAMMAbi,
      factory: {
        address: CONTRACTS.MARKET_FACTORY,
        event: MarketFactoryAbi.find((e) => e.type === "event" && e.name === "MarketCreated")!,
        parameter: "marketAddress",
      },
      startBlock: START_BLOCK,
    },

    /**
     * PredictionPariMutuel (Dynamic)
     * Pari-mutuel style betting markets
     * Events: SeedInitialLiquidity, PositionPurchased, WinningsRedeemed
     */
    PredictionPariMutuel: {
      network: "sonic",
      abi: PredictionPariMutuelAbi,
      factory: {
        address: CONTRACTS.MARKET_FACTORY,
        event: MarketFactoryAbi.find((e) => e.type === "event" && e.name === "PariMutuelCreated")!,
        parameter: "marketAddress",
      },
      startBlock: START_BLOCK,
    },
  },
});
