import type { LlmRelayDeadlines } from '@lobechat/agent-gateway-client';
import type {
  ChatMethodOptions,
  ChatStreamPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
  ModelRuntime,
  PullModelParams,
} from '@lobechat/model-runtime';
import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { createStreamEventManager } from '../factory';
import { getAgentRuntimeRedisClient } from '../redis';
import type { IStreamEventManager } from '../types';
import { createClientLlmExecutorUnavailableError } from './errors';
import { DEFAULT_LLM_RELAY_DEADLINES } from './protocol';
import { RelayModelRuntime } from './RelayModelRuntime';
import type { LlmRelayRequestScope } from './requestScope';
import { getLlmRelayRequestScope } from './requestScope';
import { resolveProviderRelay } from './resolveLlmExecutionSite';

const log = debug('lobe-server:agent-runtime:llm-relay:one-shot');

/**
 * One-shot relay (T-667): an LLM call made outside any agent run — a topic
 * title, a translation, a provider check — whose provider only the user's
 * device can reach. The tab that asks for it subscribes to a fresh gateway
 * channel (`llmcall:<userId>:<nonce>`) and names it in the request headers;
 * the server opens that channel, dispatches the call's `llm_execute` on it
 * through {@link RelayModelRuntime}, and returns the device's result to the
 * caller like any provider result.
 *
 * The channel lives as long as the request: every relayed call the request
 * makes uses it, and it is closed when the request ends. A call made without
 * such a request — a bot webhook, a workflow, a cron, work deferred past the
 * response — has no device to run on and fails at once (`no_executor`).
 */

/** The runtime methods a request-scoped caller uses, wherever the call runs. */
export type RequestModelRuntime = Pick<
  ModelRuntime,
  'chat' | 'generateObject' | 'models' | 'pullModel'
>;

/**
 * One-shot calls run inside a request, not a 600 s step: keep the whole call
 * well inside a route's `maxDuration`.
 */
const ONE_SHOT_DEADLINES: LlmRelayDeadlines = { ...DEFAULT_LLM_RELAY_DEADLINES, totalMs: 240_000 };

interface OneShotRelayRuntimeParams {
  deadlines: LlmRelayDeadlines;
  provider: string;
  redis: NonNullable<ReturnType<typeof getAgentRuntimeRedisClient>>;
  runtimeProvider: string;
  scope: LlmRelayRequestScope;
  streamManager: IStreamEventManager;
}

/**
 * The request's provider runtime when the provider runs on the device: each
 * method is one relayed call on the request's channel.
 */
class OneShotRelayRuntime implements RequestModelRuntime {
  constructor(private readonly params: OneShotRelayRuntimeParams) {}

  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    return (await this.call()).chat(payload, options);
  }

  async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
    return (await this.call()).generateObject(payload, options);
  }

  async models() {
    return (await this.call()).models();
  }

  async pullModel(params: PullModelParams, options?: { signal?: AbortSignal }) {
    return (await this.call()).pullModel(params, options);
  }

  private async call() {
    const { deadlines, provider, redis, runtimeProvider, scope, streamManager } = this.params;
    if (scope.ended) throw noClientRequestError(provider);

    try {
      await scope.open(streamManager);
    } catch (error) {
      log('failed to open relay channel %s: %O', scope.request.channel, error);
      throw createClientLlmExecutorUnavailableError(provider, 'relay_unsupported');
    }

    return new RelayModelRuntime({
      attempt: 1,
      callId: scope.nextCallId(),
      deadlines,
      operationId: scope.request.channel,
      preferredClientId: scope.request.clientId,
      provider,
      redis,
      runtimeProvider,
      stepIndex: 0,
      streamManager,
      userId: scope.userId,
    });
  }
}

const noClientRequestError = (provider: string) =>
  createClientLlmExecutorUnavailableError(provider, 'no_executor', {
    context: 'no_client_request',
    message: `${provider} runs on the user's device, and no open LobeHub tab is attached to this request to run it.`,
  });

export interface InitModelRuntimeForRequestOptions {
  /** Shorter deadlines for a latency-sensitive call (input completion). */
  deadlines?: Partial<LlmRelayDeadlines>;
  workspaceId?: string;
}

/**
 * `initModelRuntimeFromDB` for a call made on behalf of a request: a provider
 * only the user's device can reach (the shared `fetchOnClient` rule, with the
 * `agent_llm_relay` rollout on) is relayed to the requesting tab; everything
 * else runs on the server exactly as before.
 *
 * A deployment that cannot relay (no Agent Gateway or no Redis) keeps the
 * legacy server runtime: its browser sends no relay headers either.
 *
 * Throws `ClientLlmExecutorUnavailable` up front when such a provider has no
 * tab to run on (`no_executor`, e.g. a bot or a workflow).
 */
export const initModelRuntimeForRequest = async (
  db: LobeChatDatabase,
  userId: string,
  provider: string,
  { deadlines, workspaceId }: InitModelRuntimeForRequestOptions = {},
): Promise<RequestModelRuntime> => {
  const relay = await resolveProviderRelay({ db, provider, userId, workspaceId });
  if (!relay) return initModelRuntimeFromDB(db, userId, provider, workspaceId);

  const redis = getAgentRuntimeRedisClient();
  const streamManager = createStreamEventManager();
  if (!redis || !streamManager.sendLlmExecute || !streamManager.openLlmRelayChannel) {
    log('deployment cannot relay %s, calling it from the server', provider);
    return initModelRuntimeFromDB(db, userId, provider, workspaceId);
  }

  const scope = getLlmRelayRequestScope();
  if (!scope || scope.ended || scope.userId !== userId) {
    log('no client request to relay %s to', provider);
    throw noClientRequestError(provider);
  }

  return new OneShotRelayRuntime({
    deadlines: { ...ONE_SHOT_DEADLINES, ...deadlines },
    provider,
    redis,
    runtimeProvider: relay.runtimeProvider,
    scope,
    streamManager,
  });
};
