/**
 * PONDER DATABASE SCHEMA
 *
 * Defines all database tables for the Anymarket prediction markets indexer.
 * All tables include chainId/chainName for multi-chain support.
 *
 * Ponder 0.16+ uses onchainTable (Drizzle-based).
 * hex columns are stored as TEXT (not BYTEA).
 * Columns are nullable by default; use .notNull() for required fields.
 *
 * @see https://ponder.sh/docs/schema
 */

import { onchainTable } from "ponder";

// ===========================================================================
// ORACLE FEE EVENTS
// ===========================================================================

export const oracleFeeEvents = onchainTable("oracleFeeEvents", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	chainName: t.text().notNull(),
	oracleAddress: t.hex().notNull(),
	eventName: t.text().notNull(),
	newFee: t.bigint(),
	to: t.hex(),
	amount: t.bigint(),
	txHash: t.hex().notNull(),
	blockNumber: t.bigint().notNull(),
	timestamp: t.bigint().notNull(),
}));

// ===========================================================================
// EVENTS TABLE (off-chain, synced from pandora-api)
// ===========================================================================

export const events = onchainTable("events", (t) => ({
	id: t.text().primaryKey(),
	title: t.text().notNull(),
	creator: t.text().notNull(),
	marketType: t.text().notNull(),
	arbiter: t.text().notNull(),
	sources: t.text().notNull(),
	category: t.integer().notNull(),
	feeTier: t.integer(),
	maxPriceImbalance: t.integer(),
	curveFlattener: t.integer(),
	curveOffset: t.integer(),
	pollAddresses: t.text().notNull(),
	marketAddresses: t.text().notNull(),
	status: t.text().notNull(),
	marketCount: t.integer().notNull(),
	createdAt: t.text().notNull(),
}));

// ===========================================================================
// POLLS TABLE
// ===========================================================================

export const polls = onchainTable("polls", (t) => ({
	id: t.hex().primaryKey(),
	chainId: t.integer().notNull(),
	chainName: t.text().notNull(),
	creator: t.hex().notNull(),
	arbiter: t.hex(),
	question: t.text().notNull(),
	rules: t.text().notNull(),
	sources: t.text().notNull(),
	deadlineEpoch: t.integer().notNull(),
	finalizationEpoch: t.integer().notNull(),
	checkEpoch: t.integer().notNull(),
	lastRefreshWasFree: t.boolean(),
	lastRefreshOldCheckEpoch: t.integer(),
	arbitrationStarted: t.boolean().notNull(),
	category: t.integer().notNull(),
	status: t.integer().notNull(),
	resolutionReason: t.text(),
	setter: t.hex(),
	disputedBy: t.hex(),
	disputeReason: t.text(),
	disputeStake: t.bigint(),
	disputedAt: t.bigint(),
	resolvedAt: t.bigint(),
	preDisputeStatus: t.integer(),
	preDisputeResolutionReason: t.text(),
	eventId: t.text(),
	displayTitle: t.text(),
	topicSlug: t.text(),
	maxMarketTvl: t.bigint(),
	totalMarketsTvl: t.bigint(),
	createdAtBlock: t.bigint().notNull(),
	createdAt: t.bigint().notNull(),
	createdTxHash: t.hex().notNull(),
}));

// ===========================================================================
// MARKETS TABLE
// ===========================================================================

