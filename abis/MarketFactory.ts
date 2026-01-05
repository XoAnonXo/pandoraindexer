/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                        MARKET FACTORY ABI                                  ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Factory contract that deploys trading markets for prediction polls.       ║
 * ║  Each poll can have ONE market - either AMM or PariMutuel type.            ║
 * ║  Markets handle all trading, liquidity, and payout logic.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * MARKET TYPES:
 * ─────────────
 * 
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ AMM (Automated Market Maker)                                    │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ • Uses constant product formula (x * y = k)                     │
 * │ • Creates YES and NO ERC20 tokens                               │
 * │ • Allows buy/sell/swap operations                               │
 * │ • LPs provide liquidity and earn fees                           │
 * │ • Continuous price discovery based on supply/demand             │
 * └─────────────────────────────────────────────────────────────────┘
 * 
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ PariMutuel (Pool Betting)                                       │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ • All bets go into a shared pool                                │
 * │ • Winners split the entire pool proportionally                  │
 * │ • Odds change dynamically based on betting activity             │
 * │ • Simpler model - buy only, no selling                          │
 * │ • Seeded with initial liquidity on creation                     │
 * └─────────────────────────────────────────────────────────────────┘
 * 
 * IMPORTANT FOR INDEXER:
 * ──────────────────────
 * - MarketCreated and PariMutuelCreated are FACTORY events
 * - The marketAddress from these events is used to track dynamic contracts
 * - Market creation often races with first liquidity/trade events
 * - Handlers must use getOrCreateMinimalMarket() to handle race conditions
 */

export const MarketFactoryAbi = [
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKET DEPLOYMENT EVENTS (Factory Events)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * MarketCreated - AMM market deployed
   * 
   * Emitted when createMarket() is called.
   * This deploys a new PredictionAMM contract linked to a poll.
   * 
   * FACTORY PATTERN: Ponder uses this event to discover
   * and index the dynamically deployed AMM contract.
   * 
   * @param pollAddress - Linked poll contract (indexed, for filtering)
   * @param marketAddress - Newly deployed AMM contract (indexed, factory key)
   * @param creator - Wallet that created the market (indexed)
   * @param yesToken - ERC20 token representing YES outcome
   * @param noToken - ERC20 token representing NO outcome
   * @param collateral - Accepted collateral token (USDC)
   * @param feeTier - Trading fee in basis points (e.g., 30 = 0.3%)
   * @param maxPriceImbalancePerHour - Price manipulation protection
   */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "pollAddress", type: "address" },
      { indexed: true, name: "marketAddress", type: "address" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "yesToken", type: "address" },
      { indexed: false, name: "noToken", type: "address" },
      { indexed: false, name: "collateral", type: "address" },
      { indexed: false, name: "feeTier", type: "uint24" },
      { indexed: false, name: "maxPriceImbalancePerHour", type: "uint24" },
    ],
    name: "MarketCreated",
    type: "event",
  },
  
  /**
   * PariMutuelCreated - PariMutuel market deployed
   * 
   * Emitted when createPariMutuel() is called.
   * This deploys a new PredictionPariMutuel contract linked to a poll.
   * 
   * FACTORY PATTERN: Ponder uses this event to discover
   * and index the dynamically deployed PariMutuel contract.
   * 
   * @param pollAddress - Linked poll contract (indexed)
   * @param marketAddress - Newly deployed PariMutuel contract (indexed, factory key)
   * @param creator - Wallet that created the market (indexed)
   * @param collateral - Accepted collateral token (USDC)
   * @param curveFlattener - Odds curve flattening parameter (affects payout curve)
   * @param curveOffset - Initial odds offset parameter
   */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "pollAddress", type: "address" },
      { indexed: true, name: "marketAddress", type: "address" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "collateral", type: "address" },
      { indexed: false, name: "curveFlattener", type: "uint8" },
      { indexed: false, name: "curveOffset", type: "uint24" },
    ],
    name: "PariMutuelCreated",
    type: "event",
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN EVENTS (Not currently indexed)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * CollateralWhitelisted - Collateral token approved/revoked
   * 
   * Admin event for managing which tokens can be used as collateral.
   * Currently only USDC is whitelisted on all chains.
   */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "collateral", type: "address" },
      { indexed: false, name: "whitelisted", type: "bool" },
    ],
    name: "CollateralWhitelisted",
    type: "event",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL ADMIN EVENTS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    anonymous: false,
    inputs: [
      { indexed: false, name: "oldRate", type: "uint256" },
      { indexed: false, name: "newRate", type: "uint256" },
    ],
    name: "ProtocolFeeRateUpdated",
    type: "event",
  },

  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "contractType", type: "string" },
      { indexed: false, name: "oldImplementation", type: "address" },
      { indexed: false, name: "newImplementation", type: "address" },
    ],
    name: "ImplementationUpdated",
    type: "event",
  },

  {
    anonymous: false,
    inputs: [
      { indexed: false, name: "oldBuffer", type: "uint32" },
      { indexed: false, name: "newBuffer", type: "uint32" },
    ],
    name: "MarketCloseBufferUpdated",
    type: "event",
  },
] as const;

