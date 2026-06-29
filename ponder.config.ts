/**
 * Ponder Configuration - Anymarket Prediction Markets
 *
 * Compatible with Ponder ^0.16.0.
 *
 * @see https://ponder.sh/docs/getting-started/new-project
 */

import { createConfig, factory } from "ponder";

// =============================================================================
// CONTRACT ABIS
// =============================================================================

import { PredictionOracleAbi } from "./abis/PredictionOracle";
import { PredictionPollAbi } from "./abis/PredictionPoll";
import { MarketFactoryAbi } from "./abis/MarketFactory";
import { PredictionAMMAbi } from "./abis/PredictionAMM";
import { PredictionPariMutuelAbi } from "./abis/PredictionPariMutuel";
import { ReferralFactoryAbi } from "./abis/ReferralFactory";
import { ReferralCampaignAbi } from "./abis/ReferralCampaign";
import { DisputeResolverRemoteAbi } from "./abis/DisputeResolverRemote";
// import { TokensFactoryAbi } from "./abis/TokensFactory";
// import { BondingCurveAbi } from "./abis/BondingCurve";

// =============================================================================
// CHAIN CONFIGURATION
// =============================================================================

import { CHAINS } from "./config";

const ethereum = CHAINS[1];
const rpcUrl = process.env.PONDER_RPC_URL_1 ?? ethereum.rpcUrls[0];
const fallbackRpcUrls = ethereum.rpcUrls.filter((url) => url !== rpcUrl);

// =============================================================================
// STARTUP LOG
// =============================================================================
console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║           PONDER INDEXER — RESOLVED CONFIGURATION          ║");
console.log("╠══════════════════════════════════════════════════════════════╣");
console.log(`║  Chain:            ${ethereum.name} (id: ${ethereum.chainId})`);
console.log(`║  RPC:              ${rpcUrl}`);
console.log(`║  Fallback RPCs:    ${fallbackRpcUrls.length > 0 ? fallbackRpcUrls.join(", ") : "none"}`);
console.log(`║  Start Block:      ${ethereum.startBlock}`);
console.log("╠══════════════════════════════════════════════════════════════╣");
console.log(`║  Oracle:           ${ethereum.contracts.oracle}`);
console.log(`║  MarketFactory:    ${ethereum.contracts.marketFactory}`);
console.log(`║  USDC:             ${ethereum.contracts.usdc}`);
console.log(`║  Vault:            ${ethereum.contracts.vault ?? "—"}`);
console.log(`║  DisputeRemote:    ${ethereum.contracts.disputeResolverRemote ?? "—"}`);
console.log(`║  ReferralFactory:  ${ethereum.contracts.referralFactory ?? "—"}`);
console.log(`║  LaunchpadFactory: ${ethereum.contracts.launchpadFactory ?? "—"}`);
console.log("╚══════════════════════════════════════════════════════════════╝\n");

// =============================================================================
// CONFIGURATION
// =============================================================================

export default createConfig({
	database: {
		kind: "postgres",
		poolConfig: {
			max: 30,
			connectionTimeoutMillis: 10_000,
			idleTimeoutMillis: 30_000,
		},
	},

	chains: {
		ethereum: {
			id: 1,
			rpc: rpcUrl,
			pollingInterval: 6_000,
			maxRequestsPerSecond: 400,
		},
	},

	contracts: {
		PredictionOracle: {
			chain: "ethereum",
			abi: PredictionOracleAbi,
			address: ethereum.contracts.oracle,
			startBlock: ethereum.startBlock,
		},

		PredictionPoll: {
			chain: "ethereum",
			abi: PredictionPollAbi,
			address: factory({
				address: ethereum.contracts.oracle,
				event: PredictionOracleAbi.find((e) => e.type === "event" && e.name === "PollCreated")!,
				parameter: "pollAddress",
			}),
			startBlock: ethereum.startBlock,
		},

		MarketFactory: {
			chain: "ethereum",
			abi: MarketFactoryAbi,
			address: ethereum.contracts.marketFactory,
			startBlock: ethereum.startBlock,
		},

		PredictionAMM: {
			chain: "ethereum",
			abi: PredictionAMMAbi,
			address: factory({
				address: ethereum.contracts.marketFactory,
				event: MarketFactoryAbi.find((e) => e.type === "event" && e.name === "MarketCreated")!,
				parameter: "marketAddress",
			}),
			startBlock: ethereum.startBlock,
		},

		PredictionPariMutuel: {
			chain: "ethereum",
			abi: PredictionPariMutuelAbi,
			address: factory({
				address: ethereum.contracts.marketFactory,
				event: MarketFactoryAbi.find((e) => e.type === "event" && e.name === "PariMutuelCreated")!,
				parameter: "marketAddress",
			}),
			startBlock: ethereum.startBlock,
		},

		ReferralFactory: {
			chain: "ethereum",
			abi: ReferralFactoryAbi,
			address: ethereum.contracts.referralFactory!,
			startBlock: ethereum.startBlock,
		},

		ReferralCampaign: {
			chain: "ethereum",
			abi: ReferralCampaignAbi,
			address: factory({
				address: ethereum.contracts.referralFactory!,
				event: ReferralFactoryAbi.find(
					(e): e is Extract<typeof e, { type: "event" }> =>
						e.type === "event" && "name" in e && e.name === "CampaignCreated",
				)!,
				parameter: "campaign",
			}),
			startBlock: ethereum.startBlock,
		},

		...(ethereum.contracts.disputeResolverRemote
			? {
					DisputeResolverRemote: {
						chain: "ethereum" as const,
						abi: DisputeResolverRemoteAbi,
						address: ethereum.contracts.disputeResolverRemote,
						startBlock: ethereum.startBlock,
					},
				}
			: {}),
	},
});