export const markets = onchainTable("markets", (t) => ({
	id: t.hex().primaryKey(),
	chainId: t.integer().notNull(),
	chainName: t.text().notNull(),
	pollAddress: t.hex().notNull(),
	isIncomplete: t.boolean().notNull(),
	creator: t.hex().notNull(),
	marketType: t.text().notNull(),
	collateralToken: t.hex().notNull(),
	yesToken: t.hex(),
	noToken: t.hex(),
	feeTier: t.integer(),
	maxPriceImbalancePerHour: t.integer(),
	curveFlattener: t.integer(),
	curveOffset: t.integer(),
	marketStartTimestamp: t.bigint(),
	marketCloseTimestamp: t.bigint(),
	totalVolume: t.bigint().notNull(),
	volume24h: t.bigint().notNull(),
	trades24h: t.integer().notNull(),
	totalTrades: t.integer().notNull(),
	currentTvl: t.bigint().notNull(),
	uniqueTraders: t.integer().notNull(),
	initialLiquidity: t.bigint().notNull(),
	reserveYes: t.bigint(),
	reserveNo: t.bigint(),
	totalHold: t.bigint(),
	creatorFeesEarned: t.bigint().notNull(),
	platformFeesEarned: t.bigint().notNull(),
	totalCollateralYes: t.bigint(),
	totalCollateralNo: t.bigint(),
	totalSharesYes: t.bigint(),
	totalSharesNo: t.bigint(),
	yesChance: t.bigint(),
	eventId: t.text(),
	numericId: t.integer(),
	createdAtBlock: t.bigint().notNull(),
	createdAt: t.bigint().notNull(),
	createdTxHash: t.hex().notNull(),
}));

// ===========================================================================
// MARKET ID COUNTER (singleton)
// ===========================================================================

export const marketIdCounter = onchainTable("marketIdCounter", (t) => ({
	id: t.text().primaryKey(),
	nextId: t.integer().notNull(),
}));

// ===========================================================================
// TRADES TABLE
// ===========================================================================

export const trades = onchainTable("trades", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	chainName: t.text().notNull(),
	trader: t.hex().notNull(),
	marketAddress: t.hex().notNull(),
	pollAddress: t.hex().notNull(),
	tradeType: t.text().notNull(),
	side: t.text().notNull(),
	collateralAmount: t.bigint().notNull(),
	tokenAmount: t.bigint(),
	feeAmount: t.bigint().notNull(),
	buyPrice: t.bigint(),
	tokenAmountOut: t.bigint(),
	txHash: t.hex().notNull(),
	blockNumber: t.bigint().notNull(),
	timestamp: t.bigint().notNull(),
}));

// ===========================================================================
// PRICE TICKS TABLE
// ===========================================================================

export const priceTicks = onchainTable("priceTicks", (t) => ({
	id: t.text().primaryKey(),
	marketAddress: t.hex().notNull(),
	timestamp: t.bigint().notNull(),
	seq: t.bigint().notNull(),
	yesPrice: t.bigint().notNull(),
	volume: t.bigint().notNull(),
	side: t.text().notNull(),
	tradeType: t.text().notNull(),
	txHash: t.hex().notNull(),
	blockNumber: t.bigint().notNull(),
}));

// ===========================================================================
// CANDLES TABLES
// ===========================================================================

export const candles1m = onchainTable("candles1m", (t) => ({
	id: t.text().primaryKey(),
	marketAddress: t.hex().notNull(),
	bucketStart: t.bigint().notNull(),
	open: t.bigint().notNull(),
	high: t.bigint().notNull(),
	low: t.bigint().notNull(),
	close: t.bigint().notNull(),
	volume: t.bigint().notNull(),
	trades: t.integer().notNull(),
	firstSeq: t.bigint().notNull(),
	lastSeq: t.bigint().notNull(),
}));

export const candles5m = onchainTable("candles5m", (t) => ({
	id: t.text().primaryKey(),
	marketAddress: t.hex().notNull(),
	bucketStart: t.bigint().notNull(),
	open: t.bigint().notNull(),
	high: t.bigint().notNull(),
	low: t.bigint().notNull(),
	close: t.bigint().notNull(),
	volume: t.bigint().notNull(),
	trades: t.integer().notNull(),
	firstSeq: t.bigint().notNull(),
	lastSeq: t.bigint().notNull(),
}));

export const candles1h = onchainTable("candles1h", (t) => ({
	id: t.text().primaryKey(),
	marketAddress: t.hex().notNull(),
	bucketStart: t.bigint().notNull(),
	open: t.bigint().notNull(),
	high: t.bigint().notNull(),
	low: t.bigint().notNull(),
	close: t.bigint().notNull(),
	volume: t.bigint().notNull(),
	trades: t.integer().notNull(),
	firstSeq: t.bigint().notNull(),
	lastSeq: t.bigint().notNull(),
}));

