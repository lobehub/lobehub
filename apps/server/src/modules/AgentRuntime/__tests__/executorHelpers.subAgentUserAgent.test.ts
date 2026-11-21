import { type AgentState } from '@lobechat/agent-runtime';
import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { type RuntimeExecutorContext } from '../context';
import { buildServerVirtualSubAgentRunner } from '../executorHelpers';

/**
 * Model-call admission reads the run's user agent: the mobile app is exempt from
 * the onboarding gate. A child that lost it was refused with "Request blocked."
 * on every call while its parent, on the same account, kept running.
 */
describe('buildServerVirtualSubAgentRunner user agent inheritance', () => {
  const buildRunner = (audit?: { userAgent?: string }) => {
    const execVirtualSubAgent = vi.fn().mockResolvedValue({ operationId: 'child-op' });
    const ctx = {
      execVirtualSubAgent,
      messageModel: { create: vi.fn().mockResolvedValue({ id: 'placeholder-id' }) },
      operationId: 'parent-op',
      topicId: 'topic-1',
    } as unknown as RuntimeExecutorContext;

    const runner = buildServerVirtualSubAgentRunner(
      ctx,
      {
        operationId: 'parent-op',
        origin: { agentId: 'agent-1', topicId: 'topic-1' },
        principal: { audit },
        world: { agent: {} as any },
      } as unknown as AgentState,
      { id: 'tool-call-1' } as ChatToolPayload,
      'parent-message-1',
    );

    return { execVirtualSubAgent, runner };
  };

  it('hands the parent run user agent to the child', async () => {
    const { execVirtualSubAgent, runner } = buildRunner({ userAgent: 'okhttp/4.12.0' });

    await runner!.run({ description: 'task', instruction: 'What day is it?' });

    expect(execVirtualSubAgent.mock.calls[0][0].userAgent).toBe('okhttp/4.12.0');
  });

  it('leaves it unset when the parent run has none', async () => {
    const { execVirtualSubAgent, runner } = buildRunner();

    await runner!.run({ description: 'task', instruction: 'What day is it?' });

    expect(execVirtualSubAgent.mock.calls[0][0].userAgent).toBeUndefined();
  });
});
