// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeFactoryDeps } from '../runtimeFactory';
import { createAgentRuntime } from '../runtimeFactory';

const reopen = vi.hoisted(() => ({
  withGraphSteerReopen: vi.fn((executors: unknown) => executors),
}));
vi.mock('../graphSteerReopen', () => reopen);
vi.mock('@/database/models/agentInbox', () => ({ AgentInboxModel: { isInboxTopic: vi.fn() } }));

describe('createAgentRuntime — graph steer reopen', () => {
  it('runs the operation’s LLM calls through the graph steer reopen', async () => {
    const deps = {
      agentFactory: vi.fn((config: any) => ({ config, runner: vi.fn() })),
      completeGroupMemberBarrier: vi.fn(),
      coordinator: { isInterrupted: vi.fn(), loadAgentState: vi.fn() },
      delegate: {},
      serverDB: {},
      userId: 'user_1',
    } as unknown as RuntimeFactoryDeps;

    await createAgentRuntime(deps, {
      agentState: { origin: { topicId: 'tpc_1', userId: 'user_1' } },
      operationId: 'op_1',
      stepIndex: 0,
    });

    expect(reopen.withGraphSteerReopen).toHaveBeenCalledWith(
      expect.objectContaining({ call_llm: expect.any(Function) }),
      'op_1',
    );
  });

  it('wires shouldReplayAssistantReasoning into compressionConfig.includeReasoning', async () => {
    const agentFactory = vi.fn((config: any) => ({ config, runner: vi.fn() }));
    const deps = {
      agentFactory,
      completeGroupMemberBarrier: vi.fn(),
      coordinator: { isInterrupted: vi.fn(), loadAgentState: vi.fn() },
      delegate: {},
      serverDB: {},
      userId: 'user_1',
    } as unknown as RuntimeFactoryDeps;

    await createAgentRuntime(deps, {
      agentState: {
        modelRuntimeConfig: {
          model: 'gpt-4o-mini',
          modelFacts: {
            cards: [{ extendParams: [], id: 'gpt-4o-mini', providerId: 'openai' }],
            model: 'gpt-4o-mini',
            provider: 'openai',
          },
          provider: 'openai',
        },
        origin: { topicId: 'tpc_1', userId: 'user_1' },
        world: {
          agent: {
            chatConfig: { enableContextCompression: true },
            systemRole: 'You are a helpful assistant.',
          },
        },
      },
      operationId: 'op_1',
      stepIndex: 0,
    });

    expect(agentFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        agentConfig: expect.objectContaining({
          systemRole: 'You are a helpful assistant.',
        }),
        compressionConfig: expect.objectContaining({
          enabled: true,
          includeReasoning: false,
        }),
      }),
    );
  });
});
