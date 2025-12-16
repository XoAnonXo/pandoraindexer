/**
 * Error handling utilities
 */

const DEFAULT_RETRIES = 3;
const BASE_DELAY_MS = 100;

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = DEFAULT_RETRIES,
  delayMs = BASE_DELAY_MS
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry if it looks like a permanent schema/logic error
      // e.g. Prisma unique constraint violation (we handle that specifically in getOrCreate),
      // but generic DB connection errors are retryable.
      if (attempt < retries) {
        const sleepTime = delayMs * Math.pow(2, attempt);
        console.warn(`Operation failed, retrying in ${sleepTime}ms (Attempt ${attempt + 1}/${retries}). Error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, sleepTime));
      }
    }
  }
  
  throw lastError;
}

export function logAndRethrow(context: string, error: any): never {
  console.error(`[FATAL] ${context}:`, error);
  throw error;
}

export function logSoftError(context: string, error: any): void {
  console.warn(`[WARN] ${context}:`, error);
}





