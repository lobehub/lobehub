export type RedisConfig = {
  database?: number;
  enabled: boolean;
  password?: string;
  prefix: string;
  tls: boolean;
  url: string;
  username?: string;
  /**
   * Per-command timeout in milliseconds. Defaults to the provider's own bound
   * (10s) when unset. Best-effort callers on a hot path may set it shorter so a
   * stalled client degrades to their fallback promptly instead of blocking.
   */
  commandTimeoutMs?: number;
  /** Connection timeout in milliseconds. Defaults to the provider's own bound (10s) when unset. */
  connectTimeoutMs?: number;
};
