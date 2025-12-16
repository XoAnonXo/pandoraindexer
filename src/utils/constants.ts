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





