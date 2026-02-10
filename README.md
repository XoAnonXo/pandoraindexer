# Anymarket Indexer

A blockchain indexer for the Anymarket prediction markets platform, built with [Ponder](https://ponder.sh).

**Multi-Chain Support**: All tables include `chainId` and `chainName` for cross-chain data filtering.

## Quick Start

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your RPC URL

# Run in development mode
npm run dev
```

## Features

-   ✅ **Multi-Chain Ready** - Tables support multiple EVM chains
-   ✅ **Real-time Indexing** - Polls, markets, trades, users, winnings
-   ✅ **Referral System** - Track referral codes, campaigns, and rewards
-   ✅ **Dispute Resolution** - NFT-based voting on oracle decisions
-   ✅ **Launchpad System** - pump.fun style tokens with bonding curves
-   ✅ **Platform Statistics** - Per-chain and time-series analytics
-   ✅ **GraphQL API** - Auto-generated from schema
-   ✅ **Docker Support** - Easy deployment to Railway

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ANYMARKET INDEXER                        │
│                   (Multi-Chain Support)                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────┐      ┌─────────┐      ┌─────────┐            │
│   │  Sonic  │      │  Base   │      │ Arbitrum│   ...      │
│   │ (146)   │      │ (8453)  │      │ (42161) │            │
│   └────┬────┘      └────┬────┘      └────┬────┘            │
│        │                │                │                  │
│        └────────────────┼────────────────┘                  │
│                         ▼                                   │
│              ┌─────────────────┐                            │
│              │  Event Handlers │                            │
│              │   (src/index.ts)│                            │
│              └────────┬────────┘                            │
│                       ▼                                     │
│              ┌─────────────────┐                            │
│              │   PostgreSQL    │                            │
│              │   (Multi-Chain) │                            │
│              └────────┬────────┘                            │
│                       ▼                                     │
│              ┌─────────────────┐                            │
│              │   GraphQL API   │                            │
│              │  (port 42069)   │                            │
│              └─────────────────┘                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

### Core Tables (Per Chain)

| Table             | Description              | Key Fields                                   |
| ----------------- | ------------------------ | -------------------------------------------- |
| `polls`           | Prediction questions     | chainId, question, status, resolvedAt        |
| `markets`         | AMM & PariMutuel markets | chainId, marketType, totalVolume, currentTvl |
| `trades`          | All trading activity     | chainId, tradeType, side, collateralAmount   |
| `users`           | Per-chain user stats     | chainId, address, totalVolume, totalWinnings |
| `winnings`        | Winning redemptions      | chainId, collateralAmount, outcome           |
| `liquidityEvents` | LP add/remove            | chainId, eventType, collateralAmount         |

### Analytics Tables (Per Chain)

| Table           | Description       | Key Fields                                     |
| --------------- | ----------------- | ---------------------------------------------- |
| `platformStats` | Chain totals      | chainId, totalVolume, totalMarkets, totalUsers |
| `dailyStats`    | Daily aggregates  | chainId, dayTimestamp, volume, tradesCount     |
| `hourlyStats`   | Hourly aggregates | chainId, hourTimestamp, volume                 |

### Referral System Tables

| Table            | Description                    | Key Fields                               |
| ---------------- | ------------------------------ | ---------------------------------------- |
| `referralCodes`  | User referral codes            | code, owner, totalReferrals, totalVolume |
| `referrals`      | Referrer-referee relationships | referrer, referee, totalVolume           |
| `campaigns`      | Reward campaigns               | campaignId, rewardToken, totalRewards    |
| `campaignClaims` | Individual reward claims       | campaignId, user, totalClaimed           |

### Dispute Resolution Tables

| Table                 | Description         | Key Fields                                   |
| --------------------- | ------------------- | -------------------------------------------- |
| `disputes`            | Dispute tracking    | oracle, disputer, state, votesYes/No/Unknown |
| `disputeVotes`        | Individual votes    | oracle, voter, power, votedFor               |
| `disputeRewardClaims` | Voter reward claims | oracle, tokenId, rewardAmount                |

## Dispute Resolution System

### Overview

The Dispute Resolution System allows NFT holders to challenge oracle/poll decisions through voting.

**Architecture:**

-   **DisputeResolverHome** (Sonic) - Manages disputes on Sonic, wraps AnonStaking NFTs

**Current Deployment:**

-   Sonic: `0x2446DC1279Ed900c05CF2D137B07f383d98c0baD` (DisputeResolverHome)
-   AnonStaking: `0x5170F242c0246FD9427fB94c595d9b50fb48AA91`
-   Vault: `0xeb9404fF82e576F6b8623814AdCF10B61A5c7d44`

### Key Events

| Event               | Description                         |
| ------------------- | ----------------------------------- |
| `DisputeCreated`    | New dispute opened against oracle   |
| `Vote`              | NFT holder casts vote               |
| `DisputeResolved`   | Dispute finalized with outcome      |
| `DisputeFailed`     | Dispute failed (insufficient votes) |
| `VoteRewardClaimed` | Voter claims rewards                |
| `CollateralTaken`   | Disputer's collateral seized        |

### GraphQL Examples

**Get Active Disputes:**

```graphql
{
	disputes(where: { state: 1 }) {
		oracle
		disputer
		draftStatus
		votesYes
		votesNo
		endAt
	}
}
```

**Get My Votes:**

```graphql
{
	disputeVotes(where: { voter: "0xYOUR_ADDRESS" }) {
		oracle
		votedFor
		power
		votedAt
	}
}
```

**Get My Rewards:**

```graphql
{
	disputeRewardClaims(where: { claimer: "0xYOUR_ADDRESS" }) {
		oracle
		rewardAmount
		claimedAt
	}
}
```

### Integration with Polls

Disputes automatically update the `polls` table:

-   Sets `disputedBy`, `disputeStake`, `disputedAt`, `arbitrationStarted`
-   Updates `status` when resolved

## Launchpad System

### Overview

The Launchpad System (pump.fun fork) creates tokens with bonding curves that graduate to DEX at $50k market cap.

**Architecture:**

-   **TokensFactory** - Creates new launchpad tokens with bonding curves
-   **BondingCurve** - Individual trading contracts with constant product formula

**Current Deployment:**

-   TokensFactory: `0x283d0c80Fd94D3d5281FA2904Dcc97Aa397dAfF0`
-   Oracle: `0x98f9A771C012C24E638CC5663A30087B146310D7`
-   Spooky Router: `0xa6AD18C2aC47803E193F75c3677b14BF19B94883`

### Key Features

-   **1 billion token supply** per token
-   **Bonding curve pricing** with constant product formula
-   **0.3% swap fee** (50% to creator, 50% to factory)
-   **Automatic graduation** to DEX at $50k USD market cap
-   **Dynamic initial reserve** ($4k USD worth)

### Key Events

| Event                    | Contract      | Description                           |
| ------------------------ | ------------- | ------------------------------------- |
| `TokenCreated`           | TokensFactory | New launchpad token created           |
| `TokenGraduated`         | TokensFactory | Token reached $50k and graduated      |
| `TokenUriSet`            | TokensFactory | Token metadata URI updated            |
| `TokenImageUriSet`       | TokensFactory | Token image updated                   |
| `TokenDescriptionSet`    | TokensFactory | Token description updated             |
| `Buy`                    | BondingCurve  | Token purchase                        |
| `Sell`                   | BondingCurve  | Token sale                            |
| `Graduated`              | BondingCurve  | Internal - DEX pair created           |
| `GraduationFailed`       | BondingCurve  | Graduation attempt failed (slippage)  |

### Launchpad Tables

| Table             | Description              | Key Fields                                         |
| ----------------- | ------------------------ | -------------------------------------------------- |
| `launchpadTokens` | Created tokens           | creator, name, symbol, currentTvlNative, isGraduated |
| `launchpadTrades` | Buy/Sell trades          | bondingCurveAddress, trader, tradeType, nativeAmount |
| `tokenSystems`    | Token referral system    | system (pandora/localizer)                         |
| `graduatedCreators` | Graduated creators     | tokenAddress, bondingCurveAddress, status          |

### GraphQL Examples

**Get Launchpad Tokens:**

```graphql
{
  launchpadTokens(orderBy: "currentTvlNative", orderDirection: "desc") {
    id
    name
    symbol
    creator
    currentTvlNative
    isGraduated
    createdAt
    imageUri
  }
}
```

**Get Graduated Tokens:**

```graphql
{
  launchpadTokens(where: { isGraduated: true }) {
    id
    name
    symbol
    creator
    graduatedAt
  }
}
```

**Get Token Trades:**

```graphql
{
  launchpadTrades(where: { bondingCurveAddress: "0x..." }) {
    trader
    tradeType
    nativeAmount
    tokenAmount
    fee
    timestamp
  }
}
```

## Referral System

### Overview

The Referral System tracks referrer-referee relationships and distributes rewards via EIP-712 signatures.

**Architecture:**

-   **ReferralFactory** - Manages referral relationships on-chain with signature verification
-   **ReferralCampaign** - Individual campaign contracts for reward distribution

**Current Deployment:**

-   ReferralFactory: `0x75527046cE73189a8a3a06d8bfdd09d4643c6A01`
-   RewardToken: `0x25B7Ca1e238bAC63EAA62420BBb86d0afbEba9eB`
-   First Campaign: `0x203d3BCc55a497BDC7cf49e2a1F5BA142230A165`

### Key Features

**Signature-Based Registration:**

-   Referees must sign EIP-712 message to confirm referral relationship
-   Prevents spam and ensures consent

**Operator-Signed Rewards:**

-   Backend operator signs claim messages for earned rewards
-   Users claim rewards by submitting signature to campaign contract

**On-Chain Tracking:**

-   All referral relationships stored on-chain
-   Enables localizers to switch to their own indexer/operator

### Key Events

| Event                | Description                         |
| -------------------- | ----------------------------------- |
| `ReferralRegistered` | New referral relationship confirmed |
| `CampaignCreated`    | New reward campaign deployed        |

### GraphQL Examples

**Get My Referrals:**

```graphql
{
	referrals(where: { referrerAddress: "0xYOUR_ADDRESS" }) {
		refereeAddress
		status
		totalVolumeGenerated
		totalFeesGenerated
		totalRewardsEarned
		referredAt
	}
}
```

**Get Active Campaigns:**

```graphql
{
	campaigns(where: { status: 0 }) {
		id
		rewardAsset
		creator
		totalParticipants
		totalClaims
		createdAt
	}
}
```

## Adding a New Chain

### 1. Add Chain Config

Edit `config.ts`:

```typescript
export const CHAINS: Record<number, ChainConfig> = {
  // Existing chain...
	146: {
		/* Sonic */
	},

  // Add new chain
  8453: {
    chainId: 8453,
    name: "Base",
    shortName: "base",
    rpcUrl: process.env.PONDER_RPC_URL_8453 ?? "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    contracts: {
			oracle: "0x...", // Deploy and add address
			marketFactory: "0x...", // Deploy and add address
      usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
			referralFactory: "0x...", // Deploy ReferralFactory
			rewardToken: "0x...", // Reward token for campaigns
			disputeResolverHome: "0x...", // Sonic only
			launchpadFactory: "0x...", // Launchpad factory (optional)
			bondingCurve: "0x...", // Not used directly (dynamic)
    },
		startBlock: 12345678, // Block when contracts were deployed
    enabled: true,
  },
};
```

### 2. Update Ponder Config

Edit `ponder.config.ts`:

```typescript
// Add network
networks: {
  sonic: { ... },
  base: {
    chainId: 8453,
    transport: http(process.env.PONDER_RPC_URL_8453),
    pollingInterval: 2_000,
  },
},

