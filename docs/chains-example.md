# Multi-Chain Configuration Examples

This document contains template configurations for adding new chains to the indexer.

## Base Mainnet (Chain ID: 8453)

```typescript
{
  chainId: 8453,
  name: "Base",
  rpcUrls: [
    "https://mainnet.base.org",
  ],
  explorerUrl: "https://basescan.org",
  contracts: {
    oracle: "0x...",           // TODO: Deploy and add address
    marketFactory: "0x...",    // TODO: Deploy and add address
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Native USDC on Base
  },
  startBlock: 0,               // TODO: Set to deployment block
  enabled: false,
}
```

## Arbitrum One (Chain ID: 42161)

```typescript
{
  chainId: 42161,
  name: "Arbitrum One",
  rpcUrls: [
    "https://arb1.arbitrum.io/rpc",
  ],
  explorerUrl: "https://arbiscan.io",
  contracts: {
    oracle: "0x...",           // TODO: Deploy and add address
    marketFactory: "0x...",    // TODO: Deploy and add address
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Native USDC on Arbitrum
  },
  startBlock: 0,               // TODO: Set to deployment block
  enabled: false,
}
```





