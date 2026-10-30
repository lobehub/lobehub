import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { vi } from 'vitest';

import { buildRunLifecycle } from '../../lifecycle/buildRunLifecycle';
import { createGatewayEventHandler } from './gatewayEventHandler';

export function createMockStore() {
  let reasoningCounter = 0;
  return {
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    // completeRun (via buildRunLifecycle) drains the input queue on a successful
    // terminal and fails the op on an errored terminal.
    dbMessagesMap: {} as Record<string, any>,
    drainQueuedMessages: vi.fn(() => [] as any[]),
    failOperation: vi.fn(),
    internal_dispatchMessage: vi.fn(),
    internal_executeClientTool: vi.fn().mockResolvedValue(undefined),
    internal_toggleToolCallingStreaming: vi.fn(),
    markTopicUnread: vi.fn(),
    messagesMap: {} as Record<string, any>,
    topicDataMap: {},
    operations: {
      'op-1': {
        context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' },
        metadata: { startTime: 0 },
      },
    } as Record<string, any>,
    operationsByContext: {},
    replaceMessages: vi.fn(),
    startOperation: vi.fn(() => {
      reasoningCounter += 1;
      return {
        abortController: new AbortController(),
        operationId: `op-reasoning-${reasoningCounter}`,
      };
    }),
    updateOperationMetadata: vi.fn(),
    updateTopicStatus: vi.fn().mockResolvedValue(undefined),
  };
}

export function createHandler(
  store: ReturnType<typeof createMockStore>,
  overrides?: { assistantMessageId?: string; gatewayOperationId?: string },
) {
  const get = vi.fn(() => store) as any;
  const assistantMessageId = overrides?.assistantMessageId ?? 'msg-initial';
  const context = { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' } as any;
  return createGatewayEventHandler(get, {
    assistantMessageId,
    context,
    gatewayOperationId: overrides?.gatewayOperationId,
    operationId: 'op-1',
    // The gateway transport injects the shared run lifecycle (built once per run
    // in gateway.ts). Build the real one here so the terminal completeRun /
    // afterRunComplete path under test runs against the mock store.
    runLifecycle: buildRunLifecycle(get, {
      context,
      parentMessageId: assistantMessageId,
      parentMessageType: 'assistant',
      runId: 'op-1',
      runScope: 'top_level',
      runtimeType: 'gateway',
    }),
  });
}

export function makeEvent(type: AgentStreamEvent['type'], data?: any): AgentStreamEvent {
  return { data, id: '1', operationId: 'op-1', stepIndex: 0, timestamp: Date.now(), type };
}

/** Flush the async processing queue by draining microtasks + setTimeout queue */
export const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 15));
  }
};
