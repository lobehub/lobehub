import type { AntigravityQuotaSnapshot } from '@lobechat/heterogeneous-agents/quota';

/** Old readings remain visible in the panel but never masquerade as a current badge. */
export const isAntigravityQuotaStale = (quota: AntigravityQuotaSnapshot, now: number) =>
  now - quota.updatedAt >= 120_000 ||
  quota.groups.some((group) =>
    group.buckets.some(
      (bucket) => !bucket.disabled && bucket.resetsAt !== null && bucket.resetsAt <= now,
    ),
  );

export const antigravityQuotaCompact = (quota: AntigravityQuotaSnapshot, now = Date.now()) => {
  if (quota.status !== 'ok' || isAntigravityQuotaStale(quota, now)) return [];
  const fractions = quota.groups.flatMap((group) =>
    group.buckets.flatMap((bucket) =>
      !bucket.disabled && bucket.remainingFraction !== null ? [bucket.remainingFraction] : [],
    ),
  );
  if (!fractions.length) return [];
  const remaining = Math.min(...fractions);
  return [
    {
      key: 'antigravity',
      ...(remaining > 0 && remaining < 0.001 ? { label: '<' } : {}),
      leftPercent: remaining === 0 ? 0 : Math.max(0.1, Math.round(remaining * 1000) / 10),
    },
  ];
};
