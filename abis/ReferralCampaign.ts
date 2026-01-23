/**
 * ReferralCampaign ABI
 * 
 * Handles reward distribution via operator signatures with EIP-712 verification.
 * Campaigns are created dynamically by ReferralFactory.
 * 
 * @contract Created by ReferralFactory (0x75527046cE73189a8a3a06d8bfdd09d4643c6A01)
 * @chain Sonic (146)
 * @example First campaign: 0x203d3BCc55a497BDC7cf49e2a1F5BA142230A165
 */
export const ReferralCampaignAbi = [
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
    name: "creator",
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
    name: "version",
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

  // =========================================================================
  // WRITE FUNCTIONS
  // =========================================================================
  {
    type: "function",
    name: "claim",
    inputs: [
      { name: "amount", type: "uint256", internalType: "uint256" },
      { name: "v", type: "uint8", internalType: "uint8" },
      { name: "r", type: "bytes32", internalType: "bytes32" },
      { name: "s", type: "bytes32", internalType: "bytes32" },
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
] as const;





