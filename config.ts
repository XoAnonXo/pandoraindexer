/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                     MULTI-CHAIN CONFIGURATION                              ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  This file defines all supported blockchain networks and their smart       ║
 * ║  contract addresses for the Anymarket prediction markets platform.         ║
 * ║                                                                            ║
 * ║  HOW TO ADD A NEW CHAIN:                                                   ║
 * ║  ────────────────────────                                                  ║
 * ║  1. Add chain configuration to the CHAINS object below                     ║
 * ║  2. Update ponder.config.ts with network and contract definitions          ║
 * ║  3. Set environment variable: PONDER_RPC_URL_{chainId}                     ║
 * ║  4. Deploy - indexer will sync from the specified startBlock               ║
 * ║                                                                            ║
 * ║  IMPORTANT: The startBlock should be the block BEFORE the first contract   ║
 * ║  deployment to ensure no events are missed during initial sync.            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * @module config
 * @author Anymarket Team
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Configuration interface for a single blockchain network.
 * 
 * Each supported chain must define:
 * - Network identifiers (chainId, name)
 * - Connection details (rpcUrl, explorerUrl)
 * - Core contract addresses (oracle, marketFactory, usdc)
 * - Indexing parameters (startBlock, enabled)
 */
export interface ChainConfig {
  /** 
   * EIP-155 Chain ID - unique identifier for the blockchain network
   * @example 146 for Sonic, 8453 for Base, 42161 for Arbitrum
   */
  chainId: number;
  
  /** 
   * Human-readable chain name for display in UI and logs
   * @example "Sonic", "Base", "Arbitrum One"
   */
  name: string;
  
  /** 
   * Short lowercase name used for internal references and GraphQL queries
   * @example "sonic", "base", "arbitrum"
   */
  shortName: string;
  
  /** 
   * RPC endpoint URL for blockchain data fetching
   * Can be overridden via PONDER_RPC_URL_{chainId} environment variable
   */
  rpcUrl: string;
  
  /** 
   * Block explorer base URL for transaction/address links
   * @example "https://sonicscan.org", "https://basescan.org"
   */
  explorerUrl: string;
  
  /** 
   * Core contract addresses deployed on this chain
   * All addresses must be checksummed hex strings (0x-prefixed)
   */
  contracts: {
    /** 
     * PredictionOracle contract - manages poll creation and resolution
     * Emits: PollCreated, PollRefreshed, OperatorAdded/Removed
     */
    oracle: `0x${string}`;
    
    /** 
     * MarketFactory contract - deploys AMM and PariMutuel markets
     * Emits: MarketCreated, PariMutuelCreated, CollateralWhitelisted
     */
    marketFactory: `0x${string}`;
    
    /** 
     * USDC token address - primary collateral for all markets
     * Used for TVL calculations and volume tracking
     */
    usdc: `0x${string}`;
  };
  
  /** 
   * Block number to start indexing from (inclusive)
   * Should be slightly BEFORE first contract deployment
   * Lower values = longer initial sync time
   */
  startBlock: number;
  
  /** 
   * Whether this chain is actively indexed
   * Set to false to temporarily disable without removing config
   */
  enabled: boolean;
}

// =============================================================================
// CHAIN CONFIGURATIONS
// =============================================================================
// 
// Add new chains here when deploying to additional networks.
// Each chain requires its own set of deployed contracts.
//
// DEPLOYMENT CHECKLIST FOR NEW CHAIN:
// ┌──────────────────────────────────────────────────────────────┐
// │ □ Deploy PredictionOracle contract                          │
// │ □ Deploy MarketFactory contract                             │
// │ □ Note the deployment block number for startBlock           │
// │ □ Add chain config below                                    │
// │ □ Update ponder.config.ts with network + contracts          │
// │ □ Set PONDER_RPC_URL_{chainId} environment variable         │
// │ □ Test with a single market before full production          │
// └──────────────────────────────────────────────────────────────┘
// =============================================================================

