/**
 * Dispute Handlers
 *
 * Handles events from both DisputeResolverRemote and DisputeResolverHome contracts.
 * Tracks dispute creation, voting, resolution, and reward claims.
 *
 * Both contracts share identical event signatures for common operations,
 * so we use shared handler functions to avoid code duplication.
 */

import { ponder } from "@/generated";
import { getChainName, CHAINS } from "../../config";
import { DisputeResolverRemoteAbi } from "../../abis/DisputeResolverRemote";
import { DisputeResolverHomeAbi } from "../../abis/DisputeResolverHome";

// =============================================================================
// HELPER TYPES
// =============================================================================

type ContractType = "home" | "remote";

interface ContractDisputeInfo {
  state: number;
  finalStatus: number;
  isCollateralTaken: boolean;
  endAt: bigint | null;
  reason: string;
}

/**
 * Get the contract address based on contract type.
 */
function getContractAddress(
  chainId: number,
  contractType: ContractType
): `0x${string}` | undefined {
  const chain = CHAINS[chainId];
  if (!chain) return undefined;

  return contractType === "home"
    ? chain.contracts.disputeResolverHome
    : chain.contracts.disputeResolverRemote;
}

/**
 * Get the ABI based on contract type.
 */
function getContractAbi(contractType: ContractType) {
  return contractType === "home"
    ? DisputeResolverHomeAbi
    : DisputeResolverRemoteAbi;
}

/**
 * Read dispute state directly from the contract via getDisputeInfo.
 * Returns authoritative on-chain values for state, finalStatus, etc.
 */
async function readDisputeFromContract(
  context: any,
  chainId: number,
  oracle: `0x${string}`,
  contractType: ContractType,
  blockNumber?: bigint
): Promise<ContractDisputeInfo | null> {
  const addr = getContractAddress(chainId, contractType);
  if (!addr || addr === "0x0000000000000000000000000000000000000000") return null;

  try {
    const info = await context.client.readContract({
      address: addr,
      abi: getContractAbi(contractType),
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
    console.error(
      `[Dispute] Failed to read contract state for ${(oracle as string).slice(0, 10)}...:`,
      err
    );
    return null;
  }
}

// =============================================================================
// SHARED HANDLER FUNCTIONS
// =============================================================================

/**
 * Handle DisputeCreated event (shared between Home and Remote)
 */
async function handleDisputeCreated(
  event: any,
  context: any,
  contractType: ContractType
) {
  const { disputer, oracle, draftStatus, amount, marketToken } = event.args;
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

  const contractInfo = await readDisputeFromContract(
    context,
    chainId,
    oracle,
    contractType,
    block.number
  );

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
    `[${chainName}] Dispute created (${contractType}) for oracle ${normalizedOracle.slice(
      0,
      10
    )}... by ${normalizedDisputer.slice(0, 10)}... (deposit: ${amount})`
  );
}

/**
 * Handle Vote event (shared between Home and Remote)
 */
async function handleVote(
  event: any,
  context: any,
  contractType: ContractType
) {
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
    `[${chainName}] Vote (${contractType}): ${normalizedVoter.slice(0, 10)}... on ${normalizedOracle.slice(0, 10)}... (power: ${power}, option: ${status})`
  );
}

/**
 * Handle DisputeResolved event (shared between Home and Remote)
 */
