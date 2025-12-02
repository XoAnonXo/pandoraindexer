/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                     PONDER DATABASE SCHEMA                                 ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Defines all database tables for the Anymarket prediction markets indexer. ║
 * ║  All tables include chainId/chainName for multi-chain support.             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * TABLE OVERVIEW:
 * ───────────────
 * 
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ CORE ENTITY TABLES                                                      │
 * ├──────────────────┬──────────────────────────────────────────────────────┤
 * │ polls            │ Prediction questions from Oracle contract            │
 * │ markets          │ AMM and PariMutuel trading markets                   │
 * │ trades           │ Individual buy/sell/swap/bet transactions            │
 * │ users            │ Aggregated user statistics (per chain)               │
 * │ winnings         │ Winning redemption records after resolution          │
 * │ liquidityEvents  │ LP add/remove liquidity actions                      │
 * └──────────────────┴──────────────────────────────────────────────────────┘
 * 
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ANALYTICS TABLES                                                        │
 * ├──────────────────┬──────────────────────────────────────────────────────┤
 * │ platformStats    │ Global platform metrics (one record per chain)       │
 * │ dailyStats       │ Daily aggregated metrics (one record per day/chain)  │
 * │ hourlyStats      │ Hourly aggregated metrics (one record per hour/chain)│
 * └──────────────────┴──────────────────────────────────────────────────────┘
 * 
 * ID CONVENTIONS:
 * ───────────────
 * - polls, markets: Contract address (hex)
 * - trades, winnings, liquidityEvents: chainId-txHash-logIndex
 * - users: chainId-address
 * - platformStats: chainId (as string)
 * - dailyStats: chainId-dayTimestamp
 * - hourlyStats: chainId-hourTimestamp
 * 
 * DECIMAL CONVENTIONS:
 * ────────────────────
 * - All monetary values (USDC) use 6 decimals
 * - To display: divide by 1,000,000 (1e6)
 * - Example: 1000000n = $1.00
 * 
 * @version 3 - Added createdTxHash to markets table for live activity display (2024-12-02)
 * @version 4 - Added initialLiquidity to markets table for tracking initial deposits (2024-12-02)
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
    /** Initial liquidity deposited at market creation (6 decimals) */
    initialLiquidity: p.bigint(),
    /** AMM reserve YES tokens */
    reserveYes: p.bigint().optional(),
    /** AMM reserve NO tokens */
    reserveNo: p.bigint().optional(),
    /** Block when created */
    createdAtBlock: p.bigint(),
    /** Timestamp when created */
    createdAt: p.bigint(),
    /** Transaction hash of creation */
    createdTxHash: p.hex(),
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
   * 
   * ID FORMAT: chainId-userAddress (e.g., "146-0x1234...")
   * 
   * A user record is created on their first interaction with the platform.
   * All monetary values are in USDC (6 decimals).
   * 
   * PROFIT/LOSS CALCULATION:
   * ────────────────────────
   * realizedPnL = (totalWithdrawn + totalWinnings) - totalDeposited
   * 
   * This only tracks REALIZED profits:
   * - totalDeposited: Money put into markets (buys/bets)
   * - totalWithdrawn: Money taken out from sells (net of fees)
   * - totalWinnings: Claimed winnings after market resolution
   * 
   * Unrealized gains (held positions) are NOT tracked here.
   */
  users: p.createTable({
    // ─────────────────────────────────────────────────────────────────────────
    // IDENTITY FIELDS
    // ─────────────────────────────────────────────────────────────────────────
    /** Composite ID: chainId-userAddress (e.g., "146-0x1234...") */
    id: p.string(),
    /** Chain ID where this user record applies */
    chainId: p.int(),
    /** Human-readable chain name for UI display */
    chainName: p.string(),
    /** User's wallet address (lowercase, normalized) */
    address: p.hex(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // TRADING ACTIVITY
    // ─────────────────────────────────────────────────────────────────────────
    /** Total number of trades executed (buys, sells, swaps, bets) */
    totalTrades: p.int(),
    /** Total trading volume in USDC (6 decimals) - sum of all trade amounts */
    totalVolume: p.bigint(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // PROFIT/LOSS TRACKING
    // ─────────────────────────────────────────────────────────────────────────
    /** 
     * Total USDC deposited into markets via BuyTokens/PositionPurchased
     * Represents capital at risk (6 decimals)
     */
    totalDeposited: p.bigint(),
    /** 
     * Total USDC withdrawn via SellTokens (net of fees)
     * Represents realized exit from trading positions (6 decimals)
     */
    totalWithdrawn: p.bigint(),
    /** 
     * Total USDC won from resolved markets via WinningsRedeemed
     * Only updated after market resolution + 24h finalization (6 decimals)
     */
    totalWinnings: p.bigint(),
    /** 
     * Realized profit/loss formula:
     * realizedPnL = (totalWithdrawn + totalWinnings) - totalDeposited
     * 
     * Positive = net profit, Negative = net loss
     * Only tracks realized returns (money actually received)
     * Does NOT include unrealized gains from held positions
     */
    realizedPnL: p.bigint(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // WIN/LOSS TRACKING
    // ─────────────────────────────────────────────────────────────────────────
    /** Number of markets where user was on the winning side */
    totalWins: p.int(),
    /** Number of markets where user was on the losing side */
    totalLosses: p.int(),
    /** 
     * Current consecutive streak: 
     * Positive = consecutive wins, Negative = consecutive losses
     * Resets when streak breaks
     */
    currentStreak: p.int(),
    /** Highest winning streak ever achieved (always >= 0) */
    bestStreak: p.int(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // CREATOR STATS
    // ─────────────────────────────────────────────────────────────────────────
    /** Number of AMM/PariMutuel markets created by this user */
    marketsCreated: p.int(),
    /** Number of prediction polls created by this user */
    pollsCreated: p.int(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // TIMESTAMPS
    // ─────────────────────────────────────────────────────────────────────────
    /** Unix timestamp of user's first trade (null if never traded) */
    firstTradeAt: p.bigint().optional(),
    /** Unix timestamp of user's most recent trade (null if never traded) */
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
   * Global platform statistics aggregated per blockchain.
   * 
   * ID FORMAT: chainId as string (e.g., "146" for Sonic)
   * 
   * One record exists per supported chain. This provides dashboard-level
   * metrics for the entire platform on each chain.
   * 
   * VOLUME vs LIQUIDITY (TVL):
   * ──────────────────────────
   * - totalVolume: Sum of all trading activity (buys, sells, bets)
   * - totalLiquidity: Current USDC locked across all markets (TVL)
   * 
   * Volume is cumulative (always increases), while liquidity fluctuates
   * as users add/remove funds and redeem winnings.
   * 
   * CONSISTENCY RULE:
   * ─────────────────
   * totalVolume should equal the sum of all market.totalVolume values.
   * If they differ, there's a bug in the event handlers.
   */
  platformStats: p.createTable({
    // ─────────────────────────────────────────────────────────────────────────
    // IDENTITY
    // ─────────────────────────────────────────────────────────────────────────
    /** Chain ID as string (e.g., "146") - primary key */
    id: p.string(),
    /** Chain ID as number for filtering/joins */
    chainId: p.int(),
    /** Human-readable chain name for UI */
    chainName: p.string(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // POLL METRICS
    // ─────────────────────────────────────────────────────────────────────────
    /** Total prediction polls created via Oracle */
    totalPolls: p.int(),
    /** Total polls that have been resolved (status != 0) */
    totalPollsResolved: p.int(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // MARKET METRICS
    // ─────────────────────────────────────────────────────────────────────────
    /** Total markets created (AMM + PariMutuel) */
    totalMarkets: p.int(),
    /** AMM markets specifically */
    totalAmmMarkets: p.int(),
    /** PariMutuel markets specifically */
    totalPariMarkets: p.int(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // TRADING METRICS
    // ─────────────────────────────────────────────────────────────────────────
    /** Total trades executed across all markets */
    totalTrades: p.int(),
    /** Total unique users who have traded */
    totalUsers: p.int(),
    /** 
     * Total trading volume in USDC (6 decimals)
     * Includes: buys, sells, bets, seed liquidity
     */
    totalVolume: p.bigint(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // FINANCIAL METRICS
    // ─────────────────────────────────────────────────────────────────────────
    /** 
     * Current TVL: Total USDC locked across all markets (6 decimals)
     * This should approximate the sum of on-chain USDC balances
     */
    totalLiquidity: p.bigint(),
    /** Total protocol fees collected from trading (6 decimals) */
    totalFees: p.bigint(),
    /** Total USDC paid out to winners (6 decimals) */
    totalWinningsPaid: p.bigint(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // METADATA
    // ─────────────────────────────────────────────────────────────────────────
    /** Unix timestamp of last update to this record */
    lastUpdatedAt: p.bigint(),
    /** 
     * Schema version marker - increment to force full re-index
     * Not currently used but reserved for future migrations
     */
    resyncVersion: p.int().optional(),
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
