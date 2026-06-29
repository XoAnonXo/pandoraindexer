import { markets, polls, users } from "ponder:schema";
import { getOrCreateUser, getOrCreateMinimalMarket } from "./db";
import { updateAggregateStats } from "./stats";
import { updatePollTvl } from "./pollTvl";
import { isPollResolved } from "../handlers/amm-shared";
import type { ChainInfo } from "../utils/types";

interface ProtocolFeesParams {
  context: any;
  chain: ChainInfo;
  marketAddress: `0x${string}`;
  timestamp: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
  logIndex: number;
  platformShare: bigint;
  creatorShare: bigint;
  marketType: "amm" | "pari";
  /** Current on-chain TVL (read by caller via the appropriate contract ABI) */
  currentTvl: bigint;
  /** Optional reserve data — only AMM provides this */
  reserves?: { reserveYes: bigint; reserveNo: bigint; yesChance: bigint };
}

/**
 * Shared handler for ProtocolFeesWithdrawn events.
 * Both AMM and PariMutuel emit identical events; the only difference
 * is how TVL/reserves are read from the contract (done by the caller).
 */
export async function handleProtocolFeesWithdrawn(params: ProtocolFeesParams) {
  const {
    context, chain, marketAddress, timestamp, blockNumber, txHash, logIndex,
    platformShare, creatorShare, marketType, currentTvl, reserves,
  } = params;

  const market =
    (await context.db.find(markets, { id: marketAddress })) ??
    (await getOrCreateMinimalMarket(
      context, marketAddress, chain, marketType, timestamp, blockNumber, txHash
    ));

  const oldTvl = market.currentTvl ?? 0n;
  const delta = currentTvl - oldTvl;

  const marketUpdate: Record<string, any> = {
    currentTvl,
    creatorFeesEarned: (market.creatorFeesEarned ?? 0n) + creatorShare,
    platformFeesEarned: (market.platformFeesEarned ?? 0n) + platformShare,
  };

  if (reserves) {
    marketUpdate.reserveYes = reserves.reserveYes;
    marketUpdate.reserveNo = reserves.reserveNo;

    const poll = await context.db.find(polls, { id: market.pollAddress });
    if (!isPollResolved(poll?.status)) {
      marketUpdate.yesChance = reserves.yesChance;
    }
  }

  await context.db.update(markets, { id: marketAddress }).set(marketUpdate);
  await updatePollTvl(context, market.pollAddress);

  if (delta !== 0n) {
    await updateAggregateStats(context, chain, timestamp, { tvlChange: delta });
  }

  if (creatorShare > 0n && market.creator) {
    const creatorUser = await getOrCreateUser(context, market.creator, chain);
    await context.db.update(users, { id: creatorUser.id }).set({
      totalCreatorFees: (creatorUser.totalCreatorFees ?? 0n) + creatorShare,
    });
  }

  if (platformShare > 0n) {
    await updateAggregateStats(context, chain, timestamp, {
      platformFees: platformShare,
    });
  }
}
