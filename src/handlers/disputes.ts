/**
 * Dispute Handlers
 *
 * Handles events from DisputeResolverRemote (for remote chains like Ethereum).
 * Tracks dispute creation, voting, resolution, and reward claims.
 *
 * Note: DisputeResolverHome is only on Sonic (home chain).
 * This file handles DisputeResolverRemote events for Ethereum and other remote chains.
 */

import { ponder } from "@/generated";
import { getChainName, CHAINS } from "../../config";
import { DisputeResolverRemoteAbi } from "../../abis/DisputeResolverRemote";

// =============================================================================
// HELPER TYPES
// =============================================================================

interface ChainInfo {
  chainId: number;
  chainName: string;
}

interface ContractDisputeInfo {
  state: number;
  finalStatus: number;
  isCollateralTaken: boolean;
  endAt: bigint | null;
  reason: string;
}

/**
 * Read dispute state directly from the contract via getDisputeInfo.
 * Returns authoritative on-chain values for state, finalStatus, etc.
 */
async function readDisputeFromContract(
  context: any,
  chainId: number,
  oracle: `0x${string}`,
  blockNumber?: bigint
): Promise<ContractDisputeInfo | null> {
  const addr = CHAINS[chainId]?.contracts.disputeResolverRemote;
  if (!addr || addr === "0x0000000000000000000000000000000000000000") return null;

  try {
    const info = await context.client.readContract({
      address: addr,
      abi: DisputeResolverRemoteAbi,
      functionName: "getDisputeInfo",
      args: [oracle],
      ...(blockNumber ? { blockNumber } : {}),
    });
    // tuple: [disputer, isCollateralTaken, state, draftStatus, finalStatus, disputerDeposit, endAt, marketToken, reason]
    return {
      isCollateralTaken: info[1] as boolean,
      state: Number(info[2]),
      finalStatus: Number(info[4]),
      endAt: BigInt(info[6]),
      reason: info[8] as string,
    };
  } catch (err) {
    console.error(`[Dispute] Failed to read contract state for ${(oracle as string).slice(0, 10)}...:`, err);
    return null;
  }
}

// =============================================================================
// DisputeResolverRemote Events (for Ethereum and other remote chains)
// =============================================================================

/**
 * Event: DisputeCreated
 * Emitted when a new dispute is opened against an oracle/poll.
 */

