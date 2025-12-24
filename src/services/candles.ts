import type { PonderContext } from "../utils/types";

const CANDLE_PRICE_SCALE = 1_000_000_000n; // 1e9

export const CANDLE_INTERVALS = ["1m", "5m", "1h"] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export const INTERVAL_TO_SECONDS: Record<CandleInterval, number> = {
  "1m": 60,
  "5m": 300,
  "1h": 3600,
};

function toBucketStart(timestampSec: bigint, intervalSec: number): bigint {
  const interval = BigInt(intervalSec);
  return (timestampSec / interval) * interval;
}

export function computeBucketStart(timestampSec: bigint, intervalSec: number): bigint {
  return toBucketStart(timestampSec, intervalSec);
}

function tradeSeq(blockNumber: bigint, logIndex: number): bigint {
  // Ensure stable ordering inside the same block.
  // 1_000_000 leaves plenty of room for logIndex.
  return blockNumber * 1_000_000n + BigInt(logIndex);
}

export function computeYesExecutionPriceScaled(params: {
  isYesSide: boolean;
  collateralAmount: bigint;
  tokenAmount: bigint;
}): bigint {
  const { isYesSide, collateralAmount, tokenAmount } = params;
  if (tokenAmount <= 0n) return CANDLE_PRICE_SCALE / 2n;

  // Outcome tokens use same decimals as collateral (see contracts/market/OutcomeToken.sol),
  // so collateralAmount/tokenAmount is already in [0..1] range.
  const priceScaled = (collateralAmount * CANDLE_PRICE_SCALE) / tokenAmount;

  if (isYesSide) {
    return clampPriceScaled(priceScaled);
  }

  // Convert NO execution price to YES price.
  // yesPrice = 1 - noPrice
  const yesPriceScaled = CANDLE_PRICE_SCALE - clampPriceScaled(priceScaled);
  return clampPriceScaled(yesPriceScaled);
}

function clampPriceScaled(priceScaled: bigint): bigint {
  if (priceScaled < 0n) return 0n;
  if (priceScaled > CANDLE_PRICE_SCALE) return CANDLE_PRICE_SCALE;
  return priceScaled;
}

function makeTickId(
  marketAddress: `0x${string}`,
  txHash: `0x${string}`,
  logIndex: number
): string {
  return `${marketAddress.toLowerCase()}-${txHash.toLowerCase()}-${logIndex}`;
}

function makeBucketId(marketAddress: `0x${string}`, bucketStart: bigint): string {
  return `${marketAddress.toLowerCase()}-${bucketStart.toString()}`;
}

async function upsertCandleBucket(params: {
  context: PonderContext;
  marketAddress: `0x${string}`;
  interval: CandleInterval;
  timestamp: bigint;
  seq: bigint;
  priceScaled: bigint;
  volume: bigint;
}): Promise<void> {
  const {
    context,
    marketAddress,
    interval,
    timestamp,
    seq,
    priceScaled,
    volume,
  } = params;

  const intervalSec = INTERVAL_TO_SECONDS[interval];
  const bucketStart = toBucketStart(timestamp, intervalSec);
  const bucketId = makeBucketId(marketAddress, bucketStart);

  const table =
    interval === "1m"
      ? context.db.candles1m
      : interval === "5m"
        ? context.db.candles5m
        : context.db.candles1h;

  const existing = await table.findUnique({ id: bucketId });
  if (!existing) {
    await table.create({
      id: bucketId,
      data: {
        marketAddress,
        bucketStart,
        open: priceScaled,
        high: priceScaled,
        low: priceScaled,
        close: priceScaled,
        volume,
        trades: 1,
        firstSeq: seq,
        lastSeq: seq,
      },
    });
    return;
  }

  const open = seq < existing.firstSeq ? priceScaled : existing.open;
  const close = seq > existing.lastSeq ? priceScaled : existing.close;
  const high = existing.high > priceScaled ? existing.high : priceScaled;
  const low = existing.low < priceScaled ? existing.low : priceScaled;

  await table.update({
    id: bucketId,
    data: {
      open,
      close,
      high,
      low,
      volume: existing.volume + volume,
      trades: existing.trades + 1,
      firstSeq: seq < existing.firstSeq ? seq : existing.firstSeq,
      lastSeq: seq > existing.lastSeq ? seq : existing.lastSeq,
    },
  });
}

export async function recordAmmPriceTickAndCandles(params: {
  context: PonderContext;
  marketAddress: `0x${string}`;
  timestamp: bigint;
  blockNumber: bigint;
  logIndex: number;
  isYesSide: boolean;
  collateralAmount: bigint;
  tokenAmount: bigint;
  tradeType: "buy" | "sell";
  txHash: `0x${string}`;
}): Promise<void> {
  const {
    context,
    marketAddress,
    timestamp,
    blockNumber,
    logIndex,
    isYesSide,
    collateralAmount,
    tokenAmount,
    tradeType,
    txHash,
  } = params;

  const seq = tradeSeq(blockNumber, logIndex);
  const yesPrice = computeYesExecutionPriceScaled({
    isYesSide,
    collateralAmount,
    tokenAmount,
  });


  await context.db.priceTicks.create({
    id: makeTickId(marketAddress, txHash, logIndex),
    data: {
      marketAddress,
      timestamp,
      seq,
      yesPrice,
      volume: collateralAmount,
      side: isYesSide ? "yes" : "no",
      tradeType,
      txHash,
      blockNumber,
    },
  });

  
  await upsertCandleBucket({
    context,
    marketAddress,
    interval: "1m",
    timestamp,
    seq,
    priceScaled: yesPrice,
    volume: collateralAmount,
  });
  await upsertCandleBucket({
    context,
    marketAddress,
    interval: "5m",
    timestamp,
    seq,
    priceScaled: yesPrice,
    volume: collateralAmount,
  });
  await upsertCandleBucket({
    context,
    marketAddress,
    interval: "1h",
    timestamp,
    seq,
    priceScaled: yesPrice,
    volume: collateralAmount,
  });
}


