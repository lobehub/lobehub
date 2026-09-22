import type { KimiCodeQuotaSnapshot } from '@lobechat/heterogeneous-agents/quota';

import { agentQuotaService } from './agentQuota';
import { heterogeneousAgentService } from './electron/heterogeneousAgent';
import { buildKimiCodePanelSnapshot } from './kimiCodeQuotaViewModel';

const REFRESH_MS = 2 * 60_000;

interface KimiCodeQuotaSource {
  agentId?: string;
  deviceId?: string;
  env?: Record<string, string>;
}

interface FetchOptions {
  force?: boolean;
  onInterim?: (snapshot: KimiCodeQuotaSnapshot) => void;
  revalidate?: boolean;
}

const readPersisted = async <T>(request: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await request;
  } catch (error) {
    console.error('[kimiCodeQuota:read-persisted]', error);
    return fallback;
  }
};

/** Device/profile sources identify their login before reusing persisted data. */
export const createKimiCodeQuotaReader = (source: KimiCodeQuotaSource) => {
  let trustedAccountId: string | undefined;
  let lastLive: KimiCodeQuotaSnapshot | null = null;
  const readQuota = async (options: FetchOptions = {}): Promise<KimiCodeQuotaSnapshot> => {
    const [allAccounts, bindings] = await Promise.all([
      readPersisted(agentQuotaService.listAccounts(), []),
      source.agentId ? readPersisted(agentQuotaService.listBindings(source.agentId), []) : [],
    ]);
    const accounts = allAccounts.filter((account) => account.provider === 'kimi-code');
    const pinnedId = bindings.find((binding) => binding.role === 'pinned')?.accountId;
    let account =
      source.deviceId || source.env?.KIMI_CODE_HOME
        ? accounts.find((item) => item.externalAccountId === trustedAccountId)
        : (accounts.find((item) => item.externalAccountId === trustedAccountId) ??
          accounts.find((item) => item.id === pinnedId) ??
          accounts[0]);
    let readings = account
      ? await readPersisted(agentQuotaService.getLatestReadings(account.id), [])
      : [];
    const persisted =
      account && readings.length ? buildKimiCodePanelSnapshot(account, readings, lastLive) : null;
    const receivedAt = account?.updatedAt ? new Date(account.updatedAt).getTime() : 0;
    if (persisted && !options.force && !options.revalidate && Date.now() - receivedAt < REFRESH_MS)
      return persisted;
    if (persisted) options.onInterim?.(persisted);

    let live: KimiCodeQuotaSnapshot | null;
    try {
      live = source.deviceId
        ? await agentQuotaService.refreshKimiCodeQuota({
            env: source.env,
            deviceId: source.deviceId,
            ...(options.force ? { force: true } : {}),
          })
        : await heterogeneousAgentService.getKimiCodeQuota({
            env: source.env,
            ...(options.force ? { force: true } : {}),
          });
    } catch (error) {
      console.error('[kimiCodeQuota:refresh]', error);
      if (persisted) return persisted;
      throw error;
    }
    if (live?.status === 'ok') lastLive = live;
    const externalAccountId = live?.identity?.externalAccountId;
    if (live?.status === 'ok' && externalAccountId) {
      trustedAccountId = externalAccountId;
      account = accounts.find((item) => item.externalAccountId === externalAccountId);
      readings = account
        ? await readPersisted(agentQuotaService.getLatestReadings(account.id), [])
        : [];
      const fresh = live.readings?.filter(
        (reading) =>
          !readings.some(
            (previous) =>
              previous.limitType === reading.limitType &&
              previous.scopeKey === reading.scopeKey &&
              previous.capturedAt >= reading.capturedAt,
          ),
      );
      // Ingest when there are new readings OR a wallet to persist — the wallet
      // moves independently of the limit windows.
      if (!source.deviceId && (fresh?.length || live.extraUsage)) {
        try {
          account = await agentQuotaService.ingestKimiCodeSnapshot({
            extraUsage: live.extraUsage,
            identity: live.identity!,
            readings: fresh ?? [],
          });
        } catch (error) {
          console.error('[kimiCodeQuota:ingest]', error);
        }
      }
      if (source.deviceId && !account) {
        account = (await readPersisted(agentQuotaService.listAccounts(), [])).find(
          (item) => item.provider === 'kimi-code' && item.externalAccountId === externalAccountId,
        );
      }
      if (account)
        readings = await readPersisted(agentQuotaService.getLatestReadings(account.id), []);
    } else if (live?.status === 'ok') {
      // A successful but unidentified login must not inherit the previous account.
      trustedAccountId = undefined;
      account = undefined;
      readings = [];
    }
    // A deterministically unavailable login (missing/expired credentials) is a
    // current fact, not a gap to paper over with stale readings — surface it so
    // the panel shows the sign-in guidance instead of stale quota.
    if (live?.status === 'unavailable') return live;
    if (account && readings.length) return buildKimiCodePanelSnapshot(account, readings, live);
    return (
      live ??
      persisted ?? {
        error: 'Device is unavailable',
        extraUsage: null,
        monthly: null,
        monthlyCode: null,
        provider: 'kimi-code',
        session: null,
        status: 'error',
        updatedAt: Date.now(),
        weekly: null,
      }
    );
  };
  return Object.assign(readQuota, {
    acceptLocalSnapshot: async (snapshot: KimiCodeQuotaSnapshot) => {
      lastLive = snapshot;
      if (
        snapshot.status === 'ok' &&
        snapshot.identity?.externalAccountId &&
        snapshot.readings?.length
      ) {
        trustedAccountId = snapshot.identity.externalAccountId;
        await agentQuotaService.ingestKimiCodeSnapshot({
          extraUsage: snapshot.extraUsage,
          identity: snapshot.identity,
          readings: snapshot.readings,
        });
      }
    },
  });
};
