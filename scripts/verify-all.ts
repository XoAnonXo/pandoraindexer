#!/usr/bin/env tsx
/**
 * Main Verification Script
 * 
 * Runs all verification checks and produces a comprehensive report.
 * 
 * Usage:
 *   npm run verify           # Run all verifications
 *   npm run verify:polls     # Verify polls only
 *   npm run verify:markets   # Verify markets only
 *   npm run verify:volume    # Verify volume only
 *   npm run verify:stats     # Verify platform stats only
 * 
 * Environment Variables:
 *   INDEXER_URL             # GraphQL endpoint (default: http://localhost:42069)
 *   PONDER_RPC_URL_146      # Sonic RPC URL
 */

import {
  logHeader,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  printSummary,
  createSummary,
  colors,
  type VerificationSummary,
} from "./utils.js";
import { verifyPolls } from "./verify-polls.js";
import { verifyMarkets } from "./verify-markets.js";
import { verifyVolume } from "./verify-volume.js";
import { verifyPlatformStats } from "./verify-platform-stats.js";
import { verifyPnL } from "./verify-pnl.js";
import { verifyReferrals } from "./verify-referrals.js";

/**
 * Merge multiple summaries
 */
function mergeSummaries(...summaries: VerificationSummary[]): VerificationSummary {
  const merged = createSummary();
  
  for (const s of summaries) {
    merged.total += s.total;
    merged.passed += s.passed;
    merged.failed += s.failed;
    merged.warnings += s.warnings;
    merged.mismatches.push(...s.mismatches);
  }
  
  return merged;
}

/**
 * Print banner
 */
function printBanner(): void {
  console.log();
  console.log(`${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║                                                            ║${colors.reset}`);
  console.log(`${colors.cyan}║  ${colors.bright}PANDORA INDEXER VERIFICATION SUITE${colors.reset}${colors.cyan}                      ║${colors.reset}`);
  console.log(`${colors.cyan}║                                                            ║${colors.reset}`);
  console.log(`${colors.cyan}║  Comparing indexer data with on-chain values               ║${colors.reset}`);
  console.log(`${colors.cyan}║                                                            ║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log();
}

/**
 * Print configuration
 */
function printConfig(): void {
  const indexerUrl = process.env.INDEXER_URL ?? "http://localhost:42069";
  const rpcUrl = process.env.PONDER_RPC_URL_146 ?? "https://rpc.soniclabs.com";
  
  logInfo("Configuration:");
  console.log(`   Indexer URL: ${indexerUrl}`);
  console.log(`   RPC URL:     ${rpcUrl}`);
  console.log();
}

/**
 * Main function
 */
async function main(): Promise<void> {
  printBanner();
  printConfig();
  
  const startTime = Date.now();
  const summaries: VerificationSummary[] = [];
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const runAll = args.length === 0;
  const runPolls = runAll || args.includes("--polls");
  const runMarkets = runAll || args.includes("--markets");
  const runVolume = runAll || args.includes("--volume");
  const runStats = runAll || args.includes("--stats");
  const runPnL = runAll || args.includes("--pnl");
  const runReferrals = runAll || args.includes("--referrals");
  
  try {
    // 1. Verify Platform Stats (quick internal consistency check)
    if (runStats) {
      logInfo("Starting Platform Stats verification...");
      const statsSummary = await verifyPlatformStats();
      summaries.push(statsSummary);
    }
    
    // 2. Verify Polls
    if (runPolls) {
      logInfo("Starting Polls verification...");
      const pollsSummary = await verifyPolls();
      summaries.push(pollsSummary);
    }
    
    // 3. Verify Markets
    if (runMarkets) {
      logInfo("Starting Markets verification...");
      const marketsSummary = await verifyMarkets();
      summaries.push(marketsSummary);
    }
    
    // 4. Verify Volume (most thorough, can be slow)
    if (runVolume) {
      logInfo("Starting Volume verification...");
      const volumeSummary = await verifyVolume();
      summaries.push(volumeSummary);
    }

    // 5. Verify PnL
    if (runPnL) {
      logInfo("Starting PnL verification...");
      const pnlSummary = await verifyPnL();
      summaries.push(pnlSummary);
    }

    // 6. Verify Referrals & Campaigns
    if (runReferrals) {
      logInfo("Starting Referrals & Campaigns verification...");
      const referralsSummary = await verifyReferrals();
      summaries.push(referralsSummary);
    }
    
  } catch (error) {
    logError(`Verification failed with error: ${error}`);
    process.exit(1);
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  
  // Print combined summary
  logHeader("COMBINED RESULTS");
  
  const combined = mergeSummaries(...summaries);
  printSummary(combined);
  
  console.log();
  logInfo(`Total time: ${elapsed}s`);
  
  // Exit with appropriate code
  if (combined.failed > 0) {
    logError(`\n⛔ Verification FAILED with ${combined.failed} mismatches`);
    process.exit(1);
  } else if (combined.warnings > 0) {
    logWarning(`\n⚠️  Verification completed with ${combined.warnings} warnings`);
    process.exit(0);
  } else {
    logSuccess(`\n✨ All verifications PASSED!`);
    process.exit(0);
  }
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});




