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
  let compressionRollbackGroup: ReturnType<typeof vi.fn>;
  let compressionUpdateGroup: ReturnType<typeof vi.fn>;
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
    compressionRollbackGroup = vi.fn().mockResolvedValue({});
    compressionUpdateGroup = vi.fn();
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
          rollbackGroup: compressionRollbackGroup,
          updateGroup: compressionUpdateGroup,
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
    llmStream.mockImplementation(async (_payload, handlers) => {
      handlers?.onText?.('sum');
      handlers?.onText?.('mary');
      return {
        content: 'summary',
        usage: {
          totalInputTokens: 10,
          totalOutputTokens: 5,
          totalTokens: 15,
        },
      };
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
    expect(llmStream).toHaveBeenCalledWith(
      {
        messages: [{ content: 'summarize', role: 'user' }],
        model: 'gpt-4',
        provider: 'openai',
        stream: true,
      },
      expect.objectContaining({ onText: expect.any(Function) }),
      undefined,
    );
    expect(compressionUpdateGroup).toHaveBeenNthCalledWith(1, {
      content: 'sum',
      messageGroupId: 'group-123',
    });
    expect(compressionUpdateGroup).toHaveBeenNthCalledWith(2, {
      content: 'summary',
      messageGroupId: 'group-123',
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

  it('skips without compression side effects when topic context is missing', async () => {
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

  it('runs with client transports when userId is absent', async () => {
    messagesQuery.mockResolvedValue([{ content: 'history', id: 'msg-history', role: 'user' }]);
    compressionCreateGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
    });
    compressionFinalizeGroup.mockResolvedValue({
      messages: [{ content: 'summary', id: 'group-123', role: 'compressedGroup' }],
    });
    host.operation.userId = undefined;
    host.lifecycle = undefined;

    const state = createState({
      messages: [{ content: 'history', id: 'msg-history', role: 'user' }],
    });
    const result = await compressContext(host)(createInstruction(state.messages), state);

    expect(compressionCreateGroup).toHaveBeenCalledTimes(1);
    expect((result.nextContext?.payload as any).skipped).not.toBe(true);
  });

  it('supersedes prior compressed groups without duplicating their summaries', async () => {
    const sourceGroup1 = {
      content: 'First prior summary',
      id: 'source-group-1',
      lastMessageId: 'assistant-in-source-1',
      role: 'compressedGroup',
    };
    const sourceGroup2 = {
      content: 'Second prior summary',
      id: 'source-group-2',
      lastMessageId: 'assistant-in-source-2',
      role: 'compressedGroup',
    };
    messagesQuery.mockResolvedValue([
      sourceGroup1,
      sourceGroup2,
      { content: 'recent question', id: 'msg-recent', role: 'user' },
      { content: 'recent answer', id: 'assistant-recent', role: 'assistant' },
    ]);
    compressionCreateGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messages: [
        sourceGroup1,
        sourceGroup2,
        { content: '...', id: 'group-123', role: 'compressedGroup' },
      ],
      messagesToSummarize: [{ content: 'recent question', id: 'msg-recent', role: 'user' }],
    });
    compressionFinalizeGroup.mockResolvedValue({
      messages: [{ content: 'combined summary', id: 'group-123', role: 'compressedGroup' }],
    });
    llmStream.mockResolvedValue({ content: 'combined summary' });
    const state = createState({
      messages: [
        sourceGroup1,
        sourceGroup2,
        { content: 'recent question', id: 'msg-recent', role: 'user' },
        { content: 'recent answer', id: 'assistant-recent', role: 'assistant' },
      ],
    });

    const result = await compressContext(host)(createInstruction(state.messages), state);

    expect(compressionBuildPrompt).toHaveBeenCalledWith({
      existingSummary: 'First prior summary\n\nSecond prior summary',
      messages: [{ content: 'recent question', id: 'msg-recent', role: 'user' }],
    });
    expect(compressionFinalizeGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        messageGroupId: 'group-123',
        sourceGroupIds: ['source-group-1', 'source-group-2'],
      }),
    );
    expect((result.nextContext?.payload as any).compressedMessages).toEqual([
      { content: 'combined summary', id: 'group-123', role: 'compressedGroup' },
    ]);
    expect((result.nextContext?.payload as any).parentMessageId).toBe('assistant-recent');
  });

  it('can recompress summaries when there are no new persisted messages', async () => {
    const sourceGroup = {
      content: 'Prior summary',
      id: 'source-group',
      lastMessageId: 'assistant-in-source',
      role: 'compressedGroup',
    };
    messagesQuery.mockResolvedValue([sourceGroup]);
    compressionCreateGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messages: [sourceGroup, { content: '...', id: 'group-123', role: 'compressedGroup' }],
      messagesToSummarize: [],
    });
    compressionFinalizeGroup.mockResolvedValue({
      messages: [{ content: 'shorter summary', id: 'group-123', role: 'compressedGroup' }],
    });
    llmStream.mockResolvedValue({ content: 'shorter summary' });
    const state = createState({ messages: [sourceGroup] });

    const result = await compressContext(host)(createInstruction(state.messages), state);

    expect(compressionCreateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ messageIds: [] }),
    );
    expect(compressionFinalizeGroup).toHaveBeenCalledWith(
      expect.objectContaining({ sourceGroupIds: ['source-group'] }),
    );
    expect((result.nextContext?.payload as any).parentMessageId).toBe('assistant-in-source');
  });

  it('skips before creating a group when model config is unavailable', async () => {
    messagesQuery.mockResolvedValue([
      { content: 'history', id: 'msg-history', role: 'user' },
      { content: 'loading', id: 'assistant-existing', role: 'assistant' },
    ]);
    const state = createState({
      messages: [{ content: 'history', id: 'msg-history', role: 'user' }],
      modelRuntimeConfig: undefined,
    });

    const result = await compressContext(host)(createInstruction(state.messages), state);

    expect(compressionCreateGroup).not.toHaveBeenCalled();
    expect(result.nextContext?.payload as any).toMatchObject({
      parentMessageId: 'assistant-existing',
      skipped: true,
    });
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

  it('rolls back a created group when summary generation fails', async () => {
    const sourceGroup = {
      content: 'Existing summary',
      id: 'source-group',
      role: 'compressedGroup',
    };
    messagesQuery.mockResolvedValue([
      sourceGroup,
      { content: 'history', id: 'msg-history', role: 'user' },
    ]);
    compressionCreateGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
    });
    llmStream.mockRejectedValue(new Error('summary failed'));

    const state = createState({
      messages: [sourceGroup, { content: 'history', id: 'msg-history', role: 'user' }],
    });
    const result = await compressContext(host)(createInstruction(state.messages), state);

    expect(compressionRollbackGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'summary failed' }),
        messageGroupId: 'group-123',
      }),
    );
    expect(compressionFinalizeGroup).not.toHaveBeenCalled();
    expect(result.nextContext?.payload as any).toMatchObject({
      compressedMessages: expect.arrayContaining([sourceGroup]),
      skipped: true,
    });
  });

  it('rolls back instead of finalizing when the compression signal is aborted', async () => {
    const controller = new AbortController();
    messagesQuery.mockResolvedValue([{ content: 'history', id: 'msg-history', role: 'user' }]);
    compressionCreateGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
      signal: controller.signal,
    });
    llmStream.mockImplementation(async () => {
      controller.abort();
      return { content: 'partial summary' };
    });

    const state = createState({
      messages: [{ content: 'history', id: 'msg-history', role: 'user' }],
    });
    const result = await compressContext(host)(createInstruction(state.messages), state);

    expect(compressionRollbackGroup).toHaveBeenCalledWith(
      expect.objectContaining({ messageGroupId: 'group-123' }),
    );
    expect(compressionFinalizeGroup).not.toHaveBeenCalled();
    expect((result.nextContext?.payload as any).skipped).toBe(true);
  });
});
