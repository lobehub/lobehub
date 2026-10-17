import { isOwnLlmRelayChannelId, isScopedLlmRelayChannelId } from '@lobechat/agent-gateway-client';
import type { AgentRunLlmExecutor } from '@lobechat/agent-runtime';
import type { ExecAgentLlmExecutor } from '@lobechat/types';
import debug from 'debug';

import type { IStreamEventManager } from '@/server/modules/AgentRuntime/types';

const log = debug('lobe-server:ai-agent-service:sub-agent-llm-relay');

/**
 * A sub-agent a tab dispatches itself (`execSubAgentTask`, e.g. a direct
 * `@agent` mention) has no server parent run whose relay executor it could
 * inherit, and no tab subscribes to the child's own channel. So the tab
 * subscribes to a one-shot relay channel (`llmcall:<userId>:…`) first and
 * names it here; the child's `llm_execute` rides that channel.
 */
export interface SubAgentLlmRelayRequest {
  /** The one-shot channel the dispatching tab subscribed to. */
  channel: string;
  /** The dispatching tab's executor declaration. */
  executor: ExecAgentLlmExecutor;
}

export interface SubAgentLlmRelayScope {
  streamManager: IStreamEventManager;
  userId: string;
  workspaceId?: string;
}

/**
 * Open the requested channel on the gateway and return the executor the child
 * run carries: the tab's declaration, relaying on that channel. `undefined`
 * when the channel is not the caller's own or the deployment cannot relay —
 * the child then runs without an executor, exactly as before.
 */
export const openSubAgentLlmRelay = async (
  request: SubAgentLlmRelayRequest | undefined,
  { streamManager, userId, workspaceId }: SubAgentLlmRelayScope,
): Promise<AgentRunLlmExecutor | undefined> => {
  if (!request) return;
  // Only the caller's own channels, bound to the workspace this request runs
  // in: anything else could name a real run's operation, another user's
  // channel, or the user's tab of another workspace, whose providers differ.
  if (!isScopedLlmRelayChannelId(request.channel, userId, workspaceId)) {
    log('ignoring relay channel %s outside %s / %s', request.channel, userId, workspaceId);
    return;
  }
  if (!streamManager.openLlmRelayChannel || !streamManager.sendLlmExecute) {
    log('deployment cannot relay, child runs without an executor');
    return;
  }

  try {
    await streamManager.openLlmRelayChannel(request.channel, userId);
  } catch (error) {
    log('failed to open relay channel %s: %O', request.channel, error);
    return;
  }

  return { ...request.executor, channelOperationId: request.channel };
};

/**
 * End a channel opened by {@link openSubAgentLlmRelay}. The tab calls it once
 * it stops standing by (the child finished or was given up), since only the
 * tab knows when that is. Best effort.
 */
export const closeSubAgentLlmRelay = async (
  channel: string,
  userId: string,
  streamManager: IStreamEventManager,
): Promise<boolean> => {
  if (!isOwnLlmRelayChannelId(channel, userId)) return false;

  await streamManager.closeLlmRelayChannel?.(channel);
  return true;
};