ponder.on(
  "DisputeResolverRemote:DisputeCreated",
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

    const contractInfo = await readDisputeFromContract(context, chainId, oracle, block.number);

    await context.db.disputes.create({
      id: disputeId,
      data: {
        chainId,
        oracle: normalizedOracle,
        disputer: normalizedDisputer,
        isCollateralTaken: contractInfo?.isCollateralTaken ?? false,
        state: contractInfo?.state ?? 1,
        draftStatus: Number(draftStatus),
        finalStatus: contractInfo?.finalStatus ?? 0,
        disputerDeposit: amount,
        endAt: contractInfo?.endAt ?? null,
        marketToken: normalizedToken,
        marketTokenSymbol: tokenSymbol,
        marketTokenDecimals: tokenDecimals,
        reason: contractInfo?.reason ?? "",
        voteCount: 0,
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
 * tokenIds are not in this event — they come from CrossChainVoteReceived
 * in the same transaction. We create the vote record here, then
 * CrossChainVoteReceived updates it with tokenIds.
 */
ponder.on("DisputeResolverRemote:Vote", async ({ event, context }: any) => {
  const { voter, oracle, power, status } = event.args;
  const { block, transaction } = event;
  const timestamp = block.timestamp;
  const chainId = context.network.chainId;
  const chainName = getChainName(chainId);

  const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
  const normalizedVoter = voter.toLowerCase() as `0x${string}`;
  const disputeId = `${chainId}-${normalizedOracle}`;
  const voteId = `${chainId}-${normalizedOracle}-${normalizedVoter}-${transaction.hash}`;

  const dispute = await context.db.disputes.findUnique({ id: disputeId });
  if (dispute) {
    const updates: any = { voteCount: dispute.voteCount + 1 };

    if (status === 1) {
      updates.votesYes = dispute.votesYes + power;
    } else if (status === 2) {
      updates.votesNo = dispute.votesNo + power;
    } else if (status === 3) {
      updates.votesUnknown = dispute.votesUnknown + power;
    }

    await context.db.disputes.update({
      id: disputeId,
      data: updates,
    });
  }

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
    `[${chainName}] Vote: ${normalizedVoter.slice(0, 10)}... on ${normalizedOracle.slice(0, 10)}... (power: ${power}, option: ${status})`
  );
});

/**
 * Event: DisputeResolved
 * Emitted when a dispute is resolved with a final decision.
 */
ponder.on(
  "DisputeResolverRemote:DisputeResolved",
  async ({ event, context }: any) => {
    const { oracle, finalStatus, resolver } = event.args;
    const { block } = event;
    const timestamp = block.timestamp;
    const chainId = context.network.chainId;
    const chainName = getChainName(chainId);

    const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
    const normalizedResolver = resolver.toLowerCase() as `0x${string}`;
    const disputeId = `${chainId}-${normalizedOracle}`;

    const contractInfo = await readDisputeFromContract(context, chainId, oracle, block.number);
    const resolvedState = contractInfo?.state ?? 2;
    const resolvedFinalStatus = contractInfo?.finalStatus ?? Number(finalStatus);

    const dispute = await context.db.disputes.findUnique({ id: disputeId });
    if (dispute) {
      await context.db.disputes.update({
        id: disputeId,
        data: {
          state: resolvedState,
          finalStatus: resolvedFinalStatus,
          isCollateralTaken: contractInfo?.isCollateralTaken ?? dispute.isCollateralTaken,
          resolvedAt: timestamp,
          resolvedBy: normalizedResolver,
        },
      });
    } else {
      console.warn(
        `[${chainName}] Dispute not found for ${normalizedOracle.slice(0, 10)}..., skipping resolve (DisputeCreated event missing)`
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
  "DisputeResolverRemote:DisputeFailed",
  async ({ event, context }: any) => {
    const { oracle, disputer } = event.args;
    const { block } = event;
    const chainId = context.network.chainId;
    const chainName = getChainName(chainId);

    const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
    const disputeId = `${chainId}-${normalizedOracle}`;

    const contractInfo = await readDisputeFromContract(context, chainId, oracle, block.number);
    const failedState = contractInfo?.state ?? 3;

    const dispute = await context.db.disputes.findUnique({ id: disputeId });
    if (dispute) {
      await context.db.disputes.update({
        id: disputeId,
        data: {
          state: failedState,
          isCollateralTaken: contractInfo?.isCollateralTaken ?? dispute.isCollateralTaken,
          finalStatus: contractInfo?.finalStatus ?? dispute.finalStatus,
        },
      });
    } else {
      console.warn(
        `[${chainName}] Dispute not found for ${normalizedOracle.slice(0, 10)}..., skipping fail (DisputeCreated event missing)`
      );
    }

    console.log(
      `[${chainName}] Dispute failed for oracle ${normalizedOracle.slice(
        0,
        10
      )}... (contract state: ${failedState})`
    );
  }
);

/**
 * Event: VoteRewardClaimed
 * Emitted when a voter claims their rewards from a resolved dispute.
 */
ponder.on(
  "DisputeResolverRemote:VoteRewardClaimed",
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
        address: CHAINS[chainId]?.contracts.disputeResolverRemote,
        abi: DisputeResolverRemoteAbi,
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
  "DisputeResolverRemote:CollateralTaken",
  async ({ event, context }: any) => {
    const { oracle } = event.args;
    const { block } = event;
    const chainId = context.network.chainId;
    const chainName = getChainName(chainId);

    const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
    const disputeId = `${chainId}-${normalizedOracle}`;

    const contractInfo = await readDisputeFromContract(context, chainId, oracle, block.number);

    const dispute = await context.db.disputes.findUnique({ id: disputeId });
    if (dispute) {
      await context.db.disputes.update({
        id: disputeId,
        data: {
          isCollateralTaken: true,
          state: contractInfo?.state ?? dispute.state,
          finalStatus: contractInfo?.finalStatus ?? dispute.finalStatus,
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
 * Event: CrossChainVoteReceived
 * Emitted in the same tx as Vote when a vote arrives via LayerZero.
 * Updates the vote record created by the Vote handler with tokenIds and cross-chain info.
 */
ponder.on(
  "DisputeResolverRemote:CrossChainVoteReceived",
  async ({ event, context }: any) => {
    const { voter, oracle, srcChainEid, tokenIds } = event.args;
    const { transaction } = event;
    const chainId = context.network.chainId;
    const chainName = getChainName(chainId);

    const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
    const normalizedVoter = voter.toLowerCase() as `0x${string}`;
    const voteId = `${chainId}-${normalizedOracle}-${normalizedVoter}-${transaction.hash}`;

    const tokenIdStrings = tokenIds.map((id: bigint) => id.toString());

    const existing = await context.db.disputeVotes.findUnique({ id: voteId });
    if (existing) {
      await context.db.disputeVotes.update({
        id: voteId,
        data: {
          isCrossChain: true,
          sourceChainEid: Number(srcChainEid),
          tokenIds: JSON.stringify(tokenIdStrings),
        },
      });
    }

    console.log(
      `[${chainName}] CrossChainVote: ${normalizedVoter.slice(0, 10)}... on ${normalizedOracle.slice(0, 10)}... (EID: ${srcChainEid}, NFTs: [${tokenIdStrings.join(",")}])`
    );
  }
);

/**
 * Event: CrossChainClaimReceived
 * Emitted when a claim request is received from home chain via LayerZero.
 */
ponder.on(
  "DisputeResolverRemote:CrossChainClaimReceived",
  async ({ event, context }: any) => {
    const { claimer, oracle, srcChainEid, tokenIds } = event.args;
    const chainId = context.network.chainId;
    const chainName = getChainName(chainId);

    console.log(
      `[${chainName}] Cross-chain claim received from EID ${srcChainEid} for oracle ${oracle.slice(
        0,
        10
      )}... by ${claimer.slice(0, 10)}... (${tokenIds.length} NFTs)`
    );
  }
);
