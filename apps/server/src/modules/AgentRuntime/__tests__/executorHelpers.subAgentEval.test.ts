import { type AgentState } from '@lobechat/agent-runtime';
import { type ChatToolPayload, RequestTrigger } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { type RuntimeExecutorContext } from '../context';
import { buildServerVirtualSubAgentRunner } from '../executorHelpers';

/**
 * A `callSubAgent` child forked inside an eval attempt must stay inside the
 * attempt's sandbox. Before this, the child ran with no eval context at all:
 * its tool calls went to the real services instead of the case mocks, its
 * Memory was the caller's own, it saw the wall clock, and it had no step cap.
 */
describe('buildServerVirtualSubAgentRunner eval inheritance', () => {
  const evalRuntime = {
    caseId: 'case-7',
    memory: { fixtureHash: 'hash', runId: 'run-1', topicId: 'topic-1' },
    toolForwarding: { twitter: { endpoint: 'http://mock/twitter' } },
  };
  const evalContext = { sessionDate: '2026-07-24', timezone: 'America/New_York' };

  const buildRunner = (state: Partial<AgentState>) => {
    const execVirtualSubAgent = vi.fn().mockResolvedValue({ operationId: 'child-op' });
    const ctx = {
      execVirtualSubAgent,
      messageModel: { create: vi.fn().mockResolvedValue({ id: 'placeholder-id' }) },
      operationId: 'parent-op',
      topicId: 'topic-1',
    } as unknown as RuntimeExecutorContext;

    const runner = buildServerVirtualSubAgentRunner(
      ctx,
      { operationId: 'parent-op', ...state } as AgentState,
      { id: 'tool-call-1' } as ChatToolPayload,
      'parent-message-1',
    );

    return { execVirtualSubAgent, runner };
  };

  it('hands the attempt clock, runtime and step cap to the child of an eval run', async () => {
    const { execVirtualSubAgent, runner } = buildRunner({
      maxSteps: 20,
      origin: { agentId: 'agent-1', topicId: 'topic-1', trigger: RequestTrigger.Eval },
      plan: { eval: evalRuntime },
      world: { eval: evalContext } as any,
    });

    await runner!.run({ description: 'task', instruction: 'do it' });

    expect(execVirtualSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        eval: { context: evalContext, maxSteps: 20, runtime: evalRuntime },
      }),
    );
  });

  it('passes nothing eval-related for an ordinary chat run', async () => {
    const { execVirtualSubAgent, runner } = buildRunner({
      maxSteps: 20,
      origin: { agentId: 'agent-1', topicId: 'topic-1', trigger: RequestTrigger.Chat },
    });

    await runner!.run({ description: 'task', instruction: 'do it' });

    expect(execVirtualSubAgent.mock.calls[0][0]).not.toHaveProperty('eval');
  });
});