export const candles1d = onchainTable("candles1d", (t) => ({
	id: t.text().primaryKey(),
	marketAddress: t.hex().notNull(),
	bucketStart: t.bigint().notNull(),
	open: t.bigint().notNull(),
	high: t.bigint().notNull(),
	low: t.bigint().notNull(),
	close: t.bigint().notNull(),
	volume: t.bigint().notNull(),
	trades: t.integer().notNull(),
	firstSeq: t.bigint().notNull(),
	lastSeq: t.bigint().notNull(),
}));

// ===========================================================================
// USERS TABLE
// ===========================================================================

export const users = onchainTable("users", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	chainName: t.text().notNull(),
	address: t.hex().notNull(),
	totalTrades: t.integer().notNull(),
	totalVolume: t.bigint().notNull(),
	totalDeposited: t.bigint().notNull(),
	totalWithdrawn: t.bigint().notNull(),
	totalWinnings: t.bigint().notNull(),
	realizedPnL: t.bigint().notNull(),
	totalWins: t.integer().notNull(),
	totalLosses: t.integer().notNull(),
	currentStreak: t.integer().notNull(),
	bestStreak: t.integer().notNull(),
	marketsCreated: t.integer().notNull(),
	pollsCreated: t.integer().notNull(),
	totalCreatorFees: t.bigint().notNull(),
	referrerAddress: t.hex(),
	referralCodeHash: t.hex(),
	totalReferrals: t.integer().notNull(),
	totalReferralVolume: t.bigint().notNull(),
	totalReferralExitVolume: t.bigint().notNull(),
	totalReferralFees: t.bigint().notNull(),
	totalReferralRewards: t.bigint().notNull(),
	referredAt: t.bigint(),
	firstTradeAt: t.bigint(),
	lastTradeAt: t.bigint(),
}));

// ===========================================================================
// MARKET USERS TABLE
// ===========================================================================

export const marketUsers = onchainTable("marketUsers", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	marketAddress: t.hex().notNull(),
	user: t.hex().notNull(),
	lastTradeAt: t.bigint().notNull(),
}));

// ===========================================================================
// WINNINGS TABLE
// ===========================================================================

export const winnings = onchainTable("winnings", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	chainName: t.text().notNull(),
	user: t.hex().notNull(),
	marketAddress: t.hex().notNull(),
	collateralAmount: t.bigint().notNull(),
	feeAmount: t.bigint().notNull(),
	yesTokenAmount: t.bigint(),
	noTokenAmount: t.bigint(),
	yesCostBasis: t.bigint(),
	noCostBasis: t.bigint(),
	side: t.text(),
	pollStatus: t.integer(),
	marketQuestion: t.text(),
	marketType: t.text().notNull(),
	outcome: t.integer(),
	txHash: t.hex().notNull(),
	timestamp: t.bigint().notNull(),
}));

// ===========================================================================
// POSITION HISTORY TABLE
// ===========================================================================

export const positionHistory = onchainTable("positionHistory", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	user: t.hex().notNull(),
	marketAddress: t.hex().notNull(),
	pollAddress: t.hex(),
	marketQuestion: t.text(),
	marketType: t.text().notNull(),
	side: t.text().notNull(),
	result: t.text().notNull(),
	pollStatus: t.integer().notNull(),
	yesCostBasis: t.bigint().notNull(),
	noCostBasis: t.bigint().notNull(),
	yesTokens: t.bigint().notNull(),
	noTokens: t.bigint().notNull(),
	collateralReceived: t.bigint().notNull(),
	feeAmount: t.bigint().notNull(),
	pnl: t.bigint().notNull(),
	resolvedAt: t.bigint().notNull(),
	txHash: t.hex(),
}));

// ===========================================================================
// LIQUIDITY EVENTS TABLE
// ===========================================================================

