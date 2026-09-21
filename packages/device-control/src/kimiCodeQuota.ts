import type { KimiCodeQuotaSnapshot } from '@lobechat/heterogeneous-agents/quota';
import {
  createQuotaCacheKey,
  fetchKimiCodeQuota,
  KIMI_CODE_QUOTA_FRESH_MS,
  QuotaSnapshotCache,
} from '@lobechat/heterogeneous-agents/quota-sampler';

export interface GetKimiCodeQuotaParams {
  /** Agent-configured env overrides (KIMI_CODE_HOME / KIMI_CODE_BASE_URL). */
  env?: Record<string, string>;
  force?: boolean;
}

// One cache per device host process (`lh connect` daemon / desktop gateway
// connection): every web client polling this device's quota coalesces into a
// single usage-API request per fresh window.
const quotaCache = new QuotaSnapshotCache<KimiCodeQuotaSnapshot>({
  freshMs: KIMI_CODE_QUOTA_FRESH_MS,
});

/**
 * Sample the Kimi Code subscription quota of the login on THIS device, for the
 * `getKimiCodeQuota` device RPC. Same sampler as the desktop IPC path:
 * credentials from the CLI's credential file, snapshot from the Kimi usage API
 * — no CLI spawned.
 */
export const getKimiCodeQuota = (
  params: GetKimiCodeQuotaParams = {},
): Promise<KimiCodeQuotaSnapshot> =>
  quotaCache.get(
    createQuotaCacheKey('kimi-code', params.env),
    () => fetchKimiCodeQuota({ env: params.env }),
    { force: params.force },
  );
