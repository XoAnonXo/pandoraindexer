/**
 * Contract ABIs and Addresses for On-Chain Verification
 * 
 * These are extended ABIs with view functions needed for verification
 */

// Contract Addresses (Sonic Chain)
export const CONTRACTS = {
  oracle: "0x9492a0c32Fb22d1b8940e44C4D69f82B6C3cb298" as const,
  marketFactory: "0x017277d36f80422a5d0aA5B8C93f5ae57BA2A317" as const,
  usdc: "0xc6020e5492c2892fD63489797ce3d431ae101d5e" as const,
  referralRegistry: "0xF3a3930B0FA5D0a53d1204Be1Deea638d939f04f" as const,
  campaignFactory: "0xcc83403203607Ba4DfbeC42d6Af0606363F80617" as const,
  referralRewards: "0x9a3c55c9d3929B37C817F261e42DcE619aa7d605" as const,
  startBlock: 5507800, // Block where contracts were deployed
};

// RPC URL
export const RPC_URL = process.env.PONDER_RPC_URL_146 ?? "https://rpc.soniclabs.com";

// USDC Decimals
export const USDC_DECIMALS = 6;

// PredictionPoll ABI (View Functions)
export const PredictionPollAbi = [
  {
    type: "function",
    name: "question",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "rules",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "sources",
    inputs: [],
    outputs: [{ name: "", type: "string[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "deadlineEpoch",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "finalizationEpoch",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "checkEpoch",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "category",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "status",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "resolutionReason",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "creator",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

// PredictionAMM ABI (View Functions)
export const PredictionAMMAbi = [
  {
    type: "function",
    name: "pollAddress",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "yesToken",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "noToken",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "collateral",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "feeTier",
    inputs: [],
    outputs: [{ name: "", type: "uint24" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maxPriceImbalancePerHour",
    inputs: [],
    outputs: [{ name: "", type: "uint24" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "reserveYes",
    inputs: [],
    outputs: [{ name: "", type: "uint112" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "reserveNo",
    inputs: [],
    outputs: [{ name: "", type: "uint112" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReserves",
    inputs: [],
    outputs: [
      { name: "rYes", type: "uint112" },
      { name: "rNo", type: "uint112" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "creator",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  // Events for volume verification
  {
    type: "event",
    name: "BuyTokens",
    inputs: [
      { name: "trader", type: "address", indexed: true },
      { name: "isYes", type: "bool", indexed: true },
      { name: "tokenAmount", type: "uint256", indexed: false },
      { name: "collateralAmount", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SellTokens",
    inputs: [
      { name: "trader", type: "address", indexed: true },
      { name: "isYes", type: "bool", indexed: true },
      { name: "tokenAmount", type: "uint256", indexed: false },
      { name: "collateralAmount", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LiquidityAdded",
    inputs: [
      { name: "provider", type: "address", indexed: true },
      { name: "collateralAmount", type: "uint256", indexed: false },
      { name: "lpTokens", type: "uint256", indexed: false },
      {
        name: "amounts",
        type: "tuple",
        indexed: false,
        components: [
          { name: "yesToAdd", type: "uint256" },
          { name: "noToAdd", type: "uint256" },
          { name: "yesToReturn", type: "uint256" },
          { name: "noToReturn", type: "uint256" },
        ],
      },
    ],
  },
] as const;

// PredictionPariMutuel ABI (View Functions)
export const PredictionPariMutuelAbi = [
  {
    type: "function",
    name: "pollAddress",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "collateral",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "yesPool",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "noPool",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "curveFlattener",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "curveOffset",
    inputs: [],
    outputs: [{ name: "", type: "uint24" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "creator",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalYesShares",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalNoShares",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // Events for volume verification
  {
    type: "event",
    name: "SeedInitialLiquidity",
    inputs: [
      { name: "yesAmount", type: "uint256", indexed: false },
      { name: "noAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PositionPurchased",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "isYes", type: "bool", indexed: true },
      { name: "collateralIn", type: "uint256", indexed: false },
      { name: "sharesOut", type: "uint256", indexed: false },
    ],
  },
] as const;

// PredictionOracle ABI (View Functions & Events)
export const PredictionOracleAbi = [
  {
    type: "event",
    name: "PollCreated",
    inputs: [
      { name: "pollAddress", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "deadlineEpoch", type: "uint32", indexed: false },
      { name: "question", type: "string", indexed: false },
    ],
  },
] as const;

// MarketFactory ABI (Events)
export const MarketFactoryAbi = [
  {
    type: "event",
    name: "MarketCreated",
    inputs: [
      { name: "pollAddress", type: "address", indexed: true },
      { name: "marketAddress", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "yesToken", type: "address", indexed: false },
      { name: "noToken", type: "address", indexed: false },
      { name: "collateral", type: "address", indexed: false },
      { name: "feeTier", type: "uint24", indexed: false },
      { name: "maxPriceImbalancePerHour", type: "uint24", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PariMutuelCreated",
    inputs: [
      { name: "pollAddress", type: "address", indexed: true },
      { name: "marketAddress", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "collateral", type: "address", indexed: false },
      { name: "curveFlattener", type: "uint8", indexed: false },
      { name: "curveOffset", type: "uint24", indexed: false },
    ],
  },
] as const;

// ERC20 ABI (for collateral balance checks)
export const ERC20Abi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
] as const;

// ReferralRegistry ABI (View Functions & Events)
export const ReferralRegistryAbi = [
  // Events
  {
    type: "event",
    name: "CodeRegistered",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "codeHash", type: "bytes32", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ReferralRegistered",
    inputs: [
      { name: "referee", type: "address", indexed: true },
      { name: "referrer", type: "address", indexed: true },
      { name: "codeHash", type: "bytes32", indexed: true },
    ],
  },
  // View functions
  {
    type: "function",
    name: "getReferrer",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getUserCode",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCodeOwner",
    inputs: [{ name: "codeHash", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasReferrer",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

// CampaignFactory ABI (View Functions & Events)
export const CampaignFactoryAbi = [
  // Events
  {
    type: "event",
    name: "CampaignCreated",
    inputs: [
      { name: "campaignId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "rewardAsset", type: "address", indexed: true },
      { name: "assetKind", type: "uint8", indexed: false },
      { name: "rewardPool", type: "uint256", indexed: false },
      { name: "startTime", type: "uint256", indexed: false },
      { name: "endTime", type: "uint256", indexed: false },
      { name: "rewardType", type: "uint8", indexed: false },
      { name: "rewardConfig", type: "bytes", indexed: false },
      { name: "name", type: "string", indexed: false },
      { name: "description", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CampaignStatusChanged",
    inputs: [
      { name: "campaignId", type: "uint256", indexed: true },
      { name: "status", type: "uint8", indexed: false },
    ],
  },
  // View functions
  {
    type: "function",
    name: "campaignCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCampaign",
    inputs: [{ name: "campaignId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "updater", type: "address" },
          { name: "rewardAsset", type: "address" },
          { name: "assetKind", type: "uint8" },
          { name: "rewardPool", type: "uint256" },
          { name: "rewardsPaid", type: "uint256" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "rewardType", type: "uint8" },
          { name: "rewardConfig", type: "bytes" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

