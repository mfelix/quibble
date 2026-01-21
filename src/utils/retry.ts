export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  jitterFactor: 0.2,
};

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: Error
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  isRetryable: (error: Error) => boolean,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryable(lastError) || attempt === opts.maxAttempts) {
        throw lastError;
      }

      const delay = calculateDelay(attempt, opts);
      await sleep(delay);
    }
  }

  throw new RetryError(
    `Operation failed after ${opts.maxAttempts} attempts`,
    opts.maxAttempts,
    lastError!
  );
}

function calculateDelay(attempt: number, opts: RetryOptions): number {
  const exponentialDelay = opts.baseDelayMs * Math.pow(2, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, opts.maxDelayMs);
  const jitter = cappedDelay * opts.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, cappedDelay + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isTransientError(error: Error): boolean {
  const message = error.message.toLowerCase();

  if (message.includes('timeout') || message.includes('timed out')) return true;
  if (message.includes('econnrefused') || message.includes('econnreset')) return true;
  if (message.includes('network') || message.includes('socket')) return true;
  if (message.includes('rate limit') || message.includes('429')) return true;
  if (message.includes('too many requests')) return true;
  if (message.includes('503') || message.includes('service unavailable')) return true;
  if (message.includes('502') || message.includes('bad gateway')) return true;

  return false;
}
