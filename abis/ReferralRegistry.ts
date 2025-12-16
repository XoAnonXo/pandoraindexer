/**
 * ReferralRegistry ABI
 * 
 * Tracks referral codes and referrer-referee relationships.
 * 
 * @contract 0xF3a3930B0FA5D0a53d1204Be1Deea638d939f04f
 * @chain Sonic (146)
 */
export const ReferralRegistryAbi = [
  // Events
  {
    type: "event",
    anonymous: false,
    name: "CodeRegistered",
    inputs: [
      { name: "owner", type: "address", indexed: true, internalType: "address" },
      { name: "codeHash", type: "bytes32", indexed: true, internalType: "bytes32" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "ReferralRegistered",
    inputs: [
      { name: "referee", type: "address", indexed: true, internalType: "address" },
      { name: "referrer", type: "address", indexed: true, internalType: "address" },
      { name: "codeHash", type: "bytes32", indexed: true, internalType: "bytes32" },
    ],
  },
  // View functions
  {
    type: "function",
    name: "getReferrer",
    inputs: [{ name: "user", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getUserCode",
    inputs: [{ name: "user", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCodeOwner",
    inputs: [{ name: "codeHash", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasReferrer",
    inputs: [{ name: "user", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
] as const;

