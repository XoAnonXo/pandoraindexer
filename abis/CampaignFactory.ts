/**
 * CampaignFactory ABI
 * 
 * Creates and manages reward campaigns for the referral system.
 * 
 * @contract 0xcc83403203607Ba4DfbeC42d6Af0606363F80617
 * @chain Sonic (146)
 */
export const CampaignFactoryAbi = [
  // Events
  {
    type: "event",
    anonymous: false,
    name: "CampaignCreated",
    inputs: [
      { name: "campaignId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "creator", type: "address", indexed: true, internalType: "address" },
      { name: "rewardAsset", type: "address", indexed: true, internalType: "address" },
      { name: "assetKind", type: "uint8", indexed: false, internalType: "uint8" },
      { name: "rewardPool", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "startTime", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "endTime", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "rewardType", type: "uint8", indexed: false, internalType: "uint8" },
      { name: "rewardConfig", type: "bytes", indexed: false, internalType: "bytes" },
      { name: "name", type: "string", indexed: false, internalType: "string" },
      { name: "description", type: "string", indexed: false, internalType: "string" },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "CampaignStatusChanged",
    inputs: [
      { name: "campaignId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "status", type: "uint8", indexed: false, internalType: "uint8" },
    ],
  },
  // View functions
  {
    type: "function",
    name: "campaignCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCampaign",
    inputs: [{ name: "campaignId", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct ICampaignFactory.Campaign",
        components: [
          { name: "creator", type: "address", internalType: "address" },
          { name: "updater", type: "address", internalType: "address" },
          { name: "rewardAsset", type: "address", internalType: "address" },
          { name: "assetKind", type: "uint8", internalType: "uint8" },
          { name: "rewardPool", type: "uint256", internalType: "uint256" },
          { name: "rewardsPaid", type: "uint256", internalType: "uint256" },
          { name: "startTime", type: "uint256", internalType: "uint256" },
          { name: "endTime", type: "uint256", internalType: "uint256" },
          { name: "rewardType", type: "uint8", internalType: "uint8" },
          { name: "rewardConfig", type: "bytes", internalType: "bytes" },
          { name: "status", type: "uint8", internalType: "uint8" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

