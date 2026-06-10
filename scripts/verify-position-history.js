const url = 'https://pandoraindexer-dev.up.railway.app/graphql';
const user = '0xd24cb02bed630baa49887168440d90be8da6708c';

async function query(gql) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql }),
  });
  return r.json();
}

async function run() {
  // 1. positionHistory
  const ph = await query(`{
    positionHistorys(where: { user: "${user}" }, orderBy: "resolvedAt", orderDirection: "desc", limit: 50) {
      items {
        id marketAddress marketQuestion marketType side result pollStatus
        yesCostBasis noCostBasis collateralReceived feeAmount pnl resolvedAt txHash
      }
    }
  }`);
  console.log('=== POSITION HISTORY ===');
  const phItems = ph.data?.positionHistorys?.items || [];
  console.log(`Total records: ${phItems.length}`);
  for (const item of phItems) {
    const spent = (BigInt(item.yesCostBasis) + BigInt(item.noCostBasis));
    console.log(`  [${item.result.toUpperCase()}] ${item.marketType} | side=${item.side} | spent=${spent} | received=${item.collateralReceived} | pnl=${item.pnl} | market=${item.marketAddress.slice(0,10)}...`);
  }
  console.log('');

  // 2. winnings table for same user
  const w = await query(`{
    winningss(where: { user: "${user}" }, orderBy: "timestamp", orderDirection: "desc", limit: 50) {
      items {
        id marketAddress marketQuestion marketType side pollStatus
        yesCostBasis noCostBasis collateralAmount feeAmount txHash timestamp
      }
    }
  }`);
  console.log('=== WINNINGS TABLE ===');
  const wItems = w.data?.winningss?.items || [];
  console.log(`Total records: ${wItems.length}`);
  for (const item of wItems) {
    const spent = (BigInt(item.yesCostBasis || '0') + BigInt(item.noCostBasis || '0'));
    const pnl = BigInt(item.collateralAmount) - spent;
    console.log(`  ${item.marketType} | side=${item.side} | spent=${spent} | received=${item.collateralAmount} | pnl=${pnl} | market=${item.marketAddress.slice(0,10)}...`);
  }
  console.log('');

  // 3. Cross-check: every winning should have matching positionHistory
  console.log('=== CROSS-CHECK ===');
  const phByMarket = new Map(phItems.map(i => [i.marketAddress, i]));
  let mismatches = 0;
  for (const w of wItems) {
    const ph = phByMarket.get(w.marketAddress);
    if (!ph) {
      console.log(`  MISSING in positionHistory: market=${w.marketAddress}`);
      mismatches++;
    } else {
      const wSpent = BigInt(w.yesCostBasis || '0') + BigInt(w.noCostBasis || '0');
      const phSpent = BigInt(ph.yesCostBasis) + BigInt(ph.noCostBasis);
      if (wSpent !== phSpent) {
        console.log(`  MISMATCH spent: market=${w.marketAddress} winnings=${wSpent} posHistory=${phSpent}`);
        mismatches++;
      }
      if (w.collateralAmount !== ph.collateralReceived) {
        console.log(`  MISMATCH received: market=${w.marketAddress} winnings=${w.collateralAmount} posHistory=${ph.collateralReceived}`);
        mismatches++;
      }
    }
  }

  // Check losses in positionHistory (should NOT appear in winnings)
  const lostItems = phItems.filter(i => i.result === 'lost');
  for (const l of lostItems) {
    const inWinnings = wItems.find(w => w.marketAddress === l.marketAddress);
    if (inWinnings) {
      console.log(`  CONFLICT: market=${l.marketAddress} marked as LOST in posHistory but EXISTS in winnings`);
      mismatches++;
    }
  }

  if (mismatches === 0) {
    console.log('  All records match!');
  } else {
    console.log(`  ${mismatches} mismatches found.`);
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  const wins = phItems.filter(i => i.result === 'won').length;
  const losses = phItems.filter(i => i.result === 'lost').length;
  const refunds = phItems.filter(i => i.result === 'refunded').length;
  console.log(`  Wins: ${wins}, Losses: ${losses}, Refunds: ${refunds}`);
}

run().catch(e => console.error(e));
