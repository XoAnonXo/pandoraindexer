/**
 * PredictionPoll ABI
 * 
 * Individual poll contract created by the Oracle.
 * Each poll represents a yes/no question that can be resolved.
 * 
 * Key Events:
 * - AnswerSet: When a poll is resolved (Yes/No/Unknown)
 * - ArbitrationStarted: When arbitration is requested
 */

export const PredictionPollAbi = [
  // CRITICAL: Poll resolution event
  {
    type: "event",
    name: "AnswerSet",
    inputs: [
      { name: "status", type: "uint8", indexed: false },
      { name: "setter", type: "address", indexed: true },
      { name: "reason", type: "string", indexed: false },
    ],
  },

  // Arbitration event
  {
    type: "event",
    name: "ArbitrationStarted",
    inputs: [
      { name: "requester", type: "address", indexed: true },
      { name: "reason", type: "string", indexed: false },
      { name: "stake", type: "uint256", indexed: false },
    ],
  },
] as const;

