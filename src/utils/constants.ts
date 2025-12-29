/**
 * Minimum collateral amount to index a trade (in USDC with 6 decimals)
 * Trades below this threshold are skipped to filter out dust/spam transactions.
 * 1_000_000n = $1.00 USDC
 */
export const MIN_TRADE_AMOUNT = 1_000_000n;

/**
 * Minimum token amount for swaps to filter dust.
 * Low value (1000) chosen to be safe for both 6-decimal and 18-decimal tokens
 * while still filtering 1-wei spam.
 */
export const MIN_TOKEN_AMOUNT = 1000n;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

export const TradeSide = {
  YES: "yes",
  NO: "no",
  IMBALANCE: "imbalance",
} as const;

export type TradeSideValue = (typeof TradeSide)[keyof typeof TradeSide];

export const TradeType = {
  BUY: "buy",
  SELL: "sell",
  SWAP: "swap",
  BET: "bet",
  LIQUIDITY_IMBALANCE: "liquidity_imbalance",
} as const;

export type TradeTypeValue = (typeof TradeType)[keyof typeof TradeType];

export const MarketType = {
  AMM: "amm",
  PARI: "pari",
} as const;

export type MarketTypeValue = (typeof MarketType)[keyof typeof MarketType];

/**
 * Poll status codes, matching the contracts.
 * 0 = pending, 1 = yes, 2 = no, 3 = unknown/refund
 */
export const PollStatus = {
  PENDING: 0,
  YES: 1,
  NO: 2,
  UNKNOWN: 3,
} as const;

export type PollStatusValue = (typeof PollStatus)[keyof typeof PollStatus];





