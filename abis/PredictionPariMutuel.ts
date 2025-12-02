/**
 * PredictionPariMutuel ABI
 * 
 * Pari-mutuel betting market for predictions.
 * All bets are pooled and winners share the losing pool proportionally.
 * Uses dynamic odds based on betting activity.
 * 
 * Key Events:
 * - SeedInitialLiquidity: When initial liquidity is added (COUNTS AS VOLUME!)
 * - PositionPurchased: When a user places a bet
 * - WinningsRedeemed: When a winner claims their payout
 */

export const PredictionPariMutuelAbi = [
  // CRITICAL: Initial liquidity event - this is volume!
  {
    type: "event",
    name: "SeedInitialLiquidity",
    inputs: [
      { name: "yesAmount", type: "uint256", indexed: false },
      { name: "noAmount", type: "uint256", indexed: false },
    ],
  },

  // Betting Event
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

  // Resolution Event
  {
    type: "event",
    name: "WinningsRedeemed",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "collateralAmount", type: "uint256", indexed: false },
      { name: "outcome", type: "uint8", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },

  // Protocol Fees
  {
    type: "event",
    name: "ProtocolFeesWithdrawn",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },

  // View function for poll address (factory pattern)
  {
    type: "function",
    name: "pollAddress",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;