export const liquidityEvents = onchainTable("liquidityEvents", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	chainName: t.text().notNull(),
	provider: t.hex().notNull(),
	marketAddress: t.hex().notNull(),
	pollAddress: t.hex().notNull(),
	eventType: t.text().notNull(),
	collateralAmount: t.bigint().notNull(),
	lpTokens: t.bigint().notNull(),
	yesTokenAmount: t.bigint(),
	noTokenAmount: t.bigint(),
	yesTokensReturned: t.bigint(),
	noTokensReturned: t.bigint(),
	txHash: t.hex().notNull(),
	timestamp: t.bigint().notNull(),
}));

// ===========================================================================
// PLATFORM STATS TABLE
// ===========================================================================

export const platformStats = onchainTable("platformStats", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	chainName: t.text().notNull(),
	totalPolls: t.integer().notNull(),
	totalPollsResolved: t.integer().notNull(),
	totalMarkets: t.integer().notNull(),
	totalAmmMarkets: t.integer().notNull(),
	totalPariMarkets: t.integer().notNull(),
	totalTrades: t.integer().notNull(),
	totalUsers: t.integer().notNull(),
	totalVolume: t.bigint().notNull(),
	totalLiquidity: t.bigint().notNull(),
	totalFees: t.bigint().notNull(),
	totalWinningsPaid: t.bigint().notNull(),
	totalPlatformFeesEarned: t.bigint().notNull(),
	lastUpdatedAt: t.bigint().notNull(),
	resyncVersion: t.integer(),
}));

// ===========================================================================
// DAILY STATS TABLE
// ===========================================================================

export const dailyStats = onchainTable("dailyStats", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	chainName: t.text().notNull(),
	dayTimestamp: t.bigint().notNull(),
	pollsCreated: t.integer().notNull(),
	marketsCreated: t.integer().notNull(),
	tradesCount: t.integer().notNull(),
	volume: t.bigint().notNull(),
	winningsPaid: t.bigint().notNull(),
	newUsers: t.integer().notNull(),
	activeUsers: t.integer().notNull(),
}));

// ===========================================================================
// HOURLY STATS TABLE
// ===========================================================================

export const hourlyStats = onchainTable("hourlyStats", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	chainName: t.text().notNull(),
	hourTimestamp: t.bigint().notNull(),
	tradesCount: t.integer().notNull(),
	volume: t.bigint().notNull(),
	uniqueTraders: t.integer().notNull(),
}));

// ===========================================================================
// REFERRAL CODES TABLE
// ===========================================================================

export const referralCodes = onchainTable("referralCodes", (t) => ({
	id: t.hex().primaryKey(),
	ownerAddress: t.hex().notNull(),
	code: t.text().notNull(),
	totalReferrals: t.integer().notNull(),
	totalVolumeGenerated: t.bigint().notNull(),
	totalFeesGenerated: t.bigint().notNull(),
	createdAt: t.bigint().notNull(),
	createdAtBlock: t.bigint().notNull(),
}));

// ===========================================================================
// REFERRALS TABLE
// ===========================================================================

export const referrals = onchainTable("referrals", (t) => ({
	id: t.text().primaryKey(),
	referrerAddress: t.hex().notNull(),
	refereeAddress: t.hex().notNull(),
	referralCodeHash: t.hex(),
	status: t.text().notNull(),
	totalVolumeGenerated: t.bigint().notNull(),
	totalExitVolumeGenerated: t.bigint().notNull(),
	totalFeesGenerated: t.bigint().notNull(),
	totalTradesCount: t.integer().notNull(),
	totalRewardsEarned: t.bigint().notNull(),
	referredAt: t.bigint().notNull(),
	referredAtBlock: t.bigint().notNull(),
	firstTradeAt: t.bigint(),
	lastTradeAt: t.bigint(),
}));

// ===========================================================================
// REFERRAL STATS TABLE
// ===========================================================================

export const referralStats = onchainTable("referralStats", (t) => ({
	id: t.text().primaryKey(),
	totalCodes: t.integer().notNull(),
	totalReferrals: t.integer().notNull(),
	totalVolumeGenerated: t.bigint().notNull(),
	totalFeesGenerated: t.bigint().notNull(),
	totalRewardsDistributed: t.bigint().notNull(),
	updatedAt: t.bigint().notNull(),
}));

// ===========================================================================
// CAMPAIGNS TABLE
// ===========================================================================

