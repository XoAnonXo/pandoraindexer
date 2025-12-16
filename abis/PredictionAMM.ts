/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                       PREDICTION AMM ABI                                   ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Automated Market Maker for prediction markets using constant product.     ║
 * ║  Creates YES and NO tokens that traders can buy, sell, and swap.           ║
 * ║  LPs provide liquidity and earn trading fees.                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * HOW AMM WORKS:
 * ──────────────
 * 
 *   Constant Product Formula: reserveYes × reserveNo = k (constant)
 *   
 *   ┌───────────────────────────────────────────────────────────┐
 *   │                    LIQUIDITY POOL                         │
 *   │                                                           │
 *   │     YES Tokens         │           NO Tokens              │
 *   │     (reserveYes)       │           (reserveNo)            │
 *   │                        │                                  │
 *   │     When user buys     │     When user buys               │
 *   │     YES → reserveYes↓  │     NO → reserveNo↓              │
 *   │           reserveNo↑   │           reserveYes↑            │
 *   │                        │                                  │
 *   └───────────────────────────────────────────────────────────┘
 *   
 *   Price = reserveNo / reserveYes (for YES token)
 *   As more people buy YES, its price increases (supply decreases)
 * 
 * VOLUME TRACKING (CRITICAL):
 * ───────────────────────────
 * 
 *   ┌─────────────────────────┬────────────────────┬─────────────┐
 *   │ Event                   │ Counts as Volume?  │ Amount      │
 *   ├─────────────────────────┼────────────────────┼─────────────┤
 *   │ BuyTokens               │ ✅ YES             │ collateral  │
 *   │ SellTokens              │ ✅ YES             │ collateral  │
 *   │ SwapTokens              │ ❌ NO              │ (no USDC)   │
 *   │ LiquidityAdded imbalance│ ⚠️ MAYBE          │ tokensReturn│
 *   │ LiquidityRemoved        │ ❌ NO              │ (withdrawal)│
 *   │ WinningsRedeemed        │ ❌ NO              │ (payout)    │
 *   └─────────────────────────┴────────────────────┴─────────────┘
 * 
 * TVL TRACKING:
 * ─────────────
 *   TVL = actual USDC balance in the contract
 *   
 *   +collateral: BuyTokens, LiquidityAdded
 *   -collateral: SellTokens, LiquidityRemoved, WinningsRedeemed
 */

