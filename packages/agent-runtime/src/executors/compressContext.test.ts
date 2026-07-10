import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeHost } from '../transport';
import type { AgentInstructionCompressContext, AgentState } from '../types';
import { compressContext } from './compressContext';

const createUsage = () => ({
  humanInteraction: {
    approvalRequests: 0,
    promptRequests: 0,
    selectRequests: 0,
    totalWaitingTimeMs: 0,
  },
  llm: {
    apiCalls: 0,
    processingTimeMs: 0,
    tokens: { input: 0, output: 0, total: 0 },
  },
  tools: {
    byTool: [],
    totalCalls: 0,
    totalTimeMs: 0,
  },
});

const createCost = () => ({
  calculatedAt: new Date().toISOString(),
  currency: 'USD',
  llm: {
    byModel: [],
    currency: 'USD',
    total: 0,
  },
  tools: {
    byTool: [],
    currency: 'USD',
    total: 0,
  },
  total: 0,
});

const createState = (overrides?: Partial<AgentState>): AgentState => ({
  cost: createCost(),
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
  maxSteps: 100,
  messages: [],
  metadata: {
    agentId: 'agent-123',
    threadId: 'thread-123',
    topicId: 'topic-123',
  },
  modelRuntimeConfig: {
    model: 'gpt-4',
    provider: 'openai',
  },
  operationId: 'op-123',
  status: 'running',
  stepCount: 0,
  toolManifestMap: {},
  usage: createUsage(),
  ...overrides,
});

const createInstruction = (messages: any[]): AgentInstructionCompressContext => ({
  payload: {
    currentTokenCount: 5000,
    messages,
  },
  type: 'compress_context',
});

describe('compressContext executor', () => {
  let host: AgentRuntimeHost;
  let messagesQuery: ReturnType<typeof vi.fn>;
  let compressionCreateGroup: ReturnType<typeof vi.fn>;
  let compressionBuildPrompt: ReturnType<typeof vi.fn>;
  let compressionFinalizeGroup: ReturnType<typeof vi.fn>;
  let llmStream: ReturnType<typeof vi.fn>;
  let lifecycleDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    messagesQuery = vi.fn().mockResolvedValue([]);
    compressionCreateGroup = vi.fn().mockResolvedValue({
      messageGroupId: 'group-123',
      messagesToSummarize: [],
    });
    compressionBuildPrompt = vi.fn().mockResolvedValue({
      messages: [{ content: 'summarize', role: 'user' }],
    });
    compressionFinalizeGroup = vi.fn().mockResolvedValue({});
    llmStream = vi.fn().mockResolvedValue({ content: 'summary' });
    lifecycleDispatch = vi.fn().mockResolvedValue(undefined);

    host = {
      lifecycle: {
        dispatch: lifecycleDispatch,
        dispatchBeforeToolCall: vi.fn().mockResolvedValue(null),
      },
      operation: {
        operationId: 'op-123',
        stepIndex: 2,
        topicId: 'topic-123',
        userId: 'user-123',
        workspaceId: 'workspace-123',
      },
      transports: {
        compression: {
          buildPrompt: compressionBuildPrompt,
          createGroup: compressionCreateGroup,
          finalizeGroup: compressionFinalizeGroup,
        },
        llm: {
          stream: llmStream,
        },
        messages: {
          query: messagesQuery,
        } as any,
        stream: {
          publishChunk: vi.fn(),
          publishEvent: vi.fn(),
        },
      },
    };
  });

  it('compresses db messages and preserves a trailing user follow-up outside the group', async () => {
    const preservedMessage = {
      content: 'continue with this exact instruction',
      id: 'msg-follow-up',
      role: 'user',
    };

    messagesQuery.mockResolvedValue([
      { content: 'history', id: 'msg-history', role: 'user' },
      { content: 'loading', id: 'assistant-existing', role: 'assistant' },
      preservedMessage,
    ]);
    compressionCreateGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
    });
    llmStream.mockResolvedValue({
      content: 'summary',
      usage: {
        totalInputTokens: 10,
        totalOutputTokens: 5,
        totalTokens: 15,
      },
    });
    compressionFinalizeGroup.mockResolvedValue({
      messages: [{ content: 'summary', id: 'group-123', role: 'compressedGroup' }],
    });

    const state = createState({
      messages: [{ content: 'history', id: 'msg-history', role: 'user' }, preservedMessage],
    });
    const result = await compressContext(host)(createInstruction(state.messages), state);

    expect(messagesQuery).toHaveBeenCalledWith(
      {
        agentId: 'agent-123',
        groupId: undefined,
        threadId: 'thread-123',
        topicId: 'topic-123',
      },
      { resolveAssetUrls: true },
    );
    expect(compressionCreateGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        messageIds: ['msg-history', 'assistant-existing'],
        topicId: 'topic-123',
        workspaceId: 'workspace-123',
      }),
    );
    expect(compressionBuildPrompt).toHaveBeenCalledWith({
      existingSummary: undefined,
      messages: [{ content: 'history', id: 'msg-history', role: 'user' }],
    });
    expect(llmStream).toHaveBeenCalledWith({
      messages: [{ content: 'summarize', role: 'user' }],
      model: 'gpt-4',
      provider: 'openai',
      stream: true,
    });
    expect(compressionFinalizeGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'summary',
        messageGroupId: 'group-123',
        topicId: 'topic-123',
      }),
    );
    expect((result.nextContext?.payload as any).compressedMessages).toEqual([
      { content: 'summary', id: 'group-123', role: 'compressedGroup' },
      preservedMessage,
    ]);
    expect((result.nextContext?.payload as any).parentMessageId).toBe('assistant-existing');
    expect(result.events).toContainEqual({
      groupId: 'group-123',
      parentMessageId: 'assistant-existing',
      type: 'compression_complete',
    });
    expect(result.newState.usage.llm.tokens).toEqual({ input: 10, output: 5, total: 15 });
    expect(lifecycleDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ tokenCount: 5000 }),
        type: 'beforeCompact',
      }),
    );
    expect(lifecycleDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ groupId: 'group-123', summary: 'summary' }),
        type: 'afterCompact',
      }),
    );
  });

  it('skips without compression side effects when topic or user context is missing', async () => {
    const state = createState({
      metadata: { agentId: 'agent-123' },
      messages: [{ content: 'history', role: 'user' }],
    });
    const missingContextHost: AgentRuntimeHost = {
      ...host,
      operation: { ...host.operation, topicId: undefined, userId: undefined },
    };

    const result = await compressContext(missingContextHost)(
      createInstruction(state.messages),
      state,
    );

    expect(compressionCreateGroup).not.toHaveBeenCalled();
    expect(llmStream).not.toHaveBeenCalled();
    expect((result.nextContext?.payload as any).skipped).toBe(true);
  });

  it('continues with skipped compression and dispatches onCompactError when compression fails', async () => {
    messagesQuery.mockResolvedValue([{ content: 'history', id: 'msg-history', role: 'user' }]);
    compressionCreateGroup.mockRejectedValueOnce(new Error('compression failed'));

    const state = createState({
      messages: [{ content: 'history', id: 'msg-history', role: 'user' }],
    });
    const result = await compressContext(host)(createInstruction(state.messages), state);

    expect(compressionFinalizeGroup).not.toHaveBeenCalled();
    expect((result.nextContext?.payload as any).skipped).toBe(true);
    expect(result.events[0]).toMatchObject({ type: 'compression_error' });
    expect(lifecycleDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ error: 'compression failed' }),
        type: 'onCompactError',
      }),
    );
  });
});