async function handleDisputeResolved(
  event: any,
  context: any,
  contractType: ContractType
) {
  const { oracle, finalStatus, resolver } = event.args;
  const { block } = event;
  const timestamp = block.timestamp;
  const chainId = context.network.chainId;
  const chainName = getChainName(chainId);

  const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
  const normalizedResolver = resolver.toLowerCase() as `0x${string}`;
  const disputeId = `${chainId}-${normalizedOracle}`;

  const contractInfo = await readDisputeFromContract(
    context,
    chainId,
    oracle,
    contractType,
    block.number
  );
  const resolvedState = contractInfo?.state ?? 2;
  const resolvedFinalStatus = contractInfo?.finalStatus ?? Number(finalStatus);

  const dispute = await context.db.disputes.findUnique({ id: disputeId });
  if (dispute) {
    await context.db.disputes.update({
      id: disputeId,
      data: {
        state: resolvedState,
        finalStatus: resolvedFinalStatus,
        isCollateralTaken:
          contractInfo?.isCollateralTaken ?? dispute.isCollateralTaken,
        resolvedAt: timestamp,
        resolvedBy: normalizedResolver,
      },
    });
  } else {
    console.warn(
      `[${chainName}] Dispute not found for ${normalizedOracle.slice(0, 10)}..., skipping resolve (DisputeCreated event missing)`
    );
  }

  const poll = await context.db.polls.findUnique({ id: normalizedOracle });
  if (poll) {
    const newStatus = Number(finalStatus);
    const statusChanged = poll.status !== newStatus;

    await context.db.polls.update({
      id: normalizedOracle,
      data: {
        ...(statusChanged && {
          preDisputeStatus: poll.status,
          preDisputeResolutionReason: poll.resolutionReason ?? null,
        }),
        status: newStatus,
        resolutionReason: "arbiter decision",
        resolvedAt: timestamp,
      },
    });

    if (statusChanged) {
      console.log(
        `[${chainName}] Poll ${normalizedOracle.slice(0, 10)}... overturned: status ${poll.status} → ${newStatus}`
      );
    }
  } else {
    console.warn(
      `[${chainName}] Poll not found for ${normalizedOracle.slice(0, 10)}..., skipping status update`
    );
  }

  console.log(
    `[${chainName}] Dispute resolved (${contractType}) for oracle ${normalizedOracle.slice(
      0,
      10
    )}... (finalStatus: ${finalStatus}, resolver: ${normalizedResolver.slice(
      0,
      10
    )}...)`
  );
}

/**
 * Handle DisputeFailed event (shared between Home and Remote)
 */
async function handleDisputeFailed(
  event: any,
  context: any,
  contractType: ContractType
) {
  const { oracle } = event.args;
  const { block } = event;
  const chainId = context.network.chainId;
  const chainName = getChainName(chainId);

  const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
  const disputeId = `${chainId}-${normalizedOracle}`;

  const contractInfo = await readDisputeFromContract(
    context,
    chainId,
    oracle,
    contractType,
    block.number
  );
  const failedState = contractInfo?.state ?? 3;

  const dispute = await context.db.disputes.findUnique({ id: disputeId });
  if (dispute) {
    await context.db.disputes.update({
      id: disputeId,
      data: {
        state: failedState,
        isCollateralTaken:
          contractInfo?.isCollateralTaken ?? dispute.isCollateralTaken,
        finalStatus: contractInfo?.finalStatus ?? dispute.finalStatus,
      },
    });
  } else {
    console.warn(
      `[${chainName}] Dispute not found for ${normalizedOracle.slice(0, 10)}..., skipping fail (DisputeCreated event missing)`
    );
  }

  console.log(
    `[${chainName}] Dispute failed (${contractType}) for oracle ${normalizedOracle.slice(
      0,
      10
    )}... (contract state: ${failedState})`
  );
}

/**
 * Handle VoteRewardClaimed event (shared between Home and Remote)
 */
