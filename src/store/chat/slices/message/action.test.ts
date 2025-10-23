import { TraceEventType } from '@lobechat/types';
import * as lobeUIModules from '@lobehub/ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mutate } from 'swr';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { ChatMessage } from '@/types/message';

import { useChatStore } from '../../store';

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
    removeMessage: vi.fn(),
    removeMessagesByAssistant: vi.fn(),
    removeMessages: vi.fn(() => Promise.resolve()),
    createMessage: vi.fn(() => Promise.resolve('new-message-id')),
    updateMessage: vi.fn(),
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
  activeId: 'session-id',
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
    it('should return early if activeId is undefined', async () => {
      useChatStore.setState({ activeId: undefined });
      const { result } = renderHook(() => useChatStore());
      const updateInputMessageSpy = vi.spyOn(result.current, 'updateInputMessage');

      await act(async () => {
        await result.current.addAIMessage();
      });

      expect(messageService.createMessage).not.toHaveBeenCalled();
      expect(updateInputMessageSpy).not.toHaveBeenCalled();
    });

    it('should call internal_createMessage with correct parameters', async () => {
      const inputMessage = 'Test input message';
      useChatStore.setState({ inputMessage });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.addAIMessage();
      });

      expect(messageService.createMessage).toHaveBeenCalledWith({
        content: inputMessage,
        role: 'assistant',
        sessionId: mockState.activeId,
        topicId: mockState.activeTopicId,
      });
    });

    it('should call updateInputMessage with empty string', async () => {
      const { result } = renderHook(() => useChatStore());
      const updateInputMessageSpy = vi.spyOn(result.current, 'updateInputMessage');
      await act(async () => {
        await result.current.addAIMessage();
      });

      expect(updateInputMessageSpy).toHaveBeenCalledWith('');
    });
  });

  describe('addUserMessage', () => {
    it('should return early if activeId is undefined', async () => {
      useChatStore.setState({ activeId: undefined });
      const { result } = renderHook(() => useChatStore());
      const updateInputMessageSpy = vi.spyOn(result.current, 'updateInputMessage');

      await act(async () => {
        await result.current.addUserMessage({ message: 'test message' });
      });

      expect(messageService.createMessage).not.toHaveBeenCalled();
      expect(updateInputMessageSpy).not.toHaveBeenCalled();
    });

    it('should call internal_createMessage with correct parameters', async () => {
      const message = 'Test user message';
      const fileList = ['file-id-1', 'file-id-2'];
      useChatStore.setState({
        activeId: mockState.activeId,
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
        sessionId: mockState.activeId,
        topicId: mockState.activeTopicId,
        threadId: undefined,
      });
    });

    it('should call internal_createMessage with threadId when activeThreadId is set', async () => {
      const message = 'Test user message';
      const activeThreadId = 'thread-123';
      useChatStore.setState({
        activeId: mockState.activeId,
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
        sessionId: mockState.activeId,
        topicId: mockState.activeTopicId,
        threadId: activeThreadId,
      });
    });

    it('should call updateInputMessage with empty string', async () => {
      const { result } = renderHook(() => useChatStore());
      const updateInputMessageSpy = vi.spyOn(result.current, 'updateInputMessage');

      await act(async () => {
        await result.current.addUserMessage({ message: 'test' });
      });

      expect(updateInputMessageSpy).toHaveBeenCalledWith('');
    });

    it('should handle message without fileList', async () => {
      const message = 'Test user message without files';
      useChatStore.setState({ activeId: mockState.activeId });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.addUserMessage({ message });
      });

      expect(messageService.createMessage).toHaveBeenCalledWith({
        content: message,
        files: undefined,
        role: 'user',
        sessionId: mockState.activeId,
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

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          activeTopicId: undefined,
          messagesMap: {
            [messageMapKey('session-id')]: [{ id: messageId } as ChatMessage],
          },
        });
      });
      await act(async () => {
        await result.current.deleteMessage(messageId);
      });

      expect(deleteSpy).toHaveBeenCalledWith(messageId);
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });

    it('deleteMessage should remove messages with tools', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const removeMessagesSpy = vi.spyOn(messageService, 'removeMessages');

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          activeTopicId: undefined,
          messagesMap: {
            [messageMapKey('session-id')]: [
              { id: messageId, tools: [{ id: 'tool1' }, { id: 'tool2' }] } as ChatMessage,
              { id: '2', tool_call_id: 'tool1', role: 'tool' } as ChatMessage,
              { id: '3', tool_call_id: 'tool2', role: 'tool' } as ChatMessage,
            ],
          },
        });
      });
      await act(async () => {
        await result.current.deleteMessage(messageId);
      });

      expect(removeMessagesSpy).toHaveBeenCalledWith([messageId, '2', '3']);
      expect(result.current.refreshMessages).toHaveBeenCalled();
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
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const updateMessageSpy = vi.spyOn(messageService, 'updateMessage');
      const removeMessageSpy = vi.spyOn(messageService, 'removeMessage');

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          activeTopicId: undefined,
          messagesMap: {
            [messageMapKey('session-id')]: [
              {
                id: messageId,
                role: 'assistant',
                tools: [{ id: 'tool1' }, { id: 'tool2' }],
              } as ChatMessage,
              { id: '2', parentId: messageId, tool_call_id: 'tool1', role: 'tool' } as ChatMessage,
              { id: '3', tool_call_id: 'tool2', role: 'tool' } as ChatMessage,
            ],
          },
        });
      });
      await act(async () => {
        await result.current.deleteToolMessage('2');
      });

      expect(removeMessageSpy).toHaveBeenCalled();
      expect(updateMessageSpy).toHaveBeenCalledWith('message-id', {
        tools: [{ id: 'tool2' }],
      });
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('clearAllMessages', () => {
    it('clearAllMessages should remove all messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const clearAllSpy = vi.spyOn(result.current, 'clearAllMessages');

      await act(async () => {
        await result.current.clearAllMessages();
      });

      expect(clearAllSpy).toHaveBeenCalled();
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('updateInputMessage', () => {
    it('updateInputMessage should update the input message state', () => {
      const { result } = renderHook(() => useChatStore());
      const newInputMessage = 'Updated message';
      act(() => {
        result.current.updateInputMessage(newInputMessage);
      });

      expect(result.current.inputMessage).toEqual(newInputMessage);
    });

    it('should not update state if message is the same as current inputMessage', () => {
      const inputMessage = 'Test input message';
      useChatStore.setState({ inputMessage });
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.updateInputMessage(inputMessage);
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

  describe('internal_updateMessageContent', () => {
    it('should call messageService.internal_updateMessageContent with correct parameters', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const newContent = 'Updated content';

      const spy = vi.spyOn(messageService, 'updateMessage');
      await act(async () => {
        await result.current.internal_updateMessageContent(messageId, newContent);
      });

      expect(spy).toHaveBeenCalledWith(messageId, { content: newContent });
    });

    it('should dispatch message update action', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const newContent = 'Updated content';
      const internal_dispatchMessageSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      await act(async () => {
        await result.current.internal_updateMessageContent(messageId, newContent);
      });

      expect(internal_dispatchMessageSpy).toHaveBeenCalledWith({
        id: messageId,
        type: 'updateMessage',
        value: { content: newContent },
      });
    });

    it('should refresh messages after updating content', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const newContent = 'Updated content';

      await act(async () => {
        await result.current.internal_updateMessageContent(messageId, newContent);
      });

      expect(result.current.refreshMessages).toHaveBeenCalled();
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
      const activeId = useChatStore.getState().activeId;
      const activeTopicId = useChatStore.getState().activeTopicId;

      // 在这里，我们不需要再次模拟 mutate，因为它已经在顶部被模拟了
      await act(async () => {
        await result.current.refreshMessages();
      });

      // 确保 mutate 调用了正确的参数（session 和 group 两次）
      expect(mutate).toHaveBeenCalledWith([
        'SWR_USE_FETCH_MESSAGES',
        activeId,
        activeTopicId,
        'session',
      ]);
      expect(mutate).toHaveBeenCalledWith([
        'SWR_USE_FETCH_MESSAGES',
        activeId,
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

  describe('useFetchMessages hook', () => {
    // beforeEach(() => {
    //   vi.mocked(useSWR).mockRestore();
    // });

    it('should fetch messages for given session and topic ids', async () => {
      const sessionId = 'session-id';
      const topicId = 'topic-id';
      const messages = [{ id: 'message-id', content: 'Hello' }];

      // 设置模拟返回值
      (messageService.getMessages as Mock).mockResolvedValue(messages);

      const { result } = renderHook(() =>
        useChatStore().useFetchMessages(true, sessionId, topicId),
      );

      // 等待异步操作完成
      await waitFor(() => {
        expect(result.current.data).toEqual(messages);
      });
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

    it('should call internal_updateMessageContent with correct parameters', async () => {
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
});
