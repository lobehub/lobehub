import { type AgentState } from '@lobechat/agent-runtime';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as ContextEngineering from '@/server/modules/Mecha/ContextEngineering';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { createRuntimeExecutors, type RuntimeExecutorContext } from '../RuntimeExecutors';

// Mock dependencies
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn().mockResolvedValue({
    chat: vi.fn().mockResolvedValue(new Response('done')),
  }),
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

    mockMessageModel = {
      create: vi.fn().mockResolvedValue({ id: 'msg-123' }),
      update: vi.fn().mockResolvedValue({}),
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
        const state = createMockState();

        const tools = [{ description: 'Search the web', name: 'search' }];
        const instruction = {
          payload: {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
            tools,
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
        const stateTools = [{ description: 'State tool', name: 'state-tool' }];
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
          tools: [{ description: 'State tool', name: 'state-tool' }] as any,
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

      it('should pass correct params from agentConfig to serverMessagesEngine', async () => {
        const ctxWithConfig: RuntimeExecutorContext = {
          ...ctx,
          agentConfig: {
            chatConfig: { enableHistoryCount: true, historyCount: 10 },
            files: [{ content: 'file contents', enabled: true, id: 'file-1', name: 'doc.pdf' }],
            knowledgeBases: [{ enabled: true, id: 'kb-1', name: 'My KB' }],
            plugins: ['web-search', 'calculator'],
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

        expect(engineSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            enableHistoryCount: true,
            historyCount: 10,
            knowledge: {
              fileContents: [{ content: 'file contents', fileId: 'file-1', filename: 'doc.pdf' }],
              knowledgeBases: [{ id: 'kb-1', name: 'My KB' }],
            },
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'gpt-4',
            provider: 'openai',
            systemRole: 'You are a helpful assistant',
            toolsConfig: { tools: ['web-search', 'calculator'] },
          }),
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

    it('should return undefined parentMessageId if messageModel.create fails', async () => {
      // Setup: mock messageModel.create to throw an error
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

      const result = await executors.call_tool!(instruction, state);

      // parentMessageId should be undefined when message creation fails
      const payload = result.nextContext!.payload as { parentMessageId?: string };
      expect(payload.parentMessageId).toBeUndefined();
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
      expect(mockMessageModel.query).toHaveBeenCalledWith({
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: 'topic-123',
      });

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

    it('should fallback to original parentMessageId if no tool messages created', async () => {
      // All tool message creations fail
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

      const result = await executors.call_tools_batch!(instruction, state);

      // Should fallback to original parentMessageId
      const payload = result.nextContext!.payload as { parentMessageId?: string };
      expect(payload.parentMessageId).toBe('original-parent-123');
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

    it('should continue if tool message creation fails for one tool', async () => {
      // First message creation succeeds, second fails
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

      const result = await executors.call_tools_batch!(instruction, state);

      // Both tools should be executed
      expect(mockToolExecutionService.executeTool).toHaveBeenCalledTimes(2);

      // Should still return result
      expect(result.nextContext).toBeDefined();

      // parentMessageId should be the first successful tool message
      const payload = result.nextContext!.payload as { parentMessageId?: string };
      expect(payload.parentMessageId).toBe('tool-msg-1');
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
      expect(mockMessageModel.query).toHaveBeenCalledWith({
        agentId: 'agent-abc',
        threadId: 'thread-xyz',
        topicId: 'topic-abc-123',
      });
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
      expect(mockMessageModel.query).toHaveBeenCalledWith({
        agentId: 'agent-123',
        threadId: 'thread-123',
        topicId: undefined,
      });

      // Expected: newState.messages should NOT be empty
      // The next call_llm step needs messages to work properly
      expect(result.newState.messages.length).toBeGreaterThan(0);
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

    it('should continue processing remaining tools if one fails to create', async () => {
      // Mock: first call succeeds, second call fails
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

      const result = await executors.resolve_aborted_tools!(instruction, state);

      // Should still complete and emit done event
      expect(result.newState.status).toBe('done');
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: 'done',
        }),
      );

      // Only the first tool message should be added to state
      expect(result.newState.messages).toHaveLength(1);
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

    it('should throw when LLM stream contains error events from provider', async () => {
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

      await expect(executors.call_llm!(instruction, state)).rejects.toThrow(/LLM stream error/);

      // Error event should be published to stream manager
      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith(
        'op-123',
        expect.objectContaining({
          type: 'error',
        }),
      );
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
            phase: 'llm_execution',
          }),
        }),
      );
    });
  });
});
