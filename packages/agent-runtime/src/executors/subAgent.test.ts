import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeHost } from '../transport';
import type { AgentInstruction, AgentState, SubAgentTask } from '../types';
import { execSubAgent, execSubAgents } from './subAgent';

interface TargetSubAgentTask extends SubAgentTask {
  targetAgentId: string;
}

const createState = (overrides?: Partial<AgentState>): AgentState => ({
  cost: {
    calculatedAt: '2026-07-09T00:00:00.000Z',
    currency: 'USD',
    llm: { byModel: [], currency: 'USD', total: 0 },
    tools: { byTool: [], currency: 'USD', total: 0 },
    total: 0,
  },
  createdAt: '2026-07-09T00:00:00.000Z',
  lastModified: '2026-07-09T00:00:00.000Z',
  maxSteps: 100,
  messages: [],
  metadata: {
    agentId: 'parent-agent',
    threadId: 'thread-1',
    topicId: 'topic-1',
  },
  operationId: 'op-1',
  status: 'running',
  stepCount: 0,
  toolManifestMap: {},
  usage: {
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
    llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
    tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
  },
  ...overrides,
});

describe('sub-agent executors', () => {
  let execSubAgentTransport: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let host: AgentRuntimeHost;

  beforeEach(() => {
    execSubAgentTransport = vi.fn().mockResolvedValue({
      assistantMessageId: 'assistant-child',
      operationId: 'child-op',
      success: true,
      threadId: 'child-thread',
    });
    update = vi.fn().mockResolvedValue(undefined);

    host = {
      operation: {
        operationId: 'op-1',
        stepIndex: 2,
        topicId: 'topic-1',
      },
      transports: {
        messages: {
          createAssistantMessage: vi.fn(),
          createToolMessage: vi.fn(),
          deleteMessage: vi.fn(),
          findById: vi.fn(),
          query: vi.fn(),
          update,
          updatePluginState: vi.fn(),
          updateToolMessage: vi.fn(),
        },
        stream: {
          publishChunk: vi.fn(),
          publishError: vi.fn(),
          publishEvent: vi.fn(),
        },
        subAgent: {
          execSubAgent: execSubAgentTransport,
          execVirtualSubAgent: vi.fn(),
        },
      },
    } as unknown as AgentRuntimeHost;
  });

  it('dispatches target agent with the source parent message and advances to sub_agent_result', async () => {
    const instruction: Extract<AgentInstruction, { type: 'exec_sub_agent' }> = {
      payload: {
        parentMessageId: 'tool-msg-1',
        task: {
          description: 'Call target',
          instruction: 'Do useful work',
          targetAgentId: 'target-agent',
          timeout: 1_800_000,
        } as TargetSubAgentTask,
      },
      type: 'exec_sub_agent',
    };

    const result = await execSubAgent(host)(instruction, createState());

    expect(execSubAgentTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'target-agent',
        instruction: 'Do useful work',
        parentMessageId: 'tool-msg-1',
        parentOperationId: 'op-1',
        timeout: 1_800_000,
        title: 'Call target',
        topicId: 'topic-1',
      }),
    );
    expect(result.nextContext?.phase).toBe('sub_agent_result');
    expect(result.nextContext?.payload).toMatchObject({
      parentMessageId: 'tool-msg-1',
      result: {
        success: true,
        threadId: 'child-thread',
      },
    });
  });

  it('blocks nested sub-agent dispatch before transport dispatch', async () => {
    const instruction: Extract<AgentInstruction, { type: 'exec_sub_agent' }> = {
      payload: {
        parentMessageId: 'tool-msg-1',
        task: {
          description: 'Nested',
          instruction: 'Do nested work',
        },
      },
      type: 'exec_sub_agent',
    };

    const result = await execSubAgent(host)(
      instruction,
      createState({ metadata: { agentId: 'parent-agent', isSubAgent: true, topicId: 'topic-1' } }),
    );

    expect(execSubAgentTransport).not.toHaveBeenCalled();
    expect(result.nextContext?.payload).toMatchObject({
      result: {
        error: 'Sub-agent calls cannot be triggered from within another sub-agent.',
        success: false,
      },
    });
  });

  it('skips dispatch when no sub-agent transport is registered', async () => {
    const instruction: Extract<AgentInstruction, { type: 'exec_sub_agent' }> = {
      payload: {
        parentMessageId: 'tool-msg-1',
        task: {
          description: 'Call target',
          instruction: 'Do work',
        },
      },
      type: 'exec_sub_agent',
    };

    const result = await execSubAgent({
      ...host,
      transports: {
        ...host.transports,
        subAgent: undefined,
      },
    })(instruction, createState());

    expect(execSubAgentTransport).not.toHaveBeenCalled();
    expect(result.nextContext?.payload).toMatchObject({
      parentMessageId: 'tool-msg-1',
      result: { success: false, threadId: '' },
    });
  });

  it('reports dispatch failures through the result payload', async () => {
    execSubAgentTransport.mockRejectedValueOnce(new Error('spawn failed'));
    const instruction: Extract<AgentInstruction, { type: 'exec_sub_agent' }> = {
      payload: {
        parentMessageId: 'tool-msg-1',
        task: {
          description: 'Call target',
          instruction: 'Do work',
        },
      },
      type: 'exec_sub_agent',
    };

    const result = await execSubAgent(host)(instruction, createState());

    expect(update).not.toHaveBeenCalled();
    expect(result.nextContext?.payload).toMatchObject({
      result: { success: false },
    });
  });

  it('dispatches a batch using the source parent message', async () => {
    execSubAgentTransport
      .mockResolvedValueOnce({
        assistantMessageId: 'assistant-child-1',
        operationId: 'child-op-1',
        success: true,
        threadId: 'child-thread-1',
      })
      .mockResolvedValueOnce({
        assistantMessageId: 'assistant-child-2',
        operationId: 'child-op-2',
        success: true,
        threadId: 'child-thread-2',
      });
    const instruction: Extract<AgentInstruction, { type: 'exec_sub_agents' }> = {
      payload: {
        parentMessageId: 'tool-msg-1',
        tasks: [
          { description: 'Task A', instruction: 'Do A' },
          {
            description: 'Task B',
            instruction: 'Do B',
            targetAgentId: 'target-b',
          } as TargetSubAgentTask,
        ],
      },
      type: 'exec_sub_agents',
    };

    const result = await execSubAgents(host)(instruction, createState());

    expect(execSubAgentTransport).toHaveBeenCalledTimes(2);
    expect(execSubAgentTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agentId: 'target-b',
        parentMessageId: 'tool-msg-1',
      }),
    );
    expect(result.nextContext?.phase).toBe('sub_agents_batch_result');
    expect(result.nextContext?.payload).toMatchObject({
      parentMessageId: 'tool-msg-1',
      results: [
        { success: true, threadId: 'child-thread-1' },
        { success: true, threadId: 'child-thread-2' },
      ],
    });
  });
});
