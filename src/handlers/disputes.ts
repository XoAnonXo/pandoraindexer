/**
 * Dispute Handlers
 *
 * Handles events from DisputeResolverHome (Sonic) and DisputeResolverRemote (Base/others).
 * Tracks dispute creation, voting, resolution, and reward claims.
 */

import { ponder } from "@/generated";
import { getChainName, CHAINS } from "../../config";
import { DisputeResolverHomeAbi } from "../../abis/DisputeResolverHome";

// =============================================================================
// HELPER TYPES
// =============================================================================

interface ChainInfo {
	chainId: number;
	chainName: string;
}

// =============================================================================
// DisputeResolverHome Events (Sonic chain)
// =============================================================================

/**
 * Event: DisputeCreated
 * Emitted when a new dispute is opened against an oracle/poll.
 */
ponder.on(
	"DisputeResolverHome:DisputeCreated",
	async ({ event, context }: any) => {
		const { disputer, oracle, draftStatus, amount, marketToken } =
			event.args;
		const { block } = event;
		const timestamp = block.timestamp;
		const chainId = context.network.chainId;
		const chainName = getChainName(chainId);

		const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
		const normalizedDisputer = disputer.toLowerCase() as `0x${string}`;
		const normalizedToken = marketToken.toLowerCase() as `0x${string}`;
		const disputeId = `${chainId}-${normalizedOracle}`;

		let tokenSymbol = "UNKNOWN";
		let tokenDecimals = 18;

		try {
			const [symbol, decimals] = await Promise.all([
				context.client
					.readContract({
						address: marketToken,
						abi: [
							{
								type: "function",
								name: "symbol",
								inputs: [],
								outputs: [{ type: "string" }],
								stateMutability: "view",
							},
						],
						functionName: "symbol",
					})
					.catch(() => "UNKNOWN"),
				context.client
					.readContract({
						address: marketToken,
						abi: [
							{
								type: "function",
								name: "decimals",
								inputs: [],
								outputs: [{ type: "uint8" }],
								stateMutability: "view",
							},
						],
						functionName: "decimals",
					})
					.catch(() => 18),
			]);

			tokenSymbol = symbol;
			tokenDecimals = Number(decimals);
		} catch (err) {
			console.error(
				`[Dispute] Failed to fetch token info for ${marketToken}:`,
				err
			);
		}

		// Get dispute reason from contract state
		let disputeReason = "";
		try {
			const disputeResolverAddress =
				CHAINS[chainId]?.contracts.disputeResolverHome;
			if (
				disputeResolverAddress &&
				disputeResolverAddress !==
					"0x0000000000000000000000000000000000000000"
			) {
				const disputeInfo = await context.client.readContract({
					address: disputeResolverAddress,
					abi: DisputeResolverHomeAbi,
					functionName: "getDisputeInfo",
					args: [oracle],
				});

				// disputeInfo is a tuple: [disputer, isCollateralTaken, state, draftStatus, finalStatus, disputerDeposit, endAt, marketToken, reason]
				disputeReason = disputeInfo[8] as string;
			}
		} catch (err) {
			console.error(
				`[Dispute] Failed to fetch reason for oracle ${normalizedOracle.slice(
					0,
					10
				)}...:`,
				err
			);
		}

		const endAt = timestamp ? BigInt(timestamp) + 7200n : null;

		await context.db.disputes.create({
			id: disputeId,
			data: {
				chainId,
				oracle: normalizedOracle,
				disputer: normalizedDisputer,
				isCollateralTaken: false,
				state: 1, // Active
				draftStatus: Number(draftStatus),
				finalStatus: 0, // Pending
				disputerDeposit: amount,
				endAt,
				marketToken: normalizedToken,
				marketTokenSymbol: tokenSymbol,
				marketTokenDecimals: tokenDecimals,
				reason: disputeReason,
				votesYes: 0n,
				votesNo: 0n,
				votesUnknown: 0n,
				createdAt: timestamp,
				createdAtBlock: block.number,
			},
		});

		const poll = await context.db.polls.findUnique({
			id: normalizedOracle,
		});
		if (poll) {
			await context.db.polls.update({
				id: normalizedOracle,
				data: {
					disputedBy: normalizedDisputer,
					disputeStake: amount,
					disputedAt: timestamp,
					arbitrationStarted: true,
				},
			});
		}

		console.log(
			`[${chainName}] Dispute created for oracle ${normalizedOracle.slice(
				0,
				10
			)}... by ${normalizedDisputer.slice(0, 10)}... (deposit: ${amount})`
		);
	}
);

