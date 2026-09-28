import type { CodexQuotaSnapshot } from '@lobechat/heterogeneous-agents/quota';

import { agentQuotaService } from './agentQuota';
import { buildCodexPanelSnapshot } from './codexQuotaViewModel';
import { heterogeneousAgentService } from './electron/heterogeneousAgent';

const REFRESH_MS = 2 * 60_000;

interface CodexQuotaSource {
  agentId?: string;
  command?: string;
  deviceId?: string;
  env?: Record<string, string>;
}

interface FetchOptions {
  force?: boolean;
  onInterim?: (snapshot: CodexQuotaSnapshot) => void;
  revalidate?: boolean;
}

const readPersisted = async <T>(request: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await request;
  } catch (error) {
    console.error('[codexQuota:read-persisted]', error);
    return fallback;
  }
};

/** Device/profile sources identify their login before reusing persisted data. */
export const createCodexQuotaReader = (source: CodexQuotaSource) => {
  let trustedAccountId: string | undefined;
  let lastLive: CodexQuotaSnapshot | null = null;
  const readQuota = async (options: FetchOptions = {}): Promise<CodexQuotaSnapshot> => {
    const [allAccounts, bindings] = await Promise.all([
      readPersisted(agentQuotaService.listAccounts(), []),
      source.agentId ? readPersisted(agentQuotaService.listBindings(source.agentId), []) : [],
    ]);
    const accounts = allAccounts.filter((account) => account.provider === 'codex');
    const pinnedId = bindings.find((binding) => binding.role === 'pinned')?.accountId;
    let account =
      source.deviceId || source.env?.CODEX_HOME
        ? accounts.find((item) => item.externalAccountId === trustedAccountId)
        : (accounts.find((item) => item.externalAccountId === trustedAccountId) ??
          accounts.find((item) => item.id === pinnedId) ??
          accounts[0]);
    let readings = account
      ? await readPersisted(agentQuotaService.getLatestReadings(account.id), [])
      : [];
    const persisted =
      account && readings.length ? buildCodexPanelSnapshot(account, readings, lastLive) : null;
    const receivedAt = account?.updatedAt ? new Date(account.updatedAt).getTime() : 0;
    if (persisted && !options.force && !options.revalidate && Date.now() - receivedAt < REFRESH_MS)
      return persisted;
    if (persisted) options.onInterim?.(persisted);

    let live: CodexQuotaSnapshot | null;
    try {
      live = source.deviceId
        ? await agentQuotaService.refreshCodexQuota({
            command: source.command,
            env: source.env,
            deviceId: source.deviceId,
            ...(options.force ? { force: true } : {}),
          })
        : await heterogeneousAgentService.getCodexQuota({
            command: source.command,
            env: source.env,
            ...(options.force ? { force: true } : {}),
          });
    } catch (error) {
      console.error('[codexQuota:refresh]', error);
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
      if (!source.deviceId && fresh?.length) {
        try {
          account = await agentQuotaService.ingestCodexSnapshot({
            identity: live.identity!,
            readings: fresh,
          });
        } catch (error) {
          console.error('[codexQuota:ingest]', error);
        }
      }
      if (source.deviceId && !account) {
        account = (await readPersisted(agentQuotaService.listAccounts(), [])).find(
          (item) => item.provider === 'codex' && item.externalAccountId === externalAccountId,
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
    if (account && readings.length) return buildCodexPanelSnapshot(account, readings, live);
    return (
      live ??
      persisted ?? {
        error: 'Device is unavailable',
        provider: 'codex',
        session: null,
        status: 'error',
        updatedAt: Date.now(),
        weekly: null,
      }
    );
  };
  return Object.assign(readQuota, {
    acceptLocalSnapshot: async (snapshot: CodexQuotaSnapshot) => {
      lastLive = snapshot;
      if (
        snapshot.status === 'ok' &&
        snapshot.identity?.externalAccountId &&
        snapshot.readings?.length
      ) {
        trustedAccountId = snapshot.identity.externalAccountId;
        await agentQuotaService.ingestCodexSnapshot({
          identity: snapshot.identity,
          readings: snapshot.readings,
        });
      }
    },
  });
};