export const campaigns = onchainTable("campaigns", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	chainName: t.text().notNull(),
	operator: t.hex().notNull(),
	rewardToken: t.hex().notNull(),
	campaignType: t.bigint().notNull(),
	status: t.integer().notNull(),
	createdAtBlock: t.bigint().notNull(),
	createdAt: t.bigint().notNull(),
	createdTxHash: t.hex().notNull(),
}));

// ===========================================================================
// CAMPAIGN STATS TABLE
// ===========================================================================

export const campaignStats = onchainTable("campaignStats", (t) => ({
	id: t.text().primaryKey(),
	totalCampaigns: t.integer().notNull(),
	activeCampaigns: t.integer().notNull(),
	updatedAt: t.bigint().notNull(),
}));

// ===========================================================================
// DISPUTES TABLE
// ===========================================================================

export const disputes = onchainTable("disputes", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	oracle: t.hex().notNull(),
	disputer: t.hex().notNull(),
	isCollateralTaken: t.boolean().notNull(),
	state: t.integer().notNull(),
	draftStatus: t.integer().notNull(),
	finalStatus: t.integer().notNull(),
	disputerDeposit: t.bigint().notNull(),
	endAt: t.bigint().notNull(),
	marketToken: t.hex().notNull(),
	marketTokenSymbol: t.text().notNull(),
	marketTokenDecimals: t.integer().notNull(),
	reason: t.text().notNull(),
	voteCount: t.integer().notNull(),
	votesYes: t.bigint().notNull(),
	votesNo: t.bigint().notNull(),
	votesUnknown: t.bigint().notNull(),
	createdAt: t.bigint().notNull(),
	createdAtBlock: t.bigint().notNull(),
	resolvedAt: t.bigint(),
	resolvedBy: t.hex(),
}));

// ===========================================================================
// DISPUTE VOTES TABLE
// ===========================================================================

export const disputeVotes = onchainTable("disputeVotes", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	oracle: t.hex().notNull(),
	voter: t.hex().notNull(),
	votedFor: t.integer().notNull(),
	power: t.bigint().notNull(),
	votedAt: t.bigint().notNull(),
	votedAtBlock: t.bigint().notNull(),
	txHash: t.hex().notNull(),
	isCrossChain: t.boolean().notNull(),
	sourceChainEid: t.integer(),
	tokenIds: t.text(),
}));

// ===========================================================================
// DISPUTE REWARD CLAIMS TABLE
// ===========================================================================

export const disputeRewardClaims = onchainTable("disputeRewardClaims", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	oracle: t.hex().notNull(),
	tokenId: t.bigint().notNull(),
	claimer: t.hex().notNull(),
	rewardToken: t.hex().notNull(),
	rewardAmount: t.bigint().notNull(),
	votedFor: t.integer().notNull(),
	claimedAt: t.bigint().notNull(),
	claimedAtBlock: t.bigint().notNull(),
	txHash: t.hex().notNull(),
}));

// ===========================================================================
// GRADUATED CREATORS TABLE (Launchpad)
// ===========================================================================

export const graduatedCreators = onchainTable("graduatedCreators", (t) => ({
	id: t.hex().primaryKey(),
	tokenAddress: t.hex().notNull(),
	bondingCurveAddress: t.hex().notNull(),
	graduatedAtBlock: t.bigint().notNull(),
	graduatedAt: t.bigint().notNull(),
	graduatedTxHash: t.hex().notNull(),
	referralFactoryAddress: t.hex(),
	status: t.text().notNull(),
}));

// ===========================================================================
// MARKET SYSTEMS TABLE
// ===========================================================================

export const marketSystems = onchainTable("marketSystems", (t) => ({
	id: t.hex().primaryKey(),
	creator: t.hex().notNull(),
	system: t.text().notNull(),
	switchedAt: t.bigint(),
}));

// ===========================================================================
// TOKEN SYSTEMS TABLE
// ===========================================================================

export const tokenSystems = onchainTable("tokenSystems", (t) => ({
	id: t.hex().primaryKey(),
	creator: t.hex().notNull(),
	system: t.text().notNull(),
	switchedAt: t.bigint(),
}));

