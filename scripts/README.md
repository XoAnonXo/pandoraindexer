# Pandora Indexer Verification Scripts

Scripts to verify that the Ponder indexer data matches on-chain values.

## Setup

```bash
cd scripts
npm install
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `INDEXER_URL` | GraphQL endpoint of the indexer | `http://localhost:42069` |
| `PONDER_RPC_URL_146` | Sonic chain RPC URL | `https://rpc.soniclabs.com` |

## Usage

### Run All Verifications

```bash
npm run verify
```

### Run Individual Verifications

```bash
# Verify polls data
npm run verify:polls

# Verify markets data (AMM and PariMutuel)
npm run verify:markets

# Verify volume calculations
npm run verify:volume

# Verify platform statistics
npm run verify:stats
```

### Command Line Options

```bash
# Run specific verifications
npx tsx verify-all.ts --polls --markets

# Enable on-chain count verification (slower)
npx tsx verify-platform-stats.ts --onchain
```

## What Gets Verified

### Polls (`verify-polls.ts`)
- Question text
- Creator address
- Deadline epoch
- Status (pending/yes/no/unknown)
- Category
- Check epoch

### Markets (`verify-markets.ts`)

**AMM Markets:**
- Poll address
- Creator address
- Collateral token
- YES/NO token addresses
- Fee tier
- Reserves (YES/NO)
- TVL vs USDC balance

**PariMutuel Markets:**
- Poll address
- Creator address
- Collateral token
- Curve parameters (flattener, offset)
- Pool sizes (YES/NO)
- TVL vs total pool

### Volume (`verify-volume.ts`)
- Market volumes vs sum of trade events
- Platform total volume vs sum of market volumes
- Trade counts

**Volume sources tracked:**
- AMM: `BuyTokens.collateralAmount` + `SellTokens.collateralAmount` + `LiquidityAdded` imbalance
- PariMutuel: `SeedInitialLiquidity` + `PositionPurchased.collateralIn`

### Platform Stats (`verify-platform-stats.ts`)
- Total polls count
- Total markets count (AMM + Pari = Total)
- Total trades count
- Total users count
- Total volume = sum of market volumes
- Total winnings paid
- On-chain event counts (with `--onchain` flag)

## Output

The scripts produce colored terminal output with:
- ✅ **Green**: Verification passed
- ❌ **Red**: Mismatch detected
- ⚠️ **Yellow**: Warning (data differs but may be expected)

Exit codes:
- `0`: All verifications passed (or only warnings)
- `1`: One or more verifications failed

## Example Output

```
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  PANDORA INDEXER VERIFICATION SUITE                        ║
║                                                            ║
║  Comparing indexer data with on-chain values               ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

ℹ️  Configuration:
   Indexer URL: http://localhost:42069
   RPC URL:     https://rpc.soniclabs.com

============================================================
  POLL VERIFICATION
============================================================

📋 Poll: 0x1234...
   Question: "Will ETH reach $5000..."
✅ Question: Will ETH reach $5000 by end of 2024?
✅ Status: 0
✅ Deadline Epoch: 1735689600
✅ Creator: 0xabcd...

============================================================
  VERIFICATION SUMMARY
============================================================

Total checks:  150
✅ Passed:        148
❌ Failed:        2

Pass rate: 98.67%

❌ Mismatches:
  - 0x5678...: reserveYes
  - 0x9abc...: tvl
```

## Adding New Verifications

To add verification for a new data type:

1. Create a new `verify-*.ts` file
2. Export a main function that returns `VerificationSummary`
3. Use utilities from `utils.ts` for consistent output
4. Import and add to `verify-all.ts`

## Troubleshooting

**"Failed to fetch from indexer"**
- Make sure the indexer is running
- Check the `INDEXER_URL` is correct

**"Could not fetch on-chain data"**
- Check RPC URL is accessible
- The contract address may be invalid

**Volume mismatches**
- Check if indexer has finished syncing
- Some volume sources may be tracked differently

