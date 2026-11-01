import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { ConversationContext } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { createGatewayEventHandler } from './gatewayEventHandler';

const context = {
  agentId: 'agent-1',
  topicId: 'topic-1',
} as ConversationContext;

const makeEvent = (type: AgentStreamEvent['type'], data?: AgentStreamEvent['data']) =>
  ({
    data,
    id: 'event-1',
    operationId: 'op-1',
    stepIndex: 1,
    timestamp: 0,
    type,
  }) as AgentStreamEvent;

const flush = async () => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

describe('gateway step metrics', () => {
  it('applies the post-step LLM count from step_complete', async () => {
    const store = {
      dbMessagesMap: {},
      operations: {},
      operationsByContext: {},
      updateOperationMetadata: vi.fn(),
    } as any;
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'assistant-1',
      context,
      operationId: 'op-1',
    });

    void handler(makeEvent('step_complete', { llmCalls: 3, phase: 'tool_result' }));
    await flush();

    expect(store.updateOperationMetadata).toHaveBeenCalledWith('op-1', { llmCalls: 3 });
  });
});
