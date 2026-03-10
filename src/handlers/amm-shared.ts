import { PredictionAMMAbi } from "../../abis/PredictionAMM";
import { updatePollTvl } from "../services/pollTvl";
import { PollStatus } from "../utils/constants";

export function toBigInt(value: unknown): bigint {
  return typeof value === "bigint" ? value : BigInt(value as any);
}

export function isPollResolved(status: number | undefined | null): boolean {
  return status === PollStatus.YES || status === PollStatus.NO || status === PollStatus.UNKNOWN;
}

/**
 * Read reserves from contract and update market yesChance / TVL.
 * Called after each trade/liquidity event to keep state in sync.
 * After poll resolution, yesChance is frozen to preserve the final market price.
 */
export async function updateMarketReserves(
  context: any,
  marketAddress: `0x${string}`,
  pollAddress: `0x${string}`,
  chainName: string,
  blockNumber: bigint
): Promise<{ yesChance: bigint; collateralTvl: bigint }> {
  const reserves = await context.client.readContract({
    address: marketAddress,
    abi: PredictionAMMAbi,
    functionName: "getReserves",
    blockNumber,
  });

  const reserveYes = BigInt(reserves[0]);
  const reserveNo = BigInt(reserves[1]);
  const collateralTvl = BigInt(reserves[4]);

  const totalReserves = reserveYes + reserveNo;
  const yesChance =
    totalReserves > 0n
      ? (reserveNo * 1_000_000_000n) / totalReserves
      : 500_000_000n;

  const poll = await context.db.polls.findUnique({ id: pollAddress });
  const resolved = isPollResolved(poll?.status);

  await context.db.markets.update({
    id: marketAddress,
    data: {
      reserveYes,
      reserveNo,
      ...(resolved ? {} : { yesChance }),
      currentTvl: collateralTvl,
    },
  });

  await updatePollTvl(context, pollAddress);

  return { yesChance, collateralTvl };
}
