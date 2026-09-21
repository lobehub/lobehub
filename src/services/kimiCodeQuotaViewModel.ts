import type {
  KimiCodeExtraUsage,
  KimiCodeQuotaSnapshot,
  QuotaAccountIdentity,
  QuotaLimitReading,
} from '@lobechat/heterogeneous-agents/quota';
import {
  buildKimiCodeQuotaWindows,
  kimiCodeQuotaReadings,
} from '@lobechat/heterogeneous-agents/quota';

export const buildKimiCodePanelSnapshot = (
  account: {
    externalAccountId?: string | null;
    metadata?: Record<string, unknown> | null;
    updatedAt?: Date | string | null;
  },
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
  // The wallet belongs to this account row (ingest writes it there), so it is
  // safe to serve without an identity-matched live sample — unlike a wallet
  // borrowed from another account's live sample.
  const persistedExtraUsage =
    (account.metadata?.['extraUsage'] as KimiCodeExtraUsage | null | undefined) ?? null;
  return {
    error: null,
    extraUsage: sample?.extraUsage ?? persistedExtraUsage,
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
