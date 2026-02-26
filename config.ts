/**
 * Multi-Chain Configuration
 *
 * Defines supported networks and contract addresses.
 * See docs/chains-example.md for adding new chains.
 *
 * CONTRACT ADDRESSES are configurable via environment variables.
 * Production addresses are hardcoded as defaults so the code works
 * out of the box. For dev/staging, override via env vars:
 *
 *   ORACLE_ADDRESS_1=0x...        (chain 1 oracle)
 *   MARKET_FACTORY_ADDRESS_1=0x.. (chain 1 market factory)
 *   USDC_ADDRESS_1=0x...          (chain 1 collateral token)
 *   START_BLOCK_1=12345           (chain 1 start block)
 *   ... same pattern for optional contracts
 */

// =============================================================================
// HELPERS
// =============================================================================

type Hex = `0x${string}`;

/** Read an address from env, falling back to a hardcoded default. */
function addr(envKey: string, fallback: string): Hex {
  return (process.env[envKey] || fallback) as Hex;
}

/** Read an optional address from env or hardcoded default. */
function optAddr(envKey: string, fallback?: string): Hex | undefined {
  const v = process.env[envKey] || fallback;
  return v ? (v as Hex) : undefined;
}

// =============================================================================
// TYPES
// =============================================================================

export interface ChainConfig {
  chainId: number;
  name: string;
  shortName?: string;
  rpcUrl?: string;
  rpcUrls: string[];
  explorerUrl: string;
  contracts: {
    oracle: Hex;
    marketFactory: Hex;
    usdc: Hex;
    vault?: Hex;
    referralFactory?: Hex;
    rewardToken?: Hex;
    disputeResolverRemote?: Hex;
    disputeResolverHome?: Hex;
    referralCampaignFactory?: Hex;
    launchpadFactory?: Hex;
  };
  startBlock: number;
  enabled: boolean;
}

// =============================================================================
// CHAIN DEFINITIONS
// =============================================================================

export const CHAINS: Record<number, ChainConfig> = {
  // Ethereum Mainnet
  // Override any address with env: ORACLE_ADDRESS_1, MARKET_FACTORY_ADDRESS_1, etc.
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
      oracle:         addr("ORACLE_ADDRESS_1",          "0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442"),
      marketFactory:  addr("MARKET_FACTORY_ADDRESS_1",   "0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c"),
      usdc:           addr("USDC_ADDRESS_1",             "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
      vault:                    optAddr("VAULT_ADDRESS_1",                    "0x3E938c63f1D60f6652d2C03D921E77aA43F42703"),
      referralFactory:          optAddr("REFERRAL_FACTORY_ADDRESS_1",         "0x0dB357ed191A5191791f68A1eE45BD9F4Ef20196"),
      referralCampaignFactory:  optAddr("REFERRAL_CAMPAIGN_FACTORY_ADDRESS_1","0xf9a6CF1943fc9320bCdA0bB09055b37F464F0b2f"),
      rewardToken:              optAddr("REWARD_TOKEN_ADDRESS_1",             "0x25B7Ca1e238bAC63EAA62420BBb86d0afbEba9eB"),
      disputeResolverRemote:    optAddr("DISPUTE_RESOLVER_REMOTE_ADDRESS_1",  "0x0D7B957C47Da86c2968dc52111D633D42cb7a5F7"),
      launchpadFactory:         optAddr("LAUNCHPAD_FACTORY_ADDRESS_1",        "0x283d0c80Fd94D3d5281FA2904Dcc97Aa397dAfF0"),
    },
    startBlock: Number(process.env.START_BLOCK_1 || 24_426_990),
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
  //     vault: "0x...",
  //     referralFactory: "0x...",
  //     rewardToken: "0x...",
  //     disputeResolverRemote: "0x...", // For remote chains
  //     // disputeResolverHome: "0x...", // Only for home chain (Sonic)
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
