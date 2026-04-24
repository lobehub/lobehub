import { type AgentState } from '@lobechat/agent-runtime';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as ContextEngineering from '@/server/modules/Mecha/ContextEngineering';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { createRuntimeExecutors, type RuntimeExecutorContext } from '../RuntimeExecutors';

const mockCreateCompressionGroup = vi.fn();
const mockFinalizeCompression = vi.fn();

// Mock dependencies
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn().mockResolvedValue({
    chat: vi.fn().mockResolvedValue(new Response('done')),
  }),
}));

vi.mock('@/server/services/message', () => ({
  MessageService: vi.fn().mockImplementation(() => ({
    createCompressionGroup: mockCreateCompressionGroup,
    finalizeCompression: mockFinalizeCompression,
  })),
}));

// @lobechat/model-runtime resolves to @cloud/business-model-runtime which has
// cloud-specific dependencies that are unavailable in the test environment
vi.mock('@lobechat/model-runtime', () => ({
  consumeStreamUntilDone: vi.fn().mockResolvedValue(undefined),
}));

// model-bank is a TypeScript source file that cannot be dynamically imported in vitest
vi.mock('model-bank', () => ({
  LOBE_DEFAULT_MODEL_LIST: [
    {
      abilities: { functionCall: true, video: false, vision: true },
      id: 'gpt-4',
      providerId: 'openai',
    },
    {
      abilities: { functionCall: false, video: false, vision: false },
      id: 'no-tools-model',
      providerId: 'test-provider',
    },
  ],
}));

