# Pandora Indexer - Contract Reference

This document lists all smart contracts indexed by the Pandora indexer on Sonic chain.

## Contract Addresses (Sonic Mainnet - Chain ID: 146)

| Contract | Address | Description |
|----------|---------|-------------|
| **PredictionOracle** | `0xD595bd0ad4E9cCD3a0b5b59Be3e79E0284D7e28E` | Creates and manages prediction polls |
| **MarketFactory** | `0xb81b24B6AB3E59128b29DE67a979F89C6c193fE9` | Factory for creating AMM and PariMutuel markets |
| **ReferralRegistry** | `0xF3a3930B0FA5D0a53d1204Be1Deea638d939f04f` | Tracks referral codes and relationships |
| **CampaignFactory** | `0xcc83403203607Ba4DfbeC42d6Af0606363F80617` | Creates and manages reward campaigns |
| **ReferralRewards** | `0x9a3c55c9d3929B37C817F261e42DcE619aa7d605` | Distributes referral rewards |

---

## ReferralRegistry

**Address:** `0xF3a3930B0FA5D0a53d1204Be1Deea638d939f04f`

Tracks referral codes and referrer-referee relationships.

### Events

#### CodeRegistered
Emitted when a user registers a new referral code.

```solidity
event CodeRegistered(
    address indexed owner,      // User who registered the code
    bytes32 indexed codeHash    // Hash of the referral code
);
```

#### ReferralRegistered
Emitted when a new user registers under a referrer.

```solidity
event ReferralRegistered(
    address indexed referee,    // New user being referred
    address indexed referrer,   // User who referred them
    bytes32 indexed codeHash    // Hash of the referral code used
);
```

### View Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `getReferrer` | `address user` | `address` | Get the referrer for a user |
| `getUserCode` | `address user` | `bytes32` | Get the code hash registered by a user |
| `getCodeOwner` | `bytes32 codeHash` | `address` | Get the owner of a referral code |
| `hasReferrer` | `address user` | `bool` | Check if user has a referrer |

### ABI

```json
[
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "owner", "type": "address" },
      { "indexed": true, "internalType": "bytes32", "name": "codeHash", "type": "bytes32" }
    ],
    "name": "CodeRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "referee", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "referrer", "type": "address" },
      { "indexed": true, "internalType": "bytes32", "name": "codeHash", "type": "bytes32" }
    ],
    "name": "ReferralRegistered",
    "type": "event"
  },
  {
    "inputs": [{ "internalType": "bytes32", "name": "codeHash", "type": "bytes32" }],
    "name": "getCodeOwner",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "getReferrer",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "getUserCode",
    "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "hasReferrer",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "bytes32", "name": "codeHash", "type": "bytes32" }],
    "name": "registerCode",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "bytes32", "name": "referralCodeHash", "type": "bytes32" }],
    "name": "registerReferrer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
```

---

## CampaignFactory

**Address:** `0xcc83403203607Ba4DfbeC42d6Af0606363F80617`

Creates and manages reward campaigns for referrals.

### Events

#### CampaignCreated
Emitted when a new reward campaign is created.

```solidity
event CampaignCreated(
    uint256 indexed campaignId,     // Unique campaign ID
    address indexed creator,        // Campaign creator
    address indexed rewardAsset,    // Token used for rewards
    uint8 assetKind,                // Type of asset (ERC20, etc.)
    uint256 rewardPool,             // Total rewards available
    uint256 startTime,              // Campaign start timestamp
    uint256 endTime,                // Campaign end timestamp
    uint8 rewardType,               // Type of reward distribution
    bytes rewardConfig,             // Encoded reward configuration
    string name,                    // Campaign name
    string description              // Campaign description
);
```

#### CampaignStatusChanged
Emitted when a campaign's status changes.

```solidity
event CampaignStatusChanged(
    uint256 indexed campaignId,     // Campaign ID
    uint8 status                    // New status (0=Active, 1=Paused, 2=Ended)
);
```

### View Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `campaignCount` | - | `uint256` | Get total number of campaigns |
| `getCampaign` | `uint256 campaignId` | `Campaign` | Get campaign details |

### Campaign Struct

```solidity
struct Campaign {
    address creator;        // Campaign creator
    address updater;        // Can update campaign
    address rewardAsset;    // Reward token address
    uint8 assetKind;        // Asset type
    uint256 rewardPool;     // Total reward pool
    uint256 rewardsPaid;    // Rewards already distributed
    uint256 startTime;      // Start timestamp
    uint256 endTime;        // End timestamp
    uint8 rewardType;       // Distribution type
    bytes rewardConfig;     // Configuration data
    uint8 status;           // Current status
}
```

### ABI

