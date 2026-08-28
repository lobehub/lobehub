import type { ClaudeCodeQuotaSnapshot } from '@lobechat/heterogeneous-agents/quota';
import {
  CLAUDE_CODE_QUOTA_FRESH_MS,
  createQuotaCacheKey,
  fetchClaudeCodeQuota,
  QuotaSnapshotCache,
} from '@lobechat/heterogeneous-agents/quota-sampler';

export interface GetClaudeCodeQuotaParams {
  /** Agent-configured env overrides (external-auth detection, CLAUDE_CONFIG_DIR). */
  env?: Record<string, string>;
  force?: boolean;
}

// One cache per device host process (`lh connect` daemon / desktop gateway
// connection): every web client polling this device's quota coalesces into a
// single usage-API request per fresh window.
const quotaCache = new QuotaSnapshotCache<ClaudeCodeQuotaSnapshot>({
  freshMs: CLAUDE_CODE_QUOTA_FRESH_MS,
});

/**
 * Sample the Claude Code subscription quota of the login on THIS device, for
 * the `getClaudeCodeQuota` device RPC. Same sampler as the desktop IPC path:
 * credentials from Keychain / config dir, snapshot from the Anthropic OAuth
 * usage API — no CLI spawned.
 */
export const getClaudeCodeQuota = (
  params: GetClaudeCodeQuotaParams = {},
): Promise<ClaudeCodeQuotaSnapshot> =>
  quotaCache.get(
    createQuotaCacheKey('claude-code', params.env),
    () => fetchClaudeCodeQuota({ env: params.env }),
    { force: params.force },
  );
