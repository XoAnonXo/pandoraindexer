#!/usr/bin/env ts-node

/**
 * Standalone CLI script to test poll data fetching logic
 * Tests the same logic as src/handlers/oracle.ts lines 23-40
 *
 * Usage:
 *   npm run ts-node scripts/test-poll-data.ts <pollAddress>
 *
 * Example:
 *   npm run ts-node scripts/test-poll-data.ts 0x8faf689cBc0728Af87639fbC56AaBD08E10Ac69e
 */

import { createPublicClient, http } from "viem";
import { PredictionPollAbi } from "../abis/PredictionPoll.js";

// Sonic RPC endpoint
const RPC_URL = "https://rpc.soniclabs.com";

// Create the client (same as in oracle.ts)
const latestClient = createPublicClient({
	transport: http(RPC_URL),
});

async function testPollData(pollAddress: `0x${string}`) {
	console.log(`\n🔍 Testing poll data for: ${pollAddress}`);
	console.log(`🌐 RPC: ${RPC_URL}\n`);

	try {
		// Same logic as oracle.ts lines 23-40
		const pollData = await latestClient.readContract({
			address: pollAddress,
			abi: PredictionPollAbi,
			functionName: "getPollData",
		});

		// Extract fields same way as oracle.ts
		const category = Number(pollData.category);
		const rules = (pollData.rules || "").slice(0, 4096);
		const sources = JSON.stringify(pollData.sources || []);
		const checkEpoch = Number(pollData.finalizationEpoch);

		// Additional data from getPollData tuple
		const question = pollData.question;
		const creator = pollData.creator;
		const arbiter = pollData.arbiter;
		const deadlineEpoch = pollData.deadlineEpoch;
		const finalizationEpoch = pollData.finalizationEpoch;
		const status = pollData.status;
		const resolutionReason = pollData.resolutionReason;

		// Log results
		console.log("Poll data fetched successfully!");
		console.log("─".repeat(60));
		console.log(`Question: ${question}`);
		console.log(`Category: ${category}`);
		console.log(`Rules: ${rules}`);
		console.log(`Sources: ${sources}`);
		console.log(`Check Epoch: ${checkEpoch}`);
		console.log(`Creator: ${creator}`);
		console.log(`Arbiter: ${arbiter}`);
		console.log(`Deadline Epoch: ${deadlineEpoch}`);
		console.log(`Finalization Epoch: ${finalizationEpoch}`);
		console.log(`Status: ${status}`);
		console.log(`Resolution Reason: ${resolutionReason || "None"}`);

		// Special logging for the Will Smith poll (same as oracle.ts)
		if (
			question ===
			"Will Will Smith & Jada Pinkett Smith announce separation by Dec 28, 2025?"
		) {
			console.log(`\n🎬 Will Smith poll category: ${category}`);
		}

		console.log("─".repeat(60));
	} catch (err) {
		console.error(`Error getting poll data for ${pollAddress}:`, err);

		// Additional error logging for Will Smith poll
		try {
			const statusData = await latestClient.readContract({
				address: pollAddress,
				abi: PredictionPollAbi,
				functionName: "getStatus",
			});
			console.log(`ℹPoll status: ${statusData}`);
		} catch (statusErr) {
			console.log(`Could not get status either: ${statusErr.message}`);
		}
	}
}

async function main() {
	const pollAddress = process.argv[2] as `0x${string}`;

	if (!pollAddress) {
		console.error(
			"Usage: npm run ts-node scripts/test-poll-data.ts <pollAddress>"
		);
		console.error(
			"Example: npm run ts-node scripts/test-poll-data.ts 0x8faf689cBc0728Af87639fbC56AaBD08E10Ac69e"
		);
		process.exit(1);
	}

	// Basic address validation
	if (!pollAddress.startsWith("0x") || pollAddress.length !== 42) {
		console.error(
			"Invalid poll address format. Must be 0x followed by 40 hex characters"
		);
		process.exit(1);
	}

	try {
		await testPollData(pollAddress);
	} catch (err) {
		console.error("Unexpected error:", err);
		process.exit(1);
	}
}

main();
