/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                      PREDICTION ORACLE ABI                                 ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  The Oracle is the entry point for the prediction market system.           ║
 * ║  Users call createPoll() to deploy a new PredictionPoll contract.          ║
 * ║  Operators can resolve polls via the individual poll contracts.            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * LIFECYCLE:
 * ──────────
 * 1. User calls Oracle.createPoll(question, deadline, ...)
 * 2. Oracle deploys new PredictionPoll contract
 * 3. PollCreated event emitted with the new poll address
 * 4. Market can be created for this poll via MarketFactory
 * 5. Operator resolves poll via PredictionPoll.setAnswer()
 * 
 * IMPORTANT FOR INDEXER:
 * ──────────────────────
 * - PollCreated is used as a FACTORY event to track dynamic poll contracts
 * - The pollAddress from this event is used in ponder.config.ts factory pattern
 * - This allows indexing events from all PredictionPoll contracts automatically
 */

export const PredictionOracleAbi = [
  // ═══════════════════════════════════════════════════════════════════════════
  // POLL LIFECYCLE EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * PollCreated - Emitted when a new prediction poll is deployed
   * 
   * This is a FACTORY EVENT - Ponder uses it to discover and index
   * dynamically deployed PredictionPoll contracts.
   * 
   * @param pollAddress - The newly deployed poll contract address (indexed)
   * @param creator - Wallet that created the poll (indexed)
   * @param deadlineEpoch - Unix timestamp when betting closes (uint32)
   * @param question - The yes/no prediction question (string)
   * 
   * @example
   * // When this event fires, Ponder automatically starts indexing
   * // the new poll contract at pollAddress
   */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "pollAddress", type: "address" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "deadlineEpoch", type: "uint32" },
      { indexed: false, name: "question", type: "string" },
    ],
    name: "PollCreated",
    type: "event",
  },
  
  /**
   * PollRefreshed - Emitted when a poll's check epoch is extended
   * 
   * Operators can refresh polls to delay resolution checking.
   * This is useful when more time is needed to verify outcomes.
   * 
   * @param pollAddress - The poll being refreshed (indexed)
   * @param oldCheckEpoch - Previous check timestamp (uint32)
   * @param newCheckEpoch - New check timestamp (uint32)
   * @param wasFree - Whether this was a free refresh (bool)
   */
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "pollAddress", type: "address" },
      { indexed: false, name: "oldCheckEpoch", type: "uint32" },
      { indexed: false, name: "newCheckEpoch", type: "uint32" },
      { indexed: false, name: "wasFree", type: "bool" },
    ],
    name: "PollRefreshed",
    type: "event",
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // OPERATOR MANAGEMENT EVENTS (Not currently indexed)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * OperatorAdded - Emitted when a new operator is authorized
   * Operators can resolve polls and perform administrative actions.
   */
  {
    anonymous: false,
    inputs: [{ indexed: true, name: "operator", type: "address" }],
    name: "OperatorAdded",
    type: "event",
  },
  
  /**
   * OperatorRemoved - Emitted when an operator is de-authorized
   */
  {
    anonymous: false,
    inputs: [{ indexed: true, name: "operator", type: "address" }],
    name: "OperatorRemoved",
    type: "event",
  },
] as const;

