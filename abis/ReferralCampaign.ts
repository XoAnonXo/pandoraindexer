/**
 * ReferralCampaign ABI
 *
 * Handles reward distribution via operator signatures with EIP-712 verification.
 * Campaigns are created dynamically by ReferralFactory.
 *
 * Updated: Uses bytes signature instead of v,r,s components.
 *
 * @contract Created by ReferralFactory
 * @chain Sonic (146)
 */
export const ReferralCampaignAbi = [
  // =========================================================================
  // EVENTS
  // =========================================================================
  {
    type: "event",
    anonymous: false,
    name: "Claimed",
    inputs: [
      { name: "user", type: "address", indexed: false, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "signature", type: "bytes", indexed: false, internalType: "bytes" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "ClaimedBatch",
    inputs: [
      { name: "user", type: "address", indexed: false, internalType: "address" },
      { name: "totalAmount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "claimCount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "signatures", type: "bytes[]", indexed: false, internalType: "bytes[]" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "Withdrawn",
    inputs: [
      { name: "token", type: "address", indexed: false, internalType: "address" },
      { name: "to", type: "address", indexed: false, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
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
    name: "factory",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "operator",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "rewardToken",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "campaignType",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nonces",
    inputs: [{ name: "owner", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
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
    name: "CLAIM_TYPEHASH",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_BATCH_SIZE",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },

  // =========================================================================
  // WRITE FUNCTIONS
  // =========================================================================
  {
    type: "function",
    name: "claim",
    inputs: [
      { name: "amount", type: "uint256", internalType: "uint256" },
      { name: "signature", type: "bytes", internalType: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimBatch",
    inputs: [
      { name: "amounts", type: "uint256[]", internalType: "uint256[]" },
      { name: "signatures", type: "bytes[]", internalType: "bytes[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [{ name: "_token", type: "address", internalType: "address" }],
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
    name: "ERC2612InvalidSigner",
    inputs: [
      { name: "signer", type: "address", internalType: "address" },
      { name: "expected", type: "address", internalType: "address" },
    ],
  },
  {
    type: "error",
    name: "InvalidAccountNonce",
    inputs: [
      { name: "account", type: "address", internalType: "address" },
      { name: "currentNonce", type: "uint256", internalType: "uint256" },
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
