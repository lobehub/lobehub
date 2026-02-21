import { type UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';

import { createStore } from '../../../index';

// Mock conversation-flow parse function
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

// Mock messageService
vi.mock('@/services/message', () => ({
  messageService: {
    getMessages: vi.fn(),
    updateMessageGroupMetadata: vi.fn(),
    updateMessageMetadata: vi.fn().mockResolvedValue({ success: true, messages: [] }),
  },
}));

// Mock SWR
vi.mock('@/libs/swr', () => ({
  useClientDataSWRWithSync: vi.fn(() => ({ data: undefined, isLoading: true })),
}));

const createTestStore = (options?: { agentId?: string; topicId?: string | null }) =>
  createStore({
    context: {
      agentId: options?.agentId ?? 'test-agent',
      threadId: null,
      topicId: options?.topicId === null ? null : (options?.topicId ?? 'test-topic'),
    },
  });

describe('MessageStateAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('toggleCompressedGroupExpanded', () => {
    it('should toggle expanded state from false to true', async () => {
      const store = createTestStore();

      // Setup: compressedGroup with expanded=false
      const compressedGroup: UIChatMessage = {
        id: 'group-1',
        content: 'Summary content',
        role: 'compressedGroup' as any,
        createdAt: 1000,
        updatedAt: 1000,
        metadata: { expanded: false } as any,
      };
      store.setState({ displayMessages: [compressedGroup] });

      // Mock API response
      const updatedMessages: UIChatMessage[] = [
        { ...compressedGroup, metadata: { expanded: true } as any },
      ];
      vi.mocked(messageService.updateMessageGroupMetadata).mockResolvedValue({
        messages: updatedMessages,
      });

      // Act
      await store.getState().toggleCompressedGroupExpanded('group-1');

      // Assert: optimistic update should have been called
      expect(messageService.updateMessageGroupMetadata).toHaveBeenCalledWith({
        context: {
          agentId: 'test-agent',
          groupId: undefined,
          threadId: null,
          topicId: 'test-topic',
        },
        expanded: true,
        messageGroupId: 'group-1',
      });
    });

    it('should toggle expanded state from true to false', async () => {
      const store = createTestStore();

      // Setup: compressedGroup with expanded=true
      const compressedGroup: UIChatMessage = {
        id: 'group-1',
        content: 'Summary content',
        role: 'compressedGroup' as any,
        createdAt: 1000,
        updatedAt: 1000,
        metadata: { expanded: true } as any,
      };
      store.setState({ displayMessages: [compressedGroup] });

      // Mock API response
      const updatedMessages: UIChatMessage[] = [
        { ...compressedGroup, metadata: { expanded: false } as any },
      ];
      vi.mocked(messageService.updateMessageGroupMetadata).mockResolvedValue({
        messages: updatedMessages,
      });

      // Act
      await store.getState().toggleCompressedGroupExpanded('group-1');

      // Assert
      expect(messageService.updateMessageGroupMetadata).toHaveBeenCalledWith({
        context: {
          agentId: 'test-agent',
          groupId: undefined,
          threadId: null,
          topicId: 'test-topic',
        },
        expanded: false,
        messageGroupId: 'group-1',
      });
    });

    it('should set specific expanded value when provided', async () => {
      const store = createTestStore();

      // Setup: compressedGroup with expanded=false
      const compressedGroup: UIChatMessage = {
        id: 'group-1',
        content: 'Summary content',
        role: 'compressedGroup' as any,
        createdAt: 1000,
        updatedAt: 1000,
        metadata: { expanded: false } as any,
      };
      store.setState({ displayMessages: [compressedGroup] });

      vi.mocked(messageService.updateMessageGroupMetadata).mockResolvedValue({
        messages: [{ ...compressedGroup, metadata: { expanded: true } as any }],
      });

      // Act: explicitly set to true
      await store.getState().toggleCompressedGroupExpanded('group-1', true);

      // Assert
      expect(messageService.updateMessageGroupMetadata).toHaveBeenCalledWith({
        context: {
          agentId: 'test-agent',
          groupId: undefined,
          threadId: null,
          topicId: 'test-topic',
        },
        expanded: true,
        messageGroupId: 'group-1',
      });
    });

    it('should not call API if message does not exist', async () => {
      const store = createTestStore();

      // Act
      await store.getState().toggleCompressedGroupExpanded('nonexistent');

      // Assert
      expect(messageService.updateMessageGroupMetadata).not.toHaveBeenCalled();
    });

    it('should not call API if message is not compressedGroup', async () => {
      const store = createTestStore();

      // Setup: regular user message
      const userMessage: UIChatMessage = {
        id: 'msg-1',
        content: 'Hello',
        role: 'user',
        createdAt: 1000,
        updatedAt: 1000,
      };
      store.setState({ displayMessages: [userMessage] });

      // Act
      await store.getState().toggleCompressedGroupExpanded('msg-1');

      // Assert
      expect(messageService.updateMessageGroupMetadata).not.toHaveBeenCalled();
    });

    it('should not call API if context is missing topicId', async () => {
      const store = createTestStore({ topicId: null });

      // Setup: compressedGroup
      const compressedGroup: UIChatMessage = {
        id: 'group-1',
        content: 'Summary content',
        role: 'compressedGroup' as any,
        createdAt: 1000,
        updatedAt: 1000,
        metadata: { expanded: false } as any,
      };
      // Use shallow merge (default zustand behavior)
      store.setState({ displayMessages: [compressedGroup] });

      // Verify context is still null
      expect(store.getState().context.topicId).toBeNull();

      // Act
      await store.getState().toggleCompressedGroupExpanded('group-1');

      // Assert: should not call API because topicId is null
      expect(messageService.updateMessageGroupMetadata).not.toHaveBeenCalled();
    });

    it('should default to false when metadata.expanded is undefined', async () => {
      const store = createTestStore();

      // Setup: compressedGroup without expanded in metadata
      const compressedGroup: UIChatMessage = {
        id: 'group-1',
        content: 'Summary content',
        role: 'compressedGroup' as any,
        createdAt: 1000,
        updatedAt: 1000,
        metadata: {} as any,
      };
      store.setState({ displayMessages: [compressedGroup] });

      vi.mocked(messageService.updateMessageGroupMetadata).mockResolvedValue({
        messages: [{ ...compressedGroup, metadata: { expanded: true } as any }],
      });

      // Act: toggle from undefined (treated as false) to true
      await store.getState().toggleCompressedGroupExpanded('group-1');

      // Assert: should toggle to true
      expect(messageService.updateMessageGroupMetadata).toHaveBeenCalledWith({
        context: {
          agentId: 'test-agent',
          groupId: undefined,
          threadId: null,
          topicId: 'test-topic',
        },
        expanded: true,
        messageGroupId: 'group-1',
      });
    });

    it('should call replaceMessages with updated data from API', async () => {
      const store = createTestStore();

      // Setup
      const compressedGroup: UIChatMessage = {
        id: 'group-1',
        content: 'Summary content',
        role: 'compressedGroup' as any,
        createdAt: 1000,
        updatedAt: 1000,
        metadata: { expanded: false } as any,
      };
      store.setState({ displayMessages: [compressedGroup] });

      const replaceMessagesSpy = vi.spyOn(store.getState(), 'replaceMessages');

      const updatedMessages: UIChatMessage[] = [
        { ...compressedGroup, metadata: { expanded: true } as any },
      ];
      vi.mocked(messageService.updateMessageGroupMetadata).mockResolvedValue({
        messages: updatedMessages,
      });

      // Act
      await store.getState().toggleCompressedGroupExpanded('group-1');

      // Assert
      expect(replaceMessagesSpy).toHaveBeenCalledWith(updatedMessages);
    });
  });
});
