/**
 * Utility functions for verification scripts
 */

import { createPublicClient, http, formatUnits, type Address } from "viem";
import { sonic } from "viem/chains";
import { RPC_URL, USDC_DECIMALS } from "./contracts.js";

// Create public client for Sonic chain
export const client = createPublicClient({
  chain: sonic,
  transport: http(RPC_URL),
});

// Indexer GraphQL endpoint (adjust if different)
export const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:5009";

/**
 * Query the indexer GraphQL API
 */
export async function queryIndexer<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Indexer query failed: ${response.statusText}`);
  }

  const json = await response.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}

/**
 * Format USDC amount with decimals
 */
export function formatUSDC(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

/**
 * Format percentage
 */
export function formatPercent(num: number, denom: number): string {
  if (denom === 0) return "N/A";
  return ((num / denom) * 100).toFixed(2) + "%";
}

/**
 * Sleep for ms milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Colors for terminal output
 */
export const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

/**
 * Log with color
 */
export function log(message: string, color?: string): void {
  console.log(color ? `${color}${message}${colors.reset}` : message);
}

/**
 * Log success
 */
export function logSuccess(message: string): void {
  log(`✅ ${message}`, colors.green);
}

/**
 * Log error/mismatch
 */
export function logError(message: string): void {
  log(`❌ ${message}`, colors.red);
}

/**
 * Log warning
 */
export function logWarning(message: string): void {
  log(`⚠️  ${message}`, colors.yellow);
}

/**
 * Log info
 */
export function logInfo(message: string): void {
  log(`ℹ️  ${message}`, colors.cyan);
}

/**
 * Log section header
 */
export function logHeader(title: string): void {
  console.log();
  log(`${"=".repeat(60)}`, colors.bright);
  log(`  ${title}`, colors.bright);
  log(`${"=".repeat(60)}`, colors.bright);
  console.log();
}

/**
 * Compare two values and log result
 */
export function compare(
  label: string,
  indexerValue: unknown,
  onchainValue: unknown,
  formatter?: (val: unknown) => string
): { match: boolean; label: string } {
  const format = formatter ?? String;
  const match = String(indexerValue).toLowerCase() === String(onchainValue).toLowerCase();
  
  if (match) {
    logSuccess(`${label}: ${format(indexerValue)}`);
  } else {
    logError(`${label} MISMATCH!`);
    console.log(`   Indexer:  ${format(indexerValue)}`);
    console.log(`   On-chain: ${format(onchainValue)}`);
  }
  
  return { match, label };
}

/**
 * Compare bigint values with tolerance
 */
export function compareBigInt(
  label: string,
  indexerValue: bigint,
  onchainValue: bigint,
  tolerancePercent: number = 0.01
): { match: boolean; label: string; diff: bigint } {
  const diff = indexerValue > onchainValue 
    ? indexerValue - onchainValue 
    : onchainValue - indexerValue;
  
  const maxVal = indexerValue > onchainValue ? indexerValue : onchainValue;
  const tolerance = maxVal > 0n ? (maxVal * BigInt(Math.floor(tolerancePercent * 100))) / 10000n : 0n;
  
  const match = diff <= tolerance;
  
  if (match) {
    logSuccess(`${label}: ${formatUSDC(indexerValue)} USDC`);
    if (diff > 0n) {
      console.log(`   (diff: ${formatUSDC(diff)} USDC, within ${tolerancePercent}% tolerance)`);
    }
  } else {
    logError(`${label} MISMATCH!`);
    console.log(`   Indexer:  ${formatUSDC(indexerValue)} USDC`);
    console.log(`   On-chain: ${formatUSDC(onchainValue)} USDC`);
    console.log(`   Diff:     ${formatUSDC(diff)} USDC`);
  }
  
  return { match, label, diff };
}

/**
 * Batch process items with rate limiting
 */
export async function batchProcess<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: { batchSize?: number; delayMs?: number } = {}
): Promise<R[]> {
  const { batchSize = 10, delayMs = 100 } = options;
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((item, idx) => processor(item, i + idx))
    );
    results.push(...batchResults);
    
    if (i + batchSize < items.length) {
      await sleep(delayMs);
    }
  }
  
  return results;
}

/**
 * Summary of verification results
 */
export interface VerificationSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  mismatches: string[];
}

export function createSummary(): VerificationSummary {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
    mismatches: [],
  };
}

export function recordResult(summary: VerificationSummary, match: boolean, label: string): void {
  summary.total++;
  if (match) {
    summary.passed++;
  } else {
    summary.failed++;
    summary.mismatches.push(label);
  }
}

export function printSummary(summary: VerificationSummary): void {
  logHeader("VERIFICATION SUMMARY");
  
  console.log(`Total checks:  ${summary.total}`);
  logSuccess(`Passed:        ${summary.passed}`);
  if (summary.failed > 0) {
    logError(`Failed:        ${summary.failed}`);
  } else {
    console.log(`Failed:        ${summary.failed}`);
  }
  if (summary.warnings > 0) {
    logWarning(`Warnings:      ${summary.warnings}`);
  }
  
  console.log();
  console.log(`Pass rate: ${formatPercent(summary.passed, summary.total)}`);
  
  if (summary.mismatches.length > 0) {
    console.log();
    logError("Mismatches:");
    summary.mismatches.forEach((m) => console.log(`  - ${m}`));
  }
}




