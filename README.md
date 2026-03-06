# Anymarket Indexer

Blockchain indexer for the [Anymarket / Pandora](https://thisispandora.ai) prediction markets platform, built with [Ponder](https://ponder.sh). Indexes on-chain events into PostgreSQL and exposes a GraphQL API.

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Database Schema](#database-schema)
- [GraphQL API](#graphql-api)
- [Cron Jobs](#cron-jobs)
- [Verification Scripts](#verification-scripts)
- [Adding a New Chain](#adding-a-new-chain)
- [Environment Variables](#environment-variables)
- [Docker](#docker)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 16 (with pgvector extension recommended)

### Setup

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env   # fill in PONDER_RPC_URL_1 and DATABASE_URL

# Generate Ponder types from schema
npm run codegen

# Development (with hot reload)
npm run dev
```

The indexer starts syncing from the configured `startBlock` and exposes a GraphQL API on `http://localhost:42069`.

## Architecture

```
pandoraindexer-1/
├── config.ts              # Chain definitions: addresses, RPC URLs, start blocks
├── ponder.config.ts       # Ponder networks + contract bindings
├── ponder.schema.ts       # Database table definitions
├── cron.ts                # Hourly volume24h recalculation + event sync
├── start.sh               # Entrypoint: starts Ponder + cron in parallel
├── abis/                  # Solidity event ABIs
│   ├── PredictionOracle.ts
│   ├── PredictionPoll.ts
│   ├── MarketFactory.ts
│   ├── PredictionAMM.ts
│   ├── PredictionPariMutuel.ts
│   ├── ReferralFactory.ts
│   ├── ReferralCampaign.ts
│   ├── CampaignFactory.ts
│   ├── DisputeResolverHome.ts
│   ├── DisputeResolverRemote.ts
│   ├── TokensFactory.ts
│   └── BondingCurve.ts
├── src/
│   ├── index.ts           # Handler registration (imports all active handlers)
│   ├── handlers/          # Event handlers (one file per contract domain)
│   │   ├── oracle.ts          # PredictionOracle events
│   │   ├── poll.ts            # PredictionPoll events
│   │   ├── factory.ts         # MarketFactory events
│   │   ├── amm-trades.ts      # AMM buy/sell/swap
│   │   ├── amm-liquidity.ts   # AMM add/remove liquidity
│   │   ├── amm-resolution.ts  # AMM market resolution
│   │   ├── amm-shared.ts      # Shared AMM helpers
│   │   ├── parimutuel.ts      # Pari-mutuel events
│   │   └── disputes.ts        # Dispute resolver events
│   ├── services/          # Reusable business logic
│   │   ├── candles.ts         # Price candle aggregation
│   │   ├── db.ts              # Direct PostgreSQL queries
│   │   ├── positions.ts       # User position tracking
│   │   ├── pollTvl.ts         # Poll-level TVL calculation
│   │   ├── protocolFees.ts    # Fee tracking and analytics
│   │   ├── referral.ts        # Referral volume attribution
│   │   └── stats.ts           # Platform/daily/hourly stats updates
│   └── utils/
│       ├── constants.ts       # Shared constants
│       ├── errors.ts          # Error handling helpers
│       ├── helpers.ts         # Common utility functions
│       └── types.ts           # Shared TypeScript types
├── disabled-handlers/     # Handlers ready but not yet active on current chain
│   ├── referral.ts
│   ├── campaign.ts
│   └── launchpad.ts
└── scripts/               # Maintenance and verification scripts
    ├── verify-all.ts          # Run all verifications
    ├── verify-volume.ts       # Cross-check volumes with on-chain data
    ├── verify-polls.ts        # Validate poll states
    ├── recalculate-volume24h.ts  # Sliding-window 24h volume update
    ├── sync-events.ts         # Sync event IDs for frontend feed
    └── ...                    # Additional verification/debug scripts
```

### Data Flow

```
Ethereum RPC  ──►  Ponder Engine  ──►  Event Handlers  ──►  PostgreSQL  ──►  GraphQL API
                       │                     │
                       │                     ├── services/stats.ts  (platform/daily/hourly)
                       │                     ├── services/positions.ts (user positions)
                       │                     └── services/candles.ts (price candles)
                       │
                  cron.ts (hourly)
                       ├── recalculate volume24h
                       └── sync event IDs
```

## Database Schema

All tables include `chainId` and `chainName` columns for multi-chain support.

### Core Tables

| Table | Description | ID Format |
|-------|-------------|-----------|
| `polls` | Prediction questions from Oracle | Contract address |
| `markets` | AMM and Pari-Mutuel trading markets | Contract address |
| `trades` | Buy / sell / swap / bet transactions | `chainId-txHash-logIndex` |
| `users` | Aggregated per-chain user statistics | `chainId-address` |
| `winnings` | Winning redemptions after resolution | `chainId-txHash-logIndex` |
| `liquidityEvents` | LP add / remove actions | `chainId-txHash-logIndex` |

### Analytics Tables

| Table | Description | ID Format |
|-------|-------------|-----------|
| `platformStats` | Global metrics (one row per chain) | `chainId` |
| `dailyStats` | Daily aggregates | `chainId-dayTimestamp` |
| `hourlyStats` | Hourly aggregates | `chainId-hourTimestamp` |

### Dispute Resolution Tables

| Table | Description |
|-------|-------------|
| `disputes` | Dispute state, vote counts, deadlines |
| `disputeVotes` | Individual NFT-holder votes |
| `disputeRewardClaims` | Voter reward claims |

### Referral Tables (ready, not yet active on Ethereum)

| Table | Description |
|-------|-------------|
| `referralCodes` | User referral codes and totals |
| `referrals` | Referrer ↔ referee relationships |
| `campaigns` | Reward campaign metadata |
| `campaignClaims` | Individual reward claim records |

### Launchpad Tables (ready, not yet active on Ethereum)

| Table | Description |
|-------|-------------|
| `launchpadTokens` | Bonding-curve tokens (pump.fun fork) |
| `launchpadTrades` | Buy/sell trades on bonding curves |
| `tokenSystems` | Token referral system assignments |
| `graduatedCreators` | Tokens that graduated to DEX |

### Decimal Conventions

All monetary values use **6 decimals** (USDC standard). Divide by `1,000,000` (1e6) for display.

## GraphQL API

Ponder auto-generates a GraphQL API from the schema at `http://localhost:42069` (or port `42069` in production).

### Example Queries

**Platform stats:**

```graphql
{
  platformStatss(where: { chainId: 1 }) {
    items {
      chainName
      totalVolume
      totalMarkets
      totalUsers
    }
  }
}
```

**Top markets by volume:**

```graphql
{
  marketss(orderBy: "totalVolume", orderDirection: "desc", limit: 10) {
    items {
      id
      chainId
      marketType
      totalVolume
      totalTrades
    }
  }
}
```

**User stats:**

```graphql
{
  userss(where: { address: "0x123...", chainId: 1 }) {
    items {
      totalTrades
      totalVolume
      totalWinnings
      bestStreak
    }
  }
}
```

**Daily volume (last 7 days):**

```graphql
{
  dailyStatss(
    where: { chainId: 1 }
    orderBy: "dayTimestamp"
    orderDirection: "desc"
    limit: 7
  ) {
    items {
      dayTimestamp
      volume
      tradesCount
      newUsers
    }
  }
}
```

**Active disputes:**

```graphql
{
  disputes(where: { state: 1 }) {
    oracle
    disputer
    votesYes
    votesNo
    endAt
  }
}
```

## Cron Jobs

The `cron.ts` process runs alongside Ponder (launched by `start.sh`):

| Job | Schedule | Description |
|-----|----------|-------------|
| `recalculate:volume24h` | Every hour at `:00` | Sliding-window 24h volume for all markets |
| `sync:events` | Once at startup (90 s delay) | Sync event IDs for the frontend activity feed |
| Initial `volume24h` | Once at startup (60 s delay) | Bootstrap 24h volumes after Ponder creates tables |

## Verification Scripts

Run `npm run verify` for a full check, or individual scripts:

| Script | Description |
|--------|-------------|
| `npm run verify` | Run all verifications |
| `npm run verify:volume` | Cross-check indexed volumes vs on-chain |
| `npm run verify:polls` | Validate poll states and counts |
| `npm run verify:markets` | Verify market data consistency |
| `npm run verify:stats` | Check platform stats accuracy |
| `npm run verify:pnl` | Validate P&L calculations |
| `npm run recalculate:volume24h` | Manually recalculate 24h volumes |
| `npm run sync:events` | Manually sync event IDs |

## Adding a New Chain

### 1. Add chain config in `config.ts`

```typescript
export const CHAINS: Record<number, ChainConfig> = {
  // Existing...
  1: { /* Ethereum */ },

  // New chain
  8453: {
    chainId: 8453,
    name: "Base",
    shortName: "base",
    rpcUrls: ["https://mainnet.base.org"],
    explorerUrl: "https://basescan.org",
    contracts: {
      oracle:        addr("ORACLE_ADDRESS_8453",        "0x..."),
      marketFactory: addr("MARKET_FACTORY_ADDRESS_8453", "0x..."),
      usdc:          addr("USDC_ADDRESS_8453",           "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    },
    startBlock: 12345678,
    enabled: true,
  },
};
```

### 2. Add network and contracts in `ponder.config.ts`

```typescript
networks: {
  ethereum: { ... },
  base: {
    chainId: 8453,
    transport: http(process.env.PONDER_RPC_URL_8453),
    pollingInterval: 2_000,
  },
},
contracts: {
  PredictionOracle_Base: {
    network: "base",
    abi: PredictionOracleAbi,
    address: CHAINS[8453].contracts.oracle,
    startBlock: CHAINS[8453].startBlock,
  },
  // ... repeat for other contracts
},
```

### 3. Set environment variable

```bash
PONDER_RPC_URL_8453=https://your-base-rpc-url
```

### 4. Deploy

The indexer will pick up the new chain and sync from `startBlock`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PONDER_RPC_URL_1` | Yes | Ethereum RPC endpoint |
| `PONDER_RPC_URL_<chainId>` | Per chain | RPC for additional chains |
| `DATABASE_URL` | Production | PostgreSQL connection string |
| `ORACLE_ADDRESS_1` | No | Override oracle contract (defaults hardcoded) |
| `MARKET_FACTORY_ADDRESS_1` | No | Override market factory contract |
| `USDC_ADDRESS_1` | No | Override collateral token |
| `START_BLOCK_1` | No | Override start block |

All contract addresses can be overridden via `<CONTRACT>_ADDRESS_<CHAIN_ID>` env vars. Hardcoded production defaults are used when env vars are absent.

## Docker

### docker-compose (local development)

```bash
docker-compose up -d          # Start PostgreSQL + indexer
docker-compose logs -f        # Stream logs
docker-compose down -v        # Stop and remove volumes
```

Services:
- **postgres** — `pgvector/pgvector:pg16` on port `5433`
- **indexer** — Ponder + cron on port `42069`

### Build standalone

```bash
docker build -t anymarket-indexer .
docker run -p 42069:42069 --env-file .env anymarket-indexer
```

The Dockerfile uses `node:20-alpine`, runs `npm run codegen` at build time, and starts via `start.sh` (Ponder + cron in parallel). Health check hits `http://localhost:42069/health` every 30 s.

A separate `Dockerfile.cron` exists for running cron-only tasks (e.g., `recalculate:volume24h`) as an isolated container.

## Deployment

### Railway (recommended)

1. Create a PostgreSQL database on Railway
2. Create a new service from this repository
3. Set environment variables:
   ```
   DATABASE_URL=postgresql://...
   PONDER_RPC_URL_1=https://eth.llamarpc.com
   ```
4. Deploy — Ponder auto-creates schema and begins syncing

## Volume Tracking

These on-chain events contribute to volume:

| Event | Contract | Volume calculation |
|-------|----------|-------------------|
| `SeedInitialLiquidity` | PariMutuel | `yesAmount + noAmount` |
| `PositionPurchased` | PariMutuel | `collateralIn` |
| `BuyTokens` | AMM | `collateralAmount` |
| `SellTokens` | AMM | `collateralAmount` |
| `LiquidityAdded` (imbalance) | AMM | `yesToReturn + noToReturn` |

Run `npm run verify:volume` to cross-check indexed volumes against on-chain data.

## Troubleshooting

### Schema changes require a full re-sync

```bash
rm -rf .ponder
npm run dev
```

### Volume not tracking

Verify that `SeedInitialLiquidity` (PariMutuel) and imbalanced `LiquidityAdded` (AMM) events are being indexed. Run `npm run verify:volume` for a detailed report.

### Adding new events

1. Add the event signature to the ABI file in `abis/`
2. Create or update the handler in `src/handlers/`
3. Register the handler import in `src/index.ts`
4. Redeploy (triggers a resync from `startBlock`)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Indexer framework | [Ponder](https://ponder.sh/) ^0.6 |
| Database | PostgreSQL 16 (pgvector) |
| API | GraphQL (auto-generated by Ponder) |
| Blockchain | [Viem](https://viem.sh/) ^2 |
| Cron | [node-cron](https://github.com/node-cron/node-cron) |
| Runtime | Node.js 20, TypeScript 5 |

## License

MIT
