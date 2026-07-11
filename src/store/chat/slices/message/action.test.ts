import { type UIChatMessage } from '@lobechat/types';
import { TraceEventType } from '@lobechat/types';
import * as lobeUIModules from '@lobehub/ui';
import { act, renderHook } from '@testing-library/react';
import { type Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { messageService } from '@/services/message';
import {
  clearMessageListClientCacheState,
  isMessageListServerVerified,
  messageListKey,
  runMessageListQuery,
} from '@/services/message/cache';
import { topicService } from '@/services/topic';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useChatStore } from '../../store';

// Mock @/libs/swr mutate
vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual('@/libs/swr');
  return {
    ...actual,
    mutate: vi.fn(),
    useClientDataSWRWithSync: vi.fn(),
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
  },
}));
vi.mock('@/services/topic', () => ({
  topicService: {
    createTopic: vi.fn(() => Promise.resolve()),
    removeTopic: vi.fn(() => Promise.resolve()),
  },
}));

const realRefreshMessages = useChatStore.getState().refreshMessages;
const realRevalidateMessages = useChatStore.getState().revalidateMessages;
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
  clearMessageListClientCacheState();
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

    it('should pass user message metadata when provided', async () => {
      const message = 'Test user message with selected code';
      const metadata = {
        contextSelections: [
          {
            content: 'const answer = 42;',
            filePath: 'src/example.ts',
            id: 'selection-1',
            source: 'code' as const,
          },
        ],
      };
      useChatStore.setState({ activeAgentId: mockState.activeAgentId });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.addUserMessage({ message, metadata });
      });

      expect(messageService.createMessage).toHaveBeenCalledWith({
        content: message,
        files: undefined,
        role: 'user',
        agentId: mockState.activeAgentId,
        metadata,
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
      expect(messageService.removeMessagesByAssistant).toHaveBeenCalledWith(
        mockState.activeAgentId,
        mockState.activeTopicId,
      );
      expect(result.current.refreshTopic).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });

    it('should remove messages from the active session and topic, then refresh topics', async () => {
      const { result } = renderHook(() => useChatStore());
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        await result.current.clearMessage();
      });

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
    it('should refresh messages by invalidating message:list for the active agent+topic', async () => {
      useChatStore.setState({ refreshMessages: realRefreshMessages });

      const { result } = renderHook(() => useChatStore());
      const activeAgentId = useChatStore.getState().activeAgentId;
      const activeTopicId = useChatStore.getState().activeTopicId;
      const context = { agentId: activeAgentId, topicId: activeTopicId };
      await runMessageListQuery(context, async () => []);
      expect(isMessageListServerVerified(context)).toBe(true);

      await act(async () => {
        await result.current.refreshMessages();
      });

      expect(isMessageListServerVerified(context)).toBe(false);

      // refreshMessages now mutates with a single matcher targeting the
      // accurate `message:list` key for this agent+topic.
      expect(mutate).toHaveBeenCalledTimes(1);
      const matcher = (mutate as any).mock.calls[0][0];
      expect(typeof matcher).toBe('function');
      expect(matcher(messageListKey(context))).toBe(true);
      // other domains / other topics are not matched
      expect(matcher(['topic:list', 'container', {}])).toBe(false);
      expect(matcher(['message:list', { agentId: activeAgentId, topicId: 'other' }, 1])).toBe(
        false,
      );
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

    it('keeps soft revalidation silent after a successful prefetch verification', async () => {
      useChatStore.setState({ revalidateMessages: realRevalidateMessages });
      const context = { agentId: 'session-id', topicId: 'topic-id' };
      await runMessageListQuery(context, async () => []);

      await act(async () => {
        await useChatStore.getState().revalidateMessages(context);
      });

      expect(isMessageListServerVerified(context)).toBe(true);
      expect(mutate).not.toHaveBeenCalled();
    });

    it('softly revalidates only the exact canonical conversation context', async () => {
      useChatStore.setState({ revalidateMessages: realRevalidateMessages });
      const context = {
        agentId: 'session-id',
        groupId: 'group-id',
        threadId: 'thread-id',
        topicId: 'topic-id',
      };

      await act(async () => {
        await useChatStore.getState().revalidateMessages(context);
      });

      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate).toHaveBeenCalledWith(messageListKey(context));
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

    it('should sync mirrored tool state into the parent assistant tools array', async () => {
      const { result } = renderHook(() => useChatStore());
      const assistantMessage = {
        id: 'assistant-id',
        role: 'assistant',
        content: 'assistant',
        tools: [
          {
            apiName: 'askUserQuestion',
            arguments: '{}',
            id: 'tool-call-id',
            identifier: 'lobe-user-interaction',
            intervention: { status: 'pending' },
          },
        ],
      } as UIChatMessage;
      const toolMessage = {
        id: 'tool-message-id',
        role: 'tool',
        content: '',
        parentId: assistantMessage.id,
        plugin: {
          apiName: 'askUserQuestion',
          arguments: '{}',
          identifier: 'lobe-user-interaction',
          intervention: { status: 'pending' },
        },
        tool_call_id: 'tool-call-id',
      } as UIChatMessage;
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      act(() => {
        useChatStore.setState({
          messagesMap: {
            [messageMapKey({ agentId: 'session-id', topicId: 'topic-id' })]: [
              assistantMessage,
              toolMessage,
            ],
          },
          dbMessagesMap: {
            [messageMapKey({ agentId: 'session-id', topicId: 'topic-id' })]: [
              assistantMessage,
              toolMessage,
            ],
          },
        });
      });

      await act(async () => {
        await result.current.optimisticUpdateMessagePlugin(toolMessage.id, {
          intervention: { status: 'approved' },
        });
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        {
          id: assistantMessage.id,
          tool_call_id: 'tool-call-id',
          type: 'updateMessageTools',
          value: { intervention: { status: 'approved' } },
        },
        undefined,
      );
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

      await act(async () => {
        // Create operation with group context
        result.current.startOperation({
          type: 'sendMessage',
          context: {
            agentId: 'agent1',
            groupId: 'group1',
            topicId: 'topic1',
          },
        });

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

  describe('replaceMessages cache write-through', () => {
    beforeEach(() => {
      (mutate as Mock).mockClear();
    });

    it('seeds the message:list SWR cache for the same bucket without revalidating', async () => {
      const { result } = renderHook(() => useChatStore());

      const context = { agentId: 'wt-agent', topicId: 'wt-topic' };
      const messages = [{ id: 'm1', role: 'user', content: 'hi' }] as any;

      await act(async () => {
        result.current.replaceMessages(messages, { context });
      });

      expect(mutate).toHaveBeenCalledTimes(1);
      const [swrKey, dataArg, options] = (mutate as Mock).mock.calls[0];

      // seeds, never refetches
      expect(options).toEqual({ revalidate: false });
      expect(dataArg).toEqual(messages);
      expect(swrKey).toEqual(messageListKey(context));
      expect(isMessageListServerVerified(context)).toBe(false);
    });

    it('skips write-through when the conversation has no persisted topic', async () => {
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        result.current.replaceMessages([{ id: 'm-new', role: 'user', content: 'hi' }] as any, {
          context: { agentId: 'wt-agent-new', topicId: null },
        });
      });

      expect(mutate).not.toHaveBeenCalled();
    });

    it('skips write-through for scoped buckets the server message:list key cannot represent', async () => {
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        // Page copilot: `documentId` only exists in the local bucket key, so
        // the canonical agent/topic entry must not be created from it.
        result.current.replaceMessages([{ id: 'm-page', role: 'user', content: 'hi' }] as any, {
          context: {
            agentId: 'wt-page-agent',
            documentId: 'doc-1',
            scope: 'page',
            topicId: 'wt-page-topic',
          },
        });

        // Group-agent stream: the canonical key drops `subAgentId`, which
        // would collide with the group main conversation entry.
        result.current.replaceMessages([{ id: 'm-sub', role: 'user', content: 'hi' }] as any, {
          context: {
            agentId: 'wt-supervisor',
            groupId: 'wt-group',
            scope: 'group_agent',
            subAgentId: 'wt-worker',
            topicId: 'wt-group-topic',
          },
        });
      });

      expect(mutate).not.toHaveBeenCalled();
    });

    it('still seeds the canonical entry for a representable group context', async () => {
      const { result } = renderHook(() => useChatStore());

      const context = {
        agentId: 'wt-sup',
        groupId: 'wt-grp',
        scope: 'group' as const,
        topicId: 'wt-grp-topic',
      };
      const messages = [{ id: 'm-grp', role: 'user', content: 'hi' }] as any;

      await act(async () => {
        result.current.replaceMessages(messages, { context });
      });

      expect(mutate).toHaveBeenCalledTimes(1);
      const [swrKey, dataArg, options] = (mutate as Mock).mock.calls[0];
      expect(swrKey).toEqual(messageListKey(context));
      expect(dataArg).toEqual(messages);
      expect(options).toEqual({ revalidate: false });
    });

    it('still seeds the canonical entry for a representable group thread context', async () => {
      const { result } = renderHook(() => useChatStore());

      const context = {
        agentId: 'wt-worker',
        groupId: 'wt-grp',
        scope: 'thread' as const,
        threadId: 'wt-thread',
        topicId: 'wt-grp-topic',
      };
      const messages = [{ id: 'm-thread', role: 'user', content: 'hi' }] as any;

      await act(async () => {
        result.current.replaceMessages(messages, { context });
      });

      expect(mutate).toHaveBeenCalledWith(messageListKey(context), messages, {
        revalidate: false,
      });
    });

    it('skips write-through for the useFetchMessages onData sync path', async () => {
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        result.current.replaceMessages([{ id: 'm2', role: 'user', content: 'hi' }] as any, {
          action: 'useFetchMessages',
          context: { agentId: 'wt-agent-2', topicId: 'wt-topic-2' },
        });
      });

      expect(mutate).not.toHaveBeenCalled();
    });

    it('skips write-through while the context is streaming', async () => {
      const { result } = renderHook(() => useChatStore());

      const context = { agentId: 'wt-agent-3', topicId: 'wt-topic-3' };

      await act(async () => {
        // A running AI-runtime op marks the context as streaming.
        result.current.startOperation({ type: 'execAgentRuntime', context });
      });

      (mutate as Mock).mockClear();

      await act(async () => {
        result.current.replaceMessages([{ id: 'm3', role: 'user', content: 'hi' }] as any, {
          context,
        });
      });

      expect(mutate).not.toHaveBeenCalled();
    });

    it('still seeds the cache when the store-set is a no-op (optimistic echo)', async () => {
      const { result } = renderHook(() => useChatStore());

      const context = { agentId: 'wt-noop', topicId: 'wt-noop-topic' };
      const messages = [{ id: 'm-noop', role: 'user', content: 'hi' }] as any;
      const key = messageMapKey(context);

      // An optimistic dispatch already applied this exact state to the in-memory
      // store, but never touched the SWR cache.
      act(() => {
        useChatStore.setState({ dbMessagesMap: { [key]: messages } });
      });

      (mutate as Mock).mockClear();

      await act(async () => {
        result.current.replaceMessages(messages, {
          action: 'optimisticUpdateMessageContent',
          context,
        });
      });

      // store-set is a no-op (messagesMap bucket never populated)...
      expect(result.current.messagesMap[key]).toBeUndefined();
      // ...but the cache is still seeded so a later switch-back is not stale
      expect(mutate).toHaveBeenCalledTimes(1);
      const [swrKey, dataArg, options] = (mutate as Mock).mock.calls[0];
      expect(options).toEqual({ revalidate: false });
      expect(dataArg).toEqual(messages);
      expect(swrKey).toEqual(messageListKey(context));
    });
  });

  describe('useFetchMessages action', () => {
    it('binds the canonical key, coordinated fetcher, and fetched-data sync', async () => {
      const context = { agentId: 'fetch-agent', topicId: 'fetch-topic' };
      const messages = [{ id: 'fetch-message', role: 'user', content: 'hi' }] as any;
      (messageService.getMessages as Mock).mockResolvedValue(messages);

      renderHook(() =>
        useChatStore.getState().useFetchMessages(context, { revalidateOnFocus: false }),
      );

      expect(useClientDataSWRWithSync).toHaveBeenCalledTimes(1);
      const [key, fetcher, options] = (useClientDataSWRWithSync as Mock).mock.calls[0];
      expect(key).toEqual(messageListKey(context));
      await expect(fetcher()).resolves.toEqual(messages);

      act(() => {
        options.onData(messages);
      });

      expect(useChatStore.getState().dbMessagesMap[messageMapKey(context)]).toEqual(messages);
      expect(options).toEqual(
        expect.objectContaining({
          dedupingInterval: expect.any(Number),
          revalidateIfStale: true,
          revalidateOnFocus: false,
        }),
      );
    });
  });

  describe('prefetchMessages action', () => {
    beforeEach(() => {
      (mutate as Mock).mockClear();
      useChatStore.setState({ dbMessagesMap: {}, messagesMap: {} });
    });

    it('fetches messages in the background and hydrates the message cache', async () => {
      const { result } = renderHook(() => useChatStore());

      const context = {
        agentId: 'prefetch-agent',
        scope: 'main' as const,
        topicId: 'prefetch-topic',
      };
      const messages = [{ id: 'prefetch-message', role: 'user', content: 'hi' }] as any;

      (messageService.getMessages as Mock).mockResolvedValue(messages);

      await act(async () => {
        await result.current.prefetchMessages(context);
      });

      const key = messageMapKey(context);
      expect(messageService.getMessages).toHaveBeenCalledWith({
        agentId: 'prefetch-agent',
        groupId: null,
        threadId: null,
        topicId: 'prefetch-topic',
      });
      expect(result.current.dbMessagesMap[key]).toEqual(messages);
      expect(result.current.messagesMap[key]).toHaveLength(1);

      expect(mutate).toHaveBeenCalledTimes(1);
      const [swrKey, dataArg, options] = (mutate as Mock).mock.calls[0];
      expect(swrKey).toEqual(messageListKey(context));
      await expect(dataArg).resolves.toEqual(messages);
      expect(options).toEqual({ revalidate: false });
    });

    it('swallows a failed background prefetch and allows the same context to retry', async () => {
      const { result } = renderHook(() => useChatStore());
      const context = {
        agentId: 'prefetch-agent',
        scope: 'main' as const,
        topicId: 'failed-topic',
      };

      (messageService.getMessages as Mock).mockRejectedValueOnce(new Error('offline'));

      await act(async () => {
        await result.current.prefetchMessages(context);
      });

      (messageService.getMessages as Mock).mockResolvedValueOnce([]);
      await act(async () => {
        await result.current.prefetchMessages(context);
      });

      expect(messageService.getMessages).toHaveBeenCalledTimes(2);
    });

    it('skips prefetch when the canonical message cache is fresh', async () => {
      const { result } = renderHook(() => useChatStore());
      const context = {
        agentId: 'prefetch-agent',
        scope: 'main' as const,
        topicId: 'fresh-topic',
      };
      await runMessageListQuery(context, async () => []);

      await act(async () => {
        await result.current.prefetchMessages(context);
      });

      expect(messageService.getMessages).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
    });

    it('refreshes an already hydrated bucket with the completed server snapshot', async () => {
      const { result } = renderHook(() => useChatStore());

      const context = {
        agentId: 'prefetch-agent',
        scope: 'main' as const,
        topicId: 'cached-topic',
      };
      const key = messageMapKey(context);
      const serverMessages = [{ id: 'server-message', role: 'assistant', content: 'done' }] as any;

      act(() => {
        useChatStore.setState({
          dbMessagesMap: {
            [key]: [{ id: 'cached-message', role: 'user', content: 'hi' }] as any,
          },
        });
      });
      (messageService.getMessages as Mock).mockResolvedValue(serverMessages);

      await act(async () => {
        await result.current.prefetchMessages(context);
      });

      expect(messageService.getMessages).toHaveBeenCalledWith({
        agentId: 'prefetch-agent',
        groupId: null,
        threadId: null,
        topicId: 'cached-topic',
      });
      expect(result.current.dbMessagesMap[key]).toEqual(serverMessages);
      expect(mutate).toHaveBeenCalledTimes(1);
    });

    it('dedupes simultaneous prefetches for the same message bucket', async () => {
      const { result } = renderHook(() => useChatStore());

      const context = {
        agentId: 'prefetch-agent',
        scope: 'main' as const,
        topicId: 'dedupe-topic',
      };
      const messages = [{ id: 'deduped-message', role: 'user', content: 'hi' }] as any;
      let resolveRequest!: (value: unknown) => void;

      (messageService.getMessages as Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
      );

      const firstPrefetch = result.current.prefetchMessages(context);
      const secondPrefetch = result.current.prefetchMessages(context);

      await Promise.resolve();
      expect(messageService.getMessages).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveRequest(messages);
        await firstPrefetch;
        await secondPrefetch;
      });

      expect(result.current.dbMessagesMap[messageMapKey(context)]).toEqual(messages);
    });

    it('shares an in-flight prefetch with the mounted canonical query', async () => {
      const { result } = renderHook(() => useChatStore());
      const context = {
        agentId: 'prefetch-agent',
        scope: 'main' as const,
        threadId: 'thread-id',
        topicId: 'mount-topic',
      };
      const mountedContext = { ...context, documentId: 'ui-only-field' };
      const messages = [{ id: 'shared-message', role: 'user', content: 'hi' }] as any;
      let resolveRequest!: (value: UIChatMessage[]) => void;
      const serverRequest = new Promise<UIChatMessage[]>((resolve) => {
        resolveRequest = resolve;
      });
      (messageService.getMessages as Mock).mockReturnValue(serverRequest);

      const prefetchPromise = result.current.prefetchMessages(context);
      const mountedQuery = runMessageListQuery(mountedContext, messageService.getMessages);

      await Promise.resolve();
      expect(messageService.getMessages).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveRequest(messages);
        await Promise.all([prefetchPromise, mountedQuery]);
      });

      expect(messageService.getMessages).toHaveBeenCalledTimes(1);
      await expect(mountedQuery).resolves.toEqual(messages);
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
