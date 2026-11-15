import type {
  AntigravityQuotaParams,
  AntigravityQuotaSnapshot,
} from '@lobechat/heterogeneous-agents/quota';
import {
  createQuotaCacheKey,
  fetchAntigravityQuota,
  QuotaSnapshotCache,
} from '@lobechat/heterogeneous-agents/quota-sampler';

const quotaCache = new QuotaSnapshotCache<AntigravityQuotaSnapshot>({ freshMs: 60_000 });

/** Shared by the CLI daemon, Desktop gateway and local Desktop IPC. */
export const getAntigravityQuota = (params: AntigravityQuotaParams = {}) =>
  quotaCache.get(
    createQuotaCacheKey('antigravity', params.command, params.env),
    () => fetchAntigravityQuota(params),
    { force: params.force },
  );
