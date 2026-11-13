/** Coding-agent providers whose subscription accounts the quota layer tracks. */
export const QUOTA_ACCOUNT_PROVIDERS = ['claude-code', 'codex', 'kimi-code'] as const;
export type QuotaAccountProvider = (typeof QUOTA_ACCOUNT_PROVIDERS)[number];

/**
 * The Claude Code account an agent uses on one device. A login only exists on
 * the machine it was signed in on, so the Manual pick is made per device;
 * `accountId: null` means that device runs in Auto mode.
 */
export interface QuotaDeviceAccount {
  accountId: string | null;
}

/**
 * Auto: the load balancer rotates across the agent's candidates.
 * Manual: one account is pinned (on the run's device, or the legacy
 * agent-wide pin) and runs without balancing.
 */
export type QuotaLoadBalanceMode = 'auto' | 'manual';

/** An agent's load-balancing configuration, as the Agent Profile reads it. */
export interface QuotaLoadBalanceConfig {
  /**
   * Accounts the agent is authorized to schedule (enabled `pool` / `pinned`
   * bindings to accounts the caller can see). Many agents may authorize the
   * same account.
   */
  authorizedAccountIds: string[];
  /**
   * Accounts Auto mode chooses from: the authorized accounts that are not
   * switched off or disabled. Never includes an unauthorized account.
   */
  candidateAccountIds: string[];
  mode: QuotaLoadBalanceMode;
  /** The pinned account in Manual mode; `null` in Auto. */
  pinnedAccountId: string | null;
  /** Where the pin comes from: the run's device or the agent-wide pin. */
  pinScope: 'agent' | 'device' | null;
}

/**
 * Whether an agent → account binding authorizes the account for the agent: an
 * enabled `pool` or `pinned` row. `disabled` rows, switched-off rows and
 * missing rows do not, and such accounts never become load-balancing candidates.
 */
export const isAuthorizedQuotaBinding = (
  binding: { enabled: boolean; role: string } | null | undefined,
): boolean =>
  !!binding && binding.enabled && (binding.role === 'pool' || binding.role === 'pinned');