export const PredictionAMMAbi = [
  // ═══════════════════════════════════════════════════════════════════════════
  // TRADING EVENTS (Volume-generating)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * BuyTokens - User purchases YES or NO tokens
   * 
   * Flow: User deposits collateral (USDC) → Receives outcome tokens
   * 
   * VOLUME: ✅ collateralAmount counts as volume
   * TVL: ➕ increases by collateralAmount
   * 
   * @param trader - Buyer's wallet address (indexed)
   * @param isYes - true=bought YES, false=bought NO (indexed for filtering)
   * @param tokenAmount - Number of outcome tokens received (uint256)
   * @param collateralAmount - USDC spent (6 decimals) (uint256)
   * @param fee - Trading fee deducted (uint256)
   */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "trader", type: "address" },
      { indexed: true, name: "isYes", type: "bool" },
      { indexed: false, name: "tokenAmount", type: "uint256" },
      { indexed: false, name: "collateralAmount", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "BuyTokens",
    type: "event",
  },
  
  /**
   * SellTokens - User sells YES or NO tokens back to pool
   * 
   * Flow: User returns outcome tokens → Receives collateral (USDC)
   * 
   * VOLUME: ✅ collateralAmount counts as volume
   * TVL: ➖ decreases by collateralAmount
   * PnL: Updates user's totalWithdrawn (realized exit)
   * 
   * @param trader - Seller's wallet address (indexed)
   * @param isYes - true=sold YES, false=sold NO (indexed)
   * @param tokenAmount - Number of outcome tokens sold (uint256)
   * @param collateralAmount - USDC received (6 decimals) (uint256)
   * @param fee - Trading fee deducted (uint256)
   */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "trader", type: "address" },
      { indexed: true, name: "isYes", type: "bool" },
      { indexed: false, name: "tokenAmount", type: "uint256" },
      { indexed: false, name: "collateralAmount", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "SellTokens",
    type: "event",
  },
  
  /**
   * SwapTokens - User swaps YES for NO or vice versa
   * 
   * Flow: User returns one token type → Receives other token type
   * No collateral moves, just token exchange.
   * 
   * VOLUME: ❌ NO (no collateral enters/leaves)
   * TVL: ➡️ unchanged (token swap only)
   * 
   * @param trader - Swapper's wallet address (indexed)
   * @param yesToNo - true=swapped YES→NO, false=swapped NO→YES (indexed)
   * @param amountIn - Tokens given (uint256)
   * @param amountOut - Tokens received (uint256)
   * @param fee - Swap fee (paid in tokens) (uint256)
   */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "trader", type: "address" },
      { indexed: true, name: "yesToNo", type: "bool" },
      { indexed: false, name: "amountIn", type: "uint256" },
      { indexed: false, name: "amountOut", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "SwapTokens",
    type: "event",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLUTION EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * WinningsRedeemed - User claims payout after poll resolution
   * 
   * REQUIREMENTS for this event to fire:
   * 1. Poll must be resolved (status != 0)
   * 2. 24-hour finalization period must have passed
   * 3. No arbitration pending
   * 4. User must actively call redeem()
   * 
   * TVL: ➖ decreases by collateralAmount (funds leave contract)
   * PnL: Updates user's totalWinnings and realizedPnL
   * 
   * @param user - Winner's wallet address (indexed)
   * @param yesAmount - YES tokens redeemed (burned)
   * @param noAmount - NO tokens redeemed (burned)
   * @param collateralAmount - USDC payout received (6 decimals)
   */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "yesAmount", type: "uint256" },
      { indexed: false, name: "noAmount", type: "uint256" },
      { indexed: false, name: "collateralAmount", type: "uint256" },
    ],
    name: "WinningsRedeemed",
    type: "event",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LIQUIDITY EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * LiquidityAdded - LP deposits collateral to provide liquidity
   * 
   * IMBALANCE VOLUME TRACKING (⚠️ Important):
   * When LP adds liquidity with non-50/50 prices, they receive tokens
   * back (yesToReturn/noToReturn). This represents a position taken
   * and counts as volume!
   * 
   * Example: If current price is 70/30 and LP adds 100 USDC:
   * - 70 USDC worth of YES tokens added to pool
   * - 30 USDC worth of NO tokens added to pool  
   * - LP receives 40 USDC worth of YES tokens back (imbalance)
   * - imbalanceVolume = yesToReturn + noToReturn = 40 (counts as volume!)
   * 
   * TVL: ➕ increases by collateralAmount
   * Volume: ⚠️ yesToReturn + noToReturn (if imbalanced)
   * 
   * @param provider - LP's wallet address (indexed)
   * @param collateralAmount - USDC deposited (uint256)
   * @param lpTokens - LP tokens minted to provider (uint256)
   * @param amounts - Struct with token movement details:
   *   - yesToAdd: YES tokens added to pool
   *   - noToAdd: NO tokens added to pool
   *   - yesToReturn: YES tokens returned to LP (imbalance)
   *   - noToReturn: NO tokens returned to LP (imbalance)
   */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "provider", type: "address" },
      { indexed: false, name: "collateralAmount", type: "uint256" },
      { indexed: false, name: "lpTokens", type: "uint256" },
      {
        components: [
          { name: "yesToAdd", type: "uint256" },
          { name: "noToAdd", type: "uint256" },
          { name: "yesToReturn", type: "uint256" },
          { name: "noToReturn", type: "uint256" },
        ],
        indexed: false,
        name: "amounts",
        type: "tuple",
      },
    ],
    name: "LiquidityAdded",
    type: "event",
  },
  
  /**
   * LiquidityRemoved - LP withdraws liquidity from the pool
   * 
   * LP burns their LP tokens and receives:
   * - YES and NO tokens proportional to their share
   * - Plus collateral that was over-reserved
   * 
   * TVL: ➖ decreases by collateralToReturn
   * 
   * @param provider - LP's wallet address (indexed)
   * @param lpTokens - LP tokens burned (uint256)
   * @param yesAmount - YES tokens returned to LP (uint256)
   * @param noAmount - NO tokens returned to LP (uint256)
   * @param collateralToReturn - USDC returned to LP (uint256)
   */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "provider", type: "address" },
      { indexed: false, name: "lpTokens", type: "uint256" },
      { indexed: false, name: "yesAmount", type: "uint256" },
      { indexed: false, name: "noAmount", type: "uint256" },
      { indexed: false, name: "collateralToReturn", type: "uint256" },
    ],
    name: "LiquidityRemoved",
    type: "event",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRICE TRACKING EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Sync - Reserve values updated after any pool operation
   * 
   * Emitted after every trade/liquidity change.
   * Use these values to calculate current prices:
   *   yesPrice = rNo / (rYes + rNo)
   *   noPrice = rYes / (rYes + rNo)
   * 
   * @param rYes - Current YES token reserve (uint112)
   * @param rNo - Current NO token reserve (uint112)
   */
  {
    anonymous: false,
    inputs: [
      { indexed: false, name: "rYes", type: "uint112" },
      { indexed: false, name: "rNo", type: "uint112" },
    ],
    name: "Sync",
    type: "event",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROTOCOL FEE EVENTS (Not currently indexed)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * ProtocolFeesWithdrawn - Admin withdraws accumulated fees
   */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "caller", type: "address" },
      { indexed: false, name: "platformShare", type: "uint256" },
      { indexed: false, name: "creatorShare", type: "uint256" },
    ],
    name: "ProtocolFeesWithdrawn",
    type: "event",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * pollAddress() - Returns the linked poll contract
   * Used to look up poll status and question for denormalization.
   */
  {
    inputs: [],
    name: "pollAddress",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  
  /**
   * creator() - Returns the market creator address
   */
  {
    inputs: [],
    name: "creator",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  
  /**
   * collateral() - Returns the collateral token address (USDC)
   */
  {
    inputs: [],
    name: "collateral",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  
  /**
   * yesToken() - Returns the YES token address
   */
  {
    inputs: [],
    name: "yesToken",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  
  /**
   * noToken() - Returns the NO token address
   */
  {
    inputs: [],
    name: "noToken",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  
  /**
   * feeTier() - Returns the trading fee tier
   */
  {
    inputs: [],
    name: "feeTier",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  
  /**
   * maxPriceImbalancePerHour() - Returns max price imbalance setting
   */
  {
    inputs: [],
    name: "maxPriceImbalancePerHour",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
