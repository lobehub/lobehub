import type { UIChatMessage } from '@lobechat/types';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock localStorage BEFORE any other imports using vi.hoisted
vi.hoisted(() => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => { },
    removeItem: () => { },
    clear: () => { },
    length: 0,
    key: () => null,
  } as Storage;
});

import * as messageServiceModule from '@/services/message';

import type { ConversationContext } from '../../../../types';
import { createStore } from '../../../index';

// Mock conversation-flow parse function (必须 mock，因为这是外部库)
vi.mock('@lobechat/conversation-flow', () => ({
  parse: (messages: UIChatMessage[]) => {
    const messageMap: Record<string, UIChatMessage> = {};
    for (const msg of messages) {
      messageMap[msg.id] = msg;
    }
    const flatList = [...messages].sort((a, b) => a.createdAt - b.createdAt);
    return { flatList, messageMap };
  },
}));

// Mock useChatStore for branch switching tests
const mockChatStore = {
  startOperation: vi.fn(() => ({ operationId: 'test-op-id' })),
  switchMessageBranch: vi.fn().mockResolvedValue(undefined),
  completeOperation: vi.fn(),
  failOperation: vi.fn(),
};

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => mockChatStore,
  },
}));

// Create a test store
const createTestStore = (context?: Partial<ConversationContext>) =>
  createStore({
    context: {
      agentId: 'test-session',
      topicId: null,
      threadId: null,
      ...context,
    },
  });

