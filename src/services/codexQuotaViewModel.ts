import type {
  CodexQuotaSnapshot,
  QuotaAccountIdentity,
  QuotaLimitReading,
} from '@lobechat/heterogeneous-agents/quota';
import { buildCodexRateLimits, codexQuotaReadings } from '@lobechat/heterogeneous-agents/quota';

export const buildCodexPanelSnapshot = (
  account: { externalAccountId?: string | null; updatedAt?: Date | string | null },
  persisted: QuotaLimitReading[],
  live: CodexQuotaSnapshot | null,
  now = Date.now(),
): CodexQuotaSnapshot => {
  const sample =
    live?.status === 'ok' && live.identity?.externalAccountId === account.externalAccountId
      ? live
      : null;
  const liveReadings =
    sample?.readings ??
    (sample
      ? codexQuotaReadings(
          sample.rateLimits ?? [
            {
              limitId: 'codex',
              limitName: null,
              primary: sample.session,
              secondary: sample.weekly,
            },
          ],
          sample.updatedAt,
        )
      : []);
  const rateLimits = buildCodexRateLimits([...persisted, ...liveReadings], now);
  const primary = rateLimits.find((limit) => limit.limitId === 'codex') ?? rateLimits[0];
  const identity: QuotaAccountIdentity = {
    externalAccountId: account.externalAccountId ?? undefined,
  };
  return {
    error: null,
    identity,
    provider: 'codex',
    rateLimitResetCredits: sample?.rateLimitResetCredits,
    rateLimits,
    session: primary?.primary ?? null,
    status: 'ok',
    updatedAt:
      Math.max(
        account.updatedAt ? new Date(account.updatedAt).getTime() : 0,
        sample?.updatedAt ?? 0,
      ) || now,
    weekly: primary?.secondary ?? null,
  };
};
