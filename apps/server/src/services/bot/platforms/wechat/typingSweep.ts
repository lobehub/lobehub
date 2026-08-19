import { WechatApiClient } from '@lobechat/chat-adapter-wechat';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { getInstallationStore } from '@/server/services/messenger/installations';

import { peekWindow, type WechatWindowRedis } from './contextWindow';
import {
  listActiveWechatTyping,
  type WechatTypingEntry,
  type WechatTypingRedis,
} from './typingRegistry';

const log = debug('bot-platform:wechat:typing-sweep');

interface WechatTypingCredentials {
  baseUrl?: string;
  botId?: string;
  botToken: string;
}

/** Injectable for tests. */
export interface WechatTypingSweepDeps {
  createApiClient?: (
    botToken: string,
    botId?: string,
    baseUrl?: string,
  ) => Pick<WechatApiClient, 'startTyping'>;
  resolveCredentials?: (entry: WechatTypingEntry) => Promise<WechatTypingCredentials | null>;
}

/** Bounds repeated DB/installation lookups across sweep passes. */
const CREDENTIAL_CACHE_TTL_MS = 10 * 60_000;
const credentialCache = new Map<
  string,
  { credentials: WechatTypingCredentials | null; expiresAt: number }
>();

/** Test-only. */
export const resetWechatTypingCredentialCache = (): void => credentialCache.clear();

const defaultResolveCredentials = async (
  entry: WechatTypingEntry,
): Promise<WechatTypingCredentials | null> => {
  if (entry.installationKey) {
    const store = getInstallationStore('wechat');
    const creds = await store?.resolveByKey(entry.installationKey);
    if (!creds?.botToken) return null;
    return { baseUrl: creds.baseUrl, botId: creds.botId, botToken: creds.botToken };
  }

  const serverDB = await getServerDB();
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
    serverDB,
    'wechat',
    entry.applicationId,
    gateKeeper,
  );
  const botToken = provider?.credentials.botToken?.trim();
  if (!botToken) return null;
  return {
    baseUrl: provider!.credentials.baseUrl,
    botId: provider!.credentials.botId,
    botToken,
  };
};

const resolveCached = async (
  entry: WechatTypingEntry,
  resolve: (entry: WechatTypingEntry) => Promise<WechatTypingCredentials | null>,
): Promise<WechatTypingCredentials | null> => {
  const cacheKey = `${entry.applicationId}:${entry.installationKey ?? ''}`;
  const hit = credentialCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.credentials;

  const credentials = await resolve(entry).catch(() => null);
  credentialCache.set(cacheKey, {
    credentials,
    expiresAt: Date.now() + CREDENTIAL_CACHE_TTL_MS,
  });
  return credentials;
};

/**
 * One typing sweep pass (LOBE-12812): read the registry, keep only the
 * entries this worker owns, and send one platform typing pulse per entry —
 * the resident-host equivalent of the gateway DO's typing alarm. Runs every
 * `WECHAT_TYPING_PULSE_INTERVAL_MS` for the worker's whole window, so typing
 * spans the entire generation (start → per-step renew → completion clear)
 * instead of flickering per step.
 *
 * Entirely best-effort: a missing send-window token, unresolvable
 * credentials, or a platform error skips that entry and never throws.
 */
export const runWechatTypingSweep = async (
  redis: WechatTypingRedis,
  owns: (applicationId: string) => boolean,
  deps: WechatTypingSweepDeps = {},
): Promise<void> => {
  try {
    const entries = (await listActiveWechatTyping(redis)).filter((entry) =>
      owns(entry.applicationId),
    );
    if (entries.length === 0) return;

    const createApiClient =
      deps.createApiClient ??
      ((token: string, botId?: string, baseUrl?: string) =>
        new WechatApiClient(token, botId, baseUrl));

    await Promise.all(
      entries.map(async (entry) => {
        try {
          const window = await peekWindow(
            redis as unknown as WechatWindowRedis,
            entry.applicationId,
            entry.wechatUserId,
          );
          const contextToken = window?.token;
          if (!contextToken) return;

          const credentials = await resolveCached(
            entry,
            deps.resolveCredentials ?? defaultResolveCredentials,
          );
          if (!credentials) return;

          const api = createApiClient(credentials.botToken, credentials.botId, credentials.baseUrl);
          // WechatApiClient.startTyping is documented best-effort and never throws.
          await api.startTyping(entry.wechatUserId, contextToken);
        } catch (err: any) {
          log('pulse failed for %s (ignored): %s', entry.applicationId, err?.message);
        }
      }),
    );
  } catch (err: any) {
    log('sweep failed (ignored): %s', err?.message);
  }
};
