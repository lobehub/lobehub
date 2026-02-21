import { type UIChatMessage } from '@lobechat/types';
import { TraceEventType } from '@lobechat/types';
import * as lobeUIModules from '@lobehub/ui';
import { act, renderHook } from '@testing-library/react';
import { type Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useChatStore } from '../../store';

// Mock @/libs/swr mutate
vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual('@/libs/swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.resolve(new Response('mock'))),
);

vi.mock('zustand/traditional');
// Mock service
vi.mock('@/services/message', () => ({
  messageService: {
    getMessages: vi.fn(),
    updateMessageError: vi.fn(),
    removeMessage: vi.fn(() => Promise.resolve({ success: true, messages: [] })),
    removeMessagesByAssistant: vi.fn(),
    removeMessages: vi.fn(() => Promise.resolve({ success: true, messages: [] })),
    createMessage: vi.fn(() => Promise.resolve({ id: 'new-message-id', messages: [] })),
    updateMessage: vi.fn(() => Promise.resolve({ success: true, messages: [] })),
    updateMessageMetadata: vi.fn(() => Promise.resolve({ success: true, messages: [] })),
    updateMessagePlugin: vi.fn(() => Promise.resolve({ success: true, messages: [] })),
    updateMessagePluginError: vi.fn(() => Promise.resolve({ success: true, messages: [] })),
    updateMessageRAG: vi.fn(() => Promise.resolve({ success: true, messages: [] })),
    removeAllMessages: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('@/services/topic', () => ({
  topicService: {
    createTopic: vi.fn(() => Promise.resolve()),
    removeTopic: vi.fn(() => Promise.resolve()),
  },
}));

const realRefreshMessages = useChatStore.getState().refreshMessages;
// Mock state
const mockState = {
  activeAgentId: 'session-id',
  activeTopicId: 'topic-id',
  messages: [],
  refreshMessages: vi.fn(),
  refreshTopic: vi.fn(),
  internal_coreProcessMessage: vi.fn(),
  saveToTopic: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState(mockState, false);
});

afterEach(() => {
  process.env.NEXT_PUBLIC_BASE_PATH = undefined;

  vi.restoreAllMocks();
});

describe('chatMessage actions', () => {
  describe('addAIMessage', () => {
    it('should return early if activeAgentId is undefined', async () => {
      useChatStore.setState({ activeAgentId: undefined });
      const { result } = renderHook(() => useChatStore());
      const updateMessageInputSpy = vi.spyOn(result.current, 'updateMessageInput');

      await act(async () => {
        await result.current.addAIMessage();
      });

      expect(messageService.createMessage).not.toHaveBeenCalled();
      expect(updateMessageInputSpy).not.toHaveBeenCalled();
    });

    it('should call optimisticCreateMessage with correct parameters', async () => {
      const inputMessage = 'Test input message';
      useChatStore.setState({ inputMessage });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.addAIMessage();
      });

      expect(messageService.createMessage).toHaveBeenCalledWith({
        content: inputMessage,
        role: 'assistant',
        agentId: mockState.activeAgentId,
        topicId: mockState.activeTopicId,
      });
    });

    it('should call updateMessageInput with empty string', async () => {
      const { result } = renderHook(() => useChatStore());
      const updateMessageInputSpy = vi.spyOn(result.current, 'updateMessageInput');
      await act(async () => {
        await result.current.addAIMessage();
      });

      expect(updateMessageInputSpy).toHaveBeenCalledWith('');
    });
  });

  describe('addUserMessage', () => {
    it('should return early if activeAgentId is undefined', async () => {
      useChatStore.setState({ activeAgentId: undefined });
      const { result } = renderHook(() => useChatStore());
      const updateMessageInputSpy = vi.spyOn(result.current, 'updateMessageInput');

      await act(async () => {
        await result.current.addUserMessage({ message: 'test message' });
      });

      expect(messageService.createMessage).not.toHaveBeenCalled();
      expect(updateMessageInputSpy).not.toHaveBeenCalled();
    });

    it('should call optimisticCreateMessage with correct parameters', async () => {
      const message = 'Test user message';
      const fileList = ['file-id-1', 'file-id-2'];
      useChatStore.setState({
        activeAgentId: mockState.activeAgentId,
        activeTopicId: mockState.activeTopicId,
      });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.addUserMessage({ message, fileList });
      });

      expect(messageService.createMessage).toHaveBeenCalledWith({
        content: message,
        files: fileList,
        role: 'user',
        agentId: mockState.activeAgentId,
        topicId: mockState.activeTopicId,
        threadId: undefined,
      });
    });

    it('should call optimisticCreateMessage with threadId when activeThreadId is set', async () => {
      const message = 'Test user message';
      const activeThreadId = 'thread-123';
      useChatStore.setState({
        activeAgentId: mockState.activeAgentId,
        activeTopicId: mockState.activeTopicId,
        activeThreadId,
      });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.addUserMessage({ message });
      });

      expect(messageService.createMessage).toHaveBeenCalledWith({
        content: message,
        files: undefined,
        role: 'user',
        agentId: mockState.activeAgentId,
        topicId: mockState.activeTopicId,
        threadId: activeThreadId,
      });
    });

    it('should call updateMessageInput with empty string', async () => {
      const { result } = renderHook(() => useChatStore());
      const updateMessageInputSpy = vi.spyOn(result.current, 'updateMessageInput');

      await act(async () => {
        await result.current.addUserMessage({ message: 'test' });
      });

      expect(updateMessageInputSpy).toHaveBeenCalledWith('');
    });

    it('should handle message without fileList', async () => {
      const message = 'Test user message without files';
      useChatStore.setState({ activeAgentId: mockState.activeAgentId });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.addUserMessage({ message });
      });

      expect(messageService.createMessage).toHaveBeenCalledWith({
        content: message,
        files: undefined,
        role: 'user',
        agentId: mockState.activeAgentId,
        topicId: mockState.activeTopicId,
        threadId: undefined,
      });
    });
  });

  describe('deleteMessage', () => {
    it('deleteMessage should remove a message by id', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const deleteSpy = vi.spyOn(result.current, 'deleteMessage');
      const mockMessages = [{ id: 'other-message' }] as any;

      // Mock the service to return messages
      (messageService.removeMessages as Mock).mockResolvedValue({
        success: true,
        messages: mockMessages,
      });

      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-id',
          activeTopicId: undefined,
          messagesMap: {
            [messageMapKey({ agentId: 'session-id' })]: [{ id: messageId } as UIChatMessage],
          },
        });
      });
      await act(async () => {
        await result.current.deleteMessage(messageId);
      });

      expect(deleteSpy).toHaveBeenCalledWith(messageId);
      expect(replaceMessagesSpy).toHaveBeenCalledWith(mockMessages, {
        context: { agentId: 'session-id', topicId: undefined, threadId: undefined },
      });
    });

    it('deleteMessage should remove the message only', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const removeMessagesSpy = vi.spyOn(messageService, 'removeMessages');
      const mockMessages = [
        { id: '2', tool_call_id: 'tool1', role: 'tool' },
        { id: '3', tool_call_id: 'tool2', role: 'tool' },
      ] as any;

      // Mock the service to return remaining messages (orphaned tool messages)
      (messageService.removeMessages as Mock).mockResolvedValue({
        success: true,
        messages: mockMessages,
      });

      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-id',
          activeTopicId: undefined,
          messagesMap: {
            [messageMapKey({ agentId: 'session-id' })]: [
              { id: messageId, tools: [{ id: 'tool1' }, { id: 'tool2' }] } as UIChatMessage,
              { id: '2', tool_call_id: 'tool1', role: 'tool' } as UIChatMessage,
              { id: '3', tool_call_id: 'tool2', role: 'tool' } as UIChatMessage,
            ],
          },
        });
      });
      await act(async () => {
        await result.current.deleteMessage(messageId);
      });

      // Only the message itself should be deleted, tool messages remain as orphaned
      expect(removeMessagesSpy).toHaveBeenCalledWith([messageId], {
        agentId: 'session-id',
        topicId: undefined,
      });
      expect(replaceMessagesSpy).toHaveBeenCalledWith(mockMessages, {
        context: { agentId: 'session-id', topicId: undefined, threadId: undefined },
      });
    });

    it('deleteMessage should remove assistantGroup message with all children', async () => {
      const { result } = renderHook(() => useChatStore());
      const groupMessageId = 'group-message-id';
      const removeMessagesSpy = vi.spyOn(messageService, 'removeMessages');
      const mockMessages = [{ id: 'remaining-message' }] as any;

      // Mock the service to return messages
      (messageService.removeMessages as Mock).mockResolvedValue({
        success: true,
        messages: mockMessages,
      });

      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-id',
          activeTopicId: undefined,
          messagesMap: {
            [messageMapKey({ agentId: 'session-id' })]: [
              {
                id: groupMessageId,
                role: 'assistantGroup',
                content: '',
                children: [
                  {
                    id: 'child-1',
                    content: 'Child 1',
                  },
                  {
                    id: 'child-2',
                    content: 'Child 2',
                  },
                ],
              } as UIChatMessage,
              { id: 'other-message', role: 'user', content: 'Other' } as UIChatMessage,
            ],
          },
        });
      });
      await act(async () => {
        await result.current.deleteMessage(groupMessageId);
      });

      expect(removeMessagesSpy).toHaveBeenCalledWith([groupMessageId, 'child-1', 'child-2'], {
        agentId: 'session-id',
        topicId: undefined,
      });
      expect(replaceMessagesSpy).toHaveBeenCalledWith(mockMessages, {
        context: { agentId: 'session-id', topicId: undefined, threadId: undefined },
      });
    });

    it('deleteMessage should remove group message with children that have tool calls', async () => {
      const { result } = renderHook(() => useChatStore());
      const groupMessageId = 'group-message-id';
      const removeMessagesSpy = vi.spyOn(messageService, 'removeMessages');
      const mockMessages = [{ id: 'remaining-message' }] as any;

      // Mock the service to return messages
      (messageService.removeMessages as Mock).mockResolvedValue({
        success: true,
        messages: mockMessages,
      });

      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-id',
          activeTopicId: undefined,
          messagesMap: {
            [messageMapKey({ agentId: 'session-id' })]: [
              {
                id: groupMessageId,
                role: 'assistantGroup',
                content: '',
                children: [
                  {
                    id: 'child-1',
                    content: 'Child with tools',
                    tools: [
                      {
                        id: 'tool1',
                        result: {
                          id: 'tool-result-1',
                          content: 'Tool result',
                        },
                      },
                    ],
                  },
                  {
                    id: 'child-2',
                    content: 'Child 2',
                  },
                ],
              } as UIChatMessage,
              { id: 'other-message', role: 'user', content: 'Other' } as UIChatMessage,
            ],
          },
        });
      });
      await act(async () => {
        await result.current.deleteMessage(groupMessageId);
      });

      // Should delete assistantGroup message + all children + tool results of children
      expect(removeMessagesSpy).toHaveBeenCalledWith(
        [groupMessageId, 'child-1', 'child-2', 'tool-result-1'],
        {
          agentId: 'session-id',
          topicId: undefined,
        },
      );
      expect(replaceMessagesSpy).toHaveBeenCalledWith(mockMessages, {
        context: { agentId: 'session-id', topicId: undefined, threadId: undefined },
      });
    });
  });

  describe('copyMessage', () => {
    it('should call copyToClipboard with correct content', async () => {
      const messageId = 'message-id';
      const content = 'Test content';
      const { result } = renderHook(() => useChatStore());
      const copyToClipboardSpy = vi.spyOn(lobeUIModules, 'copyToClipboard');

      await act(async () => {
        await result.current.copyMessage(messageId, content);
      });

      expect(copyToClipboardSpy).toHaveBeenCalledWith(content);
    });

    it('should call internal_traceMessage with correct parameters', async () => {
      const messageId = 'message-id';
      const content = 'Test content';
      const { result } = renderHook(() => useChatStore());
      const internal_traceMessageSpy = vi.spyOn(result.current, 'internal_traceMessage');

      await act(async () => {
        await result.current.copyMessage(messageId, content);
      });

      expect(internal_traceMessageSpy).toHaveBeenCalledWith(messageId, {
        eventType: TraceEventType.CopyMessage,
      });
    });
  });

  describe('deleteToolMessage', () => {
    it('deleteMessage should remove a message by id', async () => {
      const messageId = 'message-id';
      const sessionId = 'session-id';
      const topicId = null;

      const rawMessages = [
        {
          id: messageId,
          role: 'assistant',
          tools: [{ id: 'tool1' }, { id: 'tool2' }],
        } as UIChatMessage,
        {
          id: '2',
          parentId: messageId,
          tool_call_id: 'tool1',
          role: 'tool',
        } as UIChatMessage,
        { id: '3', tool_call_id: 'tool2', role: 'tool' } as UIChatMessage,
      ];

      const key = messageMapKey({ agentId: sessionId, topicId });
      act(() => {
        useChatStore.setState({
          activeAgentId: sessionId,
          activeTopicId: topicId as unknown as string,
          dbMessagesMap: {
            [key]: rawMessages,
          },
          messagesMap: {
            [key]: rawMessages,
          },
        });
      });

      const { result } = renderHook(() => useChatStore());

      // Mock removeMessage to return the remaining messages after deletion
      // Note: tool1 is also removed from the assistant message's tools to reflect the concurrent update
      const remainingAfterDelete = [
        {
          id: messageId,
          role: 'assistant',
          tools: [{ id: 'tool2' }],
        } as UIChatMessage,
        { id: '3', tool_call_id: 'tool2', role: 'tool' } as UIChatMessage,
      ];

      // Mock updateMessage to return updated messages after tool removal
      const updatedMessages = [
        {
          id: messageId,
          role: 'assistant',
          tools: [{ id: 'tool2' }],
        } as UIChatMessage,
        { id: '3', tool_call_id: 'tool2', role: 'tool' } as UIChatMessage,
      ];

      const refreshToolsSpy = vi.spyOn(result.current, 'internal_refreshToUpdateMessageTools');
      const updateMessageSpy = vi
        .spyOn(messageService, 'updateMessage')
        .mockResolvedValue({ success: true, messages: updatedMessages });
      const removeMessageSpy = vi
        .spyOn(messageService, 'removeMessage')
        .mockResolvedValue({ success: true, messages: remainingAfterDelete });

      await act(async () => {
        await result.current.deleteToolMessage('2');
      });

      expect(removeMessageSpy).toHaveBeenCalled();
      expect(refreshToolsSpy).toHaveBeenCalledWith('message-id', undefined);
      expect(updateMessageSpy).toHaveBeenCalledWith(
        'message-id',
        {
          tools: [{ id: 'tool2' }],
        },
        {
          agentId: sessionId,
          topicId,
        },
      );
    });
  });

  describe('clearAllMessages', () => {
    it('clearAllMessages should remove all messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const clearAllSpy = vi.spyOn(result.current, 'clearAllMessages');
      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      await act(async () => {
        await result.current.clearAllMessages();
      });

      expect(clearAllSpy).toHaveBeenCalled();
      expect(replaceMessagesSpy).toHaveBeenCalledWith([]);
    });
  });

  describe('updateMessageInput', () => {
    it('updateMessageInput should update the input message state', () => {
      const { result } = renderHook(() => useChatStore());
      const newInputMessage = 'Updated message';
      act(() => {
        result.current.updateMessageInput(newInputMessage);
      });

      expect(result.current.inputMessage).toEqual(newInputMessage);
    });

    it('should not update state if message is the same as current inputMessage', () => {
      const inputMessage = 'Test input message';
      useChatStore.setState({ inputMessage });
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.updateMessageInput(inputMessage);
      });

      expect(result.current.inputMessage).toBe(inputMessage);
    });
  });

  describe('clearMessage', () => {
    beforeEach(() => {
      vi.clearAllMocks(); // 清除 mocks
      useChatStore.setState(mockState, false); // 重置 state
    });

    afterEach(() => {
      vi.restoreAllMocks(); // 恢复所有模拟
    });
    it('clearMessage should remove messages from the active session and topic', async () => {
      const { result } = renderHook(() => useChatStore());
      const clearSpy = vi.spyOn(result.current, 'clearMessage');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.clearMessage();
      });

      expect(clearSpy).toHaveBeenCalled();
      expect(result.current.refreshMessages).toHaveBeenCalled();
      expect(result.current.refreshTopic).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });

    it('should remove messages from the active session and topic, then refresh topics and messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        await result.current.clearMessage();
      });

      expect(mockState.refreshMessages).toHaveBeenCalled();
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();

      // 检查 activeTopicId 是否被清除，需要在状态更新后进行检查
      expect(useChatStore.getState().activeTopicId).toBeNull();
    });

    it('should call removeTopic if there is an activeTopicId', async () => {
      const { result } = renderHook(() => useChatStore());
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        await result.current.clearMessage();
      });

      expect(mockState.activeTopicId).not.toBeUndefined(); // 确保在测试前 activeTopicId 存在
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(mockState.refreshMessages).toHaveBeenCalled();
      expect(topicService.removeTopic).toHaveBeenCalledWith(mockState.activeTopicId);
      expect(switchTopicSpy).toHaveBeenCalled();
    });
  });

  describe('toggleMessageEditing ', () => {
    it('should add message id to messageEditingIds when editing is true', () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';

      act(() => {
        result.current.toggleMessageEditing(messageId, true);
      });

      expect(result.current.messageEditingIds).toContain(messageId);
    });

    it('should remove message id from messageEditingIds when editing is false', () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'abc';

      act(() => {
        result.current.toggleMessageEditing(messageId, true);
        result.current.toggleMessageEditing(messageId, false);
      });

      expect(result.current.messageEditingIds).not.toContain(messageId);
    });

    it('should update messageEditingIds correctly when enabling editing', () => {
      const messageId = 'message-id';
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.toggleMessageEditing(messageId, true);
      });

      expect(result.current.messageEditingIds).toContain(messageId);
    });

    it('should update messageEditingIds correctly when disabling editing', () => {
      const messageId = 'message-id';
      useChatStore.setState({ messageEditingIds: [messageId] });
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.toggleMessageEditing(messageId, false);
      });

      expect(result.current.messageEditingIds).not.toContain(messageId);
    });
  });

  describe('optimisticUpdateMessageContent', () => {
    it('should call messageService.optimisticUpdateMessageContent with correct parameters', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const newContent = 'Updated content';

      const spy = vi.spyOn(messageService, 'updateMessage');
      await act(async () => {
        await result.current.optimisticUpdateMessageContent(messageId, newContent);
      });

      expect(spy).toHaveBeenCalledWith(
        messageId,
        expect.objectContaining({ content: newContent }),
        { agentId: 'session-id', topicId: 'topic-id' },
      );
    });

    it('should dispatch message update action', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const newContent = 'Updated content';
      const internal_dispatchMessageSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      await act(async () => {
        await result.current.optimisticUpdateMessageContent(messageId, newContent);
      });

      expect(internal_dispatchMessageSpy).toHaveBeenCalledWith(
        {
          id: messageId,
          type: 'updateMessage',
          value: { content: newContent },
        },
        undefined,
      );
    });

    it('should replace messages after updating content', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const newContent = 'Updated content';
      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      await act(async () => {
        await result.current.optimisticUpdateMessageContent(messageId, newContent);
      });

      expect(replaceMessagesSpy).toHaveBeenCalledWith([], {
        action: 'optimisticUpdateMessageContent',
        context: { agentId: 'session-id', topicId: 'topic-id', threadId: undefined },
      });
    });
  });

  describe('refreshMessages action', () => {
    beforeEach(() => {
      vi.mock('swr', async () => {
        const actual = await vi.importActual('swr');
        return {
          ...(actual as any),
          mutate: vi.fn(),
        };
      });
    });
    afterEach(() => {
      // 在每个测试用例开始前恢复到实际的 SWR 实现
      vi.resetAllMocks();
    });
    it('should refresh messages by calling mutate for both session and group types', async () => {
      useChatStore.setState({ refreshMessages: realRefreshMessages });

      const { result } = renderHook(() => useChatStore());
      const activeAgentId = useChatStore.getState().activeAgentId;
      const activeTopicId = useChatStore.getState().activeTopicId;

      // 在这里，我们不需要再次模拟 mutate，因为它已经在顶部被模拟了
      await act(async () => {
        await result.current.refreshMessages();
      });

      // 确保 mutate 调用了正确的参数（session 和 group 两次）
      expect(mutate).toHaveBeenCalledWith([
        'SWR_USE_FETCH_MESSAGES',
        activeAgentId,
        activeTopicId,
        'session',
      ]);
      expect(mutate).toHaveBeenCalledWith([
        'SWR_USE_FETCH_MESSAGES',
        activeAgentId,
        activeTopicId,
        'group',
      ]);
      expect(mutate).toHaveBeenCalledTimes(2);
    });
    it('should handle errors during refreshing messages', async () => {
      useChatStore.setState({ refreshMessages: realRefreshMessages });
      const { result } = renderHook(() => useChatStore());

      // 设置模拟错误
      (mutate as Mock).mockImplementation(() => {
        throw new Error('Mutate error');
      });

      await act(async () => {
        await expect(result.current.refreshMessages()).rejects.toThrow('Mutate error');
      });

      // 确保恢复 mutate 的模拟，以免影响其他测试
      (mutate as Mock).mockReset();
    });
  });

  describe('internal_toggleMessageLoading', () => {
    it('should add message id to messageLoadingIds when loading is true', () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';

      act(() => {
        result.current.internal_toggleMessageLoading(true, messageId);
      });

      expect(result.current.messageLoadingIds).toContain(messageId);
    });

    it('should remove message id from messageLoadingIds when loading is false', () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'ddd-id';

      act(() => {
        result.current.internal_toggleMessageLoading(true, messageId);
        result.current.internal_toggleMessageLoading(false, messageId);
      });

      expect(result.current.messageLoadingIds).not.toContain(messageId);
    });
  });

  describe('modifyMessageContent', () => {
    it('should call internal_traceMessage with correct parameters before updating', async () => {
      const messageId = 'message-id';
      const content = 'Updated content';
      const { result } = renderHook(() => useChatStore());

      const spy = vi.spyOn(result.current, 'internal_traceMessage');
      await act(async () => {
        await result.current.modifyMessageContent(messageId, content);
      });

      expect(spy).toHaveBeenCalledWith(messageId, {
        eventType: TraceEventType.ModifyMessage,
        nextContent: content,
      });
    });

    it('should call optimisticUpdateMessageContent with correct parameters', async () => {
      const messageId = 'message-id';
      const content = 'Updated content';
      const { result } = renderHook(() => useChatStore());

      const spy = vi.spyOn(result.current, 'internal_traceMessage');

      await act(async () => {
        await result.current.modifyMessageContent(messageId, content);
      });

      expect(spy).toHaveBeenCalledWith(messageId, {
        eventType: 'Modify Message',
        nextContent: 'Updated content',
      });
    });
  });

  describe('OptimisticUpdateContext isolation', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('optimisticUpdateMessageContent should use context sessionId/topicId', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const content = 'Updated content';
      const contextSessionId = 'context-session-id';
      const contextTopicId = 'context-topic-id';

      const updateMessageSpy = vi.spyOn(messageService, 'updateMessage');

      let operationId: string;
      await act(async () => {
        // Create operation with desired context
        const op = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: contextSessionId, topicId: contextTopicId },
        });
        operationId = op.operationId;

        await result.current.optimisticUpdateMessageContent(messageId, content, undefined, {
          operationId,
        });
      });

      expect(updateMessageSpy).toHaveBeenCalledWith(
        messageId,
        expect.objectContaining({ content, tools: undefined }),
        { agentId: contextSessionId, topicId: contextTopicId },
      );
    });

    it('optimisticUpdateMessageError should use context operationId', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const error = { message: 'Error occurred', type: 'error' as any };
      const contextSessionId = 'context-session';
      const contextTopicId = 'context-topic';

      const updateMessageSpy = vi.spyOn(messageService, 'updateMessage');

      let operationId: string;
      await act(async () => {
        // Create operation with desired context
        const op = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: contextSessionId, topicId: contextTopicId },
        });
        operationId = op.operationId;

        await result.current.optimisticUpdateMessageError(messageId, error, {
          operationId,
        });
      });

      expect(updateMessageSpy).toHaveBeenCalledWith(
        messageId,
        { error },
        { agentId: contextSessionId, topicId: contextTopicId },
      );
    });

    it('optimisticDeleteMessage should use context operationId', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const contextSessionId = 'context-session';
      const contextTopicId = 'context-topic';

      const removeMessageSpy = vi.spyOn(messageService, 'removeMessage');

      let operationId: string;
      await act(async () => {
        // Create operation with desired context
        const op = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: contextSessionId, topicId: contextTopicId },
        });
        operationId = op.operationId;

        await result.current.optimisticDeleteMessage(messageId, {
          operationId,
        });
      });

      expect(removeMessageSpy).toHaveBeenCalledWith(messageId, {
        agentId: contextSessionId,
        topicId: contextTopicId,
      });
    });

    it('optimisticDeleteMessages should use context operationId', async () => {
      const { result } = renderHook(() => useChatStore());
      const ids = ['id-1', 'id-2'];
      const contextSessionId = 'context-session';
      const contextTopicId = 'context-topic';

      const removeMessagesSpy = vi.spyOn(messageService, 'removeMessages');

      let operationId: string;
      await act(async () => {
        // Create operation with desired context
        const op = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: contextSessionId, topicId: contextTopicId },
        });
        operationId = op.operationId;

        await result.current.optimisticDeleteMessages(ids, {
          operationId,
        });
      });

      expect(removeMessagesSpy).toHaveBeenCalledWith(ids, {
        agentId: contextSessionId,
        topicId: contextTopicId,
      });
    });
  });

  describe('optimisticUpdateMessagePlugin', () => {
    it('should dispatch message update action with plugin value', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const pluginValue = { arguments: '{"test":"value"}' };
      const internal_dispatchMessageSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      await act(async () => {
        await result.current.optimisticUpdateMessagePlugin(messageId, pluginValue);
      });

      expect(internal_dispatchMessageSpy).toHaveBeenCalledWith(
        {
          id: messageId,
          type: 'updateMessagePlugin',
          value: pluginValue,
        },
        undefined,
      );
    });

    it('should call messageService.updateMessagePlugin with correct parameters', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const pluginValue = { state: 'success' };

      const updateMessagePluginSpy = vi.spyOn(messageService, 'updateMessagePlugin');
      await act(async () => {
        await result.current.optimisticUpdateMessagePlugin(messageId, pluginValue);
      });

      expect(updateMessagePluginSpy).toHaveBeenCalledWith(messageId, pluginValue, {
        agentId: 'session-id',
        topicId: 'topic-id',
      });
    });

    it('should replace messages after updating plugin', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const pluginValue = { apiName: 'test-api' };
      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      await act(async () => {
        await result.current.optimisticUpdateMessagePlugin(messageId, pluginValue);
      });

      expect(replaceMessagesSpy).toHaveBeenCalledWith([], {
        context: { agentId: 'session-id', topicId: 'topic-id', threadId: undefined },
      });
    });

    it('should use context operationId when provided', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const pluginValue = { identifier: 'test-plugin' };
      const contextSessionId = 'context-session';
      const contextTopicId = 'context-topic';

      const updateMessagePluginSpy = vi.spyOn(messageService, 'updateMessagePlugin');

      let operationId: string;
      await act(async () => {
        // Create operation with desired context
        const op = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: contextSessionId, topicId: contextTopicId },
        });
        operationId = op.operationId;

        await result.current.optimisticUpdateMessagePlugin(messageId, pluginValue, {
          operationId,
        });
      });

      expect(updateMessagePluginSpy).toHaveBeenCalledWith(messageId, pluginValue, {
        agentId: contextSessionId,
        topicId: contextTopicId,
      });
    });
  });

  describe('replaceMessages with groupId context', () => {
    it('should use groupId from context params when provided', async () => {
      const { result } = renderHook(() => useChatStore());

      const messages = [
        { id: 'msg1', role: 'user', content: 'Hello' },
        { id: 'msg2', role: 'assistant', content: 'Hi' },
      ] as any;

      await act(async () => {
        result.current.replaceMessages(messages, {
          context: {
            agentId: 'agent1',
            groupId: 'group1',
            topicId: 'topic1',
          },
        });
      });

      // Verify the messages are stored with the group context
      const key = messageMapKey({
        agentId: 'agent1',
        groupId: 'group1',
        topicId: 'topic1',
      });

      expect(result.current.messagesMap[key]).toEqual(messages);
    });

    it('should use activeGroupId from global state when no context provided', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: 'agent1',
          activeGroupId: 'group1',
          activeTopicId: 'topic1',
        });
      });

      const messages = [{ id: 'msg1', role: 'user', content: 'Hello' }] as any;

      await act(async () => {
        result.current.replaceMessages(messages);
      });

      // Verify the messages are stored with the group context from global state
      const key = messageMapKey({
        agentId: 'agent1',
        groupId: 'group1',
        topicId: 'topic1',
      });

      expect(result.current.messagesMap[key]).toEqual(messages);
    });

    it('should preserve groupId from operation context', async () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      await act(async () => {
        // Create operation with group context
        const op = result.current.startOperation({
          type: 'sendMessage',
          context: {
            agentId: 'agent1',
            groupId: 'group1',
            topicId: 'topic1',
          },
        });
        operationId = op.operationId;

        const messages = [{ id: 'msg1', role: 'user', content: 'Hello' }] as any;

        // Use operation context via replaceMessages
        result.current.replaceMessages(messages, {
          context: {
            agentId: 'agent1',
            groupId: 'group1',
            topicId: 'topic1',
          },
        });
      });

      const key = messageMapKey({
        agentId: 'agent1',
        groupId: 'group1',
        topicId: 'topic1',
      });

      expect(result.current.messagesMap[key]).toBeDefined();
    });

    it('should generate different keys for same agent in different groups', async () => {
      const { result } = renderHook(() => useChatStore());

      const messages1 = [{ id: 'msg1', role: 'user', content: 'Group 1' }] as any;
      const messages2 = [{ id: 'msg2', role: 'user', content: 'Group 2' }] as any;

      await act(async () => {
        result.current.replaceMessages(messages1, {
          context: {
            agentId: 'agent1',
            groupId: 'group1',
            topicId: 'topic1',
          },
        });

        result.current.replaceMessages(messages2, {
          context: {
            agentId: 'agent1',
            groupId: 'group2',
            topicId: 'topic1',
          },
        });
      });

      const key1 = messageMapKey({
        agentId: 'agent1',
        groupId: 'group1',
        topicId: 'topic1',
      });

      const key2 = messageMapKey({
        agentId: 'agent1',
        groupId: 'group2',
        topicId: 'topic1',
      });

      // Different groups should have different keys and different messages
      expect(key1).not.toBe(key2);
      expect(result.current.messagesMap[key1]).toEqual(messages1);
      expect(result.current.messagesMap[key2]).toEqual(messages2);
    });
  });

  describe('Public API with context parameter', () => {
    describe('deleteMessage with context', () => {
      it('should pass context to optimisticDeleteMessages', async () => {
        const { result } = renderHook(() => useChatStore());
        const messageId = 'message-id';

        // Setup: use the same agentId for both global state and message
        // This ensures the message can be found by the selector
        const agentId = 'session-id';
        const topicId = 'topic-123';
        const key = messageMapKey({ agentId, topicId });

        const messages = [{ id: messageId, role: 'user', content: 'Test message' }] as any;

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            messagesMap: {
              [key]: messages,
            },
          });
        });

        // Create operation with context
        let operationId: string;
        act(() => {
          const op = result.current.startOperation({
            type: 'regenerate',
            context: { agentId, topicId },
          });
          operationId = op.operationId;
        });

        // Spy on optimisticDeleteMessages to verify context is passed
        const optimisticDeleteSpy = vi.spyOn(result.current, 'optimisticDeleteMessages');

        // Use vi.spyOn to mock the service response
        vi.spyOn(messageService, 'removeMessages').mockResolvedValue({
          success: true,
          messages: [],
        } as any);

        // Delete message with operationId context
        await act(async () => {
          await result.current.deleteMessage(messageId, { operationId: operationId! });
        });

        // Verify: optimisticDeleteMessages was called with the context
        expect(optimisticDeleteSpy).toHaveBeenCalledWith([messageId], {
          operationId: operationId!,
        });
      });
    });

    describe('modifyMessageContent with context', () => {
      it('should use operationId context for optimistic update', async () => {
        const { result } = renderHook(() => useChatStore());
        const messageId = 'message-id';
        const newContent = 'Modified content';

        // Group context
        const groupContext = {
          agentId: 'agent-in-group',
          groupId: 'group-123',
          topicId: 'topic-in-group',
        };
        const groupKey = messageMapKey(groupContext);

        // Global state - different from group context
        const globalAgentId = 'global-agent';
        const globalKey = messageMapKey({ agentId: globalAgentId });

        // Setup: messages in both contexts
        const groupMessages = [
          { id: messageId, role: 'user', content: 'Original group content' },
        ] as any;
        const globalMessages = [
          { id: 'global-msg', role: 'user', content: 'Global message' },
        ] as any;

        act(() => {
          useChatStore.setState({
            activeAgentId: globalAgentId,
            activeTopicId: undefined,
            dbMessagesMap: {
              [groupKey]: groupMessages,
              [globalKey]: globalMessages,
            },
            messagesMap: {
              [groupKey]: groupMessages,
              [globalKey]: globalMessages,
            },
          });
        });

        // Create operation with group context
        let operationId: string;
        act(() => {
          const op = result.current.startOperation({
            type: 'regenerate',
            context: groupContext,
          });
          operationId = op.operationId;
        });

        // Use vi.spyOn to mock the service response
        const updateMessageSpy = vi.spyOn(messageService, 'updateMessage').mockResolvedValue({
          success: true,
          messages: [{ id: messageId, role: 'user', content: newContent }],
        } as any);

        // Modify message with operationId context
        await act(async () => {
          await result.current.modifyMessageContent(messageId, newContent, {
            operationId: operationId!,
          });
        });

        // Verify: service was called with the message update
        // Note: updateMessage is called with all fields, we just check that it was called with the id and content
        expect(updateMessageSpy).toHaveBeenCalledWith(
          messageId,
          expect.objectContaining({ content: newContent }),
          expect.anything(),
        );

        // Verify: global messages should remain untouched
        expect(result.current.messagesMap[globalKey]).toEqual(globalMessages);
      });
    });

    describe('switchMessageBranch with context', () => {
      it('should use operationId context for optimistic update', async () => {
        const { result } = renderHook(() => useChatStore());
        const messageId = 'message-id';
        const branchIndex = 2;

        // Group context
        const groupContext = {
          agentId: 'agent-in-group',
          groupId: 'group-123',
          topicId: 'topic-in-group',
        };
        const groupKey = messageMapKey(groupContext);

        // Global state - different from group context
        const globalAgentId = 'global-agent';
        const globalKey = messageMapKey({ agentId: globalAgentId });

        // Setup: messages in both contexts
        const groupMessages = [
          { id: messageId, role: 'user', content: 'Group message', metadata: {} },
        ] as any;
        const globalMessages = [
          { id: 'global-msg', role: 'user', content: 'Global message', metadata: {} },
        ] as any;

        act(() => {
          useChatStore.setState({
            activeAgentId: globalAgentId,
            activeTopicId: undefined,
            dbMessagesMap: {
              [groupKey]: groupMessages,
              [globalKey]: globalMessages,
            },
            messagesMap: {
              [groupKey]: groupMessages,
              [globalKey]: globalMessages,
            },
          });
        });

        // Create operation with group context
        let operationId: string;
        act(() => {
          const op = result.current.startOperation({
            type: 'regenerate',
            context: groupContext,
          });
          operationId = op.operationId;
        });

        // Use vi.spyOn to mock the service response
        const updateMetadataSpy = vi
          .spyOn(messageService, 'updateMessageMetadata')
          .mockResolvedValue({
            success: true,
            messages: [
              {
                id: messageId,
                role: 'user',
                content: 'Group message',
                metadata: { activeBranchIndex: branchIndex },
              },
            ],
          } as any);

        // Switch branch with operationId context
        await act(async () => {
          await result.current.switchMessageBranch(messageId, branchIndex, {
            operationId: operationId!,
          });
        });

        // Verify: service was called with the metadata update
        // Note: service is called with 3 args: (id, metadata, context)
        // The context includes all fields from internal_getConversationContext
        expect(updateMetadataSpy).toHaveBeenCalledWith(
          messageId,
          { activeBranchIndex: branchIndex },
          expect.objectContaining({
            agentId: groupContext.agentId,
            groupId: groupContext.groupId,
            topicId: groupContext.topicId,
          }),
        );

        // Verify: global messages should remain untouched
        expect(result.current.messagesMap[globalKey]).toEqual(globalMessages);
      });
    });

    describe('optimistic updates with groupId in operation context', () => {
      const groupContext = {
        agentId: 'agent-in-group',
        groupId: 'group-456',
        topicId: 'topic-in-group',
      };
      const groupKey = messageMapKey(groupContext);
      const messageId = 'message-id';
      const messages = [{ id: messageId, role: 'user', content: 'Test' }] as any;

      beforeEach(() => {
        act(() => {
          useChatStore.setState({
            activeAgentId: 'global-agent',
            activeTopicId: undefined,
            dbMessagesMap: { [groupKey]: messages },
            messagesMap: { [groupKey]: messages },
          });
        });
      });

      it('optimisticUpdateMessageContent should pass groupId via ctx', async () => {
        const { result } = renderHook(() => useChatStore());

        let operationId: string;
        act(() => {
          const op = result.current.startOperation({
            type: 'regenerate',
            context: groupContext,
          });
          operationId = op.operationId;
        });

        const updateSpy = vi
          .spyOn(messageService, 'updateMessage')
          .mockResolvedValue({ success: true, messages: [] } as any);

        await act(async () => {
          await result.current.optimisticUpdateMessageContent(messageId, 'new content', undefined, {
            operationId: operationId!,
          });
        });

        expect(updateSpy).toHaveBeenCalledWith(
          messageId,
          expect.objectContaining({ content: 'new content' }),
          expect.objectContaining({
            agentId: groupContext.agentId,
            groupId: groupContext.groupId,
            topicId: groupContext.topicId,
          }),
        );
      });

      it('optimisticDeleteMessage should pass groupId via ctx', async () => {
        const { result } = renderHook(() => useChatStore());

        let operationId: string;
        act(() => {
          const op = result.current.startOperation({
            type: 'regenerate',
            context: groupContext,
          });
          operationId = op.operationId;
        });

        const removeSpy = vi
          .spyOn(messageService, 'removeMessage')
          .mockResolvedValue({ success: true, messages: [] } as any);

        await act(async () => {
          await result.current.optimisticDeleteMessage(messageId, { operationId: operationId! });
        });

        expect(removeSpy).toHaveBeenCalledWith(
          messageId,
          expect.objectContaining({
            agentId: groupContext.agentId,
            groupId: groupContext.groupId,
            topicId: groupContext.topicId,
          }),
        );
      });

      it('optimisticUpdateMessageError should pass groupId via ctx', async () => {
        const { result } = renderHook(() => useChatStore());

        let operationId: string;
        act(() => {
          const op = result.current.startOperation({
            type: 'regenerate',
            context: groupContext,
          });
          operationId = op.operationId;
        });

        const error = { type: 'TestError', message: 'Test' };

        const updateSpy = vi
          .spyOn(messageService, 'updateMessage')
          .mockResolvedValue({ success: true, messages: [] } as any);

        await act(async () => {
          await result.current.optimisticUpdateMessageError(messageId, error as any, {
            operationId: operationId!,
          });
        });

        expect(updateSpy).toHaveBeenCalledWith(
          messageId,
          expect.objectContaining({ error }),
          expect.objectContaining({
            agentId: groupContext.agentId,
            groupId: groupContext.groupId,
            topicId: groupContext.topicId,
          }),
        );
      });

      it('optimisticUpdateMessageMetadata should pass groupId via ctx', async () => {
        const { result } = renderHook(() => useChatStore());

        let operationId: string;
        act(() => {
          const op = result.current.startOperation({
            type: 'regenerate',
            context: groupContext,
          });
          operationId = op.operationId;
        });

        const metadata = { collapsed: true };

        const updateSpy = vi
          .spyOn(messageService, 'updateMessageMetadata')
          .mockResolvedValue({ success: true, messages: [] } as any);

        await act(async () => {
          await result.current.optimisticUpdateMessageMetadata(messageId, metadata, {
            operationId: operationId!,
          });
        });

        expect(updateSpy).toHaveBeenCalledWith(
          messageId,
          metadata,
          expect.objectContaining({
            agentId: groupContext.agentId,
            groupId: groupContext.groupId,
            topicId: groupContext.topicId,
          }),
        );
      });
    });
  });
});
