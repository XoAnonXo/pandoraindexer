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
    referralFactory: `0x${string}`; // ✅ ReferralFactory with signature-based system
    rewardToken: `0x${string}`; // ✅ Reward token for referral campaigns
    disputeResolverHome: `0x${string}`;
    launchpadFactory: `0x${string}`; // ✅ TokensFactory for Launchpad (BondingCurves are dynamic)
  };
  startBlock: number;
  enabled: boolean;
}

export const CHAINS: Record<number, ChainConfig> = {
  // Ethereum Mainnet
  1: {
    chainId: 1,
    name: "Ethereum",
    shortName: "ethereum",
    rpcUrl: process.env.PONDER_RPC_URL_1 ?? "https://eth.llamarpc.com",
    rpcUrls: [
      "https://eth.llamarpc.com",
      "https://ethereum-rpc.publicnode.com",
      "https://rpc.ankr.com/eth",
      "https://1rpc.io/eth",
    ],
    explorerUrl: "https://etherscan.io",
    contracts: {
      oracle: "0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442",
      marketFactory: "0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c",
      usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC (Ethereum Mainnet)
      referralFactory: "0x75527046cE73189a8a3a06d8bfdd09d4643c6A01",
      rewardToken: "0x25B7Ca1e238bAC63EAA62420BBb86d0afbEba9eB",
      disputeResolverHome: "0x2446DC1279Ed900c05CF2D137B07f383d98c0baD",
      launchpadFactory: "0x283d0c80Fd94D3d5281FA2904Dcc97Aa397dAfF0",
      // Note: bondingCurve is dynamic - created via TokensFactory:TokenCreated event
    },
    startBlock: 24_426_990, // Oracle deployed at block 24426997
    enabled: true,
  },

  // To add a new chain, copy the template below and fill in the values:
  // <chainId>: {
  //   chainId: <chainId>,
  //   name: "<Chain Name>",
  //   shortName: "<chain>",
  //   rpcUrl: process.env.PONDER_RPC_URL_<chainId> ?? "<default_rpc>",
  //   rpcUrls: ["<rpc1>", "<rpc2>"],
  //   explorerUrl: "<explorer_url>",
  //   contracts: {
  //     oracle: "0x...",
  //     marketFactory: "0x...",
  //     usdc: "0x...",
  //     referralFactory: "0x...",
  //     rewardToken: "0x...",
  //     disputeResolverHome: "0x...",
  //     launchpadFactory: "0x...",
  //   },
  //   startBlock: <deployment_block>,
  //   enabled: true,
  // },
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