export const CHAINS: Record<number, ChainConfig> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // SONIC MAINNET (Chain ID: 146) - PRODUCTION
  // ═══════════════════════════════════════════════════════════════════════════
  // High-performance L1 blockchain with fast finality
  // Deployed: December 2024
  // ═══════════════════════════════════════════════════════════════════════════
  146: {
    chainId: 146,
    name: "Sonic",
    shortName: "sonic",
    // RPC can be overridden via environment variable for custom/premium endpoints
    rpcUrl: process.env.PONDER_RPC_URL_146 ?? "https://rpc.soniclabs.com",
    explorerUrl: "https://sonicscan.org",
    contracts: {
      // PredictionOracle: Creates and manages polls, emits PollCreated events
      oracle: "0x9492a0c32Fb22d1b8940e44C4D69f82B6C3cb298",
      // MarketFactory: Deploys AMM/PariMutuel markets for each poll
      marketFactory: "0x017277d36f80422a5d0aA5B8C93f5ae57BA2A317",
      // USDC: Circle's USD stablecoin on Sonic (6 decimals)
      usdc: "0xc6020e5492c2892fD63489797ce3d431ae101d5e",
    },
    // Start indexing from this block (before first contract deployment)
    startBlock: 56_000_000,
    enabled: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BASE MAINNET (Chain ID: 8453) - TEMPLATE (NOT DEPLOYED)
  // ═══════════════════════════════════════════════════════════════════════════
  // Uncomment and fill in addresses when deploying to Base
  // ═══════════════════════════════════════════════════════════════════════════
  // 8453: {
  //   chainId: 8453,
  //   name: "Base",
  //   shortName: "base",
  //   rpcUrl: process.env.PONDER_RPC_URL_8453 ?? "https://mainnet.base.org",
  //   explorerUrl: "https://basescan.org",
  //   contracts: {
  //     oracle: "0x...",           // TODO: Deploy and add address
  //     marketFactory: "0x...",    // TODO: Deploy and add address
  //     usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Native USDC on Base
  //   },
  //   startBlock: 0,               // TODO: Set to deployment block
  //   enabled: false,
  // },

  // ═══════════════════════════════════════════════════════════════════════════
  // ARBITRUM ONE (Chain ID: 42161) - TEMPLATE (NOT DEPLOYED)
  // ═══════════════════════════════════════════════════════════════════════════
  // Uncomment and fill in addresses when deploying to Arbitrum
  // ═══════════════════════════════════════════════════════════════════════════
  // 42161: {
  //   chainId: 42161,
  //   name: "Arbitrum One",
  //   shortName: "arbitrum",
  //   rpcUrl: process.env.PONDER_RPC_URL_42161 ?? "https://arb1.arbitrum.io/rpc",
  //   explorerUrl: "https://arbiscan.io",
  //   contracts: {
  //     oracle: "0x...",           // TODO: Deploy and add address
  //     marketFactory: "0x...",    // TODO: Deploy and add address
  //     usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Native USDC on Arbitrum
  //   },
  //   startBlock: 0,               // TODO: Set to deployment block
  //   enabled: false,
  // },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
// 
// Utility functions for working with chain configurations.
// Used throughout the indexer codebase for chain-specific operations.
// =============================================================================

/**
 * Get all chains that are currently enabled for indexing.
 * 
 * Use this to iterate over active chains when performing
 * cross-chain aggregations or validations.
 * 
 * @returns {ChainConfig[]} Array of enabled chain configurations
 * 
 * @example
 * // Get total volume across all chains
 * const chains = getEnabledChains();
 * let totalVolume = 0n;
 * for (const chain of chains) {
 *   totalVolume += await getChainVolume(chain.chainId);
 * }
 */
export function getEnabledChains(): ChainConfig[] {
  return Object.values(CHAINS).filter((chain) => chain.enabled);
}

/**
 * Retrieve the full configuration for a specific chain by its ID.
 * 
 * @param {number} chainId - The EIP-155 chain ID to look up
 * @returns {ChainConfig | undefined} Chain config if found, undefined otherwise
 * 
 * @example
 * const sonicConfig = getChainConfig(146);
 * if (sonicConfig) {
 *   console.log(`Oracle address: ${sonicConfig.contracts.oracle}`);
 * }
 */
export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId];
}

/**
 * Get the human-readable name for a chain ID.
 * 
 * Returns a fallback string "Chain {chainId}" if the chain
 * is not configured, useful for logging unknown chains.
 * 
 * @param {number} chainId - The EIP-155 chain ID
 * @returns {string} Chain name (e.g., "Sonic") or fallback
 * 
 * @example
 * console.log(getChainName(146));    // "Sonic"
 * console.log(getChainName(99999));  // "Chain 99999"
 */
export function getChainName(chainId: number): string {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

/**
 * Check if a chain is both configured AND enabled.
 * 
 * A chain must exist in CHAINS and have enabled=true to be supported.
 * Use this before processing events from a specific chain.
 * 
 * @param {number} chainId - The EIP-155 chain ID to check
 * @returns {boolean} True if chain is configured and enabled
 * 
 * @example
 * if (!isChainSupported(chainId)) {
 *   console.warn(`Unsupported chain: ${chainId}`);
 *   return;
 * }
 */
export function isChainSupported(chainId: number): boolean {
  return chainId in CHAINS && CHAINS[chainId].enabled;
}

