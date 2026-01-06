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
 * @version 5 - Added pollAddress to liquidityEvents for easier frontend querying (2024-12-02)
 * @version 4 - Added initialLiquidity to markets table for tracking initial deposits (2024-12-02)
 * @see https://ponder.sh/docs/schema
 */

import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  // ===========================================================================
  // ORACLE FEE EVENTS (analytics)
  // ===========================================================================
  /**
   * Fee-related events from PredictionOracle.
   * These are useful for analytics (fee parameter changes + fee withdrawals).
   *
   * ID FORMAT: chainId-txHash-logIndex
   */
  oracleFeeEvents: p.createTable({
    /** Unique ID: chainId-txHash-logIndex */
    id: p.string(),
    /** Chain ID */
    chainId: p.int(),
    /** Chain name */
    chainName: p.string(),
    /** Oracle contract address */
    oracleAddress: p.hex(),
    /**
     * Event kind:
     * - "OperatorGasFeeUpdated"
     * - "ProtocolFeeUpdated"
     * - "ProtocolFeesWithdrawn"
     */
    eventName: p.string(),
    /** newFee for *FeeUpdated events */
    newFee: p.bigint().optional(),
    /** to address for ProtocolFeesWithdrawn */
    to: p.hex().optional(),
    /** amount for ProtocolFeesWithdrawn */
    amount: p.bigint().optional(),
    /** Tx hash */
    txHash: p.hex(),
    /** Block number */
    blockNumber: p.bigint(),
    /** Block timestamp */
    timestamp: p.bigint(),
  }),

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
    /** Arbiter address (can override poll status) */
    arbiter: p.hex().optional(),
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
    /** Whether the last refresh was free */
    lastRefreshWasFree: p.boolean().optional(),
    /** Previous check epoch value from the last PollRefreshed event */
    lastRefreshOldCheckEpoch: p.int().optional(),
    /** Whether arbitration has been started for this poll */
    arbitrationStarted: p.boolean(),
    /** Poll category (0-11) */
    category: p.int(),
    /** Poll status: 0=Pending, 1=Yes, 2=No, 3=Unknown */
    status: p.int(),
    /** Resolution reason (if resolved) */
    resolutionReason: p.string().optional(),
    /** Setter address (operator who set the answer, null if pending) */
    setter: p.hex().optional(),
    /** Address that started arbitration (if disputed) */
    disputedBy: p.hex().optional(),
    /** Reason for the dispute */
    disputeReason: p.string().optional(),
    /** Stake amount for the dispute */
    disputeStake: p.bigint().optional(),
    /** Timestamp when arbitration was started */
    disputedAt: p.bigint().optional(),
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
    /** Flag to indicate if market was created via Factory event (false) or just minimal trade record (true) */
    isIncomplete: p.boolean(),
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
    /** PariMutuel: Market start timestamp (for time-weighted odds) */
    marketStartTimestamp: p.bigint().optional(),
    /** PariMutuel: Market close timestamp (for time-weighted odds) */
    marketCloseTimestamp: p.bigint().optional(),
    /** Total trading volume (6 decimals) */
    totalVolume: p.bigint(),
    /** Number of trades */
    totalTrades: p.int(),
    /** Current total value locked */
    currentTvl: p.bigint(),
    /** Number of unique traders */
    uniqueTraders: p.int(),
    /** Initial collateral deposited at market creation (6 decimals) */
    initialLiquidity: p.bigint(),
    /** AMM reserve YES tokens */
    reserveYes: p.bigint().optional(),
    /** AMM reserve NO tokens */
    reserveNo: p.bigint().optional(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // FEE TRACKING
    // ─────────────────────────────────────────────────────────────────────────
    /** Total creator fees earned from this market (6 decimals) - sum of creatorShare from ProtocolFeesWithdrawn */
    creatorFeesEarned: p.bigint(),
    /** Total platform fees earned from this market (6 decimals) - sum of platformShare from ProtocolFeesWithdrawn */
    platformFeesEarned: p.bigint(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // PARI-MUTUEL SPECIFIC FIELDS
    // ─────────────────────────────────────────────────────────────────────────
    /** PariMutuel: Total collateral in YES pool (6 decimals) */
    totalCollateralYes: p.bigint().optional(),
    /** PariMutuel: Total collateral in NO pool (6 decimals) */
    totalCollateralNo: p.bigint().optional(),
    /** PariMutuel: Time-weighted YES shares for odds calculation */
    totalSharesYes: p.bigint().optional(),
    /** PariMutuel: Time-weighted NO shares for odds calculation */
    totalSharesNo: p.bigint().optional(),
    /** 
     * PariMutuel: Current YES probability (scaled 1e9)
     * Formula: yesChance = totalCollateralYes / (totalCollateralYes + totalCollateralNo) * 1e9
     * Example: 500_000_000 = 50%
     */
    yesChance: p.bigint().optional(),
    
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
    /** Output token amount (for swaps) */
    tokenAmountOut: p.bigint().optional(),
    /** Transaction hash */
    txHash: p.hex(),
    /** Block number */
    blockNumber: p.bigint(),
    /** Timestamp */
    timestamp: p.bigint(),
  }),

  // ===========================================================================
  // PRICE TICKS TABLE
  // ===========================================================================
  /**
   * Execution price points derived from indexed AMM buy/sell trades.
   * These are the underlying points used to build OHLC candles.
   *
   * yesPriceScaled is scaled by 1e9 (same as frontend CANDLE_PRICE_SCALE).
   */
  priceTicks: p.createTable({
    /** Unique ID: marketAddress-txHash-logIndex */
    id: p.string(),
    marketAddress: p.hex(),
    /** Timestamp (unix seconds) */
    timestamp: p.bigint(),
    /** Ordering helper: seq = blockNumber * 1_000_000 + logIndex */
    seq: p.bigint(),
    /** YES execution price scaled 1e9 */
    yesPrice: p.bigint(),
    /** Collateral volume for this trade (6 decimals) */
    volume: p.bigint(),
    /** Side of the trade ("yes"|"no") */
    side: p.string(),
    /** Trade type ("buy"|"sell") */
    tradeType: p.string(),
    /** Tx hash (for debugging) */
    txHash: p.hex(),
    /** Block number (for debugging) */
    blockNumber: p.bigint(),
  }),

  // ===========================================================================
  // CANDLES TABLES (per timeframe)
  // ===========================================================================
  /**
   * 1-minute candles derived from priceTicks.
   */
  candles1m: p.createTable({
    /** Unique ID: marketAddress-bucketStart */
    id: p.string(),
    marketAddress: p.hex(),
    bucketStart: p.bigint(),
    open: p.bigint(),
    high: p.bigint(),
    low: p.bigint(),
    close: p.bigint(),
    volume: p.bigint(),
    trades: p.int(),
    firstSeq: p.bigint(),
    lastSeq: p.bigint(),
  }),

  /**
   * 5-minute candles derived from priceTicks.
   */
  candles5m: p.createTable({
    /** Unique ID: marketAddress-bucketStart */
    id: p.string(),
    marketAddress: p.hex(),
    bucketStart: p.bigint(),
    open: p.bigint(),
    high: p.bigint(),
    low: p.bigint(),
    close: p.bigint(),
    volume: p.bigint(),
    trades: p.int(),
    firstSeq: p.bigint(),
    lastSeq: p.bigint(),
  }),

  /**
   * 1-hour candles derived from priceTicks.
   */
  candles1h: p.createTable({
    /** Unique ID: marketAddress-bucketStart */
    id: p.string(),
    marketAddress: p.hex(),
    bucketStart: p.bigint(),
    open: p.bigint(),
    high: p.bigint(),
    low: p.bigint(),
    close: p.bigint(),
    volume: p.bigint(),
    trades: p.int(),
    firstSeq: p.bigint(),
    lastSeq: p.bigint(),
  }),

  /**
   * 1-day candles derived from priceTicks.
   */
  candles1d: p.createTable({
    /** Unique ID: marketAddress-bucketStart */
    id: p.string(),
    marketAddress: p.hex(),
    bucketStart: p.bigint(),
    open: p.bigint(),
    high: p.bigint(),
    low: p.bigint(),
    close: p.bigint(),
    volume: p.bigint(),
    trades: p.int(),
    firstSeq: p.bigint(),
    lastSeq: p.bigint(),
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
    /**
     * Total fees earned from markets created by this user (6 decimals)
     * Updated when ProtocolFeesWithdrawn event fires on user's markets
     */
    totalCreatorFees: p.bigint(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // REFERRAL FIELDS
    // ─────────────────────────────────────────────────────────────────────────
    /** Address of who referred this user (null if organic/direct signup) */
    referrerAddress: p.hex().optional(),
    /** This user's registered referral code hash (null if no code registered) */
    referralCodeHash: p.hex().optional(),
    /** Total number of users this user has referred */
    totalReferrals: p.int(),
    /** Total volume generated by referred users (6 decimals) */
    totalReferralVolume: p.bigint(),
    /** Total fees generated by referred users (6 decimals) */
    totalReferralFees: p.bigint(),
    /** Total rewards earned from referrals (6 decimals) */
    totalReferralRewards: p.bigint(),
    /** Unix timestamp when this user was referred (null if organic) */
    referredAt: p.bigint().optional(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // TIMESTAMPS
    // ─────────────────────────────────────────────────────────────────────────
    /** Unix timestamp of user's first trade (null if never traded) */
    firstTradeAt: p.bigint().optional(),
    /** Unix timestamp of user's most recent trade (null if never traded) */
    lastTradeAt: p.bigint().optional(),
  }),

  // ===========================================================================
  // MARKET USERS TABLE
  // ===========================================================================
  /**
   * Tracks unique users per market to optimize "unique traders" counting.
   * Replaces expensive scans of the trades table.
   */
  marketUsers: p.createTable({
    /** Composite ID: chainId-marketAddress-userAddress */
    id: p.string(),
    /** Chain ID */
    chainId: p.int(),
    /** Market address */
    marketAddress: p.hex(),
    /** User address */
    user: p.hex(),
    /** Timestamp of last trade on this market */
    lastTradeAt: p.bigint(),
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
    /** YES tokens burned (AMM only) */
    yesTokenAmount: p.bigint().optional(),
    /** NO tokens burned (AMM only) */
    noTokenAmount: p.bigint().optional(),
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
    /** Poll address (denormalized for easier querying) */
    pollAddress: p.hex(),
    /** Event type: 'add' or 'remove' */
    eventType: p.string(),
    /** Collateral amount (6 decimals) */
    collateralAmount: p.bigint(),
    /** LP tokens minted/burned */
    lpTokens: p.bigint(),
    /** YES tokens added/removed */
    yesTokenAmount: p.bigint().optional(),
    /** NO tokens added/removed */
    noTokenAmount: p.bigint().optional(),
    /** YES tokens returned to user (from imbalance) */
    yesTokensReturned: p.bigint().optional(),
    /** NO tokens returned to user (from imbalance) */
    noTokensReturned: p.bigint().optional(),
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
    /** Total platform share from fee withdrawals across all markets (6 decimals) */
    totalPlatformFeesEarned: p.bigint(),
    
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

  // ===========================================================================
  // REFERRAL CODES TABLE
  // ===========================================================================
  /**
   * Referral codes registered by users via ReferralRegistry contract.
   * Each code is a bytes32 hash that maps to a human-readable string.
   * 
   * ID FORMAT: bytes32 code hash (hex string)
   */
  referralCodes: p.createTable({
    /** Primary key: the bytes32 code hash */
    id: p.hex(),
    /** Owner address who registered this code */
    ownerAddress: p.hex(),
    /** Human-readable code (decoded from bytes32) */
    code: p.string(),
    /** Total number of users referred using this code */
    totalReferrals: p.int(),
    /** Total trading volume generated by referred users (6 decimals) */
    totalVolumeGenerated: p.bigint(),
    /** Total fees generated by referred users (6 decimals) */
    totalFeesGenerated: p.bigint(),
    /** Unix timestamp when code was registered */
    createdAt: p.bigint(),
    /** Block number when code was registered */
    createdAtBlock: p.bigint(),
  }),

  // ===========================================================================
  // REFERRALS TABLE
  // ===========================================================================
  /**
   * Individual referral relationships between referrers and referees.
   * Created when a user signs up using a referral code.
   * 
   * ID FORMAT: "{referrerAddress}-{refereeAddress}"
   */
  referrals: p.createTable({
    /** Primary key: referrer-referee pair */
    id: p.string(),
    /** Address of the referrer (the one who shared the code) */
    referrerAddress: p.hex(),
    /** Address of the referee (the one who used the code) */
    refereeAddress: p.hex(),
    /** The referral code hash used for this referral */
    referralCodeHash: p.hex(),
    /** 
     * Status of this referral:
     * - 'pending': User signed up but hasn't traded yet
     * - 'active': User has made at least one trade
     * - 'inactive': User hasn't traded in a long time (optional future use)
     */
    status: p.string(),
    /** Total trading volume generated BY THE REFEREE (6 decimals) */
    totalVolumeGenerated: p.bigint(),
    /** Total fees generated BY THE REFEREE (6 decimals) */
    totalFeesGenerated: p.bigint(),
    /** Total number of trades made by the referee */
    totalTradesCount: p.int(),
    /** Total rewards earned BY THE REFERRER from this referee (6 decimals) */
    totalRewardsEarned: p.bigint(),
    /** Unix timestamp when the referral was registered */
    referredAt: p.bigint(),
    /** Block number when the referral was registered */
    referredAtBlock: p.bigint(),
    /** Unix timestamp of referee's first trade (null if no trades yet) */
    firstTradeAt: p.bigint().optional(),
    /** Unix timestamp of referee's last trade (null if no trades yet) */
    lastTradeAt: p.bigint().optional(),
  }),

  // ===========================================================================
  // REFERRAL STATS TABLE (Global)
  // ===========================================================================
  /**
   * Platform-wide referral statistics.
   * Single record with ID "global".
   */
  referralStats: p.createTable({
    /** Primary key: "global" */
    id: p.string(),
    /** Total number of referral codes registered */
    totalCodes: p.int(),
    /** Total number of referral relationships */
    totalReferrals: p.int(),
    /** Total trading volume generated through referrals (6 decimals) */
    totalVolumeGenerated: p.bigint(),
    /** Total fees generated through referrals (6 decimals) */
    totalFeesGenerated: p.bigint(),
    /** Total rewards distributed to referrers (6 decimals) */
    totalRewardsDistributed: p.bigint(),
    /** Unix timestamp of last update */
    updatedAt: p.bigint(),
  }),

  // ===========================================================================
  // CAMPAIGNS TABLE
  // ===========================================================================
  /**
   * Reward campaigns created via CampaignFactory contract.
   * Campaigns distribute rewards to referrers based on various criteria.
   * 
   * ID FORMAT: campaignId (uint256 as string)
   * 
   * REWARD TYPES:
   * - 0: Fixed reward per referral
   * - 1: Percentage of volume
   * - 2: Tiered rewards
   * - 3: Custom (encoded in rewardConfig)
   * 
   * ASSET KINDS:
   * - 0: Native token (S)
   * - 1: ERC20 token
   * - 2: ERC721 NFT
   * - 3: ERC1155
   * 
   * STATUS:
   * - 0: Active
   * - 1: Paused
   * - 2: Ended
   * - 3: Cancelled
   */
  campaigns: p.createTable({
    // ─────────────────────────────────────────────────────────────────────────
    // IDENTITY
    // ─────────────────────────────────────────────────────────────────────────
    /** Campaign ID from contract (uint256 as string) */
    id: p.string(),
    /** Chain ID where campaign exists */
    chainId: p.int(),
    /** Chain name for display */
    chainName: p.string(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // CAMPAIGN INFO
    // ─────────────────────────────────────────────────────────────────────────
    /** Campaign name */
    name: p.string(),
    /** Campaign description */
    description: p.string(),
    /** Creator's wallet address */
    creator: p.hex(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // REWARD CONFIGURATION
    // ─────────────────────────────────────────────────────────────────────────
    /** Reward token/asset address */
    rewardAsset: p.hex(),
    /** Asset kind: 0=Native, 1=ERC20, 2=ERC721, 3=ERC1155 */
    assetKind: p.int(),
    /** Total reward pool available (in asset decimals) */
    rewardPool: p.bigint(),
    /** Total rewards already paid out */
    rewardsPaid: p.bigint(),
    /** Reward type: 0=Fixed, 1=Percentage, 2=Tiered, 3=Custom */
    rewardType: p.int(),
    /** Encoded reward configuration (hex bytes) */
    rewardConfig: p.string(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // TIMING
    // ─────────────────────────────────────────────────────────────────────────
    /** Campaign start timestamp */
    startTime: p.bigint(),
    /** Campaign end timestamp */
    endTime: p.bigint(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // STATUS & STATS
    // ─────────────────────────────────────────────────────────────────────────
    /** Campaign status: 0=Active, 1=Paused, 2=Ended, 3=Cancelled */
    status: p.int(),
    /** Number of participants who claimed rewards */
    totalParticipants: p.int(),
    /** Number of reward claims made */
    totalClaims: p.int(),
    
    // ─────────────────────────────────────────────────────────────────────────
    // METADATA
    // ─────────────────────────────────────────────────────────────────────────
    /** Block number when created */
    createdAtBlock: p.bigint(),
    /** Timestamp when created */
    createdAt: p.bigint(),
    /** Transaction hash of creation */
    createdTxHash: p.hex(),
    /** Last time this record was updated */
    updatedAt: p.bigint(),
  }),

  // ===========================================================================
  // CAMPAIGN CLAIMS TABLE
  // ===========================================================================
  /**
   * Individual reward claims from campaigns.
   * Tracks when users claim their campaign rewards.
   * 
   * ID FORMAT: chainId-campaignId-userAddress
   */
  campaignClaims: p.createTable({
    /** Composite ID: chainId-campaignId-userAddress */
    id: p.string(),
    /** Chain ID */
    chainId: p.int(),
    /** Campaign ID */
    campaignId: p.string(),
    /** User who claimed */
    user: p.hex(),
    /** Total amount claimed by this user from this campaign */
    totalClaimed: p.bigint(),
    /** Number of times claimed (for recurring campaigns) */
    claimCount: p.int(),
    /** First claim timestamp */
    firstClaimAt: p.bigint(),
    /** Last claim timestamp */
    lastClaimAt: p.bigint(),
  }),

  // ===========================================================================
  // CAMPAIGN STATS TABLE (Global)
  // ===========================================================================
  /**
   * Platform-wide campaign statistics.
   * Single record with ID "global".
   */
  campaignStats: p.createTable({
    /** Primary key: "global" */
    id: p.string(),
    /** Total number of campaigns created */
    totalCampaigns: p.int(),
    /** Number of currently active campaigns */
    activeCampaigns: p.int(),
    /** Total rewards distributed across all campaigns */
    totalRewardsDistributed: p.bigint(),
    /** Total unique participants across all campaigns */
    totalParticipants: p.int(),
    /** Unix timestamp of last update */
    updatedAt: p.bigint(),
  }),
}));
