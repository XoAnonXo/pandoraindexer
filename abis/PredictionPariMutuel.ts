/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                    PREDICTION PARI-MUTUEL ABI                              ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Pool-based betting market where all bets are aggregated.                  ║
 * ║  Winners split the entire pool (including losers' stakes).                 ║
 * ║  Simpler than AMM - buy only, no selling or swapping.                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * HOW PARI-MUTUEL WORKS:
 * ──────────────────────
 * 
 *   ┌────────────────────────────────────────────────────────────┐
 *   │                     BETTING POOL                           │
 *   │                                                            │
 *   │    ┌─────────────────┐    ┌─────────────────┐             │
 *   │    │   YES Pool      │    │    NO Pool      │             │
 *   │    │   $600 total    │    │   $400 total    │             │
 *   │    │   (60% of bets) │    │   (40% of bets) │             │
 *   │    └─────────────────┘    └─────────────────┘             │
 *   │                                                            │
 *   │    If YES wins: YES bettors share entire $1000 pool       │
 *   │    If NO wins: NO bettors share entire $1000 pool         │
 *   │                                                            │
 *   │    Payout = (your bet / winning pool) × total pool        │
 *   └────────────────────────────────────────────────────────────┘
 * 
 * ODDS CALCULATION:
 * ─────────────────
 *   Implied Probability (YES) = yesPool / totalPool
 *   Example: 600/1000 = 60% implied probability
 *   
 *   Potential Return (YES) = totalPool / yesPool
 *   Example: 1000/600 = 1.67x return (67% profit if win)
 * 
 * VOLUME TRACKING (CRITICAL):
 * ───────────────────────────
 * 
 *   ┌─────────────────────────┬────────────────────┬──────────────┐
 *   │ Event                   │ Counts as Volume?  │ Amount       │
 *   ├─────────────────────────┼────────────────────┼──────────────┤
 *   │ SeedInitialLiquidity    │ ✅ YES (CRITICAL!) │ yes + no     │
 *   │ PositionPurchased       │ ✅ YES             │ collateralIn │
 *   │ WinningsRedeemed        │ ❌ NO              │ (payout)     │
 *   └─────────────────────────┴────────────────────┴──────────────┘
 *   
 *   ⚠️ SeedInitialLiquidity is often missed and causes volume under-counting!
 * 
 * TVL TRACKING:
 * ─────────────
 *   +collateral: SeedInitialLiquidity, PositionPurchased
 *   -collateral: WinningsRedeemed
 */

export const PredictionPariMutuelAbi = [
  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * SeedInitialLiquidity - Market creator seeds the pool
   * 
   * ⚠️ CRITICAL EVENT: This is REAL VOLUME, often missed in indexers!
   * 
   * When a PariMutuel market is created, the creator must provide
   * initial liquidity split between YES and NO pools. This capital
   * is at risk and counts as trading volume.
   * 
   * VOLUME: ✅ yesAmount + noAmount (total seed)
   * TVL: ➕ increases by (yesAmount + noAmount)
   * 
   * @param yesAmount - Initial collateral in YES pool (uint256, 6 decimals)
   * @param noAmount - Initial collateral in NO pool (uint256, 6 decimals)
   * 
   * @example
   * // Market seeded with $500 YES + $500 NO = $1000 volume
   * // Initial odds: 50/50
   */
  {
    type: "event",
    name: "SeedInitialLiquidity",
    inputs: [
      { name: "yesAmount", type: "uint256", indexed: false },
      { name: "noAmount", type: "uint256", indexed: false },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BETTING EVENTS (Volume-generating)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * PositionPurchased - User places a bet on YES or NO
   * 
   * Flow: User deposits collateral (USDC) → Receives pool shares
   * Unlike AMM, users cannot sell positions - must hold until resolution.
   * 
   * VOLUME: ✅ collateralIn counts as volume
   * TVL: ➕ increases by collateralIn
   * 
   * @param buyer - Bettor's wallet address (indexed)
   * @param isYes - true=bet on YES, false=bet on NO (indexed)
   * @param collateralIn - USDC wagered (6 decimals) (uint256)
   * @param sharesOut - Pool shares received (represents claim on pool)
   * 
   * @example
   * // User bets $100 on YES
   * // sharesOut determines their % claim on YES pool if YES wins
   */
  {
    type: "event",
    name: "PositionPurchased",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "isYes", type: "bool", indexed: true },
      { name: "collateralIn", type: "uint256", indexed: false },
      { name: "sharesOut", type: "uint256", indexed: false },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLUTION EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * WinningsRedeemed - Winner claims payout after poll resolution
   * 
   * REQUIREMENTS for this event to fire:
   * 1. Poll must be resolved (status = 1, 2, or 3)
   * 2. 24-hour finalization period must have passed
   * 3. No arbitration pending
   * 4. User must actively call redeem()
   * 
   * If status = 3 (Unknown), all bettors get proportional refunds.
   * 
   * TVL: ➖ decreases by collateralAmount
   * PnL: Updates user's totalWinnings and realizedPnL
   * 
   * @param user - Winner's wallet address (indexed)
   * @param collateralAmount - USDC payout (6 decimals, net of fees)
   * @param outcome - Final poll status: 1=Yes, 2=No, 3=Unknown/Void
   * @param fee - Platform fee deducted from payout
   */
  {
    type: "event",
    name: "WinningsRedeemed",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "collateralAmount", type: "uint256", indexed: false },
      { name: "outcome", type: "uint8", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROTOCOL FEE EVENTS (Not currently indexed)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * ProtocolFeesWithdrawn - Admin withdraws accumulated fees
   */
  {
    type: "event",
    name: "ProtocolFeesWithdrawn",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * pollAddress() - Returns the linked poll contract
   * Used to look up poll status and question for denormalization.
   */
  {
    type: "function",
    name: "pollAddress",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  
  /**
   * creator() - Returns the market creator address
   */
  {
    type: "function",
    name: "creator",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  
  /**
   * collateralToken() - Returns the collateral token address (USDC)
   */
  {
    type: "function",
    name: "collateralToken",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  
  /**
   * curveFlattener() - Returns the curve flattener parameter
   */
  {
    type: "function",
    name: "curveFlattener",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  
  /**
   * curveOffset() - Returns the curve offset parameter
   */
  {
    type: "function",
    name: "curveOffset",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // POOL STATE VIEW FUNCTIONS (Used for odds calculation)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * yesPool() - Total collateral in YES pool
   * Increases when users buy YES positions or seed liquidity
   */
  {
    type: "function",
    name: "yesPool",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  
  /**
   * noPool() - Total collateral in NO pool
   * Increases when users buy NO positions or seed liquidity
   */
  {
    type: "function",
    name: "noPool",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  
  /**
   * totalYesShares() - Time-weighted YES shares for odds calculation
   * Used in the time-weighted odds formula (not just collateral ratio)
   */
  {
    type: "function",
    name: "totalYesShares",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  
  /**
   * totalNoShares() - Time-weighted NO shares for odds calculation
   * Used in the time-weighted odds formula (not just collateral ratio)
   */
  {
    type: "function",
    name: "totalNoShares",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;
