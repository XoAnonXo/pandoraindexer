/**
 * TokensFactory ABI
 *
 * Launchpad factory contract for creating pump.fun style tokens with bonding curves.
 * Deployed at: 0x283d0c80Fd94D3d5281FA2904Dcc97Aa397dAfF0 (Sonic)
 *
 * Key features:
 * - Creates tokens with 1B supply and bonding curve mechanism
 * - Tracks graduation to DEX at $50k market cap
 * - Manages token metadata (uri, imageUri, description)
 *
 * Events we listen to:
 * - TokenCreated: New launchpad token created
 * - TokenGraduated: Token reached $50k and graduated to DEX
 * - TokenUriSet/TokenImageUriSet/TokenDescriptionSet: Metadata updates
 */

export const TokensFactoryAbi = [
  // ===========================================================================
  // EVENTS
  // ===========================================================================

  /**
   * Emitted when a new token + bonding curve is created
   */
  {
    type: "event",
    name: "TokenCreated",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "bondingCurve", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
    ],
  },

  /**
   * Emitted when a token graduates to DEX (reaches $50k market cap)
   * Called by BondingCurve.notifyTokenGraduation()
   */
  {
    type: "event",
    name: "TokenGraduated",
    inputs: [
      { name: "token", type: "address", indexed: false },
      { name: "bondingCurve", type: "address", indexed: false },
      { name: "creator", type: "address", indexed: false },
    ],
  },

  /**
   * Emitted when token URI is updated
   */
  {
    type: "event",
    name: "TokenUriSet",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "uri", type: "string", indexed: false },
    ],
  },

  /**
   * Emitted when token image URI is updated
   */
  {
    type: "event",
    name: "TokenImageUriSet",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "imageUri", type: "string", indexed: false },
    ],
  },

  /**
   * Emitted when token description is updated
   */
  {
    type: "event",
    name: "TokenDescriptionSet",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "description", type: "string", indexed: false },
    ],
  },

  /**
   * Emitted when operator approval changes
   */
  {
    type: "event",
    name: "OperatorApproved",
    inputs: [
      { name: "target", type: "address", indexed: true },
      { name: "approved", type: "bool", indexed: false },
    ],
  },

  /**
   * Emitted when router is updated
   */
  {
    type: "event",
    name: "RouterUpdated",
    inputs: [
      { name: "oldRouter", type: "address", indexed: true },
      { name: "newRouter", type: "address", indexed: true },
    ],
  },

  /**
   * Emitted when a token is migrated to a new router
   */
  {
    type: "event",
    name: "TokenMigrated",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "bondingCurve", type: "address", indexed: true },
      { name: "newRouter", type: "address", indexed: true },
    ],
  },

  // ===========================================================================
  // VIEW FUNCTIONS
  // ===========================================================================

  /**
   * Get token info by token address
   */
  {
    type: "function",
    name: "getTokenInfoByToken",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "bondingCurveAddress", type: "address" },
          { name: "creator", type: "address" },
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },

  /**
   * Get token info by bonding curve address
   */
  {
    type: "function",
    name: "getTokenInfoByBondingCurve",
    inputs: [{ name: "bondingCurve", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "bondingCurveAddress", type: "address" },
          { name: "creator", type: "address" },
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },

  /**
   * Get total number of tokens created
   */
  {
    type: "function",
    name: "getTokensCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },

  /**
   * Check if creator has graduated
   */
  {
    type: "function",
    name: "hasGraduated",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },

  /**
   * Get bonding curve address for a creator
   */
  {
    type: "function",
    name: "creatorToBondingCurve",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },

  /**
   * Get token address for a bonding curve
   */
  {
    type: "function",
    name: "bondingCurveToToken",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;
