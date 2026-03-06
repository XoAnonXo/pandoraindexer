export const TradeType = {
	BUY: "buy",
	SELL: "sell",
	SWAP: "swap",
	BET: "bet",
	SEED: "seed",
	LIQUIDITY_IMBALANCE: "liquidity_imbalance",
} as const;

export type TradeTypeValue = (typeof TradeType)[keyof typeof TradeType];

export const TradeSide = {
	YES: "yes",
	NO: "no",
} as const;

export type TradeSideValue = (typeof TradeSide)[keyof typeof TradeSide];

export const MarketType = {
	AMM: "amm",
	PARI: "pari",
} as const;

export type MarketTypeValue = (typeof MarketType)[keyof typeof MarketType];

/** Matches contract: 0=Pending, 1=Yes, 2=No, 3=Unknown */
export const PollStatus = {
	PENDING: 0,
	YES: 1,
	NO: 2,
	UNKNOWN: 3,
} as const;

export type PollStatusValue = (typeof PollStatus)[keyof typeof PollStatus];

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

/** 1e9 scale for yesChance / price values */
export const PRICE_SCALE = 1_000_000_000n;
