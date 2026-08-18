import { WechatApiClient } from '@lobechat/chat-adapter-wechat';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { isWechatHostRuntimeActive } from '@/server/services/gateway/wechatPoll/mode';
import { getInstallationStore } from '@/server/services/messenger/installations';
import type { ChatTopicBotContext } from '@/types/topic';

import { peekWindow, type WechatWindowRedis } from './contextWindow';

const log = debug('bot-platform:wechat:typing-keeper');

/** Matches the gateway DO's typing cadence (iLink typing display is short-lived). */
const TYPING_PULSE_INTERVAL_MS = 4000;
/** Hard stop: never outlive a stuck step. Mirrors the DO's typing timeout. */
const TYPING_KEEPER_MAX_MS = 60_000;

type StopTypingKeeper = () => void;

const NOOP: StopTypingKeeper = () => {};

interface WechatTypingCredentials {
  baseUrl?: string;
  botId?: string;
  botToken: string;
}

/** Injectable for tests. */
export interface WechatTypingKeeperDeps {
  createApiClient?: (
    botToken: string,
    botId?: string,
    baseUrl?: string,
  ) => Pick<WechatApiClient, 'startTyping'>;
  intervalMs?: number;
  redis?: WechatWindowRedis | null;
  resolveCredentials?: (botContext: ChatTopicBotContext) => Promise<WechatTypingCredentials | null>;
}

const defaultResolveCredentials = async (
  botContext: ChatTopicBotContext,
): Promise<WechatTypingCredentials | null> => {
  if (botContext.messengerInstallationKey) {
    const store = getInstallationStore('wechat');
    const creds = await store?.resolveByKey(botContext.messengerInstallationKey);
    if (!creds?.botToken) return null;
    return { baseUrl: creds.baseUrl, botId: creds.botId, botToken: creds.botToken };
  }

  const serverDB = await getServerDB();
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
    serverDB,
    'wechat',
    botContext.applicationId,
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

/**
 * Direct WeChat typing keeper for step execution (LOBE-12812, plan B).
 *
 * When the message gateway does not manage WeChat (unmanaged-platforms slot),
 * nothing keeps the typing indicator alive through a long LLM step — the
 * gateway DO used to own that with its alarm loop. This keeper runs inside
 * the step-executing request instead: pulse `getconfig` + `sendtyping` every
 * 4s using the context token persisted by the inbound pipeline, and stop when
 * the step finishes. Gaps between steps are sub-second and invisible.
 *
 * Entirely best-effort: any missing piece (not a WeChat run, gateway still
 * manages WeChat, no credentials, no send-window token) resolves to a no-op
 * stop function; nothing here may ever fail a step.
 */
export const startWechatTypingKeeper = async (
  botContext: ChatTopicBotContext | undefined,
  deps: WechatTypingKeeperDeps = {},
): Promise<StopTypingKeeper> => {
  try {
    if (!botContext?.platformThreadId?.startsWith('wechat:')) return NOOP;
    if (!botContext.applicationId) return NOOP;

    // platformThreadId format: wechat:{type}:{userId} (userId may contain colons)
    const wechatUserId = botContext.platformThreadId.split(':').slice(2).join(':');
    if (!wechatUserId) return NOOP;

    const redis =
      deps.redis !== undefined
        ? deps.redis
        : (getAgentRuntimeRedisClient() as unknown as WechatWindowRedis | null);
    if (!redis) return NOOP;

    // While the gateway still owns WeChat (recorded actual mode), its
    // connection object drives typing from the message stream it owns;
    // pulsing here too would double up.
    if (!(await isWechatHostRuntimeActive(redis))) return NOOP;

    const window = await peekWindow(redis, botContext.applicationId, wechatUserId);
    const contextToken = window?.token;
    if (!contextToken) return NOOP;

    const credentials = await (deps.resolveCredentials ?? defaultResolveCredentials)(botContext);
    if (!credentials) return NOOP;

    const createApiClient =
      deps.createApiClient ??
      ((token: string, botId?: string, baseUrl?: string) =>
        new WechatApiClient(token, botId, baseUrl));
    const api = createApiClient(credentials.botToken, credentials.botId, credentials.baseUrl);

    const pulse = () => {
      // WechatApiClient.startTyping is documented best-effort and never throws.
      void api.startTyping(wechatUserId, contextToken);
    };

    pulse();
    const interval = setInterval(pulse, deps.intervalMs ?? TYPING_PULSE_INTERVAL_MS);
    const maxTimer = setTimeout(() => clearInterval(interval), TYPING_KEEPER_MAX_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(maxTimer);
    };
  } catch (err: any) {
    log('typing keeper init failed (ignored): %s', err?.message);
    return NOOP;
  }
};
