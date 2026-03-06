import { PredictionAMMAbi } from "../../abis/PredictionAMM";
import { updatePollTvl } from "../services/pollTvl";

export function toBigInt(value: unknown): bigint {
  return typeof value === "bigint" ? value : BigInt(value as any);
}

/**
 * Read reserves from contract and update market yesChance / TVL.
 * Called after each trade/liquidity event to keep state in sync.
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

  await context.db.markets.update({
    id: marketAddress,
    data: {
      reserveYes,
      reserveNo,
      yesChance,
      currentTvl: collateralTvl,
    },
  });

  await updatePollTvl(context, pollAddress);

  return { yesChance, collateralTvl };
}
