import { createTimingHelpers, getDurationMs } from '@lobechat/utils';

const { logger: timing } = createTimingHelpers('lobe-server:rate-limiter');

/**
 * Token bucket rate limiter for controlling API request rates.
 *
 * Supports both RPM (requests per minute) and TPM (tokens per minute) limits.
 * Uses a token bucket algorithm with automatic refill.
 */
export interface RateLimiterOptions {
  /** Maximum requests per minute */
  rpm: number;
  /** Maximum tokens per minute (optional) */
  tpm?: number;
  /** Initial tokens available (defaults to rpm) */
  initialTokens?: number;
}

export class RateLimiter {
  private requestTokens: number;
  private tokenTokens: number;
  private lastRefill: number;
  private readonly rpm: number;
  private readonly tpm?: number;
  private acquiring: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions) {
    this.rpm = options.rpm;
    this.tpm = options.tpm;
    this.requestTokens = options.initialTokens ?? options.rpm;
    this.tokenTokens = options.tpm ?? Infinity;
    this.lastRefill = Date.now();
  }

  /**
   * Acquire permission to make a request.
   * Blocks until a request slot is available.
   * Uses a Promise-chain mutex to prevent concurrent token consumption.
   *
   * @param tokenCount - Number of tokens this request will use (for TPM limiting)
   */
  async acquire(tokenCount?: number): Promise<void> {
    // Chain onto the previous acquire to serialize access
    const predecessor = this.acquiring;
    let release: () => void;
    this.acquiring = new Promise<void>((resolve) => {
      release = resolve;
    });

    await predecessor;

    try {
      const start = Date.now();
      this.refill();

      // Check if we have request capacity
      if (this.requestTokens < 1) {
        const waitTime = this.calculateRequestWaitTime();
        timing('rate-limiter: waiting %dms for request slot', waitTime);
        await this.sleep(waitTime);
        this.refill();
      }

      // Check if we have token capacity (if TPM is configured)
      if (this.tpm && tokenCount && tokenCount > 0) {
        if (this.tokenTokens < tokenCount) {
          const waitTime = this.calculateTokenWaitTime(tokenCount);
          timing('rate-limiter: waiting %dms for token capacity', waitTime);
          await this.sleep(waitTime);
          this.refill();
        }
      }

      // Consume tokens
      this.requestTokens = Math.max(0, this.requestTokens - 1);
      if (this.tpm && tokenCount && tokenCount > 0) {
        this.tokenTokens = Math.max(0, this.tokenTokens - tokenCount);
      }

      const elapsed = getDurationMs(start);
      if (elapsed > 0) {
        timing('rate-limiter: acquired in %dms', elapsed);
      }
    } finally {
      release!();
    }
  }

  /**
   * Try to acquire permission without blocking.
   * Returns true if acquired, false if would need to wait.
   */
  tryAcquire(tokenCount?: number): boolean {
    this.refill();

    if (this.requestTokens < 1) {
      return false;
    }

    if (this.tpm && tokenCount && tokenCount > 0 && this.tokenTokens < tokenCount) {
      return false;
    }

    this.requestTokens = Math.max(0, this.requestTokens - 1);
    if (this.tpm && tokenCount && tokenCount > 0) {
      this.tokenTokens = Math.max(0, this.tokenTokens - tokenCount);
    }

    return true;
  }

  /**
   * Get current available request tokens (for monitoring).
   */
  get availableRequestTokens(): number {
    this.refill();
    return Math.floor(this.requestTokens);
  }

  /**
   * Get current available token capacity (for monitoring).
   */
  get availableTokenCapacity(): number {
    if (!this.tpm) return Infinity;
    this.refill();
    return Math.floor(this.tokenTokens);
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;

    if (elapsedMs <= 0) return;

    // Refill request tokens: rpm per minute
    const requestRefill = (elapsedMs / 60_000) * this.rpm;
    this.requestTokens = Math.min(this.rpm, this.requestTokens + requestRefill);

    // Refill token tokens: tpm per minute (if configured)
    if (this.tpm) {
      const tokenRefill = (elapsedMs / 60_000) * this.tpm;
      this.tokenTokens = Math.min(this.tpm, this.tokenTokens + tokenRefill);
    }

    this.lastRefill = now;
  }

  private calculateRequestWaitTime(): number {
    // Time until we have at least 1 request token
    const deficit = 1 - this.requestTokens;
    return Math.max(0, (deficit / this.rpm) * 60_000);
  }

  private calculateTokenWaitTime(tokenCount: number): number {
    if (!this.tpm) return 0;
    // Time until we have enough token capacity
    const deficit = tokenCount - this.tokenTokens;
    return Math.max(0, (deficit / this.tpm) * 60_000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Global rate limiter registry for managing per-provider limiters.
 */
const limiters = new Map<string, RateLimiter>();

/**
 * Get or create a rate limiter for a specific provider/model combination.
 *
 * @param key - Unique key (e.g., "openai", "siliconcloud/Qwen/Qwen3.6-35B-A3B")
 * @param options - Rate limiter configuration (only used on first call)
 */
export function getRateLimiter(key: string, options?: RateLimiterOptions): RateLimiter | null {
  if (!options) {
    return limiters.get(key) ?? null;
  }

  if (!limiters.has(key)) {
    limiters.set(key, new RateLimiter(options));
  }

  return limiters.get(key)!;
}

/**
 * Clear all rate limiters (useful for testing).
 */
export function clearRateLimiters(): void {
  limiters.clear();
}
