/**
 * Multi-Chain Configuration
 * 
 * Defines supported networks and contract addresses.
 * See docs/chains-example.md for adding new chains.
 */

export interface ChainConfig {
  chainId: number;
  name: string;
  shortName?: string; // Optional for internal refs
  rpcUrl?: string; // Legacy/Primary support
  rpcUrls: string[];
  explorerUrl: string;
  contracts: {
    oracle: `0x${string}`;
    marketFactory: `0x${string}`;
    usdc: `0x${string}`;
  };
  startBlock: number;
  enabled: boolean;
}

export const CHAINS: Record<number, ChainConfig> = {
  // Sonic Mainnet
  146: {
    chainId: 146,
    name: "Sonic",
    shortName: "sonic",
    rpcUrl: "https://rpc.soniclabs.com",
    rpcUrls: [
      // Ordered by reliability score (green first)
      "https://rpc.soniclabs.com",           // 0.146s - Official, green score
      "https://sonic.api.pocket.network",    // 0.154s - green score
      "https://sonic-rpc.publicnode.com",    // 0.383s - green score (slower but stable)
      "https://sonic.drpc.org",              // 0.155s - yellow score (rate limits)
    ],
    explorerUrl: "https://sonicscan.org",
    contracts: {
      oracle: "0x495B372311e3f9647685de3cbc90194915F3BdFE",
      marketFactory: "0x38Df1d849904b58103D39407e0F526A89235f534",
      usdc: "0xc6020e5492c2892fD63489797ce3d431ae101d5e",
    },
    startBlock: 18_190_000,
    enabled: true,
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function getChainName(chainId: number): string {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

export function getEnabledChains(): ChainConfig[] {
  return Object.values(CHAINS).filter((chain) => chain.enabled);
}

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId];
}

export function isChainSupported(chainId: number): boolean {
  return chainId in CHAINS && CHAINS[chainId].enabled;
}
