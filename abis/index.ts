/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                          ABI EXPORTS                                       ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Central export point for all contract ABIs used by the Ponder indexer.    ║
 * ║  These ABIs define the event signatures that Ponder listens for.           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * CONTRACT ARCHITECTURE:
 * ──────────────────────
 * 
 *   ┌─────────────────────┐
 *   │  PredictionOracle   │  ◄── Creates polls (prediction questions)
 *   └──────────┬──────────┘
 *              │ Deploys via PollCreated event
 *              ▼
 *   ┌─────────────────────┐
 *   │   PredictionPoll    │  ◄── Individual poll contract (yes/no question)
 *   └─────────────────────┘      Resolved via AnswerSet event
 *              │
 *              │ Linked to
 *              ▼
 *   ┌─────────────────────┐
 *   │   MarketFactory     │  ◄── Creates markets for polls
 *   └──────────┬──────────┘
 *              │ Deploys via MarketCreated/PariMutuelCreated
 *              ▼
 *   ┌─────────────────────────────────────────────┐
 *   │                                             │
 *   │   ┌─────────────────┐  ┌─────────────────┐  │
 *   │   │  PredictionAMM  │  │PredictionPariMut│  │  ◄── Trading contracts
 *   │   │  (AMM Market)   │  │uel (Pool Market)│  │
 *   │   └─────────────────┘  └─────────────────┘  │
 *   │                                             │
 *   └─────────────────────────────────────────────┘
 * 
 * @module abis
 */

// Core Oracle Contract - Entry point for poll creation
export { PredictionOracleAbi } from "./PredictionOracle";

// Individual Poll Contract - Deployed per prediction question
export { PredictionPollAbi } from "./PredictionPoll";

// Market Factory - Deploys trading markets linked to polls
export { MarketFactoryAbi } from "./MarketFactory";

// AMM Market - Automated Market Maker with constant product formula
export { PredictionAMMAbi } from "./PredictionAMM";

// PariMutuel Market - Pool-based betting with shared winnings
export { PredictionPariMutuelAbi } from "./PredictionPariMutuel";

// Referral Registry - Tracks referral codes and relationships
export { ReferralRegistryAbi } from "./ReferralRegistry";

// Campaign Factory - Creates and manages reward campaigns
export { CampaignFactoryAbi } from "./CampaignFactory";
