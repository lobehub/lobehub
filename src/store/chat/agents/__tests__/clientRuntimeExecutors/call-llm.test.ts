import { AgentRuntime, type AgentState } from '@lobechat/agent-runtime';
import type { UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { chatService } from '@/services/chat';
import type { ResolvedAgentConfig } from '@/services/chat/mecha';
import { messageService } from '@/services/message';
import { createClientRuntimeExecutors } from '@/store/chat/agents/transports/createClientRuntimeExecutors';
import type { ChatStore } from '@/store/chat/store';

const messageKey = 'agent-1_topic-1';
const operationId = 'operation-1';

const createResolvedAgentConfig = (): ResolvedAgentConfig => ({
  agentConfig: {
    ...DEFAULT_AGENT_CONFIG,
    model: 'test-model',
    provider: 'test-provider',
  },
  chatConfig: { ...DEFAULT_AGENT_CHAT_CONFIG },
  enabledManifests: [],
  enabledToolIds: [],
  isBuiltinAgent: false,
  plugins: [],
  tools: [],
});

const createState = (messages: UIChatMessage[]): AgentState =>
  AgentRuntime.createInitialState({
    messages,
    metadata: { agentId: 'agent-1', topicId: 'topic-1' },
    modelRuntimeConfig: { model: 'test-model', provider: 'test-provider' },
    operationId,
    operationToolSet: {
      enabledToolIds: [],
      manifestMap: {},
      sourceMap: {},
      tools: [],
    },
  });

const createStore = (messages: UIChatMessage[]) => {
  const dbMessagesMap = { [messageKey]: messages };
  const operations = {
    [operationId]: {
      abortController: new AbortController(),
      context: {
        agentId: 'agent-1',
        messageId: messages.at(-1)?.id,
        topicId: 'topic-1',
      },
      id: operationId,
      metadata: { startTime: Date.now() },
      status: 'running',
      type: 'execAgentRuntime',
    },
  };

  const store = {
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    dbMessagesMap,
    internal_dispatchMessage: vi.fn((action: any) => {
      if (action.type === 'createMessage') {
        dbMessagesMap[messageKey].push(action.value);
        return;
      }

      if (action.type === 'updateMessage') {
        const message = dbMessagesMap[messageKey].find((item) => item.id === action.id);
        if (message) Object.assign(message, action.value);
      }
    }),
    internal_toggleToolCallingStreaming: vi.fn(),
    internal_transformToolCalls: vi.fn(() => []),
    operations,
    optimisticUpdateMessageError: vi.fn(),
    startOperation: vi.fn(() => ({ operationId: 'reasoning-operation' })),
    updateOperationMetadata: vi.fn(),
  } as unknown as ChatStore;

  return { dbMessagesMap, store };
};

const createInstruction = (overrides: Record<string, unknown> = {}) => ({
  payload: {
    messages: [],
    model: 'test-model',
    parentMessageId: 'user-1',
    provider: 'test-provider',
    tools: [],
    ...overrides,
  },
  type: 'call_llm' as const,
});

describe('createClientRuntimeExecutors call_llm', () => {
  beforeEach(() => {
    vi.spyOn(chatService, 'buildAssistantMessageContext').mockImplementation(
      async ({ messages, model, provider }) => ({
        options: {},
        params: { messages: messages as any, model, provider },
      }),
    );
    vi.spyOn(messageService, 'batchMutate').mockImplementation(async (operations) => ({
      results: operations.map((operation, index) => ({
        id: operation.type === 'createMessage' ? operation.message.id : operation.id,
        index,
        success: true,
        type: operation.type,
      })),
      success: true,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the package executor through client adapters and batch-persisted messages', async () => {
    const userMessage = { content: 'Question', id: 'user-1', role: 'user' } as UIChatMessage;
    const { dbMessagesMap, store } = createStore([userMessage]);
    vi.spyOn(chatService, 'getChatCompletion').mockImplementation(async (_params, options) => {
      options?.onMessageHandle?.({ text: 'Answer', type: 'text' } as any);
      await options?.onFinish?.('Answer', {
        grounding: undefined,
        observationId: 'observation-1',
        traceId: 'trace-1',
        type: 'stop',
      });
      return new Response();
    });
    const executor = createClientRuntimeExecutors({
      agentConfig: createResolvedAgentConfig(),
      get: () => store,
      messageKey,
      operationId,
    }).call_llm!;

    const result = await executor(
      createInstruction({ messages: [userMessage] }),
      createState([userMessage]),
    );

    expect(result.nextContext?.phase).toBe('llm_result');
    expect(dbMessagesMap[messageKey]).toHaveLength(2);
    expect(dbMessagesMap[messageKey][1]).toMatchObject({
      content: 'Answer',
      observationId: 'observation-1',
      search: null,
      traceId: 'trace-1',
    });
    expect(messageService.batchMutate).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({
        message: expect.objectContaining({ content: '', role: 'assistant' }),
        type: 'createMessage',
      }),
    ]);
    expect(messageService.batchMutate).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({
        type: 'updateMessage',
        value: expect.objectContaining({ content: 'Answer', search: null }),
      }),
    ]);
  });

  it('accepts a parent message hidden inside a compressed group', async () => {
    const compressedAssistant = {
      content: 'Previous answer',
      id: 'assistant-compressed',
      role: 'assistant',
    } as UIChatMessage;
    const compressedGroup = {
      compressedMessages: [compressedAssistant],
      content: 'Conversation summary',
      id: 'compressed-group-1',
      role: 'compressedGroup',
    } as UIChatMessage;
    const { store } = createStore([compressedGroup]);
    vi.spyOn(chatService, 'getChatCompletion').mockImplementation(async (_params, options) => {
      options?.onMessageHandle?.({ text: 'Answer after compression', type: 'text' } as any);
      await options?.onFinish?.('Answer after compression', { type: 'stop' });
      return new Response();
    });
    const executor = createClientRuntimeExecutors({
      agentConfig: createResolvedAgentConfig(),
      get: () => store,
      messageKey,
      operationId,
    }).call_llm!;

    const result = await executor(
      createInstruction({
        messages: [compressedGroup],
        parentMessageId: compressedAssistant.id,
      }),
      createState([compressedGroup]),
    );

    expect(result.nextContext?.phase).toBe('llm_result');
    expect(messageService.batchMutate).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({
        message: expect.objectContaining({ parentId: compressedAssistant.id }),
        type: 'createMessage',
      }),
    ]);
  });

  it('treats image content parts as a non-empty completion', async () => {
    const userMessage = { content: 'Create an image', id: 'user-1', role: 'user' } as UIChatMessage;
    const { store } = createStore([userMessage]);
    const getChatCompletion = vi
      .spyOn(chatService, 'getChatCompletion')
      .mockImplementation(async (_params, options) => {
        await options?.onMessageHandle?.({
          content: 'base64data',
          mimeType: 'image/png',
          partType: 'image',
          type: 'content_part',
        } as any);
        await options?.onFinish?.('', { type: 'stop' });
        return new Response();
      });
    const executor = createClientRuntimeExecutors({
      agentConfig: createResolvedAgentConfig(),
      get: () => store,
      messageKey,
      operationId,
    }).call_llm!;

    const result = await executor(
      createInstruction({ messages: [userMessage] }),
      createState([userMessage]),
    );

    expect(result.nextContext?.phase).toBe('llm_result');
    expect(getChatCompletion).toHaveBeenCalledTimes(1);
    expect(messageService.batchMutate).toHaveBeenLastCalledWith([
      expect.objectContaining({
        type: 'updateMessage',
        value: expect.objectContaining({
          metadata: expect.objectContaining({ isMultimodal: true }),
        }),
      }),
    ]);
  });

  it('reuses a seeded assistant message without creating a duplicate', async () => {
    const userMessage = { content: 'Question', id: 'user-1', role: 'user' } as UIChatMessage;
    const assistantMessage = {
      content: '',
      id: 'assistant-1',
      parentId: userMessage.id,
      role: 'assistant',
    } as UIChatMessage;
    const { store } = createStore([userMessage, assistantMessage]);
    vi.spyOn(chatService, 'getChatCompletion').mockImplementation(async (_params, options) => {
      options?.onMessageHandle?.({ text: 'Regenerated', type: 'text' } as any);
      await options?.onFinish?.('Regenerated', { type: 'stop' });
      return new Response();
    });
    const executor = createClientRuntimeExecutors({
      agentConfig: createResolvedAgentConfig(),
      get: () => store,
      messageKey,
      operationId,
    }).call_llm!;

    await executor(
      createInstruction({
        assistantMessageId: assistantMessage.id,
        messages: [userMessage, assistantMessage],
        parentMessageId: userMessage.id,
      }),
      createState([userMessage]),
    );

    expect(messageService.batchMutate).toHaveBeenCalledTimes(1);
    expect(messageService.batchMutate).toHaveBeenCalledWith([
      expect.objectContaining({ id: assistantMessage.id, type: 'updateMessage' }),
    ]);
  });

  it('returns human_abort when the client stream is cancelled', async () => {
    const userMessage = { content: 'Question', id: 'user-1', role: 'user' } as UIChatMessage;
    const { store } = createStore([userMessage]);
    vi.spyOn(chatService, 'getChatCompletion').mockImplementation(async (_params, options) => {
      options?.onMessageHandle?.({ text: 'Partial', type: 'text' } as any);
      await options?.onFinish?.('Partial', { type: 'abort' });
      return new Response();
    });
    const executor = createClientRuntimeExecutors({
      agentConfig: createResolvedAgentConfig(),
      get: () => store,
      messageKey,
      operationId,
    }).call_llm!;

    const result = await executor(
      createInstruction({ messages: [userMessage] }),
      createState([userMessage]),
    );

    expect(result.nextContext?.phase).toBe('human_abort');
    expect(result.nextContext?.payload).toMatchObject({
      parentMessageId: expect.any(String),
      reason: 'user_cancelled',
    });
  });

  it('maps a thrown fetch abort to human_abort instead of an error state', async () => {
    const userMessage = { content: 'Question', id: 'user-1', role: 'user' } as UIChatMessage;
    const { store } = createStore([userMessage]);
    vi.spyOn(chatService, 'getChatCompletion').mockImplementation(async () => {
      const operation = store.operations[operationId];
      operation.status = 'cancelled';
      operation.abortController.abort();
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    const executor = createClientRuntimeExecutors({
      agentConfig: createResolvedAgentConfig(),
      get: () => store,
      messageKey,
      operationId,
    }).call_llm!;

    const result = await executor(
      createInstruction({ messages: [userMessage] }),
      createState([userMessage]),
    );

    expect(result.nextContext?.phase).toBe('human_abort');
    expect(result.newState.status).not.toBe('error');
  });
});