```json
[
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "campaignId", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "creator", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "rewardAsset", "type": "address" },
      { "indexed": false, "internalType": "uint8", "name": "assetKind", "type": "uint8" },
      { "indexed": false, "internalType": "uint256", "name": "rewardPool", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "startTime", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "endTime", "type": "uint256" },
      { "indexed": false, "internalType": "uint8", "name": "rewardType", "type": "uint8" },
      { "indexed": false, "internalType": "bytes", "name": "rewardConfig", "type": "bytes" },
      { "indexed": false, "internalType": "string", "name": "name", "type": "string" },
      { "indexed": false, "internalType": "string", "name": "description", "type": "string" }
    ],
    "name": "CampaignCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "campaignId", "type": "uint256" },
      { "indexed": false, "internalType": "uint8", "name": "status", "type": "uint8" }
    ],
    "name": "CampaignStatusChanged",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "campaignCount",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "campaignId", "type": "uint256" }],
    "name": "getCampaign",
    "outputs": [{
      "components": [
        { "internalType": "address", "name": "creator", "type": "address" },
        { "internalType": "address", "name": "updater", "type": "address" },
        { "internalType": "address", "name": "rewardAsset", "type": "address" },
        { "internalType": "uint8", "name": "assetKind", "type": "uint8" },
        { "internalType": "uint256", "name": "rewardPool", "type": "uint256" },
        { "internalType": "uint256", "name": "rewardsPaid", "type": "uint256" },
        { "internalType": "uint256", "name": "startTime", "type": "uint256" },
        { "internalType": "uint256", "name": "endTime", "type": "uint256" },
        { "internalType": "uint8", "name": "rewardType", "type": "uint8" },
        { "internalType": "bytes", "name": "rewardConfig", "type": "bytes" },
        { "internalType": "uint8", "name": "status", "type": "uint8" }
      ],
      "internalType": "struct ICampaignFactory.Campaign",
      "name": "",
      "type": "tuple"
    }],
    "stateMutability": "view",
    "type": "function"
  }
]
```

---

## ReferralRewards

**Address:** `0x9a3c55c9d3929B37C817F261e42DcE619aa7d605`

Handles distribution of referral rewards. *(ABI not yet integrated)*

---

## Indexed Tables

### Core Tables
| Table | Description |
|-------|-------------|
| `polls` | Prediction questions from Oracle |
| `markets` | AMM and PariMutuel trading markets |
| `trades` | Individual buy/sell/swap/bet transactions |
| `users` | Aggregated user statistics |
| `winnings` | Winning redemption records |
| `liquidityEvents` | LP add/remove actions |

### Referral Tables
| Table | Description |
|-------|-------------|
| `referralCodes` | Registered referral codes |
| `referrals` | Referrer-referee relationships |
| `referralStats` | Global referral metrics |

### Campaign Tables
| Table | Description |
|-------|-------------|
| `campaigns` | Reward campaigns created via CampaignFactory |
| `campaignClaims` | Individual reward claims from campaigns |
| `campaignStats` | Global campaign metrics |

### Analytics Tables
| Table | Description |
|-------|-------------|
| `platformStats` | Global platform metrics |
| `dailyStats` | Daily aggregated metrics |
| `hourlyStats` | Hourly aggregated metrics |

---

## Example GraphQL Queries

### Get Active Campaigns
```graphql
{
  campaignss(where: { status: 0 }, orderBy: "startTime", orderDirection: "desc") {
    items {
      id
      name
      description
      creator
      rewardAsset
      rewardPool
      rewardsPaid
      startTime
      endTime
      status
      totalParticipants
    }
  }
}
```

### Get Referral Leaderboard
```graphql
{
  userss(orderBy: "totalReferralVolume", orderDirection: "desc", limit: 10) {
    items {
      address
      totalReferrals
      totalReferralVolume
      totalReferralRewards
    }
  }
}
```

### Get Referral Codes
```graphql
{
  referralCodess(orderBy: "totalVolumeGenerated", orderDirection: "desc", limit: 10) {
    items {
      code
      ownerAddress
      totalReferrals
      totalVolumeGenerated
      totalFeesGenerated
    }
  }
}
```

### Get Campaign Stats
```graphql
{
  campaignStatss(limit: 1) {
    items {
      totalCampaigns
      activeCampaigns
      totalRewardsDistributed
      totalParticipants
    }
  }
}
```

---

## Adding New Contracts

To add a new contract to the indexer:

1. **Create ABI file** in `abis/ContractName.ts`
2. **Export from** `abis/index.ts`
3. **Add to config** in `ponder.config.ts`
4. **Create handlers** in `src/handlers/`
5. **Update schema** in `ponder.schema.ts` if new tables needed

