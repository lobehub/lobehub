import type { AgentHookEvent } from '@lobechat/agent-runtime';
import debug from 'debug';

import { hookDispatcher } from './HookDispatcher';
import type { SerializedHook } from './types';

const log = debug('lobe-server:hook-dispatcher');

export interface TerminalHookParams {
  /** Owning agent id, when known. Optional — the task/bot handlers don't require it. */
  agentId?: string;
  /** Human-readable error message (error path only). */
  errorMessage?: string;
  /** Stable error taxonomy type (error path only), e.g. 'ServerAgentRuntimeError'. */
  errorType?: string;
  /** Final assistant text, for bot-callback rendering / task handoff. */
  lastAssistantContent?: string;
  operationId: string;
  reason: 'done' | 'error' | 'interrupted';
  /**
   * Serialized webhook hooks for queue mode (read from
   * `topic.metadata.runningOperation.hooks` or `getSerializedHooks`). Ignored in
   * local mode, where `dispatch` calls the in-memory handlers instead.
   */
  serializedHooks?: SerializedHook[];
  topicId?: string;
  userId: string;
}

/**
 * Fire `onComplete` (and `onError` on the error path) lifecycle hooks for a
 * terminal run through the shared {@link hookDispatcher} — the same mechanism
 * the normal LLM runtime uses via `CompletionLifecycle.dispatchHooks`.
 *
 * This is the single funnel the heterogeneous-agent paths route through so that
 * the task lifecycle (`onTopicComplete`) and IM bot completion callbacks fire
 * uniformly regardless of how the run ended: a CLI process exit
 * (`heteroFinish`), a remote-agent `agentNotify` done signal, or a synchronous
 * dispatch failure (device offline → DEVICE_NOT_FOUND, no bound device, …).
 *
 * Always unregisters the operation's hooks afterward, mirroring
 * `CompletionLifecycle.dispatchHooks`. Hook errors are swallowed by the
 * dispatcher and never propagate to the caller.
 */
export async function dispatchTerminalHooks(params: TerminalHookParams): Promise<void> {
  const {
    agentId,
    errorMessage,
    errorType,
    lastAssistantContent,
    operationId,
    reason,
    serializedHooks,
    topicId,
    userId,
  } = params;

  const event: AgentHookEvent = {
    agentId: agentId ?? '',
    errorMessage,
    errorType,
    lastAssistantContent,
    operationId,
    reason,
    status: reason,
    topicId,
    userId,
  };

  try {
    await hookDispatcher.dispatch(operationId, 'onComplete', event, serializedHooks);
    if (reason === 'error') {
      await hookDispatcher.dispatch(operationId, 'onError', event, serializedHooks);
    }
  } catch (error) {
    log('[%s] dispatchTerminalHooks error (non-fatal): %O', operationId, error);
  } finally {
    hookDispatcher.unregister(operationId);
  }
}
