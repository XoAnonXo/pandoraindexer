# Indexer Volume Tracking - Critical Events

> **Problem:** Platform statistics showing incorrect/low volume after indexer changes
> **Root Cause:** Missing event handlers for volume-generating events
> **Solution:** Ensure ALL volume events are tracked

## Problem Description

After redeploying the Ponder indexer, platform volume statistics dropped significantly. Investigation revealed that several critical events that contribute to volume were not being indexed.

## Critical Events That Generate Volume

### 1. `SeedInitialLiquidity` (PariMutuel) ⚠️ MOST COMMONLY MISSED

**Contract:** `PredictionPariMutuel`

```solidity
event SeedInitialLiquidity(uint256 yesAmount, uint256 noAmount);
```

When a PariMutuel market is created, initial liquidity is seeded. **BOTH amounts count as volume.**

```typescript
// CORRECT: Add both amounts to volume
ponder.on("PredictionPariMutuel:SeedInitialLiquidity", async ({ event }) => {
  const totalVolume = event.args.yesAmount + event.args.noAmount;
  
  // Update market volume
  market.totalVolume += totalVolume;
  
  // Update platform volume
  platformStats.totalVolume += totalVolume;
});
```

**Why it matters:** Each PariMutuel market starts with seed liquidity. Missing this event means losing ALL initial volume for every pari-mutuel market.

---

### 2. `AnswerSet` (Poll Resolution)

**Contract:** `PredictionPoll` (dynamically created)

```solidity
event AnswerSet(PollStatus status, address indexed setter, string reason);
```

Polls are NOT created on the Oracle contract - they are separate contracts deployed via `PollCreated`. You must use **factory pattern** in Ponder config:

```typescript
// ponder.config.ts
PredictionPoll: {
  network: "sonic",
  abi: PredictionPollAbi,
  factory: {
    address: ORACLE_ADDRESS,
    event: PredictionOracleAbi.find(e => e.name === "PollCreated"),
    parameter: "pollAddress",
  },
  startBlock: START_BLOCK,
}
```

**Why it matters:** Without this, poll resolution status never updates, and `totalPollsResolved` stays at 0.

---

### 3. `LiquidityAdded` Imbalance

**Contract:** `PredictionAMM`

```solidity
event LiquidityAdded(
  address indexed provider,
  uint256 collateralAmount,
  uint256 lpTokens,
  LiquidityAmounts amounts  // Contains yesToReturn, noToReturn
);
```

When LP adds liquidity with non-50/50 distribution, they receive tokens back. This imbalance is effectively a **position** and counts as volume:

```typescript
ponder.on("PredictionAMM:LiquidityAdded", async ({ event }) => {
  const { amounts } = event.args;
  
  // Imbalance = tokens returned to provider = position taken
  const imbalanceVolume = (amounts.yesToReturn ?? 0n) + (amounts.noToReturn ?? 0n);
  
  if (imbalanceVolume > 0n) {
    market.totalVolume += imbalanceVolume;
    platformStats.totalVolume += imbalanceVolume;
  }
});
```

**Why it matters:** First liquidity add often has significant imbalance based on initial odds.

---

### 4. `Sync` (Reserve Updates)

**Contract:** `PredictionAMM`

```solidity
event Sync(uint112 rYes, uint112 rNo);
```

Track reserve values for price calculation:

```typescript
ponder.on("PredictionAMM:Sync", async ({ event }) => {
  await context.db.markets.update({
    id: event.log.address,
    data: {
      reserveYes: BigInt(event.args.rYes),
      reserveNo: BigInt(event.args.rNo),
    },
  });
});
```

---

## Complete Event → Volume Mapping

| Event | Source | Adds to Volume | Amount |
|-------|--------|---------------|--------|
| `SeedInitialLiquidity` | PariMutuel | ✅ YES | `yesAmount + noAmount` |
| `PositionPurchased` | PariMutuel | ✅ YES | `collateralIn` |
| `BuyTokens` | AMM | ✅ YES | `collateralAmount` |
| `SellTokens` | AMM | ✅ YES | `collateralAmount` |
| `LiquidityAdded` | AMM | ⚠️ MAYBE | `yesToReturn + noToReturn` (imbalance only) |
| `SwapTokens` | AMM | ❌ NO | No new collateral enters |
| `WinningsRedeemed` | Both | ❌ NO | Payout, not volume |
| `LiquidityRemoved` | AMM | ❌ NO | Withdrawal |

---

## Verification Steps

After deploying indexer changes:

1. **Check platform stats endpoint:**
   ```bash
   curl -X POST https://your-indexer.railway.app/graphql \
     -H "Content-Type: application/json" \
     -d '{"query":"{ platformStats(id: \"global\") { totalVolume totalTrades } }"}'
   ```

