import { getChainName } from "../../config";
import type { PonderContext, ChainInfo } from "./types";

// Re-export ChainInfo for backward compatibility
export type { ChainInfo } from "./types";

/**
 * Extract chain information from Ponder event context.
 */
export function getChainInfo(context: PonderContext): ChainInfo {
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
 * Calculate the day boundary timestamp (midnight UTC) for a given timestamp.
 * Uses BigInt arithmetic to avoid precision loss with large timestamps.
 */
export function getDayTimestamp(timestamp: bigint): bigint {
  return timestamp - (timestamp % 86400n);
}

/**
 * Calculate the hour boundary timestamp for a given timestamp.
 * Uses BigInt arithmetic to avoid precision loss with large timestamps.
 */
export function getHourTimestamp(timestamp: bigint): bigint {
  return timestamp - (timestamp % 3600n);
}

/**
 * Calculate realized PnL for a user.
 * Formula: realizedPnL = totalWithdrawn + totalWinnings - totalDeposited
 * 
 * Positive = net profit, Negative = net loss
 * Only tracks realized returns (money actually received)
 */
export function calculateRealizedPnL(
  totalWithdrawn: bigint,
  totalWinnings: bigint,
  totalDeposited: bigint
): bigint {
  return totalWithdrawn + totalWinnings - totalDeposited;
}
