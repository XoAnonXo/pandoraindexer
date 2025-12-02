/**
 * Ponder Schema - Multi-Chain Support
 * 
 * Defines the database tables for the Anymarket indexer.
 * All tables include chainId for multi-chain support.
 * 
 * Table Overview:
 * - polls: Prediction polls from the Oracle contract
 * - markets: AMM and PariMutuel markets
 * - trades: All trading activity (buys, sells, swaps, bets)
 * - users: Aggregated user statistics (per chain)
 * - winnings: Winning redemption records
 * - liquidityEvents: LP add/remove events
 * - platformStats: Platform metrics (per chain, ID = chainId)
 * - dailyStats: Daily aggregated statistics (per chain)
 * - hourlyStats: Hourly aggregated statistics (per chain)
 * 
 * @see https://ponder.sh/docs/schema
 */

import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  // ===========================================================================
  // POLLS TABLE
  // ===========================================================================
  /**
   * Prediction polls created via the Oracle contract
   * Each poll represents a yes/no question that can be resolved
   */
  polls: p.createTable({
    /** Poll contract address (primary key) */
    id: p.hex(),
    /** Chain ID where poll exists */
    chainId: p.int(),
    /** Chain name for display */
    chainName: p.string(),
    /** Creator's wallet address */
    creator: p.hex(),
    /** The prediction question */
    question: p.string(),
    /** Resolution rules */
    rules: p.string(),
    /** Source URLs (JSON array) */
    sources: p.string(),
    /** Deadline epoch for betting */
    deadlineEpoch: p.int(),
    /** Finalization epoch when poll can be resolved */
    finalizationEpoch: p.int(),
    /** Check epoch for operators */
    checkEpoch: p.int(),
    /** Poll category (0-11) */
    category: p.int(),
    /** Poll status: 0=Pending, 1=Yes, 2=No, 3=Unknown */
    status: p.int(),
    /** Resolution reason (if resolved) */
    resolutionReason: p.string().optional(),
    /** Timestamp when resolved (null if pending) */
    resolvedAt: p.bigint().optional(),
    /** Block number when created */
    createdAtBlock: p.bigint(),
    /** Timestamp when created */
    createdAt: p.bigint(),
    /** Transaction hash of creation */
    createdTxHash: p.hex(),
  }),

  // ===========================================================================
  // MARKETS TABLE
  // ===========================================================================
  /**
   * AMM and PariMutuel markets linked to polls
   */
  markets: p.createTable({
    /** Market contract address (primary key) */
    id: p.hex(),
    /** Chain ID where market exists */
    chainId: p.int(),
    /** Chain name for display */
    chainName: p.string(),
    /** Linked poll address */
    pollAddress: p.hex(),
    /** Market creator address */
    creator: p.hex(),
    /** Market type: 'amm' or 'pari' */
    marketType: p.string(),
    /** Collateral token address */
    collateralToken: p.hex(),
    /** YES token address (AMM only) */
    yesToken: p.hex().optional(),
    /** NO token address (AMM only) */
    noToken: p.hex().optional(),
    /** Trading fee tier (AMM only) */
    feeTier: p.int().optional(),
    /** Max price imbalance per hour (AMM only) */
    maxPriceImbalancePerHour: p.int().optional(),
    /** Curve flattener parameter (PariMutuel only) */
    curveFlattener: p.int().optional(),
    /** Curve offset parameter (PariMutuel only) */
    curveOffset: p.int().optional(),
    /** Total trading volume (6 decimals) */
    totalVolume: p.bigint(),
    /** Number of trades */
    totalTrades: p.int(),
    /** Current total value locked */
    currentTvl: p.bigint(),
    /** Number of unique traders */
    uniqueTraders: p.int(),
    /** AMM reserve YES tokens */
    reserveYes: p.bigint().optional(),
    /** AMM reserve NO tokens */
    reserveNo: p.bigint().optional(),
    /** Block when created */
    createdAtBlock: p.bigint(),
    /** Timestamp when created */
    createdAt: p.bigint(),
  }),

  // ===========================================================================
  // TRADES TABLE
  // ===========================================================================
  /**
   * Individual trade records
   * Includes AMM buys/sells/swaps and PariMutuel bets
   */
  trades: p.createTable({
    /** Unique ID: chainId-txHash-logIndex */
    id: p.string(),
    /** Chain ID where trade occurred */
    chainId: p.int(),
    /** Chain name for display */
    chainName: p.string(),
    /** Trader's wallet address */
    trader: p.hex(),
    /** Market address */
    marketAddress: p.hex(),
    /** Poll address */
    pollAddress: p.hex(),
    /** Trade type: 'buy', 'sell', 'swap', 'bet' */
    tradeType: p.string(),
    /** Side: 'yes' or 'no' */
    side: p.string(),
    /** Collateral amount (6 decimals) */
    collateralAmount: p.bigint(),
    /** Token amount (for AMM trades) */
    tokenAmount: p.bigint().optional(),
    /** Fee paid */
    feeAmount: p.bigint(),
    /** Transaction hash */
    txHash: p.hex(),
    /** Block number */
    blockNumber: p.bigint(),
    /** Timestamp */
    timestamp: p.bigint(),
  }),

  // ===========================================================================
  // USERS TABLE
  // ===========================================================================
  /**
   * Aggregated statistics per user per chain
   * ID format: chainId-userAddress
   */
  users: p.createTable({
    /** Composite ID: chainId-userAddress */
    id: p.string(),
    /** Chain ID */
    chainId: p.int(),
    /** Chain name for display */
    chainName: p.string(),
    /** User wallet address */
    address: p.hex(),
    /** Total number of trades */
    totalTrades: p.int(),
    /** Total trading volume (6 decimals) */
    totalVolume: p.bigint(),
    /** Total winnings collected (6 decimals) */
    totalWinnings: p.bigint(),
    /** Total deposited (6 decimals) */
    totalDeposited: p.bigint(),
    /** Number of winning positions */
    totalWins: p.int(),
    /** Number of losing positions */
    totalLosses: p.int(),
    /** Current win/loss streak (positive = wins, negative = losses) */
    currentStreak: p.int(),
    /** Best winning streak ever */
    bestStreak: p.int(),
    /** Number of markets created */
    marketsCreated: p.int(),
    /** Number of polls created */
    pollsCreated: p.int(),
    /** Timestamp of first trade */
    firstTradeAt: p.bigint().optional(),
    /** Timestamp of last trade */
    lastTradeAt: p.bigint().optional(),
  }),

  // ===========================================================================
  // WINNINGS TABLE
  // ===========================================================================
  /**
   * Individual winning redemption records
   */
  winnings: p.createTable({
    /** Unique ID: chainId-txHash-logIndex */
    id: p.string(),
    /** Chain ID */
    chainId: p.int(),
    /** Chain name for display */
    chainName: p.string(),
    /** User who redeemed */
    user: p.hex(),
    /** Market address */
    marketAddress: p.hex(),
    /** Collateral amount won (6 decimals) */
    collateralAmount: p.bigint(),
    /** Fee deducted */
    feeAmount: p.bigint(),
    /** Market question (denormalized for display) */
    marketQuestion: p.string().optional(),
    /** Market type: 'amm' or 'pari' */
    marketType: p.string(),
    /** Outcome: 1=Yes, 2=No, 3=Unknown */
    outcome: p.int().optional(),
    /** Transaction hash */
    txHash: p.hex(),
    /** Timestamp */
    timestamp: p.bigint(),
  }),

  // ===========================================================================
  // LIQUIDITY EVENTS TABLE
  // ===========================================================================
  /**
   * Liquidity add/remove events (AMM only)
   */
  liquidityEvents: p.createTable({
    /** Unique ID: chainId-txHash-logIndex */
    id: p.string(),
    /** Chain ID */
    chainId: p.int(),
    /** Chain name for display */
    chainName: p.string(),
    /** Liquidity provider address */
    provider: p.hex(),
    /** Market address */
    marketAddress: p.hex(),
    /** Event type: 'add' or 'remove' */
    eventType: p.string(),
    /** Collateral amount (6 decimals) */
    collateralAmount: p.bigint(),
    /** LP tokens minted/burned */
    lpTokens: p.bigint(),
    /** Transaction hash */
    txHash: p.hex(),
    /** Timestamp */
    timestamp: p.bigint(),
  }),

  // ===========================================================================
  // PLATFORM STATS TABLE (Per Chain)
  // ===========================================================================
  /**
   * Platform statistics per chain
   * ID is the chainId as string (e.g., "146" for Sonic)
   */
  platformStats: p.createTable({
    /** Chain ID as string (e.g., "146") */
    id: p.string(),
    /** Chain ID as number */
    chainId: p.int(),
    /** Chain name for display */
    chainName: p.string(),
    /** Total polls created */
    totalPolls: p.int(),
    /** Total polls resolved */
    totalPollsResolved: p.int(),
    /** Total markets created */
    totalMarkets: p.int(),
    /** Total trades executed */
    totalTrades: p.int(),
    /** Total unique users */
    totalUsers: p.int(),
    /** Total trading volume (6 decimals) */
    totalVolume: p.bigint(),
    /** Total liquidity currently locked (6 decimals) */
    totalLiquidity: p.bigint(),
    /** Total protocol fees collected (6 decimals) */
    totalFees: p.bigint(),
    /** Total winnings paid out (6 decimals) */
    totalWinningsPaid: p.bigint(),
    /** Total AMM markets */
    totalAmmMarkets: p.int(),
    /** Total PariMutuel markets */
    totalPariMarkets: p.int(),
    /** Last updated timestamp */
    lastUpdatedAt: p.bigint(),
  }),

  // ===========================================================================
  // DAILY STATS TABLE (Per Chain)
  // ===========================================================================
  /**
   * Daily aggregated statistics per chain
   * ID format: chainId-dayTimestamp
   */
  dailyStats: p.createTable({
    /** Composite ID: chainId-dayTimestamp */
    id: p.string(),
    /** Chain ID */
    chainId: p.int(),
    /** Chain name for display */
    chainName: p.string(),
    /** Day timestamp (midnight UTC) */
    dayTimestamp: p.bigint(),
    /** Polls created that day */
    pollsCreated: p.int(),
    /** Markets created that day */
    marketsCreated: p.int(),
    /** Trades executed that day */
    tradesCount: p.int(),
    /** Trading volume that day (6 decimals) */
    volume: p.bigint(),
    /** Winnings paid that day (6 decimals) */
    winningsPaid: p.bigint(),
    /** New users that day */
    newUsers: p.int(),
    /** Active users that day */
    activeUsers: p.int(),
  }),

  // ===========================================================================
  // HOURLY STATS TABLE (Per Chain)
  // ===========================================================================
  /**
   * Hourly aggregated statistics per chain
   * ID format: chainId-hourTimestamp
   */
  hourlyStats: p.createTable({
    /** Composite ID: chainId-hourTimestamp */
    id: p.string(),
    /** Chain ID */
    chainId: p.int(),
    /** Chain name for display */
    chainName: p.string(),
    /** Hour timestamp */
    hourTimestamp: p.bigint(),
    /** Trades executed that hour */
    tradesCount: p.int(),
    /** Trading volume that hour (6 decimals) */
    volume: p.bigint(),
    /** Unique traders that hour */
    uniqueTraders: p.int(),
  }),
}));