describe('RuntimeExecutors', () => {
  let mockMessageModel: any;
  let mockStreamManager: any;
  let mockToolExecutionService: any;
  let ctx: RuntimeExecutorContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateCompressionGroup.mockResolvedValue({
      messageGroupId: 'group-123',
      messagesToSummarize: [],
      success: true,
    });
    mockFinalizeCompression.mockResolvedValue({ success: true });

    mockMessageModel = {
      create: vi.fn().mockResolvedValue({ id: 'msg-123' }),
      // call_llm does a parent existence preflight; return a truthy row by
      // default so existing tests don't have to stub it.
      findById: vi.fn().mockResolvedValue({ id: 'msg-existing' }),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateToolMessage: vi.fn().mockResolvedValue({ success: true }),
    };

    mockStreamManager = {
      publishStreamChunk: vi.fn().mockResolvedValue('event-1'),
      publishStreamEvent: vi.fn().mockResolvedValue('event-2'),
    };

    mockToolExecutionService = {
      executeTool: vi.fn().mockResolvedValue({
        content: 'Tool result',
        error: null,
        executionTime: 100,
        state: {},
        success: true,
      }),
    };

    ctx = {
      loadAgentState: vi.fn().mockResolvedValue(null),
      messageModel: mockMessageModel,
      operationId: 'op-123',
      serverDB: {} as any, // Mock serverDB
      stepIndex: 0,
      streamManager: mockStreamManager,
      toolExecutionService: mockToolExecutionService,
      userId: 'user-123',
    };
  });

  // Helper to create a valid mock usage object
  const createMockUsage = () => ({
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

  // Helper to create a valid mock cost object
  const createMockCost = () => ({
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

  const createCompressContextInstruction = (messages: any[]) => ({
    payload: {
      currentTokenCount: 1000,
      messages,
    },
    type: 'compress_context' as const,
  });

  describe('call_llm executor', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
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
      usage: createMockUsage(),
      ...overrides,
    });

    it('should pass parentId from payload.parentId to messageModel.create', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await executors.call_llm!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'parent-msg-123',
        }),
      );
    });

    it('should pass parentId from payload.parentMessageId to messageModel.create', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-456',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await executors.call_llm!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'parent-msg-456',
        }),
      );
    });

    it('should prefer parentId over parentMessageId when both are provided', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentId: 'parent-id-preferred',
          parentMessageId: 'parent-message-id-fallback',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await executors.call_llm!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'parent-id-preferred',
        }),
      );
    });

    it('should throw ConversationParentMissing if parent preflight misses (LOBE-7158)', async () => {
      // parent existence preflight — if the parent row was deleted between
      // operation kickoff and call_llm, fail fast before spending LLM tokens
      // on a chain that would hit a FK violation anyway.
      mockMessageModel.findById.mockResolvedValueOnce(null);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentId: 'gone-msg',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await expect(executors.call_llm!(instruction, state)).rejects.toMatchObject({
        errorType: 'ConversationParentMissing',
        parentId: 'gone-msg',
      });
      // LLM never got invoked
      expect(initModelRuntimeFromDB).not.toHaveBeenCalled();
      // No assistant message got created either
      expect(mockMessageModel.create).not.toHaveBeenCalled();
    });

    it('should pass undefined parentId when neither parentId nor parentMessageId is provided', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await executors.call_llm!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: undefined,
        }),
      );
    });

    it('should use model and provider from state.modelRuntimeConfig as fallback', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        modelRuntimeConfig: {
          model: 'gpt-3.5-turbo',
          provider: 'openai',
        },
      });

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          parentId: 'parent-123',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await executors.call_llm!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-3.5-turbo',
          provider: 'openai',
        }),
      );
    });

    it('should preserve reasoning in newState when assistant returns tool calls', async () => {
      const toolCallPayload = [
        {
          function: { arguments: '{}', name: 'search' },
          id: 'call_1',
          type: 'function',
        },
      ];

      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onThinking?.('Need to inspect the search results first.');
        await options?.callback?.onToolsCalling?.({ toolsCalling: toolCallPayload });
        await options?.callback?.onCompletion?.({
          usage: {
            totalInputTokens: 1,
            totalOutputTokens: 2,
            totalTokens: 3,
          },
        });
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      const result = await executors.call_llm!(instruction, state);

      expect(result.newState.messages.at(-1)).toEqual(
        expect.objectContaining({
          id: 'msg-123',
          reasoning: { content: 'Need to inspect the search results first.' },
          role: 'assistant',
          tool_calls: [expect.objectContaining({ id: 'call_1' })],
        }),
      );
    });

    it('should push assistant message with persisted DB id so request_human_approve can find parent', async () => {
      const toolCallPayload = [
        {
          function: { arguments: '{}', name: 'search' },
          id: 'call_sensitive',
          type: 'function',
        },
      ];

      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onToolsCalling?.({ toolsCalling: toolCallPayload });
        await options?.callback?.onCompletion?.({
          usage: { totalInputTokens: 1, totalOutputTokens: 2, totalTokens: 3 },
        });
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      mockMessageModel.create.mockResolvedValueOnce({ id: 'persisted-assistant-id' });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const result = await executors.call_llm!(
        {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        },
        state,
      );

      const lastAssistant = result.newState.messages.at(-1);
      expect(lastAssistant).toMatchObject({
        id: 'persisted-assistant-id',
        role: 'assistant',
      });
      // The id must match the same message that nextContext exposes as
      // parentMessageId, so request_human_approve sees a single source of truth.
      expect((result.nextContext?.payload as any).parentMessageId).toBe('persisted-assistant-id');
    });

    it('should execute compress_context and return compression_result', async () => {
      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onText?.('summary');
        await options?.callback?.onCompletion?.({
          usage: {
            completionTokens: 5,
            promptTokens: 10,
            totalTokens: 15,
          },
        });
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
        { content: 'loading', id: 'assistant-existing', role: 'assistant' },
      ]);
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'group-123',
        messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
        success: true,
      });
      mockFinalizeCompression.mockResolvedValue({
        messages: [
          { content: 'summary', id: 'group-123', role: 'compressedGroup' },
          { content: 'loading', id: 'assistant-existing', role: 'assistant' },
        ],
        success: true,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'x '.repeat(70000), role: 'user' }],
      });

      const instruction = createCompressContextInstruction([
        { content: 'x '.repeat(70000), role: 'user' },
      ]);

      const result = await executors.compress_context!(instruction, state);

      expect(mockCreateCompressionGroup).toHaveBeenCalledTimes(1);
      expect(mockFinalizeCompression).toHaveBeenCalledTimes(1);
      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(result.nextContext?.phase).toBe('compression_result');
      expect((result.nextContext?.payload as any).compressedMessages[0]).toEqual({
        content: 'summary',
        id: 'group-123',
        role: 'compressedGroup',
      });
      expect((result.nextContext?.payload as any).parentMessageId).toBe('assistant-existing');
      expect(result.events).toContainEqual({
        groupId: 'group-123',
        parentMessageId: 'assistant-existing',
        type: 'compression_complete',
      });
      expect(result.newState.usage.llm.tokens.total).toBe(15);
    });

    it('should skip compress_context when topic metadata is missing', async () => {
      const executors = createRuntimeExecutors({
        ...ctx,
      });
      const state = createMockState({
        messages: [{ content: 'history', role: 'user' }],
        metadata: {
          agentId: 'agent-123',
        },
      });

      const instruction = createCompressContextInstruction([{ content: 'history', role: 'user' }]);

      const result = await executors.compress_context!(instruction, state);

      expect(mockCreateCompressionGroup).not.toHaveBeenCalled();
      expect((result.nextContext?.payload as any).skipped).toBe(true);
    });

    it('should skip compress_context when userId is missing', async () => {
      const executors = createRuntimeExecutors({
        ...ctx,
        userId: undefined,
      });
      const state = createMockState({
        messages: [{ content: 'history', role: 'user' }],
      });

      const instruction = createCompressContextInstruction([{ content: 'history', role: 'user' }]);

      const result = await executors.compress_context!(instruction, state);

      expect(mockCreateCompressionGroup).not.toHaveBeenCalled();
      expect((result.nextContext?.payload as any).skipped).toBe(true);
    });

    it('should skip compress_context when there are no compressible messages after preserving the trailing user message', async () => {
      mockMessageModel.query.mockResolvedValue([]);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'continue with this exact instruction', role: 'user' }],
      });

      const instruction = createCompressContextInstruction(state.messages);

      const result = await executors.compress_context!(instruction, state);

      expect(mockCreateCompressionGroup).not.toHaveBeenCalled();
      expect(result.nextContext?.payload as any).toMatchObject({
        compressedMessages: state.messages,
        groupId: '',
        parentMessageId: undefined,
        skipped: true,
      });
    });

    it('should skip compress_context when compression model config is missing', async () => {
      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
        { content: 'loading', id: 'assistant-existing', role: 'assistant' },
      ]);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'history', role: 'user' }],
        modelRuntimeConfig: undefined,
      });

      const instruction = createCompressContextInstruction([{ content: 'history', role: 'user' }]);

      const result = await executors.compress_context!(instruction, state);

      expect(mockCreateCompressionGroup).toHaveBeenCalledTimes(1);
      expect(mockFinalizeCompression).not.toHaveBeenCalled();
      expect(result.nextContext?.payload as any).toMatchObject({
        compressedMessages: [{ content: 'history', role: 'user' }],
        parentMessageId: 'assistant-existing',
        skipped: true,
      });
    });

    it('should continue when compress_context fails', async () => {
      mockCreateCompressionGroup.mockRejectedValueOnce(new Error('compression failed'));

      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
      ]);
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'history', role: 'user' }],
      });

      const instruction = createCompressContextInstruction([{ content: 'history', role: 'user' }]);

      const result = await executors.compress_context!(instruction, state);

      expect(result.nextContext?.phase).toBe('compression_result');
      expect((result.nextContext?.payload as any).skipped).toBe(true);
      expect(mockFinalizeCompression).not.toHaveBeenCalled();
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({ type: 'compression_error' });
    });

    it('should preserve the trailing user message outside compression', async () => {
      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onText?.('summary');
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
        { content: 'loading', id: 'assistant-existing', role: 'assistant' },
      ]);
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'group-123',
        messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
        success: true,
      });
      mockFinalizeCompression.mockResolvedValue({
        messages: [{ content: 'summary', id: 'group-123', role: 'compressedGroup' }],
        success: true,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [
          { content: 'history', id: 'msg-history', role: 'user' },
          { content: 'continue with this exact instruction', role: 'user' },
        ],
      });

      const instruction = createCompressContextInstruction(state.messages);

      const result = await executors.compress_context!(instruction, state);

      expect(mockCreateCompressionGroup).toHaveBeenCalledWith(
        'topic-123',
        ['msg-history', 'assistant-existing'],
        expect.any(Object),
      );
      expect((result.nextContext?.payload as any).compressedMessages).toEqual([
        { content: 'summary', id: 'group-123', role: 'compressedGroup' },
        { content: 'continue with this exact instruction', role: 'user' },
      ]);
    });

    it('should fallback to messagesToSummarize when finalizeCompression does not return messages', async () => {
      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onText?.('summary');
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
        { content: 'loading', id: 'assistant-existing', role: 'assistant' },
      ]);
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'group-123',
        messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
        success: true,
      });
      mockFinalizeCompression.mockResolvedValue({
        messages: undefined,
        success: true,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'history', role: 'user' }],
      });

      const instruction = createCompressContextInstruction(state.messages);

      const result = await executors.compress_context!(instruction, state);

      expect((result.nextContext?.payload as any).compressedMessages).toEqual([
        { content: 'history', id: 'msg-history', role: 'user' },
      ]);
    });

    it('should not duplicate the preserved trailing user message when it is already present in finalized messages', async () => {
      const preservedMessage = {
        content: 'continue with this exact instruction',
        id: 'msg-follow-up',
        role: 'user',
      };

      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onText?.('summary');
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
        { content: 'loading', id: 'assistant-existing', role: 'assistant' },
        preservedMessage,
      ]);
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'group-123',
        messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
        success: true,
      });
      mockFinalizeCompression.mockResolvedValue({
        messages: [
          { content: 'summary', id: 'group-123', role: 'compressedGroup' },
          preservedMessage,
        ],
        success: true,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'history', id: 'msg-history', role: 'user' }, preservedMessage],
      });

      const instruction = createCompressContextInstruction(state.messages);

      const result = await executors.compress_context!(instruction, state);

      expect((result.nextContext?.payload as any).compressedMessages).toEqual([
        { content: 'summary', id: 'group-123', role: 'compressedGroup' },
        preservedMessage,
      ]);
    });

    it('should continue with skipped compression when the compression model reports a summary error', async () => {
      const mockChat = vi.fn().mockImplementation(async (_payload, options) => {
        await options?.callback?.onError?.({ message: 'summary failed' });
        return new Response('done');
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValueOnce({ chat: mockChat } as any);

      mockMessageModel.query.mockResolvedValue([
        { content: 'history', id: 'msg-history', role: 'user' },
        { content: 'loading', id: 'assistant-existing', role: 'assistant' },
      ]);
      mockCreateCompressionGroup.mockResolvedValue({
        messageGroupId: 'group-123',
        messagesToSummarize: [{ content: 'history', id: 'msg-history', role: 'user' }],
        success: true,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        messages: [{ content: 'history', role: 'user' }],
      });

      const instruction = createCompressContextInstruction(state.messages);

      const result = await executors.compress_context!(instruction, state);

      expect(mockFinalizeCompression).not.toHaveBeenCalled();
      expect((result.nextContext?.payload as any).skipped).toBe(true);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: 'compression_error',
        }),
      );
    });

    describe('assistantMessageId reuse', () => {
      it('should reuse existing assistant message when assistantMessageId is provided', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const existingAssistantId = 'existing-assistant-msg-123';
        const instruction = {
          payload: {
            assistantMessageId: existingAssistantId,
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            parentMessageId: 'parent-msg-123',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // Should NOT create a new assistant message
        expect(mockMessageModel.create).not.toHaveBeenCalled();

        // Should publish stream_start event with existing assistant message ID
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            data: expect.objectContaining({
              assistantMessage: { id: existingAssistantId },
            }),
            type: 'stream_start',
          }),
        );
      });

      it('should create new assistant message when assistantMessageId is not provided', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            parentMessageId: 'parent-msg-123',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // Should create a new assistant message
        expect(mockMessageModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: 'agent-123',
            content: '',
            model: 'gpt-4',
            parentId: 'parent-msg-123',
            provider: 'openai',
            role: 'assistant',
          }),
        );

        // Should publish stream_start event with newly created message ID
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            data: expect.objectContaining({
              assistantMessage: { id: 'msg-123' },
            }),
            type: 'stream_start',
          }),
        );
      });

      it('should use existing assistantMessageId even when parentMessageId is also provided', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const existingAssistantId = 'pre-created-assistant-456';
        const instruction = {
          payload: {
            assistantMessageId: existingAssistantId,
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            parentId: 'parent-id-789',
            parentMessageId: 'parent-msg-789',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // Should NOT create a new message
        expect(mockMessageModel.create).not.toHaveBeenCalled();

        // Stream event should reference the existing message
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            data: expect.objectContaining({
              assistantMessage: { id: existingAssistantId },
            }),
            type: 'stream_start',
          }),
        );
      });

      it('should create new message when assistantMessageId is undefined', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const instruction = {
          payload: {
            assistantMessageId: undefined,
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // Should create a new assistant message
        expect(mockMessageModel.create).toHaveBeenCalledTimes(1);
      });

      it('should create new message when assistantMessageId is empty string', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const instruction = {
          payload: {
            assistantMessageId: '',
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
            tools: [],
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // Empty string is falsy, so should create new message
        expect(mockMessageModel.create).toHaveBeenCalledTimes(1);
      });
    });

    describe('forceFinish behavior', () => {
      let mockChat: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        mockChat = vi.fn().mockResolvedValue(new Response('done'));
        vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);
      });

      it('should strip tools when state.forceFinish is true', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState({ forceFinish: true });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
            tools: [{ description: 'Search the web', name: 'search' }],
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ tools: undefined }),
          expect.anything(),
        );
      });

      it('should pass tools normally when state.forceFinish is not set', async () => {
        const executors = createRuntimeExecutors(ctx);
        const tools = [
          {
            function: { description: 'Search the web', name: 'search' },
            type: 'function' as const,
          },
        ];
        const state = createMockState({ tools: tools as any });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ tools }),
          expect.anything(),
        );
      });

      it('should fallback to state.tools when payload.tools is not provided', async () => {
        const executors = createRuntimeExecutors(ctx);
        const stateTools = [
          {
            function: { description: 'State tool', name: 'state-tool' },
            type: 'function' as const,
          },
        ];
        const state = createMockState({ tools: stateTools as any });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ tools: stateTools }),
          expect.anything(),
        );
      });

      it('should strip state.tools too when forceFinish is true', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState({
          forceFinish: true,
          tools: [
            {
              function: { description: 'State tool', name: 'state-tool' },
              type: 'function' as const,
            },
          ] as any,
        });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ tools: undefined }),
          expect.anything(),
        );
      });
    });

    describe('serverMessagesEngine integration', () => {
      let mockChat: ReturnType<typeof vi.fn>;

      let engineSpy: any;

      beforeEach(() => {
        mockChat = vi.fn().mockResolvedValue(new Response('done'));
        vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);
        engineSpy = vi.spyOn(ContextEngineering, 'serverMessagesEngine');
      });

      afterEach(() => {
        engineSpy.mockRestore();
      });

      it('should process messages through serverMessagesEngine when agentConfig is set', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            plugins: [],
            systemRole: 'You are a helpful assistant',
          },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // Real serverMessagesEngine should have been called
        expect(engineSpy).toHaveBeenCalledTimes(1);

        // Verify the engine actually processed messages:
        // system role should be injected as the first message
        const chatMessages = mockChat.mock.calls[0][0].messages;
        expect(chatMessages[0]).toEqual(
          expect.objectContaining({
            content: expect.stringContaining('You are a helpful assistant'),
            role: 'system',
          }),
        );
        // Original user message should be preserved
        expect(chatMessages.at(-1)).toEqual(
          expect.objectContaining({ content: 'Hello', role: 'user' }),
        );
      });

      it('should not call serverMessagesEngine when agentConfig is not set', async () => {
        const executors = createRuntimeExecutors(ctx); // ctx without agentConfig
        const state = createMockState();

        const rawMessages = [{ content: 'Hello', role: 'user' }];
        const instruction = {
          payload: {
            messages: rawMessages,
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(engineSpy).not.toHaveBeenCalled();

        // Raw messages should be passed directly to chat
        expect(mockChat).toHaveBeenCalledWith(
          expect.objectContaining({ messages: rawMessages }),
          expect.anything(),
        );
      });

      it('should pass forceFinish flag to serverMessagesEngine and inject summary', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: { plugins: [], systemRole: 'test' },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState({ forceFinish: true });

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        // forceFinish should be passed to the engine
        expect(engineSpy).toHaveBeenCalledWith(expect.objectContaining({ forceFinish: true }));

        // The engine's ForceFinishSummaryInjector should inject a summary system message
        const chatMessages = mockChat.mock.calls[0][0].messages;
        const hasForceFinishMessage = chatMessages.some(
          (m: any) =>
            m.role === 'system' &&
            m.content.includes('maximum step limit') &&
            m.content.includes('Do not attempt to use any tools'),
        );
        expect(hasForceFinishMessage).toBe(true);
      });

      it('should pass evalContext to serverMessagesEngine', async () => {
        const evalContext = { expectedOutput: 'test answer', evalMode: true };
        const ctxWithEval: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: { plugins: [], systemRole: 'test' },
          evalContext: evalContext as any,
        };
        const executors = createRuntimeExecutors(ctxWithEval);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(engineSpy).toHaveBeenCalledWith(expect.objectContaining({ evalContext }));
      });

      it('should build capabilities from LOBE_DEFAULT_MODEL_LIST', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: { plugins: [], systemRole: 'test' },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        const callArgs = engineSpy.mock.calls[0][0];

        // gpt-4/openai is in mock list with functionCall: true, vision: true, video: false
        expect(callArgs.capabilities.isCanUseFC('gpt-4', 'openai')).toBe(true);
        expect(callArgs.capabilities.isCanUseVision('gpt-4', 'openai')).toBe(true);
        expect(callArgs.capabilities.isCanUseVideo('gpt-4', 'openai')).toBe(false);

        // no-tools-model has all abilities set to false
        expect(callArgs.capabilities.isCanUseFC('no-tools-model', 'test-provider')).toBe(false);
        expect(callArgs.capabilities.isCanUseVision('no-tools-model', 'test-provider')).toBe(false);
        expect(callArgs.capabilities.isCanUseVideo('no-tools-model', 'test-provider')).toBe(false);

        // Unknown model defaults: functionCall=true, vision=true, video=false
        expect(callArgs.capabilities.isCanUseFC('unknown', 'unknown')).toBe(true);
        expect(callArgs.capabilities.isCanUseVision('unknown', 'unknown')).toBe(true);
        expect(callArgs.capabilities.isCanUseVideo('unknown', 'unknown')).toBe(false);
      });

      it('should filter disabled files and knowledgeBases from agentConfig', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            files: [
              { content: 'yes', enabled: true, id: 'f1', name: 'enabled.pdf' },
              { content: 'no', enabled: false, id: 'f2', name: 'disabled.pdf' },
              { content: 'maybe', enabled: null, id: 'f3', name: 'null.pdf' },
            ],
            knowledgeBases: [
              { enabled: true, id: 'kb1', name: 'Enabled KB' },
              { enabled: false, id: 'kb2', name: 'Disabled KB' },
            ],
            plugins: [],
            systemRole: 'test',
          },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        const callArgs = engineSpy.mock.calls[0][0];

        // Only enabled files should be included (enabled === true)
        expect(callArgs.knowledge.fileContents).toHaveLength(1);
        expect(callArgs.knowledge.fileContents[0]).toEqual({
          content: 'yes',
          fileId: 'f1',
          filename: 'enabled.pdf',
        });

        // Only enabled knowledge bases
        expect(callArgs.knowledge.knowledgeBases).toHaveLength(1);
        expect(callArgs.knowledge.knowledgeBases[0]).toEqual({
          id: 'kb1',
          name: 'Enabled KB',
        });
      });

      it('should skip topic reference resolution when messages already contain topic_reference_context', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: { plugins: [], systemRole: 'test' },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [
              {
                content:
                  '<refer_topic name="Old topic" id="topic-abc" />\nHello\n<system_context>\n<context type="topic_reference_context">\n<referred_topics>...</referred_topics>\n</context>\n</system_context>',
                role: 'user',
              },
            ],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(engineSpy).toHaveBeenCalledTimes(1);
        const callArgs = engineSpy.mock.calls[0][0];
        expect(callArgs).not.toHaveProperty('topicReferences');
      });

      it('should resolve topic references when messages do not contain topic_reference_context', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: { plugins: [], systemRole: 'test' },
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [{ content: 'Just a normal message without any topic refs', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(engineSpy).toHaveBeenCalledTimes(1);
        // resolveTopicReferences ran but found no <refer_topic> tags → topicReferences is undefined
        const callArgs = engineSpy.mock.calls[0][0];
        expect(callArgs).not.toHaveProperty('topicReferences');
      });

      it('should skip rebuilding onboarding context when messages already contain onboarding injection', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            plugins: ['lobe-web-onboarding'],
            slug: 'web-onboarding',
            systemRole: 'test',
          } as any,
        };
        const executors = createRuntimeExecutors(ctxWithConfig);
        const state = createMockState();

        const instruction = {
          payload: {
            messages: [
              {
                content:
                  '<onboarding_context>\n<phase>existing</phase>\n</onboarding_context>\nHello',
                role: 'user',
              },
            ],
            model: 'gpt-4',
            provider: 'openai',
          },
          type: 'call_llm' as const,
        };

        await executors.call_llm!(instruction, state);

        expect(engineSpy).toHaveBeenCalledTimes(1);
        const callArgs = engineSpy.mock.calls[0][0];
        expect(callArgs).not.toHaveProperty('onboardingContext');
      });
    });
  });

  describe('call_tool executor', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: {
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: 'topic-123',
      },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    it('should pass parentId (parentMessageId) to messageModel.create for tool message', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      await executors.call_tool!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'assistant-msg-123',
          role: 'tool',
          tool_call_id: 'tool-call-1',
        }),
      );
    });

    it('should include all required fields when creating tool message', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-456',
          toolCalling: {
            apiName: 'crawl',
            arguments: '{"url": "https://example.com"}',
            id: 'tool-call-2',
            identifier: 'web-browsing',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      await executors.call_tool!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          content: 'Tool result',
          parentId: 'assistant-msg-456',
          role: 'tool',
          threadId: 'thread-123',
          tool_call_id: 'tool-call-2',
          topicId: 'topic-123',
        }),
      );
    });

    it('should persist tool execution time in metadata when creating tool message', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-456',
          toolCalling: {
            apiName: 'crawl',
            arguments: '{"url": "https://example.com"}',
            id: 'tool-call-2',
            identifier: 'web-browsing',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      await executors.call_tool!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            toolExecutionTimeMs: 100,
          },
        }),
      );
    });

    it('should return tool message ID as parentMessageId in nextContext for parentId chain', async () => {
      // Setup: mock messageModel.create to return a specific tool message ID
      const toolMessageId = 'tool-msg-789';
      mockMessageModel.create.mockResolvedValue({ id: toolMessageId });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{"query": "test"}',
            id: 'tool-call-1',
            identifier: 'lobe-web-browsing',
            type: 'builtin' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const result = await executors.call_tool!(instruction, state);

      // Verify nextContext.payload.parentMessageId is the tool message ID
      // This is crucial for the parentId chain: user -> assistant -> tool -> assistant2
      const payload = result.nextContext!.payload as { parentMessageId?: string };
      expect(payload.parentMessageId).toBe(toolMessageId);
      expect(result.nextContext!.phase).toBe('tool_result');
    });

    it('should re-throw when messageModel.create fails (LOBE-7158: no silent swallow)', async () => {
      // Before LOBE-7158 we silently swallowed this error and returned
      // `parentMessageId: undefined`, which let the operation continue into
      // the next step and re-hit the same failure without context. The fix
      // requires the executor to propagate so the whole step fails.
      mockMessageModel.create.mockRejectedValue(new Error('Database error'));

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      await expect(executors.call_tool!(instruction, state)).rejects.toThrow('Database error');
    });

    it('should throw ConversationParentMissing on a parent_id FK violation (LOBE-7158)', async () => {
      // Simulate the drizzle + postgres-js wrapped error shape.
      const fkError: any = new Error(
        'Failed query: insert into "messages" ... violates foreign key constraint',
      );
      fkError.cause = {
        code: '23503',
        constraint: 'messages_parent_id_messages_id_fk',
      };
      mockMessageModel.create.mockRejectedValue(fkError);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'deleted-parent',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      await expect(executors.call_tool!(instruction, state)).rejects.toMatchObject({
        errorType: 'ConversationParentMissing',
        parentId: 'deleted-parent',
      });

      // Stream event must carry the normalized error, not raw SQL text —
      // clients treat `error` events as terminal and surface data.error
      // directly, so leaking driver output here would show up to users.
      const errorEventPublishes = mockStreamManager.publishStreamEvent.mock.calls.filter(
        ([, event]: [string, any]) => event.type === 'error',
      );
      expect(errorEventPublishes.length).toBeGreaterThan(0);
      for (const [, event] of errorEventPublishes) {
        expect(event.data.errorType).toBe('ConversationParentMissing');
        expect(event.data.error).not.toMatch(/Failed query/);
      }
    });

    it('should retry tool execution when kind is retry and eventually succeed', async () => {
      mockToolExecutionService.executeTool
        .mockResolvedValueOnce({
          content: 'timeout-1',
          error: { kind: 'retry', message: 'timeout' },
          executionTime: 50,
          state: {},
          success: false,
        })
        .mockResolvedValueOnce({
          content: 'timeout-2',
          error: { kind: 'retry', message: 'timeout' },
          executionTime: 50,
          state: {},
          success: false,
        })
        .mockResolvedValueOnce({
          content: 'Tool result success',
          error: null,
          executionTime: 80,
          state: {},
          success: true,
        });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-retry-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const result = await executors.call_tool!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(3);
      expect((result.nextContext!.payload as any).isSuccess).toBe(true);
    });

    it('should stop retrying tool execution after operation is interrupted', async () => {
      mockToolExecutionService.executeTool.mockResolvedValue({
        content: 'timeout',
        error: { kind: 'retry', message: 'timeout' },
        executionTime: 50,
        state: {},
        success: false,
      });
      const loadAgentState = vi.fn().mockResolvedValue({ status: 'interrupted' });

      const executors = createRuntimeExecutors({
        ...ctx,
        loadAgentState,
      });
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-retry-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const result = await executors.call_tool!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(1);
      expect(loadAgentState).toHaveBeenCalledWith('op-123');
      expect((result.nextContext!.payload as any).isSuccess).toBe(false);
    });

    it('should materialize failed tool result after retry exhaustion', async () => {
      mockToolExecutionService.executeTool.mockResolvedValue({
        content: 'still failing',
        error: { kind: 'retry', message: 'timeout' },
        executionTime: 50,
        state: {},
        success: false,
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-retry-2',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const result = await executors.call_tool!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(3);
      expect((result.nextContext!.payload as any).isSuccess).toBe(false);
    });

    it('should not retry for replan or stop kinds', async () => {
      mockToolExecutionService.executeTool
        .mockResolvedValueOnce({
          content: 'invalid args',
          error: { kind: 'replan', message: 'invalid schema' },
          executionTime: 30,
          state: {},
          success: false,
        })
        .mockResolvedValueOnce({
          content: 'permission denied',
          error: { kind: 'stop', message: 'forbidden' },
          executionTime: 30,
          state: {},
          success: false,
        });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const replanInstruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-replan-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      const stopInstruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolCalling: {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-stop-1',
            identifier: 'web-search',
            type: 'default' as const,
          },
        },
        type: 'call_tool' as const,
      };

      await executors.call_tool!(replanInstruction, state);
      await executors.call_tool!(stopInstruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(2);
    });

    describe('skipCreateToolMessage (resumption after human approval)', () => {
      it('should update existing tool message instead of creating a new one', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const instruction = {
          payload: {
            parentMessageId: 'pending-tool-msg-1',
            skipCreateToolMessage: true,
            toolCalling: {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          },
          type: 'call_tool' as const,
        };

        await executors.call_tool!(instruction, state);

        expect(mockMessageModel.create).not.toHaveBeenCalled();
        expect(mockMessageModel.updateToolMessage).toHaveBeenCalledWith(
          'pending-tool-msg-1',
          expect.objectContaining({
            content: 'Tool result',
            metadata: { toolExecutionTimeMs: 100 },
          }),
        );
      });

      it('should return the existing toolMessageId as parentMessageId for the next LLM step', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const instruction = {
          payload: {
            parentMessageId: 'pending-tool-msg-42',
            skipCreateToolMessage: true,
            toolCalling: {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-42',
              identifier: 'web-search',
              type: 'default' as const,
            },
          },
          type: 'call_tool' as const,
        };

        const result = await executors.call_tool!(instruction, state);

        const nextPayload = result.nextContext?.payload as { parentMessageId?: string } | undefined;
        expect(nextPayload?.parentMessageId).toBe('pending-tool-msg-42');
      });

      it('should fall back to creating a new tool message when skipCreateToolMessage is false', async () => {
        const executors = createRuntimeExecutors(ctx);
        const state = createMockState();

        const instruction = {
          payload: {
            parentMessageId: 'assistant-msg-7',
            skipCreateToolMessage: false,
            toolCalling: {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-7',
              identifier: 'web-search',
              type: 'default' as const,
            },
          },
          type: 'call_tool' as const,
        };

        await executors.call_tool!(instruction, state);

        expect(mockMessageModel.create).toHaveBeenCalledTimes(1);
        expect(mockMessageModel.updateToolMessage).not.toHaveBeenCalled();
      });
    });
  });

  describe('request_human_approve executor', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [
        {
          content: 'assistant response',
          id: 'assistant-msg-1',
          role: 'assistant',
        } as any,
      ],
      metadata: {
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: 'topic-123',
      },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    const makePendingTools = () => [
      {
        apiName: 'search',
        arguments: '{"q":"test"}',
        id: 'tool-call-1',
        identifier: 'web-search',
        type: 'default' as const,
      },
      {
        apiName: 'write',
        arguments: '{"file":"a.md"}',
        id: 'tool-call-2',
        identifier: 'local-system',
        type: 'default' as const,
      },
    ];

    it('should create a pending tool message for each pendingToolsCalling', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockResolvedValueOnce({ id: 'tool-msg-2' });

      const instruction = {
        pendingToolsCalling: makePendingTools(),
        type: 'request_human_approve' as const,
      };

      await executors.request_human_approve!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenCalledTimes(2);
      expect(mockMessageModel.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          agentId: 'agent-123',
          content: '',
          parentId: 'assistant-msg-1',
          pluginIntervention: { status: 'pending' },
          role: 'tool',
          tool_call_id: 'tool-call-1',
          topicId: 'topic-123',
        }),
      );
      expect(mockMessageModel.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          parentId: 'assistant-msg-1',
          pluginIntervention: { status: 'pending' },
          tool_call_id: 'tool-call-2',
        }),
      );
    });

    it('should set state to waiting_for_human and copy pendingToolsCalling', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockResolvedValueOnce({ id: 'tool-msg-2' });
      const pending = makePendingTools();

      const result = await executors.request_human_approve!(
        { pendingToolsCalling: pending, type: 'request_human_approve' as const },
        state,
      );

      expect(result.newState.status).toBe('waiting_for_human');
      expect(result.newState.pendingToolsCalling).toEqual(pending);
    });

    it('should publish tools_calling chunk with toolMessageIds mapping', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockResolvedValueOnce({ id: 'tool-msg-2' });

      await executors.request_human_approve!(
        {
          pendingToolsCalling: makePendingTools(),
          type: 'request_human_approve' as const,
        },
        state,
      );

      const chunkCall = mockStreamManager.publishStreamChunk.mock.calls.find(
        (call: any[]) => call[2]?.chunkType === 'tools_calling',
      );
      expect(chunkCall).toBeTruthy();
      expect(chunkCall![2].toolMessageIds).toEqual({
        'tool-call-1': 'tool-msg-1',
        'tool-call-2': 'tool-msg-2',
      });
    });

    it('should skip message creation when skipCreateToolMessage is true', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      mockMessageModel.query.mockResolvedValueOnce([
        { id: 'existing-tool-1', role: 'tool', tool_call_id: 'tool-call-1' },
        { id: 'existing-tool-2', role: 'tool', tool_call_id: 'tool-call-2' },
      ]);

      await executors.request_human_approve!(
        {
          pendingToolsCalling: makePendingTools(),
          skipCreateToolMessage: true,
          type: 'request_human_approve' as const,
        },
        state,
      );

      expect(mockMessageModel.create).not.toHaveBeenCalled();
      const chunkCall = mockStreamManager.publishStreamChunk.mock.calls.find(
        (call: any[]) => call[2]?.chunkType === 'tools_calling',
      );
      expect(chunkCall![2].toolMessageIds).toEqual({
        'tool-call-1': 'existing-tool-1',
        'tool-call-2': 'existing-tool-2',
      });
    });

    it('should throw if no parent assistant message can be found', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({ messages: [] });
      mockMessageModel.query.mockResolvedValueOnce([]);

      await expect(
        executors.request_human_approve!(
          {
            pendingToolsCalling: makePendingTools(),
            type: 'request_human_approve' as const,
          },
          state,
        ),
      ).rejects.toThrow(/No assistant message found/);
    });

    it('should emit human_approve_required and tool_pending events', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockResolvedValueOnce({ id: 'tool-msg-2' });

      const result = await executors.request_human_approve!(
        {
          pendingToolsCalling: makePendingTools(),
          type: 'request_human_approve' as const,
        },
        state,
      );

      expect(result.events).toContainEqual(
        expect.objectContaining({ type: 'human_approve_required' }),
      );
      expect(result.events).toContainEqual(expect.objectContaining({ type: 'tool_pending' }));
    });

    it('should NOT return a nextContext (operation pauses)', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockResolvedValueOnce({ id: 'tool-msg-2' });

      const result = await executors.request_human_approve!(
        {
          pendingToolsCalling: makePendingTools(),
          type: 'request_human_approve' as const,
        },
        state,
      );

      expect(result.nextContext).toBeUndefined();
    });
  });

  describe('call_tools_batch executor', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: {
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: 'topic-123',
      },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    beforeEach(() => {
      // Reset mock to return unique IDs for each call
      let callCount = 0;
      mockMessageModel.create.mockImplementation(() => {
        callCount++;
        return Promise.resolve({ id: `tool-msg-${callCount}` });
      });

      // Mock query to return messages from database
      mockMessageModel.query = vi.fn().mockResolvedValue([
        { id: 'msg-1', content: 'Hello', role: 'user' },
        { id: 'msg-2', content: 'Response', role: 'assistant', tool_calls: [] },
        { id: 'tool-msg-1', content: 'Tool result 1', role: 'tool', tool_call_id: 'tool-call-1' },
        { id: 'tool-msg-2', content: 'Tool result 2', role: 'tool', tool_call_id: 'tool-call-2' },
      ]);
    });

    it('should execute multiple tools concurrently and create tool messages', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{"query": "test1"}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{"url": "https://example.com"}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      // Should execute both tools
      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(2);

      // Should create two tool messages
      expect(mockMessageModel.create).toHaveBeenCalledTimes(2);

      // Verify first tool message
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          parentId: 'assistant-msg-123',
          role: 'tool',
          tool_call_id: 'tool-call-1',
        }),
      );

      // Verify second tool message
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          parentId: 'assistant-msg-123',
          role: 'tool',
          tool_call_id: 'tool-call-2',
        }),
      );
    });

    it('should apply retry policy per tool in batch mode', async () => {
      const attemptsByTool: Record<string, number> = {};

      mockToolExecutionService.executeTool.mockImplementation((payload: any) => {
        const toolId = payload.id as string;
        const nextAttempt = (attemptsByTool[toolId] || 0) + 1;
        attemptsByTool[toolId] = nextAttempt;

        if (toolId === 'tool-call-retry-batch' && nextAttempt < 3) {
          return Promise.resolve({
            content: 'timeout',
            error: { kind: 'retry', message: 'timeout' },
            executionTime: 40,
            state: {},
            success: false,
          });
        }

        if (toolId === 'tool-call-stop-batch') {
          return Promise.resolve({
            content: 'permission denied',
            error: { kind: 'stop', message: 'forbidden' },
            executionTime: 40,
            state: {},
            success: false,
          });
        }

        return Promise.resolve({
          content: 'ok',
          error: null,
          executionTime: 60,
          state: {},
          success: true,
        });
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-retry-batch',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-stop-batch',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(4);
      expect((result.nextContext!.payload as any).toolResults).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ isSuccess: true }),
          expect.objectContaining({ isSuccess: false }),
        ]),
      );
    });

    it('should refresh messages from database after batch execution', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({ messages: [{ content: 'old', role: 'user' }] });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // Should query messages from database with agentId, threadId, and topicId
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        {
          agentId: 'agent-123',
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
        expect.any(Object),
      );

      // Messages should be refreshed from database (4 messages from mock)
      expect(result.newState.messages).toHaveLength(4);
    });

    it('should include id in refreshed messages', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // Each message should have an id
      result.newState.messages.forEach((msg: any) => {
        expect(msg.id).toBeDefined();
        expect(typeof msg.id).toBe('string');
      });

      // Verify specific message ids
      expect(result.newState.messages[0].id).toBe('msg-1');
      expect(result.newState.messages[2].id).toBe('tool-msg-1');
    });

    it('should return last tool message ID as parentMessageId in nextContext', async () => {
      let callCount = 0;
      mockMessageModel.create.mockImplementation(() => {
        callCount++;
        return Promise.resolve({ id: `created-tool-msg-${callCount}` });
      });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // parentMessageId should be the last created tool message ID
      const payload = result.nextContext!.payload as { parentMessageId?: string };
      expect(payload.parentMessageId).toBe('created-tool-msg-2');
      expect(result.nextContext!.phase).toBe('tools_batch_result');
    });

    it('should propagate persist failures instead of silently falling back (LOBE-7158)', async () => {
      // Before LOBE-7158 we fell back to the original parentMessageId here,
      // which was itself the deleted parent that caused the failure — so the
      // next step would hit the same FK violation with no context. The fix
      // requires the batch to short-circuit on persist failure.
      mockMessageModel.create.mockRejectedValue(new Error('Database error'));

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'original-parent-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await expect(executors.call_tools_batch!(instruction, state)).rejects.toThrow(
        'Database error',
      );
    });

    it('should throw ConversationParentMissing on a parent_id FK violation (LOBE-7158)', async () => {
      const fkError: any = new Error(
        'Failed query: insert into "messages" ... violates foreign key constraint',
      );
      fkError.cause = {
        code: '23503',
        constraint: 'messages_parent_id_messages_id_fk',
      };
      mockMessageModel.create.mockRejectedValue(fkError);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'deleted-parent',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await expect(executors.call_tools_batch!(instruction, state)).rejects.toMatchObject({
        errorType: 'ConversationParentMissing',
        parentId: 'deleted-parent',
      });
    });

    it('should continue processing other tools if one tool execution fails', async () => {
      // First tool fails, second succeeds
      mockToolExecutionService.executeTool
        .mockRejectedValueOnce(new Error('Tool execution error'))
        .mockResolvedValueOnce({
          content: 'Tool result 2',
          error: null,
          executionTime: 100,
          state: {},
          success: true,
        });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // Both tools should be attempted
      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(2);

      // Only one tool message should be created (for the successful tool)
      expect(mockMessageModel.create).toHaveBeenCalledTimes(1);

      // Should still return result (not throw)
      expect(result.nextContext).toBeDefined();
      expect(result.nextContext!.phase).toBe('tools_batch_result');
    });

    it('should fail the batch if tool message creation fails for any tool (LOBE-7158)', async () => {
      // Before LOBE-7158 we swallowed per-tool persist failures and kept
      // going. The fix requires the batch to abort — a FK violation on one
      // tool means every concurrent tool has the same doomed parent.
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockRejectedValueOnce(new Error('Database error'));

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await expect(executors.call_tools_batch!(instruction, state)).rejects.toThrow(
        'Database error',
      );
    });

    it('should publish tool_start and tool_end events for each tool', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      // Should publish tool_start for each tool
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({ type: 'tool_start' }),
      );

      // Should publish tool_end for each tool
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({ type: 'tool_end' }),
      );

      // At least 4 events (2 tool_start + 2 tool_end)
      expect(mockStreamManager.publishStreamEvent.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('should include toolCount and toolResults in nextContext payload', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      const payload = result.nextContext!.payload as {
        toolCount: number;
        toolResults: any[];
      };

      expect(payload.toolCount).toBe(2);
      expect(payload.toolResults).toHaveLength(2);
      expect(payload.toolResults[0]).toEqual(
        expect.objectContaining({
          toolCallId: 'tool-call-1',
          isSuccess: true,
        }),
      );
    });

    it('should query messages with correct metadata fields when state.metadata is defined', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          agentId: 'agent-abc',
          threadId: 'thread-xyz',
          topicId: 'topic-abc-123',
        },
      });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      // Should query messages with agentId, threadId, and topicId from state.metadata
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        {
          agentId: 'agent-abc',
          threadId: 'thread-xyz',
          topicId: 'topic-abc-123',
        },
        expect.any(Object),
      );
    });

    // LOBE-5143: After DB refresh, state.messages stores raw UIChatMessage[]
    // and call_llm re-injects context via serverMessagesEngine on each invocation
    it('should store raw UIChatMessage[] from DB after refresh (context re-injected by call_llm)', async () => {
      // DB only stores raw user/assistant/tool messages, NOT MessagesEngine injections
      const dbMessages = [
        { id: 'msg-1', content: 'What is quantum computing?', role: 'user' },
        {
          id: 'msg-2',
          content: '',
          role: 'assistant',
          tool_calls: [{ id: 'tool-call-1', function: { name: 'search', arguments: '{}' } }],
        },
        {
          id: 'tool-msg-1',
          content: 'Search results...',
          role: 'tool',
          tool_call_id: 'tool-call-1',
        },
      ];
      mockMessageModel.query = vi.fn().mockResolvedValue(dbMessages);

      const executors = createRuntimeExecutors(ctx);

      // State before tool execution: messages are raw UIChatMessage[]
      const state = createMockState({
        messages: [
          { id: 'msg-1', content: 'What is quantum computing?', role: 'user' },
          {
            id: 'msg-2',
            content: '',
            role: 'assistant',
            tool_calls: [{ id: 'tool-call-1', function: { name: 'search', arguments: '{}' } }],
          },
        ],
      });

      const instruction = {
        payload: {
          parentMessageId: 'msg-2',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // After DB refresh, messages should be full UIChatMessage[] (via parse),
      // preserving all fields (id, content, role, tool_calls, tool_call_id)
      expect(result.newState.messages).toHaveLength(3);
      expect(result.newState.messages[0]).toEqual(
        expect.objectContaining({
          id: 'msg-1',
          role: 'user',
          content: 'What is quantum computing?',
        }),
      );
      expect(result.newState.messages[2]).toEqual(
        expect.objectContaining({
          id: 'tool-msg-1',
          role: 'tool',
          tool_call_id: 'tool-call-1',
        }),
      );
    });

    it('should preserve messages in newState even when state.metadata.topicId is undefined', async () => {
      // Regression test: When state.metadata.topicId is undefined, previously the query
      // only passed topicId, which caused isNull(topicId) condition and returned 0 messages.
      // This led to "messages: at least one message is required" error in the next call_llm step.
      //
      // Fix: Now we also pass agentId and threadId, so even when topicId is undefined,
      // the query can still find messages by agentId scope.

      // Mock: query returns messages when agentId is provided (regardless of topicId)
      mockMessageModel.query = vi
        .fn()
        .mockImplementation((params: { agentId?: string; topicId?: string }) => {
          // With the fix, agentId is always passed, so we can find messages
          if (params.agentId) {
            return Promise.resolve([
              { id: 'msg-1', content: 'Hello', role: 'user' },
              { id: 'msg-2', content: 'Response', role: 'assistant', tool_calls: [] },
            ]);
          }
          // Without agentId (old buggy behavior), return empty
          return Promise.resolve([]);
        });

      const executors = createRuntimeExecutors(ctx);
      // State with undefined topicId but has agentId
      const state = createMockState({
        messages: [
          { content: 'Hello', role: 'user' },
          { content: 'Response', role: 'assistant', tool_calls: [] },
        ],
        metadata: {
          agentId: 'agent-123',
          threadId: 'thread-123',
          topicId: undefined, // topicId is undefined
        },
      });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // Verify agentId is passed in the query
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        {
          agentId: 'agent-123',
          threadId: 'thread-123',
          topicId: undefined,
        },
        expect.any(Object),
      );

      // Expected: newState.messages should NOT be empty
      // The next call_llm step needs messages to work properly
      expect(result.newState.messages.length).toBeGreaterThan(0);
    });

    it('should accumulate tool usage in newState after batch execution', async () => {
      mockToolExecutionService.executeTool
        .mockResolvedValueOnce({
          content: 'Search result',
          error: null,
          executionTime: 150,
          state: {},
          success: true,
        })
        .mockResolvedValueOnce({
          content: 'Crawl result',
          error: null,
          executionTime: 250,
          state: {},
          success: true,
        });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{"query": "test"}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{"url": "https://example.com"}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      const result = await executors.call_tools_batch!(instruction, state);

      // Tool usage must be accumulated in newState
      expect(result.newState.usage.tools.totalCalls).toBe(2);
      expect(result.newState.usage.tools.totalTimeMs).toBe(400);
      expect(result.newState.usage.tools.byTool).toHaveLength(2);

      // Verify per-tool breakdown
      const searchTool = result.newState.usage.tools.byTool.find(
        (t: any) => t.name === 'web-search/search',
      );
      const crawlTool = result.newState.usage.tools.byTool.find(
        (t: any) => t.name === 'web-browsing/crawl',
      );
      expect(searchTool).toEqual(
        expect.objectContaining({ calls: 1, errors: 0, totalTimeMs: 150 }),
      );
      expect(crawlTool).toEqual(expect.objectContaining({ calls: 1, errors: 0, totalTimeMs: 250 }));

      // Original state must not be mutated
      expect(state.usage.tools.totalCalls).toBe(0);
    });

    it('should persist execution time metadata for each tool message in batch execution', async () => {
      mockToolExecutionService.executeTool
        .mockResolvedValueOnce({
          content: 'Search result',
          error: null,
          executionTime: 150,
          state: {},
          success: true,
        })
        .mockResolvedValueOnce({
          content: 'Crawl result',
          error: null,
          executionTime: 250,
          state: {},
          success: true,
        });

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{"query": "test"}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{"url": "https://example.com"}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      expect(mockMessageModel.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          metadata: {
            toolExecutionTimeMs: 150,
          },
        }),
      );
      expect(mockMessageModel.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          metadata: {
            toolExecutionTimeMs: 250,
          },
        }),
      );
    });

    it('should pass toolResultMaxLength from agentConfig to executeTool', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          agentConfig: {
            chatConfig: {
              toolResultMaxLength: 5000,
            },
          },
          agentId: 'agent-123',
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          toolResultMaxLength: 5000,
        }),
      );
    });

    it('should pass agentId from runtime metadata to executeTool', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({
        metadata: {
          agentId: 'agent-docs-123',
          threadId: 'thread-123',
          topicId: 'topic-123',
        },
      });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'createDocument',
              arguments: '{"title":"Test","content":"Hello"}',
              id: 'tool-call-1',
              identifier: 'lobe-agent-documents',
              type: 'builtin' as const,
            },
          ],
        },
        type: 'call_tools_batch' as const,
      };

      await executors.call_tools_batch!(instruction, state);

      expect(mockToolExecutionService.executeTool).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          agentId: 'agent-docs-123',
        }),
      );
    });
  });

  describe('resolve_aborted_tools executor', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: {
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: 'topic-123',
      },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    it('should create aborted tool messages for all pending tool calls', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{"query": "test"}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{"url": "https://example.com"}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'resolve_aborted_tools' as const,
      };

      await executors.resolve_aborted_tools!(instruction, state);

      // Should create two aborted tool messages
      expect(mockMessageModel.create).toHaveBeenCalledTimes(2);

      // First tool message
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          content: 'Tool execution was aborted by user.',
          parentId: 'assistant-msg-123',
          pluginIntervention: { status: 'aborted' },
          role: 'tool',
          threadId: 'thread-123',
          tool_call_id: 'tool-call-1',
          topicId: 'topic-123',
        }),
      );

      // Second tool message
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          content: 'Tool execution was aborted by user.',
          parentId: 'assistant-msg-123',
          pluginIntervention: { status: 'aborted' },
          role: 'tool',
          threadId: 'thread-123',
          tool_call_id: 'tool-call-2',
          topicId: 'topic-123',
        }),
      );
    });

    it('should update state status to done after resolving aborted tools', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({ status: 'running' });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'resolve_aborted_tools' as const,
      };

      const result = await executors.resolve_aborted_tools!(instruction, state);

      expect(result.newState.status).toBe('done');
    });

    it('should emit done event with user_aborted reason', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'resolve_aborted_tools' as const,
      };

      const result = await executors.resolve_aborted_tools!(instruction, state);

      expect(result.events).toContainEqual(
        expect.objectContaining({
          reason: 'user_aborted',
          reasonDetail: 'User aborted operation with pending tool calls',
          type: 'done',
        }),
      );
    });

    it('should publish stream events for abort process', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
          ],
        },
        type: 'resolve_aborted_tools' as const,
      };

      await executors.resolve_aborted_tools!(instruction, state);

      // Should publish step_start event for tools_aborted phase
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({
          data: expect.objectContaining({
            phase: 'tools_aborted',
          }),
          type: 'step_start',
        }),
      );

      // Should publish step_complete event
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({
          data: expect.objectContaining({
            phase: 'execution_complete',
            reason: 'user_aborted',
          }),
          type: 'step_complete',
        }),
      );
    });

    it('should add tool messages to state.messages', async () => {
      const executors = createRuntimeExecutors(ctx);
      const state = createMockState({ messages: [] });

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'resolve_aborted_tools' as const,
      };

      const result = await executors.resolve_aborted_tools!(instruction, state);

      expect(result.newState.messages).toHaveLength(2);
      expect(result.newState.messages[0]).toEqual({
        content: 'Tool execution was aborted by user.',
        role: 'tool',
        tool_call_id: 'tool-call-1',
      });
      expect(result.newState.messages[1]).toEqual({
        content: 'Tool execution was aborted by user.',
        role: 'tool',
        tool_call_id: 'tool-call-2',
      });
    });

    it('should propagate persist failures instead of silently swallowing (LOBE-7158)', async () => {
      // The pre-LOBE-7158 behavior logged the error and kept walking the
      // aborted-tool list. That left a half-persisted state and hid the real
      // cause from ops. Now we fail fast.
      mockMessageModel.create
        .mockResolvedValueOnce({ id: 'tool-msg-1' })
        .mockRejectedValueOnce(new Error('Database error'));

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          parentMessageId: 'assistant-msg-123',
          toolsCalling: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'web-search',
              type: 'default' as const,
            },
            {
              apiName: 'crawl',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'web-browsing',
              type: 'default' as const,
            },
          ],
        },
        type: 'resolve_aborted_tools' as const,
      };

      await expect(executors.resolve_aborted_tools!(instruction, state)).rejects.toThrow(
        'Database error',
      );
    });
  });

  // Regression: stream errors silently produce empty llm_result
  // Uses real consumeStreamUntilDone + createCallbacksTransformer to test the full stream pipeline.
  // Only the lowest-level chat() return is mocked to simulate provider error responses.
  describe('stream error detection in call_llm', () => {
    const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
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
      usage: createMockUsage(),
      ...overrides,
    });

    afterEach(() => {
      // Restore default mock for other tests
      vi.mocked(consumeStreamUntilDone).mockResolvedValue(undefined);
    });

    it('should retry and eventually throw when LLM stream contains error events from provider', async () => {
      vi.useFakeTimers();

      // Import real implementations directly from source (bypassing the @lobechat/model-runtime mock)
      const { consumeStreamUntilDone: realConsume } =
        await import('../../../../../packages/model-runtime/src/utils/consumeStream');
      const { createCallbacksTransformer } =
        await import('../../../../../packages/model-runtime/src/core/streams/protocol');

      // Use real consumeStreamUntilDone so the stream is actually consumed
      vi.mocked(consumeStreamUntilDone).mockImplementation(realConsume);

      const errorPayload = {
        body: { message: 'rate limit exceeded' },
        message: 'rate limit exceeded',
        type: 'ProviderBizError',
      };

      // Mock chat() at the lowest level: return a Response with SSE error stream
      // piped through the real createCallbacksTransformer (just like the OpenAI factory does)
      const mockChat = vi.fn().mockImplementation(async (_payload: any, options: any) => {
        const callbacks = options?.callback;
        const sseLines = ['event: error\n', `data: ${JSON.stringify(errorPayload)}\n\n`];
        const source = new ReadableStream<string>({
          start(controller) {
            for (const line of sseLines) controller.enqueue(line);
            controller.close();
          },
        });
        return new Response(source.pipeThrough(createCallbacksTransformer(callbacks)));
      });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      try {
        const resultPromise = executors.call_llm!(instruction, state);
        const rejectionExpectation = expect(resultPromise).rejects.toThrow(/LLM stream error/);

        await Promise.resolve();
        await vi.runAllTimersAsync();

        await rejectionExpectation;

        expect(mockChat).toHaveBeenCalledTimes(6);

        const retryEvents = mockStreamManager.publishStreamEvent.mock.calls.filter(
          ([, event]: [string, { type: string }]) => event.type === 'stream_retry',
        );

        expect(retryEvents).toHaveLength(5);

        // Error event should be published to stream manager after retries are exhausted
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            type: 'error',
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('should throw and not produce llm_result when modelRuntime.chat rejects', async () => {
      // When chat() throws (pre-stream error like auth failure), it SHOULD propagate
      const mockChat = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();

      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await expect(executors.call_llm!(instruction, state)).rejects.toThrow('401 Unauthorized');

      // Error event should be published to stream
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({
          type: 'error',
          data: expect.objectContaining({
            error: '401 Unauthorized',
            errorType: 'Error',
            phase: 'llm_execution',
          }),
        }),
      );
    });

    it('should retry llm execution, emit stream_retry, and commit only the successful attempt', async () => {
      vi.useFakeTimers();

      const toolCallPayload = [
        {
          function: { arguments: '{}', name: 'search' },
          id: 'tool-call-1',
          type: 'function',
        },
      ];

      const mockChat = vi
        .fn()
        .mockImplementationOnce(async (_payload: any, options: any) => {
          await options.callback.onGrounding?.({ query: 'draft' });
          await options.callback.onToolsCalling?.({ toolsCalling: toolCallPayload });
          throw new Error('network timeout');
        })
        .mockImplementationOnce(async (_payload: any, options: any) => {
          await options.callback.onText?.('final');
          await options.callback.onCompletion?.({
            usage: { totalInputTokens: 1, totalOutputTokens: 2, totalTokens: 3 },
          });
          return new Response('done');
        });

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      try {
        const resultPromise = executors.call_llm!(instruction, state);

        await vi.runOnlyPendingTimersAsync();

        const result = await resultPromise;

        expect(mockChat).toHaveBeenCalledTimes(2);
        expect(mockMessageModel.create).toHaveBeenCalledTimes(1);
        expect(mockMessageModel.update).toHaveBeenCalledWith(
          'msg-123',
          expect.objectContaining({ content: 'final' }),
        );
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            type: 'stream_retry',
            data: { attempt: 2, delayMs: 1000, maxAttempts: 6 },
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not retry llm execution after operation is interrupted', async () => {
      const mockChat = vi.fn().mockRejectedValue(new Error('network timeout'));
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);
      const loadAgentState = vi.fn().mockResolvedValue({ status: 'interrupted' });

      const executors = createRuntimeExecutors({
        ...ctx,
        loadAgentState,
      });
      const state = createMockState();
      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      await expect(executors.call_llm!(instruction, state)).rejects.toThrow('network timeout');

      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(loadAgentState).toHaveBeenCalledWith('op-123');
      expect(
        mockStreamManager.publishStreamEvent.mock.calls.some(
          ([, event]: [string, { type: string }]) => event.type === 'stream_retry',
        ),
      ).toBe(false);
    });

    it('should not retry llm execution if operation is interrupted during backoff', async () => {
      vi.useFakeTimers();

      const mockChat = vi.fn().mockRejectedValue(new Error('network timeout'));
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);
      const loadAgentState = vi
        .fn()
        .mockResolvedValueOnce({ status: 'running' })
        .mockResolvedValueOnce({ status: 'interrupted' });

      const executors = createRuntimeExecutors({
        ...ctx,
        loadAgentState,
      });
      const state = createMockState();
      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      try {
        const resultPromise = executors.call_llm!(instruction, state);
        const rejectionExpectation = expect(resultPromise).rejects.toThrow('network timeout');

        await Promise.resolve();
        await vi.runOnlyPendingTimersAsync();

        await rejectionExpectation;

        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(loadAgentState).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should apply exponential backoff across multiple llm retries', async () => {
      vi.useFakeTimers();

      const mockChat = vi
        .fn()
        .mockRejectedValueOnce(new Error('network timeout-1'))
        .mockRejectedValueOnce(new Error('network timeout-2'))
        .mockRejectedValueOnce(new Error('network timeout-3'))
        .mockImplementationOnce(async (_payload: any, options: any) => {
          await options.callback.onText?.('final');
          await options.callback.onCompletion?.({
            usage: { totalInputTokens: 1, totalOutputTokens: 2, totalTokens: 3 },
          });
          return new Response('done');
        });

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);

      const executors = createRuntimeExecutors(ctx);
      const state = createMockState();
      const instruction = {
        payload: {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'gpt-4',
          parentMessageId: 'parent-msg-123',
          provider: 'openai',
          tools: [],
        },
        type: 'call_llm' as const,
      };

      try {
        const resultPromise = executors.call_llm!(instruction, state);

        await vi.runOnlyPendingTimersAsync();
        await Promise.resolve();
        await vi.runOnlyPendingTimersAsync();
        await Promise.resolve();
        await vi.runOnlyPendingTimersAsync();

        const result = await resultPromise;

        expect(mockChat).toHaveBeenCalledTimes(4);
        expect(result.nextContext?.phase).toBe('llm_result');

        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            type: 'stream_retry',
            data: { attempt: 2, delayMs: 1000, maxAttempts: 6 },
          }),
        );
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            type: 'stream_retry',
            data: { attempt: 3, delayMs: 2000, maxAttempts: 6 },
          }),
        );
        expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            type: 'stream_retry',
            data: { attempt: 4, delayMs: 4000, maxAttempts: 6 },
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('hooks integration', () => {
    const createToolState = (overrides?: Partial<AgentState>): AgentState => ({
      cost: createMockCost(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      maxSteps: 100,
      messages: [],
      metadata: { agentId: 'agent-123', topicId: 'topic-123' },
      operationId: 'op-123',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: createMockUsage(),
      ...overrides,
    });

    const createToolInstruction = (overrides?: any) => ({
      payload: {
        parentMessageId: 'parent-msg',
        toolCalling: {
          apiName: 'search_tweets',
          arguments: '{"query":"test"}',
          id: 'tc-1',
          identifier: 'twitter',
          type: 'default' as const,
        },
        ...overrides,
      },
      type: 'call_tool' as const,
    });

    describe('call_tool hooks', () => {
      it('should dispatch beforeToolCall and afterToolCall hooks', async () => {
        const mockDispatcher = {
          dispatch: vi.fn().mockResolvedValue(undefined),
          dispatchBeforeToolCall: vi.fn().mockResolvedValue(null),
        };

        const ctxWithHooks = { ...ctx, hookDispatcher: mockDispatcher as any };
        const executors = createRuntimeExecutors(ctxWithHooks);

        await executors.call_tool!(createToolInstruction(), createToolState());

        expect(mockDispatcher.dispatchBeforeToolCall).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({
            apiName: 'search_tweets',
            callIndex: 1,
            identifier: 'twitter',
          }),
        );

        // afterToolCall dispatched via dispatch()
        expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
          'op-123',
          'afterToolCall',
          expect.objectContaining({
            apiName: 'search_tweets',
            identifier: 'twitter',
            mocked: false,
            success: true,
          }),
          undefined,
        );
      });

      it('should skip real execution when beforeToolCall returns mock', async () => {
        const mockDispatcher = {
          dispatch: vi.fn().mockResolvedValue(undefined),
          dispatchBeforeToolCall: vi
            .fn()
            .mockResolvedValue({ content: '{"mocked":true}', isMocked: true }),
        };

        const ctxWithHooks = { ...ctx, hookDispatcher: mockDispatcher as any };
        const executors = createRuntimeExecutors(ctxWithHooks);

        await executors.call_tool!(createToolInstruction(), createToolState());

        // Real tool should NOT have been called
        expect(mockToolExecutionService.executeTool).not.toHaveBeenCalled();

        // afterToolCall should report mocked: true
        expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
          'op-123',
          'afterToolCall',
          expect.objectContaining({ mocked: true, success: true }),
          undefined,
        );

        // Tool message should be persisted with mock content
        expect(mockMessageModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            content: '{"mocked":true}',
            role: 'tool',
          }),
        );
      });

      it('should dispatch onToolCallError when tool throws', async () => {
        mockToolExecutionService.executeTool.mockRejectedValue(new Error('Connection refused'));

        const mockDispatcher = {
          dispatch: vi.fn().mockResolvedValue(undefined),
          dispatchBeforeToolCall: vi.fn().mockResolvedValue(null),
        };

        const ctxWithHooks = { ...ctx, hookDispatcher: mockDispatcher as any };
        const executors = createRuntimeExecutors(ctxWithHooks);

        await executors.call_tool!(createToolInstruction(), createToolState());

        expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
          'op-123',
          'onToolCallError',
          expect.objectContaining({
            apiName: 'search_tweets',
            error: 'Connection refused',
            identifier: 'twitter',
          }),
          undefined,
        );
      });

      it('should derive callIndex from state.usage.tools.byTool', async () => {
        const mockDispatcher = {
          dispatch: vi.fn().mockResolvedValue(undefined),
          dispatchBeforeToolCall: vi.fn().mockResolvedValue(null),
        };

        const ctxWithHooks = { ...ctx, hookDispatcher: mockDispatcher as any };
        const executors = createRuntimeExecutors(ctxWithHooks);

        // First call: no prior usage → callIndex = 1
        const state1 = createToolState();
        await executors.call_tool!(createToolInstruction(), state1);

        expect(mockDispatcher.dispatchBeforeToolCall).toHaveBeenCalledWith(
          'op-123',
          expect.objectContaining({ callIndex: 1 }),
        );

        // Second call: state reflects 1 prior call → callIndex = 2
        const state2 = createToolState({
          usage: {
            ...createMockUsage(),
            tools: {
              ...createMockUsage().tools,
              byTool: [{ calls: 1, errors: 0, name: 'twitter/search_tweets', totalTimeMs: 100 }],
              totalCalls: 1,
            },
          },
        });
        await executors.call_tool!(createToolInstruction(), state2);

        expect(mockDispatcher.dispatchBeforeToolCall).toHaveBeenLastCalledWith(
          'op-123',
          expect.objectContaining({ callIndex: 2 }),
        );
      });

      it('should work without hookDispatcher (backward compat)', async () => {
        const executors = createRuntimeExecutors(ctx); // no hookDispatcher
        const result = await executors.call_tool!(createToolInstruction(), createToolState());

        expect(result).toBeDefined();
        expect(mockToolExecutionService.executeTool).toHaveBeenCalled();
      });
    });

    describe('compress_context hooks', () => {
      it('should dispatch beforeCompact and afterCompact hooks', async () => {
        const mockDispatcher = {
          dispatch: vi.fn().mockResolvedValue(undefined),
          dispatchBeforeToolCall: vi.fn().mockResolvedValue(null),
        };

        const ctxWithHooks = {
          ...ctx,
          hookDispatcher: mockDispatcher as any,
          topicId: 'topic-123',
        };
        const executors = createRuntimeExecutors(ctxWithHooks);

        const state = createToolState({ metadata: { agentId: 'agent-123', topicId: 'topic-123' } });

        const instruction = {
          payload: {
            currentTokenCount: 5000,
            messages: [
              { content: 'hello', id: 'msg-1', role: 'user' },
              { content: 'hi there', id: 'msg-2', role: 'assistant' },
            ],
          },
          type: 'compress_context' as const,
        };

        await executors.compress_context!(instruction, state);

        expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
          'op-123',
          'beforeCompact',
          expect.objectContaining({ tokenCount: 5000 }),
          undefined,
        );
      });
    });

    describe('request_human_approve hooks', () => {
      it('should dispatch beforeHumanIntervention hook', async () => {
        const mockDispatcher = {
          dispatch: vi.fn().mockResolvedValue(undefined),
          dispatchBeforeToolCall: vi.fn().mockResolvedValue(null),
        };

        const ctxWithHooks = { ...ctx, hookDispatcher: mockDispatcher as any };
        const executors = createRuntimeExecutors(ctxWithHooks);

        const state = createToolState({
          messages: [{ content: '', id: 'asst-1', role: 'assistant' }],
          status: 'running',
        });

        const instruction = {
          pendingToolsCalling: [
            {
              apiName: 'post_tweet',
              arguments: '{}',
              id: 'tc-1',
              identifier: 'twitter',
              type: 'default' as const,
            },
          ],
          type: 'request_human_approve' as const,
        };

        await executors.request_human_approve!(instruction, state);

        expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
          'op-123',
          'beforeHumanIntervention',
          expect.objectContaining({
            pendingTools: [{ apiName: 'post_tweet', identifier: 'twitter' }],
          }),
          undefined, // serializedHooks from state.metadata._hooks
        );
      });
    });
  });
});
