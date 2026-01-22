export const BondingCurveAbi = [
  {
    type: "event",
    name: "TokenGraduated",
    inputs: [
      { name: "creator", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "bondingCurve", type: "address", indexed: false },
      { name: "tvlUsd", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Buy",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "nativeAmount", type: "uint256", indexed: false },
      { name: "tokensReceived", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Sell",
    inputs: [
      { name: "seller", type: "address", indexed: true },
      { name: "tokensAmount", type: "uint256", indexed: false },
      { name: "nativeReceived", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "creator",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;