/**
 * Event: Vote
 * Emitted when a user votes on a dispute.
 */
ponder.on("DisputeResolverHome:Vote", async ({ event, context }: any) => {
	const { voter, oracle, power, status } = event.args;
	const { block, transaction } = event;
	const timestamp = block.timestamp;
	const chainId = context.network.chainId;
	const chainName = getChainName(chainId);

	const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
	const normalizedVoter = voter.toLowerCase() as `0x${string}`;
	const disputeId = `${chainId}-${normalizedOracle}`;
	const voteId = `${chainId}-${normalizedOracle}-${normalizedVoter}-${transaction.hash}`;

	// Update vote counts in disputes table
	const dispute = await context.db.disputes.findUnique({ id: disputeId });
	if (dispute) {
		const updates: any = {};

		if (status === 1) {
			// Yes
			updates.votesYes = dispute.votesYes + power;
		} else if (status === 2) {
			// No
			updates.votesNo = dispute.votesNo + power;
		} else if (status === 3) {
			// Unknown
			updates.votesUnknown = dispute.votesUnknown + power;
		}

		await context.db.disputes.update({
			id: disputeId,
			data: updates,
		});
	}

	// Create vote record
	await context.db.disputeVotes.create({
		id: voteId,
		data: {
			chainId,
			oracle: normalizedOracle,
			voter: normalizedVoter,
			votedFor: Number(status),
			power,
			votedAt: timestamp,
			votedAtBlock: block.number,
			txHash: transaction.hash as `0x${string}`,
			isCrossChain: false,
		},
	});

	console.log(
		`[${chainName}] Vote cast for oracle ${normalizedOracle.slice(
			0,
			10
		)}... by ${normalizedVoter.slice(
			0,
			10
		)}... (power: ${power}, option: ${status})`
	);
});

/**
 * Event: DisputeResolved
 * Emitted when a dispute is resolved with a final decision.
 */
ponder.on(
	"DisputeResolverHome:DisputeResolved",
	async ({ event, context }: any) => {
		const { oracle, finalStatus, resolver } = event.args;
		const { block } = event;
		const timestamp = block.timestamp;
		const chainId = context.network.chainId;
		const chainName = getChainName(chainId);

		const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
		const normalizedResolver = resolver.toLowerCase() as `0x${string}`;
		const disputeId = `${chainId}-${normalizedOracle}`;

		// Update dispute to resolved state
		const dispute = await context.db.disputes.findUnique({ id: disputeId });
		if (dispute) {
			await context.db.disputes.update({
				id: disputeId,
				data: {
					state: 2, // Resolved
					finalStatus: Number(finalStatus),
					resolvedAt: timestamp,
					resolvedBy: normalizedResolver,
				},
			});
		} else {
			console.warn(
				`[${chainName}] Dispute not found for ${normalizedOracle.slice(0, 10)}..., skipping update`
			);
		}

		// Update poll status (poll may not exist if created before indexer startBlock)
		const poll = await context.db.polls.findUnique({ id: normalizedOracle });
		if (poll) {
			await context.db.polls.update({
				id: normalizedOracle,
				data: {
					status: Number(finalStatus),
					resolvedAt: timestamp,
				},
			});
		} else {
			console.warn(
				`[${chainName}] Poll not found for ${normalizedOracle.slice(0, 10)}..., skipping status update`
			);
		}

		console.log(
			`[${chainName}] Dispute resolved for oracle ${normalizedOracle.slice(
				0,
				10
			)}... (finalStatus: ${finalStatus}, resolver: ${normalizedResolver.slice(
				0,
				10
			)}...)`
		);
	}
);

/**
 * Event: DisputeFailed
 * Emitted when a dispute fails (not enough votes or other conditions).
 */
ponder.on(
	"DisputeResolverHome:DisputeFailed",
	async ({ event, context }: any) => {
		const { oracle, disputer } = event.args;
		const chainId = context.network.chainId;
		const chainName = getChainName(chainId);

		const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
		const disputeId = `${chainId}-${normalizedOracle}`;

		// Update dispute to failed state
		const dispute = await context.db.disputes.findUnique({ id: disputeId });
		if (dispute) {
			await context.db.disputes.update({
				id: disputeId,
				data: {
					state: 3, // Failed
				},
			});
		} else {
			console.warn(
				`[${chainName}] Dispute not found for ${normalizedOracle.slice(0, 10)}..., skipping fail update`
			);
		}

		console.log(
			`[${chainName}] Dispute failed for oracle ${normalizedOracle.slice(
				0,
				10
			)}...`
		);
	}
);