async function handleVoteRewardClaimed(
  event: any,
  context: any,
  contractType: ContractType
) {
  const { voter, oracle, srcEid, tokenId, token, reward } = event.args;
  const { timestamp, block, transaction } = event;
  const chainId = context.network.chainId;
  const chainName = getChainName(chainId);

  const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
  const normalizedVoter = voter.toLowerCase() as `0x${string}`;
  const normalizedToken = token.toLowerCase() as `0x${string}`;
  const srcEidNum = Number(srcEid);
  const claimId = `${chainId}-${normalizedOracle}-${srcEidNum}-${tokenId}-${transaction.hash}`;

  let votedFor = 0;
  try {
    const addr = getContractAddress(chainId, contractType);
    if (addr) {
      const voteRecord = await context.client.readContract({
        address: addr,
        abi: getContractAbi(contractType),
        functionName: "getVoteRecordInfo",
        args: [oracle, srcEid, tokenId],
      });
      votedFor = Number(voteRecord[2]);
    }
  } catch (err) {
    console.error(
      `[Dispute] Failed to fetch vote record for srcEid ${srcEidNum} token ${tokenId}:`,
      err
    );
  }

  await context.db.disputeRewardClaims.create({
    id: claimId,
    data: {
      chainId,
      oracle: normalizedOracle,
      srcEid: srcEidNum,
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
    `[${chainName}] Reward claimed (${contractType}): ${reward} ${normalizedToken.slice(
      0,
      10
    )}... for srcEid ${srcEidNum} token ${tokenId} by ${normalizedVoter.slice(0, 10)}...`
  );
}

/**
 * Handle CollateralTaken event (shared between Home and Remote)
 */
async function handleCollateralTaken(
  event: any,
  context: any,
  contractType: ContractType
) {
  const { oracle } = event.args;
  const { block } = event;
  const chainId = context.network.chainId;
  const chainName = getChainName(chainId);

  const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
  const disputeId = `${chainId}-${normalizedOracle}`;

  const contractInfo = await readDisputeFromContract(
    context,
    chainId,
    oracle,
    contractType,
    block.number
  );

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
    `[${chainName}] Collateral taken (${contractType}) for oracle ${normalizedOracle.slice(
      0,
      10
    )}...`
  );
}

/**
 * Handle CrossChainVoteReceived event (shared between Home and Remote)
 */
async function handleCrossChainVoteReceived(
  event: any,
  context: any,
  contractType: ContractType
) {
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
    `[${chainName}] CrossChainVote (${contractType}): ${normalizedVoter.slice(0, 10)}... on ${normalizedOracle.slice(0, 10)}... (EID: ${srcChainEid}, NFTs: [${tokenIdStrings.join(",")}])`
  );
}

/**
 * Handle CrossChainClaimReceived event (shared between Home and Remote)
 */
async function handleCrossChainClaimReceived(
  event: any,
  context: any,
  contractType: ContractType
) {
  const { claimer, oracle, srcChainEid, tokenIds } = event.args;
  const chainId = context.network.chainId;
  const chainName = getChainName(chainId);

  console.log(
    `[${chainName}] Cross-chain claim received (${contractType}) from EID ${srcChainEid} for oracle ${oracle.slice(
      0,
      10
    )}... by ${claimer.slice(0, 10)}... (${tokenIds.length} NFTs)`
  );
}

// =============================================================================
// DisputeResolverRemote Event Handlers
// =============================================================================

ponder.on(
  "DisputeResolverRemote:DisputeCreated",
  async ({ event, context }: any) => {
    await handleDisputeCreated(event, context, "remote");
  }
);

ponder.on("DisputeResolverRemote:Vote", async ({ event, context }: any) => {
  await handleVote(event, context, "remote");
});

ponder.on(
  "DisputeResolverRemote:DisputeResolved",
  async ({ event, context }: any) => {
    await handleDisputeResolved(event, context, "remote");
  }
);

ponder.on(
  "DisputeResolverRemote:DisputeFailed",
  async ({ event, context }: any) => {
    await handleDisputeFailed(event, context, "remote");
  }
);

ponder.on(
  "DisputeResolverRemote:VoteRewardClaimed",
  async ({ event, context }: any) => {
    await handleVoteRewardClaimed(event, context, "remote");
  }
);

ponder.on(
  "DisputeResolverRemote:CollateralTaken",
  async ({ event, context }: any) => {
    await handleCollateralTaken(event, context, "remote");
  }
);

ponder.on(
  "DisputeResolverRemote:CrossChainVoteReceived",
  async ({ event, context }: any) => {
    await handleCrossChainVoteReceived(event, context, "remote");
  }
);

ponder.on(
  "DisputeResolverRemote:CrossChainClaimReceived",
  async ({ event, context }: any) => {
    await handleCrossChainClaimReceived(event, context, "remote");
  }
);

/**
 * Event: EmergencyResolved (DisputeResolverRemote only)
 * Emitted when the contract owner force-fails a dispute via emergencyResolve().
 * Sets dispute state to Failed (3) without normal resolution flow.
 */