// Add contracts
contracts: {
  // Sonic contracts...

  PredictionOracle_Base: {
    network: "base",
    abi: PredictionOracleAbi,
    address: CHAINS[8453].contracts.oracle,
    startBlock: CHAINS[8453].startBlock,
  },
  // ... add other Base contracts
},
```

### 3. Set Environment Variable

```bash
PONDER_RPC_URL_8453=https://your-base-rpc-url
```

### 4. Deploy

The indexer will start syncing the new chain from its startBlock.

## Volume Tracking

**CRITICAL**: These events generate volume:

| Event                        | Contract   | Counts As Volume           |
| ---------------------------- | ---------- | -------------------------- |
| `SeedInitialLiquidity`       | PariMutuel | `yesAmount + noAmount`     |
| `PositionPurchased`          | PariMutuel | `collateralIn`             |
| `BuyTokens`                  | AMM        | `collateralAmount`         |
| `SellTokens`                 | AMM        | `collateralAmount`         |
| `LiquidityAdded` (imbalance) | AMM        | `yesToReturn + noToReturn` |

## GraphQL Examples

### Get Platform Stats by Chain

```graphql
query {
  platformStatss(where: { chainId: 146 }) {
    items {
      chainName
      totalVolume
      totalMarkets
      totalUsers
    }
  }
}
```

### Get Markets Across All Chains

```graphql
query {
  marketss(orderBy: "totalVolume", orderDirection: "desc", limit: 10) {
    items {
      id
      chainId
      chainName
      marketType
      totalVolume
      totalTrades
    }
  }
}
```

### Get User Stats by Chain

```graphql
query {
  userss(where: { address: "0x123...", chainId: 146 }) {
    items {
      chainName
      totalTrades
      totalVolume
      totalWinnings
      bestStreak
    }
  }
}
```

### Get Daily Volume by Chain

```graphql
query {
  dailyStatss(
    where: { chainId: 146 }
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

## Environment Variables

| Variable              | Description    | Required        |
| --------------------- | -------------- | --------------- |
| `PONDER_RPC_URL_146`  | Sonic RPC URL  | Yes             |
| `PONDER_RPC_URL_8453` | Base RPC URL   | If Base enabled |
| `DATABASE_URL`        | PostgreSQL URL | Production      |

## Development

```bash
# Run development server
npm run dev

# Generate types from schema
npm run codegen

# Run in production mode
npm run start
```

## Deployment (Railway)

1. Create PostgreSQL database on Railway
2. Create new service from this repo
3. Set environment variables:
   ```
   DATABASE_URL=postgresql://...
   PONDER_RPC_URL_146=https://rpc.soniclabs.com
   ```
4. Deploy

## Files

```
ponder/
├── config.ts           # Chain configurations (addresses, RPC URLs)
├── ponder.config.ts    # Ponder setup (networks, contracts)
├── ponder.schema.ts    # Database tables
├── src/
│   └── index.ts        # Event handlers entry point
├── abis/               # Contract ABIs
│   ├── PredictionOracle.ts
│   ├── PredictionPoll.ts
│   ├── MarketFactory.ts
│   ├── PredictionAMM.ts
│   ├── PredictionPariMutuel.ts
│   ├── ReferralFactory.ts        # Referral system
│   ├── ReferralCampaign.ts       # Campaign rewards
│   ├── DisputeResolverHome.ts    # Dispute voting
│   ├── TokensFactory.ts          # Launchpad factory
│   └── BondingCurve.ts           # Launchpad trading
├── src/
│   └── handlers/       # Event handlers
│       ├── oracle.ts
│       ├── poll.ts
│       ├── factory.ts
│       ├── amm.ts
│       ├── parimutuel.ts
│       ├── referral.ts
│       ├── campaign.ts
│       ├── disputes.ts
│       └── launchpad.ts          # Launchpad events
├── Dockerfile
└── docker-compose.yml
```

## Troubleshooting

### Volume Not Tracking

Check that these events are being indexed:

-   `SeedInitialLiquidity` for PariMutuel initial volume
-   `LiquidityAdded` imbalance for AMM (non-50/50 liquidity)

See `docs/INDEXER_VOLUME_TRACKING.md` for details.

### Schema Changes

Schema changes require a full re-sync:

```bash
rm -rf .ponder
npm run dev
```

### Adding New Events

1. Add event to ABI file
2. Add handler in `src/index.ts`
3. Redeploy (triggers resync)

## License

MIT
