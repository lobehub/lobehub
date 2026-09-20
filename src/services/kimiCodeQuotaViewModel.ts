import type {
  KimiCodeQuotaSnapshot,
  QuotaAccountIdentity,
  QuotaLimitReading,
} from '@lobechat/heterogeneous-agents/quota';
import {
  buildKimiCodeQuotaWindows,
  kimiCodeQuotaReadings,
} from '@lobechat/heterogeneous-agents/quota';

export const buildKimiCodePanelSnapshot = (
  account: { externalAccountId?: string | null; updatedAt?: Date | string | null },
  persisted: QuotaLimitReading[],
  live: KimiCodeQuotaSnapshot | null,
  now = Date.now(),
): KimiCodeQuotaSnapshot => {
  const sample =
    live?.status === 'ok' && live.identity?.externalAccountId === account.externalAccountId
      ? live
      : null;
  const liveReadings =
    sample?.readings ??
    (sample
      ? kimiCodeQuotaReadings(
          {
            monthly: sample.monthly,
            monthlyCode: sample.monthlyCode,
            session: sample.session,
            weekly: sample.weekly,
          },
          sample.updatedAt,
        )
      : []);
  const windows = buildKimiCodeQuotaWindows([...persisted, ...liveReadings], now);
  const identity: QuotaAccountIdentity = {
    externalAccountId: account.externalAccountId ?? undefined,
  };
  return {
    error: null,
    extraUsage: sample?.extraUsage ?? null,
    identity,
    monthly: windows.monthly,
    monthlyCode: windows.monthlyCode,
    provider: 'kimi-code',
    session: windows.session,
    status: 'ok',
    updatedAt:
      Math.max(
        account.updatedAt ? new Date(account.updatedAt).getTime() : 0,
        sample?.updatedAt ?? 0,
      ) || now,
    weekly: windows.weekly,
  };
};
