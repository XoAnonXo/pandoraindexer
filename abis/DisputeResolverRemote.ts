/**
 * DisputeResolverRemote ABI
 *
 * Remote chain dispute resolution contract (Ethereum, etc.).
 * Full dispute logic for remote chain markets, receives votes via LayerZero from home chain.
 * NO ERC721 - cannot verify NFT ownership locally.
 */

export const DisputeResolverRemoteAbi = [
	// =============================================================================
	// EVENTS
	// =============================================================================
	{
		type: "event",
		name: "DisputeCreated",
		inputs: [
			{ name: "disputer", type: "address", indexed: false },
			{ name: "oracle", type: "address", indexed: false },
			{ name: "draftStatus", type: "uint8", indexed: false },
			{ name: "amount", type: "uint256", indexed: false },
			{ name: "marketToken", type: "address", indexed: false },
		],
	},
	{
		type: "event",
		name: "Vote",
		inputs: [
			{ name: "voter", type: "address", indexed: false },
			{ name: "oracle", type: "address", indexed: false },
			{ name: "power", type: "uint256", indexed: false },
			{ name: "status", type: "uint8", indexed: false },
		],
	},
	{
		type: "event",
		name: "DisputeResolved",
		inputs: [
			{ name: "oracle", type: "address", indexed: false },
			{ name: "finalStatus", type: "uint8", indexed: false },
			{ name: "resolver", type: "address", indexed: false },
		],
	},
	{
		type: "event",
		name: "DisputeFailed",
		inputs: [
			{ name: "oracle", type: "address", indexed: false },
			{ name: "disputer", type: "address", indexed: false },
		],
	},
	{
		type: "event",
		name: "VoteRewardClaimed",
		inputs: [
			{ name: "voter", type: "address", indexed: false },
			{ name: "oracle", type: "address", indexed: false },
			{ name: "srcEid", type: "uint32", indexed: false },
			{ name: "tokenId", type: "uint256", indexed: false },
			{ name: "token", type: "address", indexed: false },
			{ name: "reward", type: "uint256", indexed: false },
		],
	},
	{
		type: "event",
		name: "CollateralTaken",
		inputs: [
			{ name: "disputer", type: "address", indexed: false },
			{ name: "oracle", type: "address", indexed: false },
			{ name: "amount", type: "uint256", indexed: false },
			{ name: "marketToken", type: "address", indexed: false },
		],
	},
	{
		type: "event",
		name: "CrossChainVoteReceived",
		inputs: [
			{ name: "voter", type: "address", indexed: true },
			{ name: "oracle", type: "address", indexed: true },
			{ name: "srcChainEid", type: "uint32", indexed: false },
			{ name: "tokenIds", type: "uint256[]", indexed: false },
		],
	},
	{
		type: "event",
		name: "CrossChainClaimReceived",
		inputs: [
			{ name: "claimer", type: "address", indexed: true },
			{ name: "oracle", type: "address", indexed: true },
			{ name: "srcChainEid", type: "uint32", indexed: false },
			{ name: "tokenIds", type: "uint256[]", indexed: false },
		],
	},
	{
		type: "event",
		name: "EmergencyResolved",
		inputs: [
			{ name: "oracle", type: "address", indexed: false },
			{ name: "caller", type: "address", indexed: false },
		],
	},
	// =============================================================================
	// VIEW FUNCTIONS
	// =============================================================================
	{
		type: "function",
		name: "getDisputeInfo",
		inputs: [{ name: "oracle", type: "address" }],
		outputs: [
			{ name: "disputer", type: "address" },
			{ name: "isCollateralTaken", type: "bool" },
			{ name: "state", type: "uint8" },
			{ name: "draftStatus", type: "uint8" },
			{ name: "finalStatus", type: "uint8" },
			{ name: "disputerDeposit", type: "uint256" },
			{ name: "endAt", type: "uint256" },
			{ name: "marketToken", type: "address" },
			{ name: "reason", type: "string" },
		],
		stateMutability: "view",
	},
	{
		type: "function",
		name: "getVoteRecordInfo",
		inputs: [
			{ name: "oracle", type: "address" },
			{ name: "srcEid", type: "uint32" },
			{ name: "tokenId", type: "uint256" },
		],
		outputs: [
			{ name: "power", type: "uint256" },
			{ name: "isClaimed", type: "bool" },
			{ name: "votedFor", type: "uint8" },
		],
		stateMutability: "view",
	},
	{
		type: "function",
		name: "getDisputeCollateral",
		inputs: [{ name: "oracle", type: "address" }],
		outputs: [
			{ name: "collateralAmount", type: "uint256" },
			{ name: "collateralToken", type: "address" },
		],
		stateMutability: "view",
	},
	{
		type: "function",
		name: "getMarketAddress",
		inputs: [{ name: "oracle", type: "address" }],
		outputs: [{ name: "", type: "address" }],
		stateMutability: "view",
	},
	{
		type: "function",
		name: "getVoteCount",
		inputs: [
			{ name: "oracle", type: "address" },
			{ name: "option", type: "uint8" },
		],
		outputs: [{ name: "", type: "uint256" }],
		stateMutability: "view",
	},
	{
		type: "function",
		name: "hasVoted",
		inputs: [
			{ name: "oracle", type: "address" },
			{ name: "srcEid", type: "uint32" },
			{ name: "tokenId", type: "uint256" },
		],
		outputs: [{ name: "", type: "bool" }],
		stateMutability: "view",
	},
] as const;
