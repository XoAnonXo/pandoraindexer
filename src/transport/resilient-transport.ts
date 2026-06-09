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
  /** Consecutive failures before switching to fallback (default: 5) */
  failThreshold?: number;
  /** How often to retry primary after fallback (ms, default: 3600000 = 1 hour) */
  recoveryIntervalMs?: number;
}

export function createResilientTransport(opts: ResilientTransportOptions): Transport {
  const {
    primary,
    fallbacks,
    failThreshold = 5,
    recoveryIntervalMs = 60 * 60 * 1000,
  } = opts;

  let consecutiveFailures = 0;
  let usingFallback = false;
  let fallbackSince = 0;
  let currentFallbackIdx = 0;

  function getCurrentUrl(): string {
    if (!usingFallback) return primary;
    return fallbacks[currentFallbackIdx % fallbacks.length];
  }

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
      currentFallbackIdx = 0;
      console.warn(
        `[RPC] ⚠️ Primary RPC failed ${consecutiveFailures}x, switching to fallback: ${fallbacks[0]}`
      );
    }
  }

  function onFallbackFailure(): void {
    currentFallbackIdx++;
    if (currentFallbackIdx >= fallbacks.length) {
      currentFallbackIdx = 0;
    }
    console.warn(`[RPC] ⚠️ Fallback failed, rotating to: ${getCurrentUrl()}`);
  }

  async function makeRequest(url: string, body: any): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

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
      const tryPrimary = shouldTryPrimary();

      if (tryPrimary) {
        try {
          const result = await makeRequest(primary, {
            jsonrpc: "2.0",
            id: 1,
            method,
            params: params ?? [],
          });
          onPrimarySuccess();
          return result;
        } catch (err: any) {
          onPrimaryFailure();
          if (fallbacks.length === 0) throw err;
        }
      }

      for (let attempt = 0; attempt < fallbacks.length; attempt++) {
        const url = getCurrentUrl();
        try {
          const result = await makeRequest(url, {
            jsonrpc: "2.0",
            id: 1,
            method,
            params: params ?? [],
          });
          return result;
        } catch {
          onFallbackFailure();
        }
      }

      throw new Error(
        `[RPC] All RPCs failed (primary + ${fallbacks.length} fallbacks) for ${method}`
      );
    },
  } as TransportConfig["value"] as any);
}