/**
 * Event: VoteRewardClaimed
 * Emitted when a voter claims their rewards from a resolved dispute.
 */
ponder.on(
	"DisputeResolverHome:VoteRewardClaimed",
	async ({ event, context }: any) => {
		const { voter, oracle, tokenId, token, reward } = event.args;
		const { timestamp, block, transaction } = event;
		const chainId = context.network.chainId;
		const chainName = getChainName(chainId);

		const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
		const normalizedVoter = voter.toLowerCase() as `0x${string}`;
		const normalizedToken = token.toLowerCase() as `0x${string}`;
		const claimId = `${chainId}-${normalizedOracle}-${tokenId}-${transaction.hash}`;

		// Get vote record info to determine what this NFT voted for
		let votedFor = 0; // Default to Pending
		try {
			const voteRecord = await context.client.readContract({
				address: CHAINS[chainId]?.contracts.disputeResolverHome,
				abi: DisputeResolverHomeAbi,
				functionName: "getVoteRecordInfo",
				args: [oracle, tokenId],
			});

			// voteRecord is a tuple: [power, isClaimed, votedFor]
			votedFor = Number(voteRecord[2]);
		} catch (err) {
			console.error(
				`[Dispute] Failed to fetch vote record for token ${tokenId}:`,
				err
			);
		}

		await context.db.disputeRewardClaims.create({
			id: claimId,
			data: {
				chainId,
				oracle: normalizedOracle,
				tokenId,
				claimer: normalizedVoter,
				rewardToken: normalizedToken,
				rewardAmount: reward,
				votedFor,
				claimedAt: timestamp,
				claimedAtBlock: block.number,
				txHash: transaction.hash as `0x${string}`,
			},
		});

		console.log(
			`[${chainName}] Reward claimed: ${reward} ${normalizedToken.slice(
				0,
				10
			)}... for token ${tokenId} by ${normalizedVoter.slice(0, 10)}...`
		);
	}
);

/**
 * Event: CollateralTaken
 * Emitted when disputer's collateral is taken (penalty).
 */
ponder.on(
	"DisputeResolverHome:CollateralTaken",
	async ({ event, context }: any) => {
		const { oracle } = event.args;
		const chainId = context.network.chainId;
		const chainName = getChainName(chainId);

		const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
		const disputeId = `${chainId}-${normalizedOracle}`;

		// Update dispute collateral status
		const dispute = await context.db.disputes.findUnique({ id: disputeId });
		if (dispute) {
			await context.db.disputes.update({
				id: disputeId,
				data: {
					isCollateralTaken: true,
				},
			});
		} else {
			console.warn(
				`[${chainName}] Dispute not found for ${normalizedOracle.slice(0, 10)}..., skipping collateral update`
			);
		}

		console.log(
			`[${chainName}] Collateral taken for oracle ${normalizedOracle.slice(
				0,
				10
			)}...`
		);
	}
);

/**
 * Event: RemoteVoteSent
 * Emitted when a vote is sent to a remote chain via LayerZero.
 */
ponder.on(
	"DisputeResolverHome:RemoteVoteSent",
	async ({ event, context }: any) => {
		const { voter, oracle, dstChainEid, tokenIds } = event.args;
		const chainId = context.network.chainId;
		const chainName = getChainName(chainId);

		console.log(
			`[${chainName}] Remote vote sent to EID ${dstChainEid} for oracle ${oracle.slice(
				0,
				10
			)}... by ${voter.slice(0, 10)}... (${tokenIds.length} NFTs)`
		);
	}
);

/**
 * Event: RemoteClaimSent
 * Emitted when a claim request is sent to a remote chain via LayerZero.
 */
ponder.on(
	"DisputeResolverHome:RemoteClaimSent",
	async ({ event, context }: any) => {
		const { claimer, oracle, dstChainEid, tokenIds } = event.args;
		const chainId = context.network.chainId;
		const chainName = getChainName(chainId);

		console.log(
			`[${chainName}] Remote claim sent to EID ${dstChainEid} for oracle ${oracle.slice(
				0,
				10
			)}... by ${claimer.slice(0, 10)}... (${tokenIds.length} NFTs)`
		);
	}
);