ponder.on(
  "DisputeResolverRemote:EmergencyResolved",
  async ({ event, context }: any) => {
    const { oracle, caller } = event.args;
    const { block } = event;
    const chainId = context.network.chainId;
    const chainName = getChainName(chainId);

    const normalizedOracle = oracle.toLowerCase() as `0x${string}`;
    const disputeId = `${chainId}-${normalizedOracle}`;

    const contractInfo = await readDisputeFromContract(
      context,
      chainId,
      oracle,
      "remote",
      block.number
    );

    const dispute = await context.db.disputes.findUnique({ id: disputeId });
    if (dispute) {
      await context.db.disputes.update({
        id: disputeId,
        data: {
          state: contractInfo?.state ?? 3,
          finalStatus: contractInfo?.finalStatus ?? dispute.finalStatus,
          isCollateralTaken:
            contractInfo?.isCollateralTaken ?? dispute.isCollateralTaken,
        },
      });
    } else {
      console.warn(
        `[${chainName}] Dispute not found for ${normalizedOracle.slice(0, 10)}..., skipping emergency resolve`
      );
    }

    console.log(
      `[${chainName}] Dispute emergency-resolved for oracle ${normalizedOracle.slice(0, 10)}... by ${(caller as string).slice(0, 10)}... (state: ${contractInfo?.state ?? 3})`
    );
  }
);

// =============================================================================
// DisputeResolverHome Event Handlers
// =============================================================================

ponder.on(
  "DisputeResolverHome:DisputeCreated",
  async ({ event, context }: any) => {
    await handleDisputeCreated(event, context, "home");
  }
);

ponder.on("DisputeResolverHome:Vote", async ({ event, context }: any) => {
  await handleVote(event, context, "home");
});

ponder.on(
  "DisputeResolverHome:DisputeResolved",
  async ({ event, context }: any) => {
    await handleDisputeResolved(event, context, "home");
  }
);

ponder.on(
  "DisputeResolverHome:DisputeFailed",
  async ({ event, context }: any) => {
    await handleDisputeFailed(event, context, "home");
  }
);

ponder.on(
  "DisputeResolverHome:VoteRewardClaimed",
  async ({ event, context }: any) => {
    await handleVoteRewardClaimed(event, context, "home");
  }
);

ponder.on(
  "DisputeResolverHome:CollateralTaken",
  async ({ event, context }: any) => {
    await handleCollateralTaken(event, context, "home");
  }
);

ponder.on(
  "DisputeResolverHome:CrossChainVoteReceived",
  async ({ event, context }: any) => {
    await handleCrossChainVoteReceived(event, context, "home");
  }
);

ponder.on(
  "DisputeResolverHome:CrossChainClaimReceived",
  async ({ event, context }: any) => {
    await handleCrossChainClaimReceived(event, context, "home");
  }
);

// =============================================================================
// DisputeResolverHome-specific Event Handlers
// =============================================================================

/**
 * Event: RemoteVoteSent (DisputeResolverHome only)
 * Emitted when a vote is sent to a remote chain via LayerZero.
 * Useful for tracking cross-chain vote initiation.
 */
ponder.on(
  "DisputeResolverHome:RemoteVoteSent",
  async ({ event, context }: any) => {
    const { voter, oracle, dstChainEid, tokenIds } = event.args;
    const chainId = context.network.chainId;
    const chainName = getChainName(chainId);

    const tokenIdStrings = tokenIds.map((id: bigint) => id.toString());

    console.log(
      `[${chainName}] RemoteVoteSent: ${voter.slice(0, 10)}... voting on ${oracle.slice(0, 10)}... to EID ${dstChainEid} (NFTs: [${tokenIdStrings.join(",")}])`
    );
  }
);

/**
 * Event: RemoteClaimSent (DisputeResolverHome only)
 * Emitted when a claim request is sent to a remote chain via LayerZero.
 * Useful for tracking cross-chain claim initiation.
 */
ponder.on(
  "DisputeResolverHome:RemoteClaimSent",
  async ({ event, context }: any) => {
    const { claimer, oracle, dstChainEid, tokenIds } = event.args;
    const chainId = context.network.chainId;
    const chainName = getChainName(chainId);

    const tokenIdStrings = tokenIds.map((id: bigint) => id.toString());

    console.log(
      `[${chainName}] RemoteClaimSent: ${claimer.slice(0, 10)}... claiming on ${oracle.slice(0, 10)}... to EID ${dstChainEid} (NFTs: [${tokenIdStrings.join(",")}])`
    );
  }
);
