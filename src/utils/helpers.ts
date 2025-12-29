import { getChainName } from "../../config";

export interface ChainInfo {
  chainId: number;
  chainName: string;
}

/**
 * Extract chain information from Ponder event context.
 */
export function getChainInfo(context: any): ChainInfo {
  const chainId = context.network.chainId;
  const chainName = getChainName(chainId);
  return { chainId, chainName };
}

/**
 * Generate a composite ID string for records that need chain-scoping.
 */
export function makeId(chainId: number, ...parts: (string | number | bigint)[]): string {
  return [chainId, ...parts].join("-");
}

/**
 * Realized PnL definition used across the indexer:
 * realizedPnL = totalWithdrawn + totalWinnings - totalDeposited
 */
export function calculateRealizedPnL(
  totalWithdrawn: bigint,
  totalWinnings: bigint,
  totalDeposited: bigint
): bigint {
  return totalWithdrawn + totalWinnings - totalDeposited;
}

/**
 * Calculate the day boundary timestamp (midnight UTC) for a given timestamp.
 */
export function getDayTimestamp(timestamp: bigint): bigint {
  const day = Number(timestamp) - (Number(timestamp) % 86400);
  return BigInt(day);
}

/**
 * Calculate the hour boundary timestamp for a given timestamp.
 */
export function getHourTimestamp(timestamp: bigint): bigint {
  const hour = Number(timestamp) - (Number(timestamp) % 3600);
  return BigInt(hour);
}

// ═══════════════════════════════════════════════════════════════════════════
// PARI-MUTUEL YESCHANCE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

const BPS_DENOMINATOR = 1_000_000n;
const ONE = 10n ** 18n;
const YESCHANCE_SCALE = 1_000_000_000n; // 1e9 scale for yesChance

/**
 * Calculate bigint power: base^exponent
 * Safe for large values unlike JavaScript Number
 */
function bigIntPow(base: bigint, exponent: number): bigint {
  let result = 1n;
  for (let i = 0; i < exponent; i++) {
    result *= base;
  }
  return result;
}

/**
 * Calculate time weight for pari-mutuel odds curve
 * Matches contract: PariMutuelStrategy._calcTimeWeight()
 *
 * Formula: wTime = offset + (BPS - offset) * (progress^k / BPS^(k-1)) / BPS
 * 
 * @param currentTs Current timestamp
 * @param startTs Market start timestamp
 * @param closeTs Market close timestamp
 * @param k Curve flattener [1-11]
 * @param offset Curve offset in BPS [0-BPS)
 * @returns Time weight in BPS scale
 */
function calculateTimeWeight(
  currentTs: bigint,
  startTs: bigint,
  closeTs: bigint,
  k: number,
  offset: bigint
): bigint {
  if (closeTs <= startTs) return BPS_DENOMINATOR;

  const elapsed = currentTs > startTs ? currentTs - startTs : 0n;
  const duration = closeTs - startTs;

  if (elapsed >= duration) return BPS_DENOMINATOR;

  // Progress [0, BPS]
  const progress = (elapsed * BPS_DENOMINATOR) / duration;

  // Power curve: progress^k / BPS^(k-1)
  // Using pure bigint arithmetic to match contract exactly
  let curveValue: bigint;
  if (k === 1) {
    curveValue = progress;
  } else {
    // progress^k / BPS^(k-1) - same as Solidity
    curveValue = bigIntPow(progress, k) / bigIntPow(BPS_DENOMINATOR, k - 1);
  }

  // Scale to [offset, BPS]
  return offset + ((BPS_DENOMINATOR - offset) * curveValue) / BPS_DENOMINATOR;
}

/**
 * Calculate shares for a bet based on time-weighted probability curve
 * 
 * @param isYes True if calculating for YES side
 * @param k Curve flattener [1-11]
 * @param offset Curve offset in BPS
 * @param amount Collateral amount
 * @param totalYes Total YES collateral in pool
 * @param totalNo Total NO collateral in pool
 * @param currentTs Current timestamp
 * @param startTs Market start timestamp
 * @param closeTs Market close timestamp
 * @returns Amount of shares
 */
function calculateShares(
  isYes: boolean,
  k: number,
  offset: bigint,
  amount: bigint,
  totalYes: bigint,
  totalNo: bigint,
  currentTs: bigint,
  startTs: bigint,
  closeTs: bigint
): bigint {
  if (amount === 0n) return 0n;

  const total = totalYes + totalNo;
  if (total === 0n) return amount; // No collateral yet, 1:1

  // 1. Calculate time weight [offset, BPS]
  const wTime = calculateTimeWeight(currentTs, startTs, closeTs, k, offset);

  // 2. Target multiplier at close: 2 * oppositeCollateral / total
  const oppositeCollateral = isYes ? totalNo : totalYes;
  const targetMult = (oppositeCollateral * 2n * BPS_DENOMINATOR) / total;

  // 3. Interpolate: mult = (BPS - wTime) + wTime * targetMult / BPS
  const multiplier =
    BPS_DENOMINATOR - wTime + (wTime * targetMult) / BPS_DENOMINATOR;

  // 4. Apply multiplier
  return (amount * multiplier) / BPS_DENOMINATOR;
}

/**
 * Calculate YES probability for PariMutuel market using time-weighted curve
 * 
 * This replicates the contract's _computeYesWinningChance() function:
 * - Calculates how many shares 1 unit would buy for YES and NO
 * - yesChance = noShares / (yesShares + noShares)
 * 
 * @param params Market parameters
 * @returns yesChance scaled to 1e9 (500_000_000 = 50%)
 */
export function calculatePariMutuelYesChance(params: {
  curveFlattener: number;
  curveOffset: number;
  totalCollateralYes: bigint;
  totalCollateralNo: bigint;
  currentTimestamp: bigint;
  marketStartTimestamp: bigint;
  marketCloseTimestamp: bigint;
}): bigint {
  const {
    curveFlattener,
    curveOffset,
    totalCollateralYes,
    totalCollateralNo,
    currentTimestamp,
    marketStartTimestamp,
    marketCloseTimestamp,
  } = params;

  const k = curveFlattener;
  const offset = BigInt(curveOffset);

  // Calculate shares for 1 unit on each side (using ONE = 1e18 for precision)
  const yesUnit = calculateShares(
    true,
    k,
    offset,
    ONE,
    totalCollateralYes,
    totalCollateralNo,
    currentTimestamp,
    marketStartTimestamp,
    marketCloseTimestamp
  );

  const noUnit = calculateShares(
    false,
    k,
    offset,
    ONE,
    totalCollateralYes,
    totalCollateralNo,
    currentTimestamp,
    marketStartTimestamp,
    marketCloseTimestamp
  );

  const denominator = yesUnit + noUnit;
  if (denominator === 0n) return 500_000_000n; // Default 50%

  // yesChance = noUnit / denominator * YESCHANCE_SCALE
  // Higher noUnit means YES is more valuable (higher probability)
  const yesChance = (noUnit * YESCHANCE_SCALE) / denominator;

  // Ensure minimum of 1 (same as contract)
  return yesChance > 0n ? yesChance : 1n;
}

