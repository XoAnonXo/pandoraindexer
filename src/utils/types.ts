export type PonderContext = any;

export interface ChainInfo {
  chainId: number;
  chainName: string;
}

export interface StatsUpdate {
  trades?: number;
  markets?: number;
  ammMarkets?: number;
  pariMarkets?: number;
  polls?: number;
  pollsResolved?: number;
  users?: number;
  activeUsers?: number;
  hourlyUniqueTraders?: number;

  volume?: bigint;
  tvlChange?: bigint;
  fees?: bigint;
  winningsPaid?: bigint;
  platformFees?: bigint;
}
