/** Native agy quota buckets; no inferred windows, capacity or credit balance. */
export interface AntigravityQuotaBucket {
  disabled: boolean;
  id: string;
  name: string;
  remainingAmount: number | null;
  remainingFraction: number | null;
  resetsAt: number | null;
  window: string | null;
}

export interface AntigravityQuotaGroup {
  buckets: AntigravityQuotaBucket[];
  name: string;
}

export interface AntigravityQuotaParams {
  command?: string;
  env?: Record<string, string>;
  force?: boolean;
}

export type AntigravityQuotaErrorCode =
  'auth_required' | 'cli_not_found' | 'command_failed' | 'timeout' | 'unsupported_client';

export interface AntigravityQuotaSnapshot {
  error: string | null;
  errorCode?: AntigravityQuotaErrorCode;
  groups: AntigravityQuotaGroup[];
  provider: 'antigravity';
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
}
