import { afterEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import type { ChatStore } from '@/store/chat/store';

import { ClientCompressionTransport } from './ClientCompressionTransport';

const createStore = () => {
  let operationIndex = 0;
  const operations: Record<string, any> = {
    'root-operation': {
      abortController: new AbortController(),
      context: {
        agentId: 'agent-1',
        groupId: 'group-1',
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
      metadata: { startTime: Date.now() },
      status: 'running',
      type: 'execAgentRuntime',
    },
  };
  const store = {
    cancelOperation: vi.fn((operationId: string) => {
      operations[operationId].abortController.abort();
      operations[operationId].status = 'cancelled';
    }),
    completeOperation: vi.fn((operationId: string) => {
      operations[operationId].status = 'completed';
    }),
    dbMessagesMap: {
      'message-key': [
        { content: 'Question', id: 'user-message', role: 'user' },
        { content: 'Answer', id: 'assistant-message', role: 'assistant' },
      ],
    },
    failOperation: vi.fn((operationId: string) => {
      operations[operationId].status = 'failed';
    }),
    internal_dispatchMessage: vi.fn(),
    operations,
    replaceMessages: vi.fn(),
    startOperation: vi.fn((params: any) => {
      const operationId = `child-operation-${++operationIndex}`;
      const abortController = new AbortController();
      operations[operationId] = {
        abortController,
        context: params.context,
        metadata: { startTime: Date.now(), ...params.metadata },
        parentOperationId: params.parentOperationId,
        status: 'running',
        type: params.type,
      };
      return { abortController, operationId };
    }),
  } as unknown as ChatStore;

  return { operations, store };
};

const createGroupInput = {
  agentId: 'agent-1',
  groupId: 'group-1',
  messageIds: ['user-message', 'assistant-message'],
  threadId: 'thread-1',
  topicId: 'topic-1',
};
const operationContext = {
  agentId: 'agent-1',
  groupId: 'group-1',
  threadId: 'thread-1',
  topicId: 'topic-1',
};

describe('ClientCompressionTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the visible group, streams updates, and finalizes both operations', async () => {
    const { store } = createStore();
    const initialMessages = [{ content: '', id: 'compressed-group', role: 'compressedGroup' }];
    const finalMessages = [{ content: 'Summary', id: 'compressed-group', role: 'compressedGroup' }];
    vi.spyOn(messageService, 'createCompressionGroup').mockResolvedValue({
      messageGroupId: 'compressed-group',
      messages: initialMessages as any,
      messagesToSummarize: [{ content: 'Question', id: 'user-message', role: 'user' }] as any,
    });
    vi.spyOn(messageService, 'finalizeCompression').mockResolvedValue({
      messages: finalMessages as any,
    });
    const transport = new ClientCompressionTransport(() => store, 'message-key', 'root-operation');

    const created = await transport.createGroup(createGroupInput);
    transport.updateGroup({ content: 'Part', messageGroupId: created.messageGroupId });
    const finalized = await transport.finalizeGroup({
      ...createGroupInput,
      content: 'Summary',
      messageGroupId: created.messageGroupId,
      sourceGroupIds: ['previous-compressed-group'],
    });

    expect(messageService.createCompressionGroup).toHaveBeenCalledWith(createGroupInput);
    expect(store.startOperation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        context: expect.objectContaining({ messageId: 'assistant-message' }),
        parentOperationId: 'root-operation',
        type: 'contextCompression',
      }),
    );
    expect(store.startOperation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        context: expect.objectContaining({ messageId: 'compressed-group' }),
        parentOperationId: 'child-operation-1',
        type: 'generateSummary',
      }),
    );
    expect(store.replaceMessages).toHaveBeenNthCalledWith(1, initialMessages, {
      context: expect.objectContaining(operationContext),
    });
    expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
      {
        id: 'compressed-group',
        type: 'updateMessage',
        value: { content: 'Part' },
      },
      { operationId: 'child-operation-2' },
    );
    expect(store.replaceMessages).toHaveBeenNthCalledWith(2, finalMessages, {
      context: expect.objectContaining(operationContext),
    });
    expect(messageService.finalizeCompression).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: 'Summary',
      groupId: 'group-1',
      messageGroupId: 'compressed-group',
      sourceGroupIds: ['previous-compressed-group'],
      threadId: 'thread-1',
      topicId: 'topic-1',
    });
    expect(store.completeOperation).toHaveBeenNthCalledWith(1, 'child-operation-2');
    expect(store.completeOperation).toHaveBeenNthCalledWith(2, 'child-operation-1', {
      groupId: 'compressed-group',
      parentMessageId: 'assistant-message',
    });
    expect(created.signal).toBeInstanceOf(AbortSignal);
    expect(finalized.messages).toEqual(finalMessages);
  });

  it('restores messages and fails child operations when summary generation fails', async () => {
    const { operations, store } = createStore();
    const restoredMessages = [
      { content: 'Question', id: 'user-message', role: 'user' },
      { content: 'Answer', id: 'assistant-message', role: 'assistant' },
    ];
    vi.spyOn(messageService, 'createCompressionGroup').mockResolvedValue({
      messageGroupId: 'compressed-group',
      messages: [] as any,
      messagesToSummarize: restoredMessages as any,
    });
    vi.spyOn(messageService, 'cancelCompression').mockResolvedValue({
      messages: restoredMessages as any,
    });
    const transport = new ClientCompressionTransport(() => store, 'message-key', 'root-operation');

    await transport.createGroup(createGroupInput);
    await transport.rollbackGroup({
      ...createGroupInput,
      error: new Error('summary failed'),
      messageGroupId: 'compressed-group',
    });

    expect(messageService.cancelCompression).toHaveBeenCalledWith({
      agentId: 'agent-1',
      groupId: 'group-1',
      messageGroupId: 'compressed-group',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });
    expect(store.replaceMessages).toHaveBeenLastCalledWith(restoredMessages, {
      context: expect.objectContaining(operationContext),
    });
    expect(store.failOperation).toHaveBeenCalledWith('child-operation-2', {
      message: 'summary failed',
      type: 'summary_generation_failed',
    });
    expect(store.failOperation).toHaveBeenCalledWith('child-operation-1', {
      message: 'summary failed',
      type: 'compression_failed',
    });
    expect(operations['child-operation-1'].status).toBe('failed');
  });

  it('keeps cancellation status while restoring the original messages', async () => {
    const { store } = createStore();
    vi.spyOn(messageService, 'createCompressionGroup').mockResolvedValue({
      messageGroupId: 'compressed-group',
      messages: [] as any,
      messagesToSummarize: [] as any,
    });
    vi.spyOn(messageService, 'cancelCompression').mockResolvedValue({ messages: [] });
    const transport = new ClientCompressionTransport(() => store, 'message-key', 'root-operation');
    const created = await transport.createGroup(createGroupInput);
    store.cancelOperation('child-operation-2', 'User cancelled');
    const abortError = new Error('Context compression cancelled');
    abortError.name = 'AbortError';

    await transport.rollbackGroup({
      ...createGroupInput,
      error: abortError,
      messageGroupId: created.messageGroupId,
    });

    expect(store.cancelOperation).toHaveBeenCalledWith(
      'child-operation-1',
      'Context compression cancelled',
    );
    expect(store.failOperation).not.toHaveBeenCalled();
  });

  it('includes the existing summary in the compression prompt', async () => {
    const { store } = createStore();
    const transport = new ClientCompressionTransport(() => store, 'message-key', 'root-operation');

    const result = await transport.buildPrompt({
      existingSummary: 'Earlier decisions',
      messages: [{ content: 'New question', id: 'user-message', role: 'user' }] as any,
    });

    expect(result.messages[1].content).toContain('Existing conversation summary:');
    expect(result.messages[1].content).toContain('Earlier decisions');
    expect(result.messages[1].content).toContain('New conversation history:');
  });
});
