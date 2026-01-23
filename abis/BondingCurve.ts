/**
 * BondingCurve ABI
 *
 * Implements pump.fun style bonding curve mechanism with graduation to DEX.
 * Each BondingCurve is created dynamically by TokensFactory:TokenCreated event.
 *
 * Key features:
 * - Constant product formula for price discovery
 * - 0.3% swap fee (50% creator, 50% factory)
 * - Automatic graduation to DEX at $50k market cap
 * - Post-graduation trades route through Uniswap V2
 *
 * Events we listen to:
 * - Buy: Token purchases
 * - Sell: Token sales
 * - Graduated: Successful graduation to DEX (internal, pair created)
 * - GraduationFailed: Graduation attempt failed
 * - Migrated: Token migrated to new router
 */

export const BondingCurveAbi = [
  // ===========================================================================
  // EVENTS
  // ===========================================================================

  /**
   * Emitted when tokens are purchased
   */
  {
    type: "event",
    name: "Buy",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "nativeAmount", type: "uint256", indexed: false },
      { name: "tokensReceived", type: "uint256", indexed: false },
    ],
  },

  /**
   * Emitted when tokens are sold
   */
  {
    type: "event",
    name: "Sell",
    inputs: [
      { name: "seller", type: "address", indexed: true },
      { name: "tokensAmount", type: "uint256", indexed: false },
      { name: "nativeReceived", type: "uint256", indexed: false },
    ],
  },

  /**
   * Emitted when token successfully graduates to DEX
   * Note: TokenGraduated event is emitted by Factory, not BondingCurve
   */
  {
    type: "event",
    name: "Graduated",
    inputs: [
      { name: "pair", type: "address", indexed: true },
      { name: "nativeAmount", type: "uint256", indexed: false },
      { name: "tokenAmount", type: "uint256", indexed: false },
    ],
  },

  /**
   * Emitted when graduation fails (e.g., slippage)
   */
  {
    type: "event",
    name: "GraduationFailed",
    inputs: [
      { name: "nativeAmount", type: "uint256", indexed: false },
      { name: "tokenAmount", type: "uint256", indexed: false },
    ],
  },

  /**
   * Emitted when token is migrated to a new router
   */
  {
    type: "event",
    name: "Migrated",
    inputs: [
      { name: "oldPair", type: "address", indexed: true },
      { name: "newPair", type: "address", indexed: true },
      { name: "newRouter", type: "address", indexed: true },
    ],
  },

  // ===========================================================================
  // VIEW FUNCTIONS
  // ===========================================================================

  /**
   * Get creator address
   */
  {
    type: "function",
    name: "creator",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },

  /**
   * Get token contract address
   */
  {
    type: "function",
    name: "token",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },

  /**
   * Get pair address (0 if not graduated)
   */
  {
    type: "function",
    name: "pair",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },

  /**
   * Get factory address
   */
  {
    type: "function",
    name: "factory",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },

  /**
   * Get virtual token reserve
   */
  {
    type: "function",
    name: "virtualTokenReserve",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },

  /**
   * Get virtual native reserve
   */
  {
    type: "function",
    name: "virtualNativeReserve",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },

  /**
   * Get total fees paid
   */
  {
    type: "function",
    name: "totalFeesPaid",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },

  /**
   * Get current market cap in USD (18 decimals)
   */
  {
    type: "function",
    name: "getMarketCap",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },

  /**
   * Get current market cap in native currency
   */
  {
    type: "function",
    name: "getMarketCapNative",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },

  /**
   * Get graduation market cap threshold in native currency
   */
  {
    type: "function",
    name: "GRADUATION_MARKET_CAP_NATIVE",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },

  /**
   * Get bonding curve state
   */
  {
    type: "function",
    name: "getState",
    inputs: [],
    outputs: [
      { name: "_virtualTokenReserve", type: "uint256" },
      { name: "_virtualNativeReserve", type: "uint256" },
      { name: "_tokensSold", type: "uint256" },
      { name: "_totalFeesPaid", type: "uint256" },
      { name: "_isGraduated", type: "bool" },
      { name: "_marketCapUSDFromReserves", type: "uint256" },
    ],
    stateMutability: "view",
  },

  /**
   * Get buy price for token amount
   */
  {
    type: "function",
    name: "getBuyPrice",
    inputs: [{ name: "tokenAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },

  /**
   * Get sell price for token amount
   */
  {
    type: "function",
    name: "getSellPrice",
    inputs: [{ name: "tokenAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },

  /**
   * Total token supply constant
   */
  {
    type: "function",
    name: "TOTAL_SUPPLY",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;
