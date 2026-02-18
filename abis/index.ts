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

// Referral Factory - Manages referral campaigns and relationships (NEW)
export { ReferralFactoryAbi } from "./ReferralFactory";

// Referral Campaign - Handles reward distribution with signatures (NEW)
export { ReferralCampaignAbi } from "./ReferralCampaign";

// Dispute Resolver Home - Manages disputes on home chain (Sonic)
export { DisputeResolverHomeAbi } from "./DisputeResolverHome";

// Dispute Resolver Remote - Manages disputes on remote chains (Ethereum, etc.)
export { DisputeResolverRemoteAbi } from "./DisputeResolverRemote";

// =============================================================================
// LAUNCHPAD CONTRACTS
// =============================================================================

// TokensFactory - Creates launchpad tokens with bonding curves
export { TokensFactoryAbi } from "./TokensFactory";

// BondingCurve - Launchpad token trading (dynamic, created by TokensFactory)
export { BondingCurveAbi } from "./BondingCurve";
