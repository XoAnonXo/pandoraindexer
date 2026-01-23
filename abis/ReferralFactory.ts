/**
 * ReferralFactory ABI
 * 
 * Manages referral campaigns and referee-referrer relationships with signature verification.
 * 
 * @contract 0x75527046cE73189a8a3a06d8bfdd09d4643c6A01
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
      { name: "version", type: "uint256", indexed: false, internalType: "uint256" },
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

  // =========================================================================
  // VIEW FUNCTIONS
  // =========================================================================
  {
    type: "function",
    name: "creator",
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
    name: "getAllCampaigns",
    inputs: [],
    outputs: [{ name: "campaigns", type: "address[]", internalType: "address[]" }],
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

  // =========================================================================
  // WRITE FUNCTIONS
  // =========================================================================
  {
    type: "function",
    name: "createCampaign",
    inputs: [
      { name: "_rewardToken", type: "address", internalType: "address" },
      { name: "_operator", type: "address", internalType: "address" },
      { name: "_version", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "campaign", type: "address", internalType: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "registerReferral",
    inputs: [
      { name: "_referrer", type: "address", internalType: "address" },
      { name: "_referee", type: "address", internalType: "address" },
      { name: "v", type: "uint8", internalType: "uint8" },
      { name: "r", type: "bytes32", internalType: "bytes32" },
      { name: "s", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;





