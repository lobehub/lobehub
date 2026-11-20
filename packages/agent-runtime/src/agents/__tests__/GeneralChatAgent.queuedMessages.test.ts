import { describe, expect, it } from 'vitest';

import type { AgentRuntimeContext, AgentState } from '../../types';
import { GeneralChatAgent } from '../GeneralChatAgent';

const state = {
  messages: [
    { content: 'Execute task', role: 'user' },
    { content: '', role: 'assistant' },
    { content: 'Task result', role: 'tool', tool_call_id: 'call-sub-agent-1' },
  ],
  operationId: 'test-session',
  status: 'running',
  stepCount: 0,
  toolManifestMap: {},
} as unknown as AgentState;

const context = (phase: AgentRuntimeContext['phase'], hasQueuedMessages: boolean) =>
  ({
    payload: { parentMessageId: 'task-parent-msg', result: { success: true } },
    phase,
    session: { messageCount: 0, sessionId: 'test-session', status: 'running', stepCount: 0 },
    stepContext: hasQueuedMessages ? { hasQueuedMessages: true } : undefined,
  }) as unknown as AgentRuntimeContext;

const agent = () =>
  new GeneralChatAgent({
    agentConfig: { maxSteps: 100 },
    modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
    operationId: 'test-session',
  });

describe('GeneralChatAgent — queued user messages at a sub-agent result', () => {
  it.each(['sub_agent_result', 'sub_agents_batch_result'] as const)(
    'hands the turn back at %s when user messages are queued, before another model call',
    async (phase) => {
      await expect(agent().runner(context(phase, true), state)).resolves.toEqual({
        reason: 'queued_message_interrupt',
        type: 'finish',
      });
    },
  );

  it('continues to the model after a single sub-agent when nothing is queued', async () => {
    await expect(agent().runner(context('sub_agent_result', false), state)).resolves.toMatchObject({
      type: 'call_llm',
    });
  });
});