2. **Compare with on-chain data:**
   - Check a few markets on Sonicscan
   - Verify event counts match
   - Verify volume calculation matches

3. **Check for console errors:**
   - Ponder logs will show handler execution
   - Look for "event not found" or similar errors

---

## Schema Requirements

Ensure your schema includes:

```typescript
// ponder.schema.ts
platformStats: p.createTable({
  id: p.string(),
  totalVolume: p.bigint(),        // MUST track this
  totalPollsResolved: p.int(),    // Updated by AnswerSet
  // ...
}),

markets: p.createTable({
  id: p.hex(),
  totalVolume: p.bigint(),        // Per-market volume
  reserveYes: p.bigint().optional(), // From Sync event
  reserveNo: p.bigint().optional(),  // From Sync event
  // ...
}),
```

---

## Prevention Checklist

Before deploying indexer changes:

- [ ] `SeedInitialLiquidity` handler exists and adds to volume
- [ ] `PredictionPoll` configured as factory contract
- [ ] `AnswerSet` handler updates poll status
- [ ] `LiquidityAdded` calculates and tracks imbalance
- [ ] `Sync` handler updates reserve values
- [ ] All volume events increment both market AND platform stats
- [ ] Schema has `totalPollsResolved` field
- [ ] Schema has `reserveYes`/`reserveNo` fields

---

## Related Files

- Indexer repo: https://github.com/XoAnonXo/sonicmarketindexer
- Config: `ponder/ponder.config.ts`
- Schema: `ponder/ponder.schema.ts`
- Handlers: `ponder/src/index.ts`
- ABIs: `ponder/abis/`

---

## Critical Bug: Platform vs Market Stats Consistency

### Problem (2024-12-02)

Platform total volume showed `$1,041,109` but the correct value should be `$912,230`. 
Sum of individual market volumes was only `$745,209`.

**Discrepancy: $295,900 (28.4% over-counted)**

### Root Cause

Volume events were updating `platformStats.totalVolume` **UNCONDITIONALLY**, but only updating `market.totalVolume` if the market record existed:

```typescript
// BUG: This pattern causes inconsistency
const market = await context.db.markets.findUnique({ id: marketAddress });

if (market) {  // ⚠️ CONDITIONAL - may not run
  await context.db.markets.update({
    data: { totalVolume: market.totalVolume + amount }
  });
}

// ⚠️ UNCONDITIONAL - always runs even if market doesn't exist!
await context.db.platformStats.update({
  data: { totalVolume: stats.totalVolume + amount }
});
```

When market creation (`MarketCreated` / `PariMutuelCreated`) and volume events (`SeedInitialLiquidity`, `BuyTokens`, etc.) race, the market record may not exist when the volume event fires.

### Solution

Only update platform stats if the market record exists:

```typescript
// FIXED: Ensure consistency between platform and market stats
const market = await context.db.markets.findUnique({ id: marketAddress });

if (!market) {
  console.warn(`Market not found ${marketAddress} - skipping volume update`);
  return;  // Early return - don't update platform stats either
}

// Update market
await context.db.markets.update({
  data: { totalVolume: market.totalVolume + amount }
});

// Update platform (now guaranteed to be in sync)
await context.db.platformStats.update({
  data: { totalVolume: stats.totalVolume + amount }
});
```

### Affected Handlers

| Handler | Contract | Fix Applied |
|---------|----------|-------------|
| `BuyTokens` | AMM | ✅ Early return if no market |
| `SellTokens` | AMM | ✅ Early return if no market |
| `LiquidityAdded` | AMM | ✅ Early return if no market |
| `SeedInitialLiquidity` | PariMutuel | ✅ Early return if no market |
| `PositionPurchased` | PariMutuel | ✅ Early return if no market |

### Verification

After redeploying with fix, run:

```bash
curl -s -X POST https://your-indexer.railway.app/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ marketss(limit: 100) { items { totalVolume } } platformStatss { items { totalVolume } } }"}' | jq '{
    sumOfMarkets: ([.data.marketss.items[].totalVolume | tonumber] | add),
    platformTotal: .data.platformStatss.items[0].totalVolume
  }'
```

**Expected:** `sumOfMarkets` should equal `platformTotal`

### Prevention

- [ ] All volume-updating handlers must check market exists BEFORE updating ANY stats
- [ ] Use early return pattern: `if (!market) return;`
- [ ] Never update platform stats outside of the market existence check
- [ ] Add warning logs when market not found to catch issues early

---

## Fix History

| Date | Issue | Fix |
|------|-------|-----|
| 2024-12-02 | Platform volume 14% higher than correct value | Fixed all handlers to only update platform stats if market exists |
| 2024-12-02 | Volume dropped after redeploy | Added `SeedInitialLiquidity`, `AnswerSet`, `Sync` handlers; fixed `LiquidityAdded` imbalance |

