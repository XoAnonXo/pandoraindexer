/**
 * Resilient RPC Transport
 *
 * Wraps a primary (paid) RPC with fallback (free) RPCs.
 * Switches to fallback after consecutive failures, and periodically
 * retries the primary to recover when it comes back online.
 *
 * Usage:
 *   import { createResilientTransport } from "./src/transport/resilient-transport";
 *   transport: createResilientTransport({
 *     primary: "https://paid-rpc.example.com/key",
 *     fallbacks: ["https://free1.example.com", "https://free2.example.com"],
 *   })
 */

import { type Transport, type TransportConfig, custom } from "viem";

interface ResilientTransportOptions {
  primary: string;
  fallbacks: string[];
  /** Consecutive failures before switching to fallback (default: 3) */
  failThreshold?: number;
  /** How often to retry primary after fallback (ms, default: 60000 = 1 min) */
  recoveryIntervalMs?: number;
  /** Request timeout in ms (default: 30000) */
  requestTimeoutMs?: number;
}

export function createResilientTransport(opts: ResilientTransportOptions): Transport {
  const {
    primary,
    fallbacks,
    failThreshold = 3,
    recoveryIntervalMs = 60_000,
    requestTimeoutMs = 30_000,
  } = opts;

  let consecutiveFailures = 0;
  let usingFallback = false;
  let fallbackSince = 0;
  let lastFallbackIdx = 0;

  function shouldTryPrimary(): boolean {
    if (!usingFallback) return true;
    return Date.now() - fallbackSince >= recoveryIntervalMs;
  }

  function onPrimarySuccess(): void {
    if (usingFallback) {
      console.log(`[RPC] ✅ Primary RPC recovered, switching back from fallback`);
    }
    consecutiveFailures = 0;
    usingFallback = false;
  }

  function onPrimaryFailure(): void {
    consecutiveFailures++;
    if (consecutiveFailures >= failThreshold && !usingFallback) {
      usingFallback = true;
      fallbackSince = Date.now();
      lastFallbackIdx = 0;
      console.warn(
        `[RPC] ⚠️ Primary RPC failed ${consecutiveFailures}x, switching to fallback: ${fallbacks[0]}`
      );
    }
  }

  async function makeRequest(url: string, body: any): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();

      if (json.error) {
        throw new Error(`RPC error: ${json.error.message || JSON.stringify(json.error)}`);
      }

      return json.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  return custom({
    async request({ method, params }: { method: string; params?: any[] }) {
      const rpcBody = { jsonrpc: "2.0", id: 1, method, params: params ?? [] };
      const tryPrimary = shouldTryPrimary();

      if (tryPrimary) {
        try {
          const result = await makeRequest(primary, rpcBody);
          onPrimarySuccess();
          return result;
        } catch (err: any) {
          onPrimaryFailure();
          if (fallbacks.length === 0) throw err;
        }
      }

      // Round-robin through fallbacks starting from where we left off
      const startIdx = lastFallbackIdx;
      for (let i = 0; i < fallbacks.length; i++) {
        const idx = (startIdx + i) % fallbacks.length;
        const url = fallbacks[idx];
        try {
          const result = await makeRequest(url, rpcBody);
          lastFallbackIdx = idx;
          return result;
        } catch {
          console.warn(`[RPC] ⚠️ Fallback ${idx + 1}/${fallbacks.length} failed (${url})`);
        }
      }
      // Advance index for next request so we don't always start on the same dead node
      lastFallbackIdx = (startIdx + 1) % fallbacks.length;

      throw new Error(
        `[RPC] All RPCs failed (primary + ${fallbacks.length} fallbacks) for ${method}`
      );
    },
  } as TransportConfig["value"] as any);
}
