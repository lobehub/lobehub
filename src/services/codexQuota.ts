import type { CodexQuotaSnapshot } from '@lobechat/heterogeneous-agents/quota';

import { getAgentQuotaStoreState } from '@/store/agentQuota';

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

const quotaReads = () => getAgentQuotaStoreState();

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
      readPersisted(quotaReads().readQuotaAccounts(), []),
      source.agentId ? readPersisted(quotaReads().readQuotaBindings(source.agentId), []) : [],
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
      ? await readPersisted(quotaReads().readQuotaReadings(account.id), [])
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
    let ingested = false;
    const externalAccountId = live?.identity?.externalAccountId;
    if (live?.status === 'ok' && externalAccountId) {
      trustedAccountId = externalAccountId;
      account = accounts.find((item) => item.externalAccountId === externalAccountId);
      readings = account ? await readPersisted(quotaReads().readQuotaReadings(account.id), []) : [];
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
          ingested = true;
          account = await agentQuotaService.ingestCodexSnapshot({
            identity: live.identity!,
            readings: fresh,
          });
          // The ingest moved the account's `updatedAt` (and may have created it).
          void readPersisted(quotaReads().readQuotaAccounts({ fresh: true }), []);
        } catch (error) {
          console.error('[codexQuota:ingest]', error);
        }
      }
      if (source.deviceId && !account) {
        account = (await readPersisted(quotaReads().readQuotaAccounts({ fresh: true }), [])).find(
          (item) => item.provider === 'codex' && item.externalAccountId === externalAccountId,
        );
      }
      // The device sampler ingests server-side, and a local ingest just wrote
      // new readings: both make the replica's copy outdated.
      if (account)
        readings = await readPersisted(
          quotaReads().readQuotaReadings(account.id, { fresh: !!source.deviceId || ingested }),
          [],
        );
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
        const account = await agentQuotaService.ingestCodexSnapshot({
          identity: snapshot.identity,
          readings: snapshot.readings,
        });
        // The replica still holds the pre-ingest account / readings: refresh both,
        // so a reader mounted inside the dedupe window does not paint them again.
        await Promise.all([
          readPersisted(quotaReads().readQuotaAccounts({ fresh: true }), []),
          account?.id
            ? readPersisted(quotaReads().readQuotaReadings(account.id, { fresh: true }), [])
            : undefined,
        ]);
      }
    },
  });
};
