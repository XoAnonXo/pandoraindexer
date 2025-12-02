/**
 * PredictionAMM ABI
 * 
 * Automated Market Maker for prediction markets.
 * Allows buying/selling/swapping YES and NO outcome tokens.
 * Uses constant product formula with fee collection.
 * 
 * Key Events:
 * - BuyTokens: When a trader buys YES or NO tokens
 * - SellTokens: When a trader sells YES or NO tokens
 * - SwapTokens: When a trader swaps between YES and NO
 * - WinningsRedeemed: When a winner claims their payout
 * - LiquidityAdded: When LP adds liquidity (first add has IMBALANCE VOLUME!)
 * - LiquidityRemoved: When LP removes liquidity
 * - Sync: Reserve updates (for price tracking)
 */

export const PredictionAMMAbi = [
  // Trading Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "trader", type: "address" },
      { indexed: true, name: "isYes", type: "bool" },
      { indexed: false, name: "tokenAmount", type: "uint256" },
      { indexed: false, name: "collateralAmount", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "BuyTokens",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "trader", type: "address" },
      { indexed: true, name: "isYes", type: "bool" },
      { indexed: false, name: "tokenAmount", type: "uint256" },
      { indexed: false, name: "collateralAmount", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "SellTokens",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "trader", type: "address" },
      { indexed: true, name: "yesToNo", type: "bool" },
      { indexed: false, name: "amountIn", type: "uint256" },
      { indexed: false, name: "amountOut", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "SwapTokens",
    type: "event",
  },

  // Resolution Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "yesAmount", type: "uint256" },
      { indexed: false, name: "noAmount", type: "uint256" },
      { indexed: false, name: "collateralAmount", type: "uint256" },
    ],
    name: "WinningsRedeemed",
    type: "event",
  },

  // Liquidity Events - IMPORTANT: First add has imbalance volume!
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "provider", type: "address" },
      { indexed: false, name: "collateralAmount", type: "uint256" },
      { indexed: false, name: "lpTokens", type: "uint256" },
      {
        components: [
          { name: "yesToAdd", type: "uint256" },
          { name: "noToAdd", type: "uint256" },
          { name: "yesToReturn", type: "uint256" },
          { name: "noToReturn", type: "uint256" },
        ],
        indexed: false,
        name: "amounts",
        type: "tuple",
      },
    ],
    name: "LiquidityAdded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "provider", type: "address" },
      { indexed: false, name: "lpTokens", type: "uint256" },
      { indexed: false, name: "yesAmount", type: "uint256" },
      { indexed: false, name: "noAmount", type: "uint256" },
      { indexed: false, name: "collateralToReturn", type: "uint256" },
    ],
    name: "LiquidityRemoved",
    type: "event",
  },

  // Sync Event - Reserve updates for price tracking
  {
    anonymous: false,
    inputs: [
      { indexed: false, name: "rYes", type: "uint112" },
      { indexed: false, name: "rNo", type: "uint112" },
    ],
    name: "Sync",
    type: "event",
  },

  // Protocol Fees
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "caller", type: "address" },
      { indexed: false, name: "platformShare", type: "uint256" },
      { indexed: false, name: "creatorShare", type: "uint256" },
    ],
    name: "ProtocolFeesWithdrawn",
    type: "event",
  },

  // View functions (needed for factory pattern to get pollAddress)
  {
    inputs: [],
    name: "pollAddress",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