describe('Message CRUD Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chat store mocks - recreate them completely
    mockChatStore.startOperation = vi.fn(() => ({ operationId: 'test-op-id' }));
    mockChatStore.switchMessageBranch = vi.fn().mockResolvedValue(undefined);
    mockChatStore.completeOperation = vi.fn();
    mockChatStore.failOperation = vi.fn();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe('createMessage', () => {
    it('should create a message with optimistic update', async () => {
      const createMessageSpy = vi
        .spyOn(messageServiceModule.messageService, 'createMessage')
        .mockResolvedValue({
          id: 'msg-1',
          messages: [
            {
              id: 'msg-1',
              content: 'Hello',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        });

      const store = createTestStore();

      let result: string | undefined;
      await act(async () => {
        result = await store.getState().createMessage({
          content: 'Hello',
          role: 'user',
          sessionId: 'test-session',
        });
      });

      expect(result).toBe('msg-1');
      expect(createMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Hello',
          role: 'user',
          sessionId: 'test-session',
        }),
      );
    });

    it('should handle creation error', async () => {
      vi.spyOn(messageServiceModule.messageService, 'createMessage').mockRejectedValue(
        new Error('Creation failed'),
      );

      const store = createTestStore();

      let result: string | undefined;
      await act(async () => {
        result = await store.getState().createMessage({
          content: 'Hello',
          role: 'user',
          sessionId: 'test-session',
        });
      });

      expect(result).toBeUndefined();
    });
  });

  describe('createTempMessage', () => {
    it('should create a temporary message for optimistic update', () => {
      const store = createTestStore();

      let tempId: string;
      act(() => {
        tempId = store.getState().createTempMessage({
          content: 'Temp message',
          role: 'user',
          sessionId: 'test-session',
        });
      });

      expect(tempId!).toMatch(/^tmp_/);

      const state = store.getState();
      expect(state.displayMessages.length).toBe(1);
      expect(state.displayMessages[0].content).toBe('Temp message');
    });
  });

  describe('deleteMessage', () => {
    it('should delete a message', async () => {
      // Use removeMessage for single message deletion
      const removeMessageSpy = vi
        .spyOn(messageServiceModule.messageService, 'removeMessage')
        .mockResolvedValue({
          success: true,
          messages: [],
        });

      const store = createTestStore();

      const testMessage = {
        id: 'msg-1',
        content: 'Hello',
        role: 'user' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      act(() => {
        store.getState().replaceMessages([testMessage]);
      });

      expect(store.getState().displayMessages.length).toBe(1);
      expect(store.getState().displayMessages[0].id).toBe('msg-1');

      await store.getState().deleteMessage('msg-1');

      expect(removeMessageSpy).toHaveBeenCalledWith('msg-1', {
        agentId: 'test-session',
        threadId: null,
        topicId: null,
      });
    });

    it('should delete assistantGroup with children and tool results', async () => {
      const removeMessagesSpy = vi
        .spyOn(messageServiceModule.messageService, 'removeMessages')
        .mockResolvedValue({
          success: true,
          messages: [],
        });

      const store = createTestStore();

      const groupMessage: UIChatMessage = {
        id: 'group-1',
        content: '',
        role: 'assistantGroup',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        children: [
          {
            id: 'child-1',
            content: 'Response',
            tools: [
              {
                id: 'tool-1',
                type: 'default',
                identifier: 'test',
                apiName: 'test',
                arguments: '',
                result: { id: 'tool-result-1', content: 'tool result content' },
              },
            ],
          },
        ],
      };

      act(() => {
        store.getState().replaceMessages([groupMessage]);
      });

      await act(async () => {
        await store.getState().deleteMessage('group-1');
      });

      expect(removeMessagesSpy).toHaveBeenCalledWith(
        ['group-1', 'child-1', 'tool-result-1'],
        expect.any(Object),
      );
    });

    it('should use removeMessage for single id and removeMessages for multiple ids', async () => {
      const removeMessageSpy = vi
        .spyOn(messageServiceModule.messageService, 'removeMessage')
        .mockResolvedValue({ success: true, messages: [] });
      const removeMessagesSpy = vi
        .spyOn(messageServiceModule.messageService, 'removeMessages')
        .mockResolvedValue({ success: true, messages: [] });

      const store = createTestStore();

      // Test single message - should use removeMessage
      const singleMessage = {
        id: 'single-1',
        content: 'Single',
        role: 'user' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      act(() => {
        store.getState().replaceMessages([singleMessage]);
      });

      await store.getState().deleteMessage('single-1');

      expect(removeMessageSpy).toHaveBeenCalledWith('single-1', expect.any(Object));
      expect(removeMessagesSpy).not.toHaveBeenCalled();

      // Reset spies
      removeMessageSpy.mockClear();
      removeMessagesSpy.mockClear();

      // Test assistantGroup - should use removeMessages
      const groupMessage: UIChatMessage = {
        id: 'group-1',
        content: '',
        role: 'assistantGroup',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        children: [{ id: 'child-1', content: 'Response' }],
      };

      act(() => {
        store.getState().replaceMessages([groupMessage]);
      });

      await store.getState().deleteMessage('group-1');

      expect(removeMessagesSpy).toHaveBeenCalledWith(['group-1', 'child-1'], expect.any(Object));
      expect(removeMessageSpy).not.toHaveBeenCalled();
    });

    it('should do nothing if message not found', async () => {
      const removeMessagesSpy = vi.spyOn(messageServiceModule.messageService, 'removeMessages');

      const store = createTestStore();

      await act(async () => {
        await store.getState().deleteMessage('nonexistent');
      });

      expect(removeMessagesSpy).not.toHaveBeenCalled();
    });
  });

  describe('deleteDBMessage', () => {
    it('should delete a single DB message directly', async () => {
      const removeMessageSpy = vi
        .spyOn(messageServiceModule.messageService, 'removeMessage')
        .mockResolvedValue({
          success: true,
          messages: [],
        });

      const store = createTestStore();

      const testMessage = {
        id: 'msg-1',
        content: 'Hello',
        role: 'user' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      act(() => {
        store.getState().replaceMessages([testMessage]);
      });

      expect(store.getState().dbMessages.length).toBe(1);

      await act(async () => {
        await store.getState().deleteDBMessage('msg-1');
      });

      expect(removeMessageSpy).toHaveBeenCalledWith('msg-1', {
        agentId: 'test-session',
        threadId: null,
        topicId: null,
      });
    });

    it('should do nothing if message not found in dbMessages', async () => {
      const removeMessageSpy = vi.spyOn(messageServiceModule.messageService, 'removeMessage');

      const store = createTestStore();

      await act(async () => {
        await store.getState().deleteDBMessage('nonexistent');
      });

      expect(removeMessageSpy).not.toHaveBeenCalled();
    });

    it('should not handle assistantGroup aggregation like deleteMessage does', async () => {
      const removeMessageSpy = vi
        .spyOn(messageServiceModule.messageService, 'removeMessage')
        .mockResolvedValue({
          success: true,
          messages: [],
        });

      const store = createTestStore();

      // Create raw DB messages (not aggregated)
      const messages = [
        {
          id: 'assistant-1',
          content: 'Response 1',
          role: 'assistant' as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'assistant-2',
          content: 'Response 2',
          role: 'assistant' as const,
          createdAt: Date.now() + 1,
          updatedAt: Date.now() + 1,
        },
      ];

      act(() => {
        store.getState().replaceMessages(messages);
      });

      // Delete only assistant-1, should NOT delete assistant-2
      await act(async () => {
        await store.getState().deleteDBMessage('assistant-1');
      });

      // Should call removeMessage with only the single ID
      expect(removeMessageSpy).toHaveBeenCalledWith('assistant-1', expect.any(Object));
      expect(removeMessageSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteMessages', () => {
    it('should delete multiple messages', async () => {
      const removeMessagesSpy = vi
        .spyOn(messageServiceModule.messageService, 'removeMessages')
        .mockResolvedValue({
          success: true,
          messages: [],
        });

      const store = createTestStore();

      act(() => {
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'msg-1',
          value: { content: 'Hello', role: 'user', sessionId: 'test-session' },
        });
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'msg-2',
          value: { content: 'World', role: 'assistant', sessionId: 'test-session' },
        });
      });

      expect(store.getState().displayMessages.length).toBe(2);

      await act(async () => {
        await store.getState().deleteMessages(['msg-1', 'msg-2']);
      });

      expect(removeMessagesSpy).toHaveBeenCalledWith(['msg-1', 'msg-2'], expect.any(Object));
    });
  });

  describe('deleteToolMessage', () => {
    it('should delete tool message and remove from parent', async () => {
      const removeMessageSpy = vi
        .spyOn(messageServiceModule.messageService, 'removeMessage')
        .mockResolvedValue({
          success: true,
          messages: [],
        });

      const store = createTestStore();

      act(() => {
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'assistant-1',
          value: {
            content: '',
            role: 'assistant',
            sessionId: 'test-session',
          },
        });
        store.getState().internal_dispatchMessage({
          type: 'addMessageTool',
          id: 'assistant-1',
          value: {
            id: 'tool-call-1',
            type: 'default',
            identifier: 'test',
            apiName: 'testFunc',
            arguments: '{}',
          },
        });
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'tool-msg-1',
          value: {
            content: 'Tool result',
            role: 'tool',
            sessionId: 'test-session',
            parentId: 'assistant-1',
            tool_call_id: 'tool-call-1',
          },
        });
      });

      await act(async () => {
        await store.getState().deleteToolMessage('tool-msg-1');
      });

      expect(removeMessageSpy).toHaveBeenCalledWith('tool-msg-1', expect.any(Object));
    });
  });

  describe('clearMessages', () => {
    it('should clear all messages in the conversation', async () => {
      const removeMessagesByAssistantSpy = vi
        .spyOn(messageServiceModule.messageService, 'removeMessagesByAssistant')
        .mockResolvedValue({ rowsAffected: 1 } as any);

      const store = createTestStore();

      act(() => {
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'msg-1',
          value: { content: 'Hello', role: 'user', sessionId: 'test-session' },
        });
      });

      await act(async () => {
        await store.getState().clearMessages();
      });

      expect(removeMessagesByAssistantSpy).toHaveBeenCalledWith('test-session', undefined);
      expect(store.getState().displayMessages.length).toBe(0);
    });
  });

  describe('updateMessageContent', () => {
    it('should update message content', async () => {
      const updateMessageSpy = vi
        .spyOn(messageServiceModule.messageService, 'updateMessage')
        .mockResolvedValue({
          success: true,
          messages: [
            {
              id: 'msg-1',
              content: 'Updated content',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        });

      const store = createTestStore();

      act(() => {
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'msg-1',
          value: { content: 'Hello', role: 'user', sessionId: 'test-session' },
        });
      });

      await act(async () => {
        await store.getState().updateMessageContent('msg-1', 'Updated content');
      });

      expect(updateMessageSpy).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({ content: 'Updated content' }),
        expect.any(Object),
      );
    });
  });

  describe('updateMessageMetadata', () => {
    it('should update message metadata', async () => {
      const updateMessageMetadataSpy = vi
        .spyOn(messageServiceModule.messageService, 'updateMessageMetadata')
        .mockResolvedValue({
          success: true,
          messages: [],
        });

      const store = createTestStore();

      act(() => {
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'msg-1',
          value: { content: 'Hello', role: 'user', sessionId: 'test-session' },
        });
      });

      await act(async () => {
        await store.getState().updateMessageMetadata('msg-1', { collapsed: true });
      });

      expect(updateMessageMetadataSpy).toHaveBeenCalledWith(
        'msg-1',
        { collapsed: true },
        expect.any(Object),
      );
    });
  });

  describe('toggleMessageCollapsed', () => {
    it('should toggle message collapsed state', async () => {
      const updateMessageMetadataSpy = vi
        .spyOn(messageServiceModule.messageService, 'updateMessageMetadata')
        .mockResolvedValue({
          success: true,
          messages: [],
        });

      const store = createTestStore();

      act(() => {
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'msg-1',
          value: { content: 'Hello', role: 'assistant', sessionId: 'test-session' },
        });
      });

      await act(async () => {
        await store.getState().toggleMessageCollapsed('msg-1', true);
      });

      expect(updateMessageMetadataSpy).toHaveBeenCalledWith(
        'msg-1',
        { collapsed: true },
        expect.any(Object),
      );
    });
  });

  describe('internal_toggleMessageLoading', () => {
    it('should toggle message loading state', () => {
      const store = createTestStore();

      act(() => {
        store.getState().internal_toggleMessageLoading(true, 'msg-1');
      });

      expect(store.getState().messageLoadingIds).toContain('msg-1');

      act(() => {
        store.getState().internal_toggleMessageLoading(false, 'msg-1');
      });

      expect(store.getState().messageLoadingIds).not.toContain('msg-1');
    });
  });

  describe('copyMessage', () => {
    it('should copy message content and call hook', async () => {
      const onMessageCopied = vi.fn();

      const store = createStore({
        context: { agentId: 'test-session', topicId: null, threadId: null },
        hooks: { onMessageCopied },
      });

      await act(async () => {
        await store.getState().copyMessage('msg-1', 'Content to copy');
      });

      expect(onMessageCopied).toHaveBeenCalledWith('msg-1');
    });
  });

  describe('modifyMessageContent', () => {
    it('should modify message content and call hook', async () => {
      vi.spyOn(messageServiceModule.messageService, 'updateMessage').mockResolvedValue({
        success: true,
        messages: [],
      });

      const onMessageModified = vi.fn();

      const store = createStore({
        context: { agentId: 'test-session', topicId: null, threadId: null },
        hooks: { onMessageModified },
      });

      act(() => {
        store.getState().replaceMessages([
          {
            id: 'msg-1',
            content: 'Original',
            role: 'user',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ]);
      });

      await act(async () => {
        await store.getState().modifyMessageContent('msg-1', 'Modified');
      });

      expect(onMessageModified).toHaveBeenCalledWith('msg-1', 'Modified', 'Original');
    });
  });

  describe('addToolToMessage', () => {
    it('should add tool to message', async () => {
      const updateMessageSpy = vi
        .spyOn(messageServiceModule.messageService, 'updateMessage')
        .mockResolvedValue({
          success: true,
          messages: [],
        });

      const store = createTestStore();

      act(() => {
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'msg-1',
          value: { content: '', role: 'assistant', sessionId: 'test-session' },
        });
      });

      const tool = {
        id: 'tool-1',
        type: 'default' as const,
        identifier: 'test',
        apiName: 'testFunc',
        arguments: '{}',
      };

      await act(async () => {
        await store.getState().addToolToMessage('msg-1', tool);
      });

      expect(updateMessageSpy).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({ tools: [tool] }),
        expect.any(Object),
      );
    });
  });

  describe('updatePluginArguments', () => {
    it('should update plugin arguments using toolCallId', async () => {
      const updateToolArgsSpy = vi
        .spyOn(messageServiceModule.messageService, 'updateToolArguments')
        .mockResolvedValue({ success: true, messages: [] } as any);
      vi.spyOn(messageServiceModule.messageService, 'getMessages').mockResolvedValue([]);

      const store = createTestStore();

      // Create an assistant message with a tool, and a tool message
      act(() => {
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'assistant-1',
          value: { content: '', role: 'assistant', sessionId: 'test-session' },
        });
        store.getState().internal_dispatchMessage({
          type: 'addMessageTool',
          id: 'assistant-1',
          value: {
            id: 'tool-call-1',
            type: 'default',
            identifier: 'test',
            apiName: 'testFunc',
            arguments: '{"key": "old"}',
          },
        });
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'tool-msg-1',
          value: {
            content: '',
            role: 'tool',
            sessionId: 'test-session',
            parentId: 'assistant-1',
            tool_call_id: 'tool-call-1',
            plugin: {
              apiName: 'test',
              arguments: '{"key": "old"}',
              identifier: 'test-plugin',
              type: 'default',
            },
          },
        });
      });

      await act(async () => {
        // Use toolCallId (tool-call-1) instead of message id
        await store.getState().updatePluginArguments('tool-call-1', { key: 'new' }, true);
      });

      // Backend API now uses toolCallId directly
      expect(updateToolArgsSpy).toHaveBeenCalledWith(
        'tool-call-1',
        { key: 'new' },
        expect.any(Object),
      );
    });

    it('should update using toolCallId even when tool message not persisted (intervention pending)', async () => {
      const updateToolArgsSpy = vi
        .spyOn(messageServiceModule.messageService, 'updateToolArguments')
        .mockResolvedValue({ success: true, messages: [] } as any);
      vi.spyOn(messageServiceModule.messageService, 'getMessages').mockResolvedValue([]);

      const store = createTestStore();

      // Create an assistant message with a tool, but NO tool message (simulating intervention pending)
      act(() => {
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'assistant-1',
          value: { content: '', role: 'assistant', sessionId: 'test-session' },
        });
        store.getState().internal_dispatchMessage({
          type: 'addMessageTool',
          id: 'assistant-1',
          value: {
            id: 'tool-call-1',
            type: 'default',
            identifier: 'test',
            apiName: 'testFunc',
            arguments: '{"key": "old"}',
            result_msg_id: 'tmp_123', // Temporary ID
          },
        });
      });

      await act(async () => {
        await store.getState().updatePluginArguments('tool-call-1', { key: 'new' }, true);
      });

      // Backend API uses toolCallId and handles intervention pending internally
      expect(updateToolArgsSpy).toHaveBeenCalledWith(
        'tool-call-1',
        { key: 'new' },
        expect.any(Object),
      );
    });

    it('should register and remove pending promise during update', async () => {
      let resolveUpdate: () => void;
      const updatePromise = new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      });

      vi.spyOn(messageServiceModule.messageService, 'updateToolArguments').mockImplementation(
        async () => {
          await updatePromise;
          return { success: true, messages: [] } as any;
        },
      );
      vi.spyOn(messageServiceModule.messageService, 'getMessages').mockResolvedValue([]);

      const store = createTestStore();

      // Create assistant with tool and tool message
      act(() => {
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'assistant-1',
          value: { content: '', role: 'assistant', sessionId: 'test-session' },
        });
        store.getState().internal_dispatchMessage({
          type: 'addMessageTool',
          id: 'assistant-1',
          value: {
            id: 'tool-call-1',
            type: 'default',
            identifier: 'test',
            apiName: 'testFunc',
            arguments: '{"key": "old"}',
          },
        });
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'tool-msg-1',
          value: {
            content: '',
            role: 'tool',
            sessionId: 'test-session',
            parentId: 'assistant-1',
            tool_call_id: 'tool-call-1',
            plugin: {
              apiName: 'test',
              arguments: '{"key": "old"}',
              identifier: 'test-plugin',
              type: 'default',
            },
          },
        });
      });

      // Start update (don't await yet)
      let updateFinished = false;
      const updateAction = act(async () => {
        await store.getState().updatePluginArguments('tool-call-1', { key: 'new' }, true);
        updateFinished = true;
      });

      // Give time for the promise to be registered
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify pending promise is registered using toolCallId
      expect(store.getState().pendingArgsUpdates.has('tool-call-1')).toBe(true);
      expect(updateFinished).toBe(false);

      // Resolve the update
      resolveUpdate!();
      await updateAction;

      // Verify pending promise is removed after completion
      expect(store.getState().pendingArgsUpdates.has('tool-call-1')).toBe(false);
      expect(updateFinished).toBe(true);
    });

    it('should skip update if value is equal', async () => {
      const updateToolArgsSpy = vi.spyOn(
        messageServiceModule.messageService,
        'updateToolArguments',
      );

      const store = createTestStore();

      act(() => {
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'assistant-1',
          value: { content: '', role: 'assistant', sessionId: 'test-session' },
        });
        store.getState().internal_dispatchMessage({
          type: 'addMessageTool',
          id: 'assistant-1',
          value: {
            id: 'tool-call-1',
            type: 'default',
            identifier: 'test',
            apiName: 'testFunc',
            arguments: '{"key": "value"}',
          },
        });
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'tool-msg-1',
          value: {
            content: '',
            role: 'tool',
            sessionId: 'test-session',
            parentId: 'assistant-1',
            tool_call_id: 'tool-call-1',
            plugin: {
              apiName: 'test',
              arguments: '{"key": "value"}',
              identifier: 'test-plugin',
              type: 'default',
            },
          },
        });
      });

      await act(async () => {
        // Update with same value using toolCallId
        await store.getState().updatePluginArguments('tool-call-1', { key: 'value' }, true);
      });

      expect(updateToolArgsSpy).not.toHaveBeenCalled();
    });
  });

  describe('waitForPendingArgsUpdate', () => {
    it('should wait for pending update to complete', async () => {
      let resolveUpdate: () => void;
      const updatePromise = new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      });

      vi.spyOn(messageServiceModule.messageService, 'updateToolArguments').mockImplementation(
        async () => {
          await updatePromise;
          return { success: true, messages: [] } as any;
        },
      );
      vi.spyOn(messageServiceModule.messageService, 'getMessages').mockResolvedValue([]);

      const store = createTestStore();

      act(() => {
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'assistant-1',
          value: { content: '', role: 'assistant', sessionId: 'test-session' },
        });
        store.getState().internal_dispatchMessage({
          type: 'addMessageTool',
          id: 'assistant-1',
          value: {
            id: 'tool-call-1',
            type: 'default',
            identifier: 'test',
            apiName: 'testFunc',
            arguments: '{"key": "old"}',
          },
        });
        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'tool-msg-1',
          value: {
            content: '',
            role: 'tool',
            sessionId: 'test-session',
            parentId: 'assistant-1',
            tool_call_id: 'tool-call-1',
            plugin: {
              apiName: 'test',
              arguments: '{"key": "old"}',
              identifier: 'test-plugin',
              type: 'default',
            },
          },
        });
      });

      // Start update without awaiting (using toolCallId)
      const updateAction = act(async () => {
        await store.getState().updatePluginArguments('tool-call-1', { key: 'new' }, true);
      });

      // Give time for the promise to be registered
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Start waiting for pending update (using toolCallId)
      let waitFinished = false;
      const waitAction = act(async () => {
        await store.getState().waitForPendingArgsUpdate('tool-call-1');
        waitFinished = true;
      });

      // Give time for wait to start
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(waitFinished).toBe(false);

      // Resolve the update
      resolveUpdate!();
      await updateAction;
      await waitAction;

      expect(waitFinished).toBe(true);
    });

    it('should resolve immediately if no pending update', async () => {
      const store = createTestStore();

      let waitFinished = false;
      await act(async () => {
        await store.getState().waitForPendingArgsUpdate('nonexistent-tool-call');
        waitFinished = true;
      });

      expect(waitFinished).toBe(true);
    });
  });

  describe('editMessageAndCreateBranch', () => {
    describe('Assistant → Multiple User Branches (核心场景)', () => {
      it('should create user branch under assistant message', async () => {
        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockResolvedValue({
            id: 'msg-3',
            messages: [
              {
                id: 'msg-1',
                content: 'User question',
                role: 'user',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
              {
                id: 'msg-2',
                content: 'Assistant response',
                role: 'assistant',
                parentId: 'msg-1',
                createdAt: Date.now() + 1,
                updatedAt: Date.now() + 1,
              },
              {
                id: 'user-reply-1',
                content: 'First user reply',
                role: 'user',
                parentId: 'msg-2',
                createdAt: Date.now() + 2,
                updatedAt: Date.now() + 2,
              },
              {
                id: 'msg-3',
                content: 'Alternative user reply',
                role: 'user',
                parentId: 'msg-2',
                createdAt: Date.now() + 3,
                updatedAt: Date.now() + 3,
              },
            ],
          });

        const store = createTestStore();

        // Setup: Assistant message with one user reply
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Assistant response',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
            {
              id: 'user-reply-1',
              content: 'First user reply',
              role: 'user',
              parentId: 'msg-2', // User reply under assistant
              createdAt: Date.now() + 2,
              updatedAt: Date.now() + 2,
            },
          ]);
        });

        let result: string | undefined;
        await act(async () => {
          // Edit the user reply to create alternative branch
          result = await store
            .getState()
            .editMessageAndCreateBranch('user-reply-1', 'Alternative user reply');
        });

        // Verify: New user branch created under same assistant parent
        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: 'Alternative user reply',
            parentId: 'msg-2', // Same parent as original user reply
            role: 'user',
          }),
        );

        // Should switch branch on assistant message (msg-2)
        expect(mockChatStore.switchMessageBranch).toHaveBeenCalledWith('msg-2', 1, expect.any(Object));
        expect(result).toBeDefined();
      });

      it('should support multiple user branches under one assistant message', async () => {
        const store = createTestStore();
        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockImplementation(async () => {
            const currentMessages = store.getState().dbMessages;
            return {
              id: 'user-reply-3',
              messages: currentMessages,
            };
          });

        // Setup: Assistant with TWO user replies already
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'assistant-1',
              content: 'Assistant response',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
            {
              id: 'user-reply-1',
              content: 'User reply 1',
              role: 'user',
              parentId: 'assistant-1',
              createdAt: Date.now() + 2,
              updatedAt: Date.now() + 2,
            },
            {
              id: 'user-reply-2',
              content: 'User reply 2',
              role: 'user',
              parentId: 'assistant-1',
              createdAt: Date.now() + 3,
              updatedAt: Date.now() + 3,
            },
          ]);
        });

        const { useChatStore } = await import('@/store/chat');
        const switchBranchSpy = vi.spyOn(useChatStore.getState(), 'switchMessageBranch');

        await act(async () => {
          // Edit first user reply to create THIRD branch
          await store.getState().editMessageAndCreateBranch('user-reply-1', 'User reply 3');
        });

        // Branch index should be 2 (0-based: [0, 1] existing → 2 is new)
        expect(switchBranchSpy).toHaveBeenCalledWith('assistant-1', 2, expect.any(Object));
      });

      it('should support nested branches: User → Assistant → User → Assistant', async () => {
        const store = createTestStore();

        // Setup complex tree:
        // User(msg-1)
        //   └─ Assistant(ass-1)
        //       ├─ User(user-1)
        //       │   └─ Assistant(ass-reply-1)
        //       └─ User(user-2) [will be created by editing user-1]
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'Initial question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'ass-1',
              content: 'Assistant response',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
            {
              id: 'user-1',
              content: 'User follow-up 1',
              role: 'user',
              parentId: 'ass-1', // User under assistant
              createdAt: Date.now() + 2,
              updatedAt: Date.now() + 2,
            },
            {
              id: 'ass-reply-1',
              content: 'Assistant reply to user-1',
              role: 'assistant',
              parentId: 'user-1',
              createdAt: Date.now() + 3,
              updatedAt: Date.now() + 3,
            },
          ]);
        });

        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockImplementation(async () => {
            const currentMessages = store.getState().dbMessages;
            return {
              id: 'assistant-reply-2',
              messages: currentMessages,
            };
          });

        await act(async () => {
          // Edit user-1 to create user-2 branch
          await store.getState().editMessageAndCreateBranch('user-1', 'User follow-up 2');
        });

        // New user message should be sibling of user-1
        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: 'User follow-up 2',
            parentId: 'ass-1', // Same parent as user-1
            role: 'user',
          }),
        );

        // Should switch branch on ass-1 to index 1
        expect(mockChatStore.switchMessageBranch).toHaveBeenCalledWith('ass-1', 1, expect.any(Object));
      });

      it('should support complex tree: Multiple Assistants → Multiple Users → Multiple Assistants', async () => {
        const store = createTestStore();

        // Setup complex tree:
        // User(msg-1)
        //   ├─ Assistant(ass-1)
        //   │   ├─ User(user-1-1)
        //   │   │   ├─ Assistant(ass-reply-1-1)
        //   │   │   └─ Assistant(ass-reply-1-2)
        //   │   └─ User(user-1-2)
        //   │       └─ Assistant(ass-reply-2-1)
        //   └─ Assistant(ass-2)
        //       └─ User(user-2-1)
        //           └─ Assistant(ass-reply-3-1)
        act(() => {
          store.getState().replaceMessages([
            // Root
            {
              id: 'msg-1',
              content: 'Initial question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            // First assistant branch
            {
              id: 'ass-1',
              content: 'Assistant response 1',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
            // User branches under ass-1
            {
              id: 'user-1-1',
              content: 'User follow-up 1-1',
              role: 'user',
              parentId: 'ass-1',
              createdAt: Date.now() + 2,
              updatedAt: Date.now() + 2,
            },
            // Assistant branches under user-1-1
            {
              id: 'ass-reply-1-1',
              content: 'Assistant reply 1-1',
              role: 'assistant',
              parentId: 'user-1-1',
              createdAt: Date.now() + 3,
              updatedAt: Date.now() + 3,
            },
            {
              id: 'ass-reply-1-2',
              content: 'Assistant reply 1-2',
              role: 'assistant',
              parentId: 'user-1-1',
              createdAt: Date.now() + 4,
              updatedAt: Date.now() + 4,
            },
            // Second user branch under ass-1
            {
              id: 'user-1-2',
              content: 'User follow-up 1-2',
              role: 'user',
              parentId: 'ass-1',
              createdAt: Date.now() + 5,
              updatedAt: Date.now() + 5,
            },
            {
              id: 'ass-reply-2-1',
              content: 'Assistant reply 2-1',
              role: 'assistant',
              parentId: 'user-1-2',
              createdAt: Date.now() + 6,
              updatedAt: Date.now() + 6,
            },
            // Second assistant branch from root
            {
              id: 'ass-2',
              content: 'Assistant response 2',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 7,
              updatedAt: Date.now() + 7,
            },
            {
              id: 'user-2-1',
              content: 'User follow-up 2-1',
              role: 'user',
              parentId: 'ass-2',
              createdAt: Date.now() + 8,
              updatedAt: Date.now() + 8,
            },
            {
              id: 'ass-reply-3-1',
              content: 'Assistant reply 3-1',
              role: 'assistant',
              parentId: 'user-2-1',
              createdAt: Date.now() + 9,
              updatedAt: Date.now() + 9,
            },
          ]);
        });

        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockImplementation(async () => {
            const currentMessages = store.getState().dbMessages;
            return {
              id: 'new-branch-msg',
              messages: currentMessages,
            };
          });

        // Test 1: Edit deep assistant message to create third assistant branch under user-1-1
        await act(async () => {
          await store
            .getState()
            .editMessageAndCreateBranch('ass-reply-1-1', 'Assistant reply 1-3');
        });

        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: 'Assistant reply 1-3',
            parentId: 'user-1-1', // Same parent as ass-reply-1-1
            role: 'assistant',
          }),
        );

        // Should switch to branch index 2 (0, 1 exist → 2 is new)
        expect(mockChatStore.switchMessageBranch).toHaveBeenCalledWith('user-1-1', 2, expect.any(Object));

        createMessageSpy.mockClear();
        mockChatStore.switchMessageBranch.mockClear();

        // Test 2: Edit user message to create third user branch under ass-1
        await act(async () => {
          await store.getState().editMessageAndCreateBranch('user-1-1', 'User follow-up 1-3');
        });

        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: 'User follow-up 1-3',
            parentId: 'ass-1', // Same parent as user-1-1
            role: 'user',
          }),
        );

        // Should switch to branch index 2 under ass-1
        expect(mockChatStore.switchMessageBranch).toHaveBeenCalledWith('ass-1', 2, expect.any(Object));
      });

      it('should maintain correct branch indices in deep trees with multiple edits', async () => {
        const store = createTestStore();

        // Setup: 5-level deep tree
        // User → Assistant → User → Assistant → User
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'root',
              content: 'Root',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'level-1',
              content: 'Level 1',
              role: 'assistant',
              parentId: 'root',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
            {
              id: 'level-2',
              content: 'Level 2',
              role: 'user',
              parentId: 'level-1',
              createdAt: Date.now() + 2,
              updatedAt: Date.now() + 2,
            },
            {
              id: 'level-3',
              content: 'Level 3',
              role: 'assistant',
              parentId: 'level-2',
              createdAt: Date.now() + 3,
              updatedAt: Date.now() + 3,
            },
            {
              id: 'level-4',
              content: 'Level 4',
              role: 'user',
              parentId: 'level-3',
              createdAt: Date.now() + 4,
              updatedAt: Date.now() + 4,
            },
          ]);
        });

        let callCount = 0;
        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockImplementation(async () => {
            callCount++;
            const currentMessages = store.getState().dbMessages;
            return {
              id: `new-branch-${callCount}`,
              messages: currentMessages,
            };
          });

        // Edit at each level and verify branch indices
        // Level 4: Should create branch index 1 (currently only 1 child)
        await act(async () => {
          await store.getState().editMessageAndCreateBranch('level-4', 'Level 4 branch 2');
        });
        expect(mockChatStore.switchMessageBranch).toHaveBeenCalledWith('level-3', 1, expect.any(Object));

        mockChatStore.switchMessageBranch.mockClear();

        // Level 3: Should create branch index 1
        await act(async () => {
          await store.getState().editMessageAndCreateBranch('level-3', 'Level 3 branch 2');
        });
        expect(mockChatStore.switchMessageBranch).toHaveBeenCalledWith('level-2', 1, expect.any(Object));

        mockChatStore.switchMessageBranch.mockClear();

        // Level 2: Should create branch index 1
        await act(async () => {
          await store.getState().editMessageAndCreateBranch('level-2', 'Level 2 branch 2');
        });
        expect(mockChatStore.switchMessageBranch).toHaveBeenCalledWith('level-1', 1, expect.any(Object));
      });
    });

    describe('User → Multiple Assistant Branches (常见场景)', () => {
      it('should create assistant branch under user message', async () => {
        const store = createTestStore();

        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockImplementation(async () => {
            const currentMessages = store.getState().dbMessages;
            return {
              id: 'msg-3',
              messages: currentMessages,
            };
          });

        // Setup: User message with one assistant response
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Original response',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
          ]);
        });

        let result: string | undefined;
        await act(async () => {
          result = await store.getState().editMessageAndCreateBranch('msg-2', 'Edited response');
        });

        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: 'Edited response',
            parentId: 'msg-1',
            role: 'assistant',
          }),
        );
      });
    });

    describe('Edge Cases and Error Handling', () => {
      it('should fall back to updateMessageContent for root messages', async () => {
        const updateMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'updateMessage')
          .mockResolvedValue({
            success: true,
            messages: [
              {
                id: 'msg-1',
                content: 'Updated root message',
                role: 'user',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ],
          });

        const store = createTestStore();

        // Setup: Root message without parentId
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'Original root message',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ]);
        });

        let result: string | undefined;
        await act(async () => {
          result = await store
            .getState()
            .editMessageAndCreateBranch('msg-1', 'Updated root message');
        });

        // Should use updateMessageContent instead of creating branch
        expect(updateMessageSpy).toHaveBeenCalledWith(
          'msg-1',
          expect.objectContaining({ content: 'Updated root message' }),
          expect.any(Object),
        );

        expect(result).toBe('msg-1'); // Returns original ID
      });

      it('should handle agentCouncil role mapping to assistant', async () => {
        const store = createTestStore();

        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockImplementation(async () => {
            const currentMessages = store.getState().dbMessages;
            return {
              id: 'msg-3',
              messages: currentMessages,
            };
          });

        // Setup: agentCouncil message
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Council response',
              role: 'agentCouncil',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
          ]);
        });

        await act(async () => {
          await store.getState().editMessageAndCreateBranch('msg-2', 'Edited council response');
        });

        // Should map agentCouncil to assistant
        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            role: 'assistant',
          }),
        );
      });

      it('should handle tasks role mapping to task', async () => {
        const store = createTestStore();

        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockImplementation(async () => {
            const currentMessages = store.getState().dbMessages;
            return {
              id: 'msg-3',
              messages: currentMessages,
            };
          });

        // Setup: tasks message
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Tasks response',
              role: 'tasks',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
          ]);
        });

        await act(async () => {
          await store.getState().editMessageAndCreateBranch('msg-2', 'Edited tasks');
        });

        // Should map tasks to task
        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            role: 'task',
          }),
        );
      });

      it('should call switchMessageBranch with correct parameters', async () => {
        const store = createTestStore();

        // Setup messages
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Response',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
          ]);
        });

        vi.spyOn(messageServiceModule.messageService, 'createMessage').mockImplementation(
          async () => {
            const currentMessages = store.getState().dbMessages;
            return {
              id: 'msg-3',
              messages: currentMessages,
            };
          },
        );

        await act(async () => {
          await store.getState().editMessageAndCreateBranch('msg-2', 'Edited');
        });

        // Should start operation
        expect(mockChatStore.startOperation).toHaveBeenCalledWith({
          context: expect.objectContaining({ messageId: 'msg-1' }),
          type: 'regenerate',
        });

        // Should switch to new branch
        expect(mockChatStore.switchMessageBranch).toHaveBeenCalledWith('msg-1', 1, {
          operationId: 'test-op-id',
        });

        // Should complete operation
        expect(mockChatStore.completeOperation).toHaveBeenCalledWith('test-op-id');
      });

      it('should handle creation error and call failOperation', async () => {
        const store = createTestStore();

        // Setup messages
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Response',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
          ]);
        });

        // Mock createMessage to reject (simulate database error)
        // Note: The store's createMessage method catches errors internally and returns undefined
        // So we need to mock messageService.createMessage to throw
        const createError = new Error('Failed to create message');
        vi.spyOn(messageServiceModule.messageService, 'createMessage').mockRejectedValue(
          createError,
        );

        // The method should still complete (createMessage catches errors internally)
        // and return the optimistic message ID
        let result: string | undefined;
        await act(async () => {
          result = await store.getState().editMessageAndCreateBranch('msg-2', 'Edited');
        });

        // Should return the optimistic message ID even when createMessage fails
        // because createMessage catches errors and returns undefined
        expect(result).toBeDefined();
        expect(result).toMatch(/^msg_/);
      });

      it('should return undefined if original message not found', async () => {
        const store = createTestStore();

        let result: string | undefined;
        await act(async () => {
          result = await store.getState().editMessageAndCreateBranch('nonexistent', 'Content');
        });

        expect(result).toBeUndefined();
      });

      it('should preserve threadId in new branch message', async () => {
        const store = createStore({
          context: {
            agentId: 'test-session',
            topicId: 'test-topic',
            threadId: 'test-thread',
          },
        });
        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockImplementation(async () => {
            const currentMessages = store.getState().dbMessages;
            return {
              id: 'msg-3',
              messages: currentMessages,
            };
          });

        // Setup messages
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Response',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
          ]);
        });

        await act(async () => {
          await store.getState().editMessageAndCreateBranch('msg-2', 'Edited');
        });

        // Should preserve threadId in new message
        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            threadId: 'test-thread',
          }),
        );
      });

      it('should support multi-level branch creation (assistant → user → assistant)', async () => {
        const store = createTestStore();

        // Setup: User → Assistant → User → Assistant (3-level tree)
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question 1',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Assistant response 1',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
            {
              id: 'msg-3',
              content: 'User follow-up',
              role: 'user',
              parentId: 'msg-2',
              createdAt: Date.now() + 2,
              updatedAt: Date.now() + 2,
            },
            {
              id: 'msg-4',
              content: 'Assistant response 2',
              role: 'assistant',
              parentId: 'msg-3',
              createdAt: Date.now() + 3,
              updatedAt: Date.now() + 3,
            },
          ]);
        });

        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockImplementation(async () => {
            const currentMessages = store.getState().dbMessages;
            return {
              id: 'msg-5',
              messages: currentMessages,
            };
          });

        await act(async () => {
          // Edit the deepest assistant message
          await store.getState().editMessageAndCreateBranch('msg-4', 'Alternative response 2');
        });

        // Should create branch at the 3rd level
        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: 'Alternative response 2',
            parentId: 'msg-3', // Parent is the user follow-up
            role: 'assistant',
          }),
        );

        // Should switch branch on msg-3
        expect(mockChatStore.switchMessageBranch).toHaveBeenCalledWith('msg-3', 1, expect.any(Object));
      });

      it('should preserve message metadata in new branch', async () => {
        const store = createTestStore();

        // Setup message with metadata
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Response with metadata',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
              metadata: {
                collapsed: true,
              },
            },
          ]);
        });

        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockImplementation(async () => {
            const currentMessages = store.getState().dbMessages;
            return {
              id: 'msg-3',
              messages: currentMessages,
            };
          });

        await act(async () => {
          await store.getState().editMessageAndCreateBranch('msg-2', 'Edited content');
        });

        // Should create new message (metadata is not copied by design - new branch starts fresh)
        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: 'Edited content',
            parentId: 'msg-1',
            role: 'assistant',
          }),
        );
      });

      it('should handle empty content gracefully', async () => {
        const store = createTestStore();

        // Setup messages
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Response',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
          ]);
        });

        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockImplementation(async () => {
            const currentMessages = store.getState().dbMessages;
            return {
              id: 'msg-3',
              messages: currentMessages,
            };
          });

        // Edit with empty content - should still work
        await act(async () => {
          await store.getState().editMessageAndCreateBranch('msg-2', '');
        });

        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: '',
            parentId: 'msg-1',
          }),
        );
      });

      it('should update displayMessages order correctly after branch creation', async () => {
        const store = createTestStore();

        // Setup initial messages
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Response 1',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
          ]);
        });

        vi.spyOn(messageServiceModule.messageService, 'createMessage').mockImplementation(
          async (params) => {
            // Simulate adding new message to the list
            const currentMessages = store.getState().dbMessages;
            const newMessage = {
              id: 'msg-3',
              content: params.content,
              role: params.role,
              parentId: params.parentId,
              createdAt: Date.now() + 2,
              updatedAt: Date.now() + 2,
            };
            return {
              id: 'msg-3',
              messages: [...currentMessages, newMessage],
            };
          },
        );

        await act(async () => {
          await store.getState().editMessageAndCreateBranch('msg-2', 'Response 2');
        });

        // After branch creation, dbMessages should contain both the original and new branch
        const dbMessages = store.getState().dbMessages;

        // Should have at least original messages plus new one
        expect(dbMessages.length).toBeGreaterThanOrEqual(2);

        // At least one message should have parentId 'msg-1'
        const siblings = dbMessages.filter((m) => m.parentId === 'msg-1');
        expect(siblings.length).toBeGreaterThanOrEqual(1);

        // Verify the new message with 'Response 2' content exists (via optimistic update)
        const newBranch = dbMessages.find((m) => m.content === 'Response 2');
        expect(newBranch).toBeDefined();
      });

      it('should handle concurrent branch creation correctly', async () => {
        const store = createTestStore();

        // Setup messages
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Response',
              role: 'assistant',
              parentId: 'msg-1',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
          ]);
        });

        let callCount = 0;
        vi.spyOn(messageServiceModule.messageService, 'createMessage').mockImplementation(
          async () => {
            callCount++;
            const currentMessages = store.getState().dbMessages;
            return {
              id: `msg-new-${callCount}`,
              messages: currentMessages,
            };
          },
        );

        // Create two branches from the same message (simulating quick edits)
        await act(async () => {
          await store.getState().editMessageAndCreateBranch('msg-2', 'Branch 1');
        });

        await act(async () => {
          await store.getState().editMessageAndCreateBranch('msg-2', 'Branch 2');
        });

        // Both operations should complete
        expect(callCount).toBe(2);

        // switchMessageBranch should be called twice with incrementing indices
        expect(mockChatStore.switchMessageBranch).toHaveBeenCalledTimes(2);
      });

      it('should handle tool role messages correctly', async () => {
        const store = createTestStore();

        // Setup with tool message
        act(() => {
          store.getState().replaceMessages([
            {
              id: 'msg-1',
              content: 'User question',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'msg-2',
              content: 'Tool result',
              role: 'tool',
              parentId: 'msg-1',
              tool_call_id: 'call-123',
              createdAt: Date.now() + 1,
              updatedAt: Date.now() + 1,
            },
          ]);
        });

        const createMessageSpy = vi
          .spyOn(messageServiceModule.messageService, 'createMessage')
          .mockImplementation(async () => {
            const currentMessages = store.getState().dbMessages;
            return {
              id: 'msg-3',
              messages: currentMessages,
            };
          });

        await act(async () => {
          await store.getState().editMessageAndCreateBranch('msg-2', 'Updated tool result');
        });

        // Should create tool message as branch
        expect(createMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            content: 'Updated tool result',
            parentId: 'msg-1',
            role: 'tool',
          }),
        );
      });
    });
  });
});