// ===========================================================================
// LAUNCHPAD TOKENS TABLE
// ===========================================================================

export const launchpadTokens = onchainTable("launchpadTokens", (t) => ({
	id: t.hex().primaryKey(),
	creator: t.hex().notNull(),
	bondingCurveAddress: t.hex().notNull(),
	name: t.text().notNull(),
	symbol: t.text().notNull(),
	uri: t.text(),
	imageUri: t.text(),
	description: t.text(),
	currentTvlNative: t.bigint().notNull(),
	isGraduated: t.boolean().notNull(),
	createdAt: t.bigint().notNull(),
	createdAtBlock: t.bigint().notNull(),
	graduatedAt: t.bigint(),
	graduatedAtBlock: t.bigint(),
}));

// ===========================================================================
// LAUNCHPAD TRADES TABLE
// ===========================================================================

export const launchpadTrades = onchainTable("launchpadTrades", (t) => ({
	id: t.text().primaryKey(),
	bondingCurveAddress: t.hex().notNull(),
	trader: t.hex().notNull(),
	tradeType: t.text().notNull(),
	nativeAmount: t.bigint().notNull(),
	tokenAmount: t.bigint().notNull(),
	fee: t.bigint().notNull(),
	timestamp: t.bigint().notNull(),
	blockNumber: t.bigint().notNull(),
	processedForReferral: t.boolean().notNull(),
}));

// ===========================================================================
// USER MARKET POSITIONS TABLE
// ===========================================================================

export const userMarketPositions = onchainTable("userMarketPositions", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	marketAddress: t.hex().notNull(),
	pollAddress: t.hex().notNull(),
	user: t.hex().notNull(),
	yesAmount: t.bigint().notNull(),
	noAmount: t.bigint().notNull(),
	yesTokens: t.bigint().notNull(),
	noTokens: t.bigint().notNull(),
	hasRedeemed: t.boolean().notNull(),
	lossRecorded: t.boolean().notNull(),
	firstPositionAt: t.bigint().notNull(),
	lastUpdatedAt: t.bigint().notNull(),
}));

// ===========================================================================
// USER LIQUIDITY POSITIONS TABLE
// ===========================================================================

export const userLiquidityPositions = onchainTable("userLiquidityPositions", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	marketAddress: t.hex().notNull(),
	pollAddress: t.hex().notNull(),
	user: t.hex().notNull(),
	lpTokens: t.bigint().notNull(),
	totalCollateralDeposited: t.bigint().notNull(),
	totalCollateralWithdrawn: t.bigint().notNull(),
	yesTokensReceived: t.bigint().notNull(),
	noTokensReceived: t.bigint().notNull(),
	initialYesChance: t.bigint().notNull(),
	weightedYesChanceSum: t.bigint().notNull(),
	addCount: t.integer().notNull(),
	removeCount: t.integer().notNull(),
	firstAddAt: t.bigint().notNull(),
	lastUpdatedAt: t.bigint().notNull(),
}));

// ===========================================================================
// CLAIM EVENTS TABLE
// ===========================================================================

// ===========================================================================
// DAILY ACTIVE USERS TABLE
// ===========================================================================

export const dailyActiveUsers = onchainTable("dailyActiveUsers", (t) => ({
	id: t.text().primaryKey(),
	chainId: t.integer().notNull(),
	dayTimestamp: t.bigint().notNull(),
	user: t.hex().notNull(),
	firstActivityAt: t.bigint().notNull(),
	tradesCount: t.integer().notNull(),
}));

// ===========================================================================
// CLAIM EVENTS TABLE
// ===========================================================================

export const claimEvents = onchainTable("claimEvents", (t) => ({
	id: t.text().primaryKey(),
	campaignAddress: t.hex().notNull(),
	userAddress: t.hex().notNull(),
	amount: t.bigint().notNull(),
	signature: t.hex().notNull(),
	blockNumber: t.bigint().notNull(),
	timestamp: t.bigint().notNull(),
	txHash: t.hex().notNull(),
}));
