import { describe, expect, it, vi } from 'vitest';

import { dispatchNonHeteroSubAgent } from './nonHeteroSubAgentDispatcher';

describe('dispatchNonHeteroSubAgent', () => {
  it('separates target execution from the parent message context in gateway mode', async () => {
    const executeGatewayAgent = vi.fn().mockResolvedValue(undefined);
    const conversationContext = {
      agentId: 'parent-agent',
      scope: 'main' as const,
      topicId: 'topic-1',
    };

    await dispatchNonHeteroSubAgent(
      {
        instruction: 'Delegated work',
        kind: 'callAgent',
        parentMessageId: 'parent-message',
        targetAgentId: 'target-agent',
      },
      {
        conversationContext,
        isGatewayMode: true,
      },
      {
        executeClientAgent: vi.fn(),
        executeGatewayAgent,
      } as any,
    );

    expect(executeGatewayAgent).toHaveBeenCalledWith({
      context: {
        ...conversationContext,
        agentId: 'target-agent',
        scope: 'sub_agent',
        subAgentId: 'target-agent',
      },
      message: 'Delegated work',
      messageContext: conversationContext,
      parentOperationId: undefined,
    });
  });
});
