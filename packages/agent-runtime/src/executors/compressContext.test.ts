import type { Mock } from 'vitest';
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
  origin: {
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
  let compressionCreateGroup: Mock;
  let compressionBuildPrompt: Mock;
  let compressionFinalizeGroup: Mock;
  let compressionRollbackGroup: Mock;
  let compressionUpdateGroup: Mock;
  let llmStream: Mock;
  let lifecycleDispatch: Mock;

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

  it('does not compress hidden siblings or reuse summaries outside the active input', async () => {
    const visible = [
      { id: 'visible-user', role: 'user', content: 'visible' },
      { id: 'visible-answer', role: 'assistant', content: 'answer' },
      { id: 'active-user', role: 'user', content: 'continue' },
    ];
    messagesQuery.mockResolvedValue([
      { id: 'other-summary', role: 'compressedGroup', content: 'HIDDEN SUMMARY' },
      ...visible,
      { id: 'hidden-sibling', role: 'assistant', content: 'HIDDEN SIBLING' },
    ]);
    compressionCreateGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messagesToSummarize: visible.slice(0, 2),
    });
    const state = createState({ messages: visible });
    const result = await compressContext(host)(createInstruction(state.messages), state);
    expect(compressionCreateGroup.mock.calls[0][0].messageIds).toEqual([
      'visible-user',
      'visible-answer',
    ]);
    expect(compressionBuildPrompt.mock.calls[0][0].existingSummary).toBeUndefined();
    expect(compressionFinalizeGroup.mock.calls[0][0].sourceGroupIds).toEqual([]);
    expect(result.nextContext?.payload).toMatchObject({ parentMessageId: 'visible-answer' });
  });

  it('leaves inherited parent-thread history intact while compacting a child thread', async () => {
    const history = [
      { id: 'ancestor', role: 'user', content: 'main conversation', threadId: null },
      { id: 'child-answer', role: 'assistant', content: 'thread reply', threadId: 'child' },
      { id: 'active-user', role: 'user', content: 'continue', threadId: 'child' },
    ];
    messagesQuery.mockResolvedValue(history);
    const state = createState({
      origin: { agentId: 'agent-123', topicId: 'topic-123', threadId: 'child' },
      messages: history,
    });
    await compressContext(host)(createInstruction(state.messages), state);
    expect(compressionCreateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ messageIds: ['child-answer'], threadId: 'child' }),
    );
  });

  it('does not dispatch a summary request after cancellation during prompt preparation', async () => {
    const controller = new AbortController();
    const history = [{ id: 'history', role: 'user', content: 'keep me' }];
    messagesQuery.mockResolvedValue(history);
    compressionCreateGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messagesToSummarize: history,
      signal: controller.signal,
    });
    compressionBuildPrompt.mockImplementation(async () => {
      controller.abort();
      return { messages: [] };
    });
    const state = createState({ messages: history });
    await compressContext(host)(createInstruction(state.messages), state);
    expect(llmStream).not.toHaveBeenCalled();
    expect(compressionRollbackGroup).toHaveBeenCalledTimes(1);
  });

  it('rolls back whitespace-only summaries without replacing the live history', async () => {
    const history = [{ id: 'history', role: 'user', content: 'keep me' }];
    messagesQuery.mockResolvedValue(history);
    compressionCreateGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messagesToSummarize: history,
    });
    llmStream.mockResolvedValue({ content: '  \n ' });
    const state = createState({ messages: history });
    const result = await compressContext(host)(createInstruction(state.messages), state);
    expect(result.newState.messages).toEqual(history);
    expect(result.events).toEqual([expect.objectContaining({ type: 'compression_error' })]);
    expect(compressionFinalizeGroup).not.toHaveBeenCalled();
    expect(compressionRollbackGroup).toHaveBeenCalledWith(
      expect.objectContaining({ messageGroupId: 'group-123' }),
    );
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
        messageIds: ['msg-history'],
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
    expect(result.newState.messages).toEqual([
      { content: 'summary', id: 'group-123', role: 'compressedGroup' },
      preservedMessage,
    ]);
    expect((result.nextContext?.payload as any).compressedMessages).toBeUndefined();
    expect((result.nextContext?.payload as any).parentMessageId).toBeUndefined();
    expect(result.events).toContainEqual({
      groupId: 'group-123',
      parentMessageId: undefined,
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

  it('preserves the latest user Work contract even after assistant and tool messages', async () => {
    const activeContract = {
      content: 'Current Work contract: verify Micron BW 150 suppliers only',
      id: 'msg-current-work',
      role: 'user',
    };
    const toolResult = { content: 'search result', id: 'msg-tool', role: 'tool' };
    messagesQuery.mockResolvedValue([
      { content: 'old objective', id: 'msg-old', role: 'user' },
      activeContract,
      { content: 'searching', id: 'msg-assistant', role: 'assistant' },
      toolResult,
    ]);
    compressionCreateGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messagesToSummarize: [{ content: 'old objective', id: 'msg-old', role: 'user' }],
    });
    compressionFinalizeGroup.mockResolvedValue({
      messages: [{ content: 'historical summary', id: 'group-123', role: 'compressedGroup' }],
    });

    const state = createState({
      messages: [
        { content: 'old objective', id: 'msg-old', role: 'user' },
        activeContract,
        { content: 'searching', id: 'msg-assistant', role: 'assistant' },
        toolResult,
      ],
    });
    const result = await compressContext(host)(createInstruction(state.messages), state);

    expect(compressionCreateGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        messageIds: ['msg-old', 'msg-assistant', 'msg-tool'],
      }),
    );
    expect(result.newState.messages).toEqual([
      { content: 'historical summary', id: 'group-123', role: 'compressedGroup' },
      activeContract,
    ]);
  });

  it('skips without compression side effects when topic context is missing', async () => {
    const state = createState({
      origin: { agentId: 'agent-123' },
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
      threadId: 'thread-123',
    };
    const sourceGroup2 = {
      content: 'Second prior summary',
      id: 'source-group-2',
      lastMessageId: 'assistant-in-source-2',
      role: 'compressedGroup',
      threadId: 'thread-123',
    };
    messagesQuery.mockResolvedValue([
      sourceGroup1,
      sourceGroup2,
      { content: 'recent question', id: 'msg-recent', role: 'user' },
      { content: 'recent answer', id: 'assistant-recent', role: 'assistant' },
    ]);
    compressionCreateGroup.mockResolvedValue({
      existingSummary: 'First prior summary\n\nSecond prior summary',
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
    expect(result.newState.messages).toEqual([
      { content: 'combined summary', id: 'group-123', role: 'compressedGroup' },
      { content: 'recent question', id: 'msg-recent', role: 'user' },
    ]);
    expect((result.nextContext?.payload as any).parentMessageId).toBe('assistant-recent');
  });

  it('leaves the main-conversation rows a thread shows out of its compaction', async () => {
    // createState() runs in thread-123; the page starts with the main-conversation turn
    // and summary the thread branched from.
    const mainGroup = {
      content: 'main summary',
      id: 'main-group',
      role: 'compressedGroup',
      threadId: null,
    };
    const threadGroup = {
      content: 'thread summary',
      id: 'thread-group',
      role: 'compressedGroup',
      threadId: 'thread-123',
    };
    // An earlier thread compaction that also folded main-conversation rows: the
    // server will not merge it, so its summary must stay out of the new one.
    const mixedGroup = { content: 'mixed summary', id: 'mixed-group', role: 'compressedGroup' };
    messagesQuery.mockResolvedValue([
      mainGroup,
      mixedGroup,
      { content: 'parent question', id: 'main-user', role: 'user', threadId: null },
      { content: 'parent answer', id: 'main-assistant', role: 'assistant', threadId: null },
      threadGroup,
      { content: 'thread question', id: 'thread-user', role: 'user', threadId: 'thread-123' },
      {
        content: 'thread answer',
        id: 'thread-assistant',
        role: 'assistant',
        threadId: 'thread-123',
      },
    ]);
    compressionCreateGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messagesToSummarize: [],
      existingSummary: 'thread summary',
    });
    const state = createState({
      messages: [
        threadGroup,
        { content: 'thread question', id: 'thread-user', role: 'user' },
        { content: 'thread answer', id: 'thread-assistant', role: 'assistant' },
        { content: 'continue', id: 'active-follow-up', role: 'user' },
      ],
    });

    await compressContext(host)(createInstruction(state.messages), state);

    expect(compressionCreateGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        messageIds: ['thread-user', 'thread-assistant'],
        threadId: 'thread-123',
      }),
    );
    expect(compressionBuildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ existingSummary: 'thread summary' }),
    );
    expect(compressionFinalizeGroup).toHaveBeenCalledWith(
      expect.objectContaining({ sourceGroupIds: ['thread-group'] }),
    );
  });

  it('does not fall back to a page summary it cannot supersede', async () => {
    // The only summary on the page mixes main-conversation and thread rows; the agent's
    // payload summary is built from every summary on the page, so it carries it too.
    const mixedGroup = { content: 'mixed summary', id: 'mixed-group', role: 'compressedGroup' };
    messagesQuery.mockResolvedValue([
      mixedGroup,
      { content: 'thread question', id: 'thread-user', role: 'user', threadId: 'thread-123' },
    ]);
    const state = createState({
      messages: [
        mixedGroup,
        { content: 'thread question', id: 'thread-user', role: 'user' },
        { content: 'continue', id: 'active-follow-up', role: 'user' },
      ],
    });
    const instruction = createInstruction(state.messages);
    instruction.payload.existingSummary = 'mixed summary';

    await compressContext(host)(instruction, state);

    expect(compressionBuildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ existingSummary: undefined }),
    );
    expect(compressionFinalizeGroup).toHaveBeenCalledWith(
      expect.objectContaining({ sourceGroupIds: [] }),
    );
  });

  it('can recompress summaries when there are no new persisted messages', async () => {
    const sourceGroup = {
      content: 'Prior summary',
      id: 'source-group',
      lastMessageId: 'assistant-in-source',
      role: 'compressedGroup',
      threadId: 'thread-123',
    };
    messagesQuery.mockResolvedValue([sourceGroup]);
    compressionCreateGroup.mockResolvedValue({
      existingSummary: 'Prior summary',
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
      parentMessageId: undefined,
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
      threadId: 'thread-123',
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
    expect(result.newState.messages).toEqual(expect.arrayContaining([sourceGroup]));
    expect(result.nextContext?.payload as any).toMatchObject({ skipped: true });
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
