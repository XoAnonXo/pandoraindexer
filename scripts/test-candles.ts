import assert from "node:assert/strict";
import { computeBucketStart, computeYesExecutionPriceScaled } from "../src/services/candles";

function testComputeYesExecutionPriceScaled() {
  // 0.5 price, YES side
  assert.equal(
    computeYesExecutionPriceScaled({
      isYesSide: true,
      collateralAmount: 500_000n,
      tokenAmount: 1_000_000n,
    }),
    500_000_000n
  );

  // 0.5 price, NO side -> YES = 0.5
  assert.equal(
    computeYesExecutionPriceScaled({
      isYesSide: false,
      collateralAmount: 500_000n,
      tokenAmount: 1_000_000n,
    }),
    500_000_000n
  );

  // NO trade at 0.1 -> YES = 0.9
  assert.equal(
    computeYesExecutionPriceScaled({
      isYesSide: false,
      collateralAmount: 100_000n,
      tokenAmount: 1_000_000n,
    }),
    900_000_000n
  );

  // Clamp: YES price > 1.0
  assert.equal(
    computeYesExecutionPriceScaled({
      isYesSide: true,
      collateralAmount: 2_000_000n,
      tokenAmount: 1_000_000n,
    }),
    1_000_000_000n
  );

  // Clamp: NO price > 1.0 -> YES = 0.0
  assert.equal(
    computeYesExecutionPriceScaled({
      isYesSide: false,
      collateralAmount: 2_000_000n,
      tokenAmount: 1_000_000n,
    }),
    0n
  );

  // Token amount 0 -> default 0.5
  assert.equal(
    computeYesExecutionPriceScaled({
      isYesSide: true,
      collateralAmount: 1_000_000n,
      tokenAmount: 0n,
    }),
    500_000_000n
  );
}

function testComputeBucketStart() {
  assert.equal(computeBucketStart(3700n, 3600), 3600n);
  assert.equal(computeBucketStart(3599n, 3600), 0n);
  assert.equal(computeBucketStart(3600n, 3600), 3600n);
  assert.equal(computeBucketStart(3660n, 60), 3660n);
  assert.equal(computeBucketStart(3661n, 60), 3660n);
}

testComputeYesExecutionPriceScaled();
testComputeBucketStart();

console.log("OK: candles tests passed");


