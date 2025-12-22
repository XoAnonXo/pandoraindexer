/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                       PREDICTION POLL ABI                                  ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Individual poll contract - deployed dynamically by PredictionOracle.      ║
 * ║  Each poll represents a single yes/no prediction question.                 ║
 * ║  Resolution determines which side wins and triggers market settlement.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * POLL STATUS VALUES:
 * ───────────────────
 *   0 = Pending   - Poll is active, not yet resolved
 *   1 = Yes       - Poll resolved to YES outcome
 *   2 = No        - Poll resolved to NO outcome
 *   3 = Unknown   - Poll resolved as invalid/voided (refund scenario)
 *
 * RESOLUTION FLOW:
 * ────────────────
 * 1. Poll created (status = 0 Pending)
 * 2. Users trade on linked markets
 * 3. Deadline passes (betting closes)
 * 4. Finalization period (24 hours for disputes)
 * 5. Operator calls setAnswer() → AnswerSet event
 * 6. Users can redeem winnings from linked markets
 *
 * IMPORTANT FOR INDEXER:
 * ──────────────────────
 * - This is a DYNAMIC contract (many instances, one per poll)
 * - Ponder discovers these via PollCreated factory event
 * - AnswerSet triggers poll status update and enables winnings redemption
 * - Poll contracts are proxies - actual logic is in implementation contract
 */

export const PredictionPollAbi = [
	// ═══════════════════════════════════════════════════════════════════════════
	// RESOLUTION EVENTS
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * AnswerSet - CRITICAL EVENT: Poll resolution
	 *
	 * Emitted when an operator sets the final outcome of a poll.
	 * This determines which side (YES/NO) wins in linked markets.
	 *
	 * After this event:
	 * - Poll status changes from Pending (0) to resolved (1/2/3)
	 * - Winners can call WinningsRedeemed on linked markets
	 * - 24-hour finalization period must pass before redemptions
	 *
	 * @param status - Final poll status: 1=Yes, 2=No, 3=Unknown (uint8)
	 * @param setter - Operator who resolved the poll (indexed)
	 * @param reason - Human-readable resolution explanation (string)
	 *
	 * @example
	 * // status = 1: YES wins, NO token holders lose
	 * // status = 2: NO wins, YES token holders lose
	 * // status = 3: Market voided, proportional refunds
	 */
	{
		type: "event",
		name: "AnswerSet",
		inputs: [
			{ name: "status", type: "uint8", indexed: false },
			{ name: "setter", type: "address", indexed: true },
			{ name: "reason", type: "string", indexed: false },
		],
	},

	// ═══════════════════════════════════════════════════════════════════════════
	// DISPUTE EVENTS
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * ArbitrationStarted - Dispute mechanism triggered
	 *
	 * Users can dispute a poll resolution by staking tokens.
	 * This pauses winnings redemption until dispute is resolved.
	 *
	 * @param requester - User who started arbitration (indexed)
	 * @param reason - Explanation for the dispute (string)
	 * @param stake - Amount staked for the dispute (uint256)
	 */
	{
		type: "event",
		name: "ArbitrationStarted",
		inputs: [
			{ name: "requester", type: "address", indexed: true },
			{ name: "reason", type: "string", indexed: false },
			{ name: "stake", type: "uint256", indexed: false },
		],
	},

	// ═══════════════════════════════════════════════════════════════════════════
	// VIEW FUNCTIONS (verified from bytecode extraction)
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * getPollData() - Returns all poll data in a single call
	 *
	 * This is the main function to get poll data.
	 * Returns a tuple with:
	 * - question (string)
	 * - rules (string)
	 * - sources (string[])
	 * - creator (address)
	 * - arbiter (address)
	 * - category (uint8)
	 * - deadlineEpoch (uint32)
	 * - finalizationEpoch (uint32)
	 * - status (uint8) - PollStatus enum
	 * - resolutionReason (string)
	 */
	{
		inputs: [],
		name: "getPollData",
		outputs: [
			{
				components: [
					{ name: "question", type: "string" },
					{ name: "rules", type: "string" },
					{ name: "sources", type: "string[]" },
					{ name: "creator", type: "address" },
					{ name: "arbiter", type: "address" },
					{ name: "status", type: "uint8" },
					{ name: "category", type: "uint8" },
					{ name: "finalizationEpoch", type: "uint32" },
					{ name: "deadlineEpoch", type: "uint32" },
					{ name: "resolutionReason", type: "string" },
				],
				type: "tuple",
			},
		],
		stateMutability: "view",
		type: "function",
	},

	/**
	 * getStatus() - Returns the poll status
	 * 0=Pending, 1=Yes, 2=No, 3=Unknown
	 */
	{
		type: "function",
		name: "getStatus",
		inputs: [],
		outputs: [{ name: "", type: "uint8" }],
		stateMutability: "view",
	},

	/**
	 * getCreator() - Returns the poll creator address
	 */
	{
		type: "function",
		name: "getCreator",
		inputs: [],
		outputs: [{ name: "", type: "address" }],
		stateMutability: "view",
	},

	/**
	 * getPollType() - Returns the poll type
	 */
	{
		type: "function",
		name: "getPollType",
		inputs: [],
		outputs: [{ name: "", type: "uint8" }],
		stateMutability: "view",
	},

	/**
	 * getArbiter() - Returns the arbiter address
	 */
	{
		type: "function",
		name: "getArbiter",
		inputs: [],
		outputs: [{ name: "", type: "address" }],
		stateMutability: "view",
	},

	/**
	 * startArbitration() - Start a dispute for this poll
	 */
	{
		type: "function",
		name: "startArbitration",
		inputs: [],
		outputs: [],
		stateMutability: "nonpayable",
	},
] as const;
