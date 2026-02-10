/**
 * ReferralFactory ABI
 *
 * Manages referral campaigns, referral codes, and referee-referrer relationships.
 *
 * Updated: Uses bytes signature instead of v,r,s components.
 *
 * @chain Sonic (146)
 */
export const ReferralFactoryAbi = [
  // =========================================================================
  // EVENTS
  // =========================================================================
  {
    type: "event",
    anonymous: false,
    name: "CampaignCreated",
    inputs: [
      { name: "campaign", type: "address", indexed: false, internalType: "address" },
      { name: "rewardToken", type: "address", indexed: false, internalType: "address" },
      { name: "operator", type: "address", indexed: false, internalType: "address" },
      { name: "campaignType", type: "uint256", indexed: false, internalType: "uint256" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "ReferralRegistered",
    inputs: [
      { name: "referrer", type: "address", indexed: false, internalType: "address" },
      { name: "referee", type: "address", indexed: false, internalType: "address" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "ReferralCodeRegistered",
    inputs: [
      { name: "referrer", type: "address", indexed: false, internalType: "address" },
      { name: "codeHash", type: "bytes32", indexed: false, internalType: "bytes32" },
      { name: "code", type: "string", indexed: false, internalType: "string" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "OwnershipTransferred",
    inputs: [
      { name: "previousOwner", type: "address", indexed: true, internalType: "address" },
      { name: "newOwner", type: "address", indexed: true, internalType: "address" },
    ],
  },

  // =========================================================================
  // VIEW FUNCTIONS
  // =========================================================================
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "referrals",
    inputs: [{ name: "referee", type: "address", internalType: "address" }],
    outputs: [{ name: "referrer", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "referralCodes",
    inputs: [{ name: "codeHash", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "referrer", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isCampaign",
    inputs: [{ name: "campaign", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReferrer",
    inputs: [{ name: "_user", type: "address", internalType: "address" }],
    outputs: [{ name: "referrer", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReferrerByCode",
    inputs: [{ name: "code", type: "string", internalType: "string" }],
    outputs: [{ name: "referrer", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReferrerCodes",
    inputs: [{ name: "referrer", type: "address", internalType: "address" }],
    outputs: [{ name: "codeHashes", type: "bytes32[]", internalType: "bytes32[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReferrerCodesCount",
    inputs: [{ name: "referrer", type: "address", internalType: "address" }],
    outputs: [{ name: "count", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReferralCount",
    inputs: [{ name: "_referrer", type: "address", internalType: "address" }],
    outputs: [{ name: "count", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReferees",
    inputs: [
      { name: "_referrer", type: "address", internalType: "address" },
      { name: "offset", type: "uint256", internalType: "uint256" },
      { name: "limit", type: "uint256", internalType: "uint256" },
    ],
    outputs: [
      { name: "total", type: "uint256", internalType: "uint256" },
      { name: "referees", type: "address[]", internalType: "address[]" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "campaignCount",
    inputs: [],
    outputs: [{ name: "count", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCampaigns",
    inputs: [
      { name: "offset", type: "uint256", internalType: "uint256" },
      { name: "limit", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "campaigns", type: "address[]", internalType: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "REGISTER_REFERRAL_TYPEHASH",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_REFERRAL_CODE_LENGTH",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_CODES_PER_REFERRER",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_BATCH_REGISTRATIONS",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },

  // =========================================================================
  // WRITE FUNCTIONS
  // =========================================================================
  {
    type: "function",
    name: "createCampaign",
    inputs: [
      { name: "_rewardToken", type: "address", internalType: "address" },
      { name: "_operator", type: "address", internalType: "address" },
      { name: "_campaignType", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "campaign", type: "address", internalType: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "registerReferralCode",
    inputs: [{ name: "code", type: "string", internalType: "string" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "registerReferral",
    inputs: [
      { name: "user", type: "address", internalType: "address" },
      { name: "referralCodeHash", type: "bytes32", internalType: "bytes32" },
      { name: "signature", type: "bytes", internalType: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "registerReferralBatch",
    inputs: [
      { name: "users", type: "address[]", internalType: "address[]" },
      { name: "referralCodeHashes", type: "bytes32[]", internalType: "bytes32[]" },
      { name: "signatures", type: "bytes[]", internalType: "bytes[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferOwnership",
    inputs: [{ name: "newOwner", type: "address", internalType: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "renounceOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // =========================================================================
  // ERRORS
  // =========================================================================
  {
    type: "error",
    name: "CampaignNotFound",
    inputs: [],
  },
  {
    type: "error",
    name: "AlreadyReferred",
    inputs: [],
  },
  {
    type: "error",
    name: "SelfReferral",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidReferrer",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidSignature",
    inputs: [],
  },
  {
    type: "error",
    name: "ReferralCodeAlreadyTaken",
    inputs: [],
  },
  {
    type: "error",
    name: "ReferralCodeNotFound",
    inputs: [],
  },
  {
    type: "error",
    name: "ReferralCodeTooLong",
    inputs: [],
  },
  {
    type: "error",
    name: "TooManyReferralCodes",
    inputs: [],
  },
  {
    type: "error",
    name: "BatchUserAlreadyReferred",
    inputs: [
      { name: "index", type: "uint256", internalType: "uint256" },
      { name: "user", type: "address", internalType: "address" },
    ],
  },
  {
    type: "error",
    name: "BatchReferralCodeNotFound",
    inputs: [
      { name: "index", type: "uint256", internalType: "uint256" },
      { name: "user", type: "address", internalType: "address" },
      { name: "codeHash", type: "bytes32", internalType: "bytes32" },
    ],
  },
  {
    type: "error",
    name: "BatchSelfReferral",
    inputs: [
      { name: "index", type: "uint256", internalType: "uint256" },
      { name: "user", type: "address", internalType: "address" },
    ],
  },
  {
    type: "error",
    name: "BatchInvalidSignature",
    inputs: [
      { name: "index", type: "uint256", internalType: "uint256" },
      { name: "user", type: "address", internalType: "address" },
      { name: "signer", type: "address", internalType: "address" },
    ],
  },
  {
    type: "error",
    name: "OwnableUnauthorizedAccount",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
  },
  {
    type: "error",
    name: "OwnableInvalidOwner",
    inputs: [{ name: "owner", type: "address", internalType: "address" }],
  },
] as const;
