import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeHost } from '../transport';
import type { AgentInstruction, AgentState } from '../types';
import { resolveAbortedTools, resolveBlockedTools } from './resolveTools';

const createState = (overrides?: Partial<AgentState>): AgentState => ({
  cost: {
    calculatedAt: '2026-07-07T00:00:00.000Z',
    currency: 'USD',
    llm: { byModel: [], currency: 'USD', total: 0 },
    tools: { byTool: [], currency: 'USD', total: 0 },
    total: 0,
  },
  createdAt: '2026-07-07T00:00:00.000Z',
  lastModified: '2026-07-07T00:00:00.000Z',
  maxSteps: 100,
  messages: [],
  metadata: {
    agentId: 'agent-1',
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

const createToolCall = (id = 'tool-call-1') => ({
  apiName: 'search',
  arguments: '{"query":"test"}',
  id,
  identifier: 'web-search',
  type: 'default' as const,
});

describe('resolveTools executors', () => {
  let createToolMessage: ReturnType<typeof vi.fn>;
  let publishError: ReturnType<typeof vi.fn>;
  let publishEvent: ReturnType<typeof vi.fn>;
  let host: AgentRuntimeHost;

  beforeEach(() => {
    createToolMessage = vi.fn().mockResolvedValue({ id: 'tool-msg-1' });
    publishError = vi.fn().mockResolvedValue(undefined);
    publishEvent = vi.fn().mockResolvedValue(undefined);

    host = {
      operation: {
        operationId: 'op-1',
        stepIndex: 2,
      },
      transports: {
        messages: {
          createAssistantMessage: vi.fn(),
          createToolMessage,
          deleteMessage: vi.fn(),
          findById: vi.fn(),
          query: vi.fn(),
          update: vi.fn(),
          updatePluginState: vi.fn(),
          updateToolMessage: vi.fn(),
        },
        stream: {
          publishChunk: vi.fn(),
          publishError,
          publishEvent,
        },
      },
    } as unknown as AgentRuntimeHost;
  });

  it('persists blocked tools as rejected tool messages and continues', async () => {
    const instruction: Extract<AgentInstruction, { type: 'resolve_blocked_tools' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolsCalling: [createToolCall()],
      },
      type: 'resolve_blocked_tools',
    };

    const result = await resolveBlockedTools(host)(instruction, createState());

    expect(createToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Blocked by security/privacy.',
        parentId: 'assistant-msg-1',
        pluginError: 'blocked_by_security_privacy',
        pluginIntervention: {
          rejectedReason: 'blocked_by_security_privacy',
          status: 'rejected',
        },
        role: 'tool',
        tool_call_id: 'tool-call-1',
      }),
    );
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isSuccess: false,
          phase: 'tool_execution',
        }),
        stepIndex: 2,
        type: 'tool_end',
      }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({ id: 'tool-call-1', type: 'tool_result' }),
    );
    expect(result.nextContext?.phase).toBe('tools_batch_result');
    expect(result.nextContext?.payload).toMatchObject({
      parentMessageId: 'tool-msg-1',
      toolCount: 1,
    });
  });

  it('persists aborted tools and completes the operation as user_aborted', async () => {
    const instruction: Extract<AgentInstruction, { type: 'resolve_aborted_tools' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolsCalling: [createToolCall('tool-call-1'), createToolCall('tool-call-2')],
      },
      type: 'resolve_aborted_tools',
    };

    const result = await resolveAbortedTools(host)(instruction, createState());

    expect(createToolMessage).toHaveBeenCalledTimes(2);
    expect(createToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Tool execution was aborted by user.',
        parentId: 'assistant-msg-1',
        pluginIntervention: { status: 'aborted' },
        role: 'tool',
        tool_call_id: 'tool-call-1',
      }),
    );
    expect(result.newState.status).toBe('done');
    expect(result.newState.messages).toHaveLength(2);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        reason: 'user_aborted',
        reasonDetail: 'User aborted operation with pending tool calls',
        type: 'done',
      }),
    );
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phase: 'tools_aborted' }),
        type: 'step_start',
      }),
    );
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phase: 'execution_complete', reason: 'user_aborted' }),
        type: 'step_complete',
      }),
    );
  });

  it('publishes and rethrows persist errors', async () => {
    const error = new Error('database went away');
    createToolMessage.mockRejectedValueOnce(error);

    const instruction: Extract<AgentInstruction, { type: 'resolve_blocked_tools' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolsCalling: [createToolCall()],
      },
      type: 'resolve_blocked_tools',
    };

    await expect(resolveBlockedTools(host)(instruction, createState())).rejects.toThrow(
      'database went away',
    );
    expect(publishError).toHaveBeenCalledWith({
      error,
      phase: 'tool_message_persist',
      stepIndex: 2,
    });
  });
});
