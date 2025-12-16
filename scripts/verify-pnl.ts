/**
 * Verify PnL: Re-calculate User PnL from history
 * 
 * Logic:
 * 1. Fetch top users.
 * 2. Fetch all trades for each user.
 * 3. Fetch all winnings for each user.
 * 4. Calc PnL = (Sells + Winnings) - (Buys + Bets + Seeds).
 * 5. Compare with stored user.realizedPnL.
 */

import {
  queryIndexer,
  logHeader,
  logInfo,
  logError,
  logWarning,
  compareBigInt,
  formatUSDC,
  createSummary,
  recordResult,
  printSummary,
  type VerificationSummary,
} from "./utils.js";

const USERS_QUERY = `
  query GetUsers($limit: Int) {
    userss(limit: $limit, orderBy: "totalTrades", orderDirection: "desc") {
      items {
        id
        address
        totalDeposited
        totalWithdrawn
        totalWinnings
        realizedPnL
        totalTrades
      }
    }
  }
`;

const USER_HISTORY_QUERY = `
  query GetUserHistory($user: String) {
    tradess(where: { trader: $user }, limit: 1000) {
      items {
        tradeType
        collateralAmount
        feeAmount
      }
    }
    winningss(where: { user: $user }, limit: 1000) {
      items {
        collateralAmount
      }
    }
  }
`;

interface IndexerUser {
  id: string;
  address: string;
  totalDeposited: string;
  totalWithdrawn: string;
  totalWinnings: string;
  realizedPnL: string;
  totalTrades: number;
}

interface IndexerTrade {
  tradeType: string;
  collateralAmount: string;
  feeAmount: string;
}

interface IndexerWinning {
  collateralAmount: string;
}

export async function verifyPnL(): Promise<VerificationSummary> {
  logHeader("PnL VERIFICATION");
  const summary = createSummary();

  // 1. Fetch Top Users
  logInfo("Fetching top 50 users...");
  let users: IndexerUser[] = [];
  try {
    const data = await queryIndexer<{ userss: { items: IndexerUser[] } }>(USERS_QUERY, { limit: 50 });
    users = data.userss.items;
  } catch (e) {
    logError(`Failed to fetch users: ${e}`);
    return summary;
  }

  logInfo(`Verifying PnL for ${users.length} users...`);

  for (const user of users) {
    console.log(`\n👤 User: ${user.address} (Trades: ${user.totalTrades})`);

    // 2. Fetch History
    let trades: IndexerTrade[] = [];
    let winnings: IndexerWinning[] = [];
    try {
      const hist = await queryIndexer<{ tradess: { items: IndexerTrade[] }, winningss: { items: IndexerWinning[] } }>(
        USER_HISTORY_QUERY, 
        { user: user.address }
      );
      trades = hist.tradess.items;
      winnings = hist.winningss.items;
    } catch (e) {
      logError(`Failed to fetch history for ${user.address}: ${e}`);
      continue;
    }

    // 3. Re-calculate
    let calcDeposited = 0n;
    let calcWithdrawn = 0n;
    let calcWinnings = 0n;

    for (const t of trades) {
      const amount = BigInt(t.collateralAmount);
      const fee = BigInt(t.feeAmount);

      if (t.tradeType === "buy" || t.tradeType === "bet" || t.tradeType === "seed") {
        calcDeposited += amount;
      } else if (t.tradeType === "sell") {
        // SellTokens event: collateralAmount is GROSS (usually).
        // Logic in indexer: net = collateral - fee.
        // Let's assume indexer logic is: storedWithdrawn += (amount - fee).
        const net = amount > fee ? amount - fee : 0n;
        calcWithdrawn += net;
      }
    }

    for (const w of winnings) {
      calcWinnings += BigInt(w.collateralAmount);
    }

    const calcPnL = (calcWithdrawn + calcWinnings) - calcDeposited;

    // 4. Compare
    // Check Deposited
    const depMatch = compareBigInt("Deposited", BigInt(user.totalDeposited), calcDeposited);
    recordResult(summary, depMatch.match, `${user.address}: deposited`);

    // Check Withdrawn
    const withMatch = compareBigInt("Withdrawn", BigInt(user.totalWithdrawn), calcWithdrawn);
    recordResult(summary, withMatch.match, `${user.address}: withdrawn`);

    // Check Winnings
    const winMatch = compareBigInt("Winnings", BigInt(user.totalWinnings), calcWinnings);
    recordResult(summary, winMatch.match, `${user.address}: winnings`);

    // Check PnL
    const pnlMatch = compareBigInt("Realized PnL", BigInt(user.realizedPnL), calcPnL);
    recordResult(summary, pnlMatch.match, `${user.address}: pnl`);

    if (!pnlMatch.match) {
        console.log(`   Expected: ${formatUSDC(calcPnL)}`);
        console.log(`   Actual:   ${formatUSDC(BigInt(user.realizedPnL))}`);
    }
  }

  return summary;
}

// Run if called directly
const scriptPath = process.argv[1];
const isMainModule = import.meta.url.endsWith(scriptPath.split('/').pop()!) || 
                     import.meta.url.includes('verify-pnl');
if (isMainModule) {
  verifyPnL()
    .then(printSummary)
    .catch(console.error);
}





