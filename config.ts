/**
 * Multi-Chain Configuration
 * 
 * This file defines all supported chains and their contract addresses.
 * To add a new chain:
 * 1. Add the chain config to CHAINS object
 * 2. Add network to ponder.config.ts
 * 3. Redeploy (will trigger resync for new chain)
 * 
 * @module config
 */

// =============================================================================
// TYPES
// =============================================================================

export interface ChainConfig {
  /** Chain ID (e.g., 146 for Sonic) */
  chainId: number;
  /** Human-readable chain name */
  name: string;
  /** Short name for display */
  shortName: string;
  /** RPC endpoint URL */
  rpcUrl: string;
  /** Block explorer URL */
  explorerUrl: string;
  /** Contract addresses */
  contracts: {
    oracle: `0x${string}`;
    marketFactory: `0x${string}`;
    usdc: `0x${string}`;
  };
  /** Block to start indexing from */
  startBlock: number;
  /** Whether this chain is currently active */
  enabled: boolean;
}

// =============================================================================
// CHAIN CONFIGURATIONS
// =============================================================================

export const CHAINS: Record<number, ChainConfig> = {
  // ---------------------------------------------------------------------------
  // Sonic Mainnet
  // ---------------------------------------------------------------------------
  146: {
    chainId: 146,
    name: "Sonic",
    shortName: "sonic",
    rpcUrl: process.env.PONDER_RPC_URL_146 ?? "https://rpc.soniclabs.com",
    explorerUrl: "https://sonicscan.org",
    contracts: {
      oracle: "0x9492a0c32Fb22d1b8940e44C4D69f82B6C3cb298",
      marketFactory: "0x017277d36f80422a5d0aA5B8C93f5ae57BA2A317",
      usdc: "0xc6020e5492c2892fD63489797ce3d431ae101d5e",
    },
    startBlock: 56_000_000,
    enabled: true,
  },

  // ---------------------------------------------------------------------------
  // Base Mainnet (Example - not deployed yet)
  // ---------------------------------------------------------------------------
  // 8453: {
  //   chainId: 8453,
  //   name: "Base",
  //   shortName: "base",
  //   rpcUrl: process.env.PONDER_RPC_URL_8453 ?? "https://mainnet.base.org",
  //   explorerUrl: "https://basescan.org",
  //   contracts: {
  //     oracle: "0x...",
  //     marketFactory: "0x...",
  //     usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
  //   },
  //   startBlock: 0,
  //   enabled: false,
  // },

  // ---------------------------------------------------------------------------
  // Arbitrum One (Example - not deployed yet)
  // ---------------------------------------------------------------------------
  // 42161: {
  //   chainId: 42161,
  //   name: "Arbitrum One",
  //   shortName: "arbitrum",
  //   rpcUrl: process.env.PONDER_RPC_URL_42161 ?? "https://arb1.arbitrum.io/rpc",
  //   explorerUrl: "https://arbiscan.io",
  //   contracts: {
  //     oracle: "0x...",
  //     marketFactory: "0x...",
  //     usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum USDC
  //   },
  //   startBlock: 0,
  //   enabled: false,
  // },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get all enabled chains
 */
export function getEnabledChains(): ChainConfig[] {
  return Object.values(CHAINS).filter((chain) => chain.enabled);
}

/**
 * Get chain config by ID
 */
export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId];
}

/**
 * Get chain name by ID
 */
export function getChainName(chainId: number): string {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

/**
 * Check if chain is supported
 */
export function isChainSupported(chainId: number): boolean {
  return chainId in CHAINS && CHAINS[chainId].enabled;
}

