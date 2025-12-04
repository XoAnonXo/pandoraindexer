/**
 * Type definitions for the Anymarket indexer
 */

import type { Context } from "@/generated";

/**
 * Ponder context type for event handlers
 * Using the generated Context type ensures type safety for db operations and client calls
 */
export type PonderContext = Context;

/**
 * Chain information extracted from context
 */
export interface ChainInfo {
  chainId: number;
  chainName: string;
}

/**
 * Stats update payload for aggregate statistics
 */
export interface StatsUpdate {
  // Counters
  trades?: number;
  markets?: number;
  ammMarkets?: number;
  pariMarkets?: number;
  polls?: number;
  pollsResolved?: number;
  users?: number;
  activeUsers?: number;
  hourlyUniqueTraders?: number;
  
  // Financials (BigInt)
  volume?: bigint;
  tvlChange?: bigint;
  fees?: bigint;
  winningsPaid?: bigint;
}

/**
 * Trade event data common to AMM and PariMutuel handlers
 */
export interface TradeEventData {
  trader: `0x${string}`;
  marketAddress: `0x${string}`;
  pollAddress: `0x${string}`;
  tradeType: string;
  side: string;
  collateralAmount: bigint;
  tokenAmount: bigint;
  feeAmount: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
  timestamp: bigint;
}

/**
 * User stats update payload
 */
export interface UserStatsUpdate {
  totalTrades?: number;
  totalVolume?: bigint;
  totalDeposited?: bigint;
  totalWithdrawn?: bigint;
  totalWinnings?: bigint;
  realizedPnL?: bigint;
  totalWins?: number;
  totalLosses?: number;
  currentStreak?: number;
  bestStreak?: number;
  marketsCreated?: number;
  pollsCreated?: number;
  firstTradeAt?: bigint;
  lastTradeAt?: bigint;
}

/**
 * Market stats update payload
 */
export interface MarketStatsUpdate {
  totalVolume?: bigint;
  totalTrades?: number;
  currentTvl?: bigint;
  uniqueTraders?: number;
  initialLiquidity?: bigint;
  reserveYes?: bigint;
  reserveNo?: bigint;
}

