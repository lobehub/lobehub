import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ConversationContext, type ConversationHooks } from '../../../types';
import { createStore } from '../../index';

vi.mock('@/services/topic', () => ({
  topicService: { branchTopicAtMessage: vi.fn(), cancelRateLimitContinuation: vi.fn() },
}));

// Mock useChatStore
const mockCancelOperations = vi.fn();
const mockCancelOperation = vi.fn();
const mockCancelSendMessageInServer = vi.fn();
const mockRegenerateUserMessage = vi.fn();
const mockRegenerateAssistantMessage = vi.fn();
const mockContinueGenerationMessage = vi.fn();
const mockDeleteMessage = vi.fn();
const mockSwitchMessageBranch = vi.fn();
const mockStartOperation = vi.fn(() => ({ operationId: 'test-op-id' }));
const mockCompleteOperation = vi.fn();
const mockAssociateMessageWithOperation = vi.fn();
const mockFailOperation = vi.fn();
const mockExecuteClientAgent = vi.fn();
const mockIsGatewayModeEnabled = vi.fn(() => false);
const mockExecuteGatewayAgent = vi.fn();
const mockUpdateTopicMetadata = vi.fn();
const mockUpdateTopicStatus = vi.fn();
const mockOpenThreadCreator = vi.fn();
const mockSourceTopic = {
  status: 'scheduled',
  metadata: { scheduledRun: { kind: 'resume_after_rate_limit' } },
};

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      dbMessagesMap: {},
      messagesMap: {
        'session-1-': [
          { id: 'msg-1', role: 'user', content: 'Hello' },
          { id: 'msg-2', role: 'assistant', content: 'Hi there', parentId: 'msg-1' },
        ],
      },
      topicDataMap: {},
      topicDetailMap: { 'source-topic': mockSourceTopic },
      operations: {},
      operationsByMessage: {},

      cancelOperations: mockCancelOperations,
      cancelOperation: mockCancelOperation,
      cancelSendMessageInServer: mockCancelSendMessageInServer,
      regenerateUserMessage: mockRegenerateUserMessage,
      regenerateAssistantMessage: mockRegenerateAssistantMessage,
      continueGenerationMessage: mockContinueGenerationMessage,
      deleteMessage: mockDeleteMessage,
      switchMessageBranch: mockSwitchMessageBranch,
      startOperation: mockStartOperation,
      associateMessageWithOperation: mockAssociateMessageWithOperation,
      completeOperation: mockCompleteOperation,
      failOperation: mockFailOperation,
      executeClientAgent: mockExecuteClientAgent,
      isGatewayModeEnabled: mockIsGatewayModeEnabled,
      executeGatewayAgent: mockExecuteGatewayAgent,
      internal_dispatchTopic: vi.fn(),
      openThreadCreator: mockOpenThreadCreator,
      updateTopicMetadata: mockUpdateTopicMetadata,
      updateTopicStatus: mockUpdateTopicStatus,
    })),
    setState: vi.fn(),
  },
}));

describe('Generation Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSourceTopic.status = 'scheduled';
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('continueGeneration', () => {
    it('should continue generation from assistantGroup message with last child as blockId', async () => {
      // Reset mock to ensure all required functions are available
      vi.mocked(await import('@/store/chat').then((m) => m.useChatStore.getState)).mockReturnValue({
        dbMessagesMap: {},
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
        topicDataMap: {},
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        executeClientAgent: mockExecuteClientAgent,
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      } as any);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
        groupId: 'group-1',
      };

      const store = createStore({ context });

      // Set displayMessages with assistantGroup message containing children
      act(() => {
        store.setState({
          displayMessages: [
            {
              id: 'group-msg-1',
              role: 'assistantGroup',
              content: '',
              children: [
                { id: 'child-1', content: 'First response' },
                { id: 'child-2', content: 'Second response' },
              ],
            },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().continueGeneration('group-msg-1');
      });

      // Should create operation with groupMessageId
      expect(mockStartOperation).toHaveBeenCalledWith({
        context: { ...context, messageId: 'group-msg-1' },
        type: 'continue',
      });

      // Should call executeClientAgent with last child id as parentMessageId
      expect(mockExecuteClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          parentMessageId: 'child-2', // last child's id
          parentMessageType: 'assistantGroup',
          parentOperationId: 'test-op-id',
        }),
      );
    });

    it('should not continue if message is not assistantGroup', async () => {
      // Reset mock to ensure all required functions are available
      vi.mocked(await import('@/store/chat').then((m) => m.useChatStore.getState)).mockReturnValue({
        dbMessagesMap: {},
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
        topicDataMap: {},
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        executeClientAgent: mockExecuteClientAgent,
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      } as any);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      // Set displayMessages with regular assistant message (not assistantGroup)
      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'assistant', content: 'Hello' }],
        } as any);
      });

      await act(async () => {
        await store.getState().continueGeneration('msg-1');
      });

      // Should not create operation if message is not assistantGroup
      expect(mockStartOperation).not.toHaveBeenCalled();
      expect(mockExecuteClientAgent).not.toHaveBeenCalled();
    });

    it('should not continue if assistantGroup has no children', async () => {
      // Reset mock to ensure all required functions are available
      vi.mocked(await import('@/store/chat').then((m) => m.useChatStore.getState)).mockReturnValue({
        dbMessagesMap: {},
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
        topicDataMap: {},
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        executeClientAgent: mockExecuteClientAgent,
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      } as any);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      // Set displayMessages with assistantGroup but no children
      act(() => {
        store.setState({
          displayMessages: [
            { id: 'group-msg-1', role: 'assistantGroup', content: '', children: [] },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().continueGeneration('group-msg-1');
      });

      // Should not create operation if no children
      expect(mockStartOperation).not.toHaveBeenCalled();
      expect(mockExecuteClientAgent).not.toHaveBeenCalled();
    });

    it('should call onBeforeContinue hook and respect false return', async () => {
      // Reset mock to ensure all required functions are available
      vi.mocked(await import('@/store/chat').then((m) => m.useChatStore.getState)).mockReturnValue({
        dbMessagesMap: {},
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
        topicDataMap: {},
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        executeClientAgent: mockExecuteClientAgent,
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      } as any);

      const onBeforeContinue = vi.fn().mockResolvedValue(false);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };
      const hooks: ConversationHooks = { onBeforeContinue };

      const store = createStore({ context, hooks });

      // Set displayMessages with assistantGroup
      act(() => {
        store.setState({
          displayMessages: [
            {
              id: 'group-msg-1',
              role: 'assistantGroup',
              content: '',
              children: [{ id: 'child-1', content: 'Response' }],
            },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().continueGeneration('group-msg-1');
      });

      expect(onBeforeContinue).toHaveBeenCalledWith('group-msg-1');
      // Should not call executeClientAgent if hook returns false
      expect(mockExecuteClientAgent).not.toHaveBeenCalled();
    });

    it('should call onContinueComplete hook after continuation', async () => {
      // Reset mock to ensure all required functions are available
      vi.mocked(await import('@/store/chat').then((m) => m.useChatStore.getState)).mockReturnValue({
        dbMessagesMap: {},
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
        topicDataMap: {},
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        executeClientAgent: mockExecuteClientAgent.mockResolvedValue(undefined),
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      } as any);

      const onContinueComplete = vi.fn();

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };
      const hooks: ConversationHooks = { onContinueComplete };

      const store = createStore({ context, hooks });

      // Set displayMessages with assistantGroup
      act(() => {
        store.setState({
          displayMessages: [
            {
              id: 'group-msg-1',
              role: 'assistantGroup',
              content: '',
              children: [{ id: 'child-1', content: 'Response' }],
            },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().continueGeneration('group-msg-1');
      });

      expect(onContinueComplete).toHaveBeenCalledWith('group-msg-1');
    });

    it('should not continue if message is not found', async () => {
      // Reset mock to ensure all required functions are available
      vi.mocked(await import('@/store/chat').then((m) => m.useChatStore.getState)).mockReturnValue({
        dbMessagesMap: {},
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
        topicDataMap: {},
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        executeClientAgent: mockExecuteClientAgent,
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      } as any);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      // Set empty displayMessages
      act(() => {
        store.setState({
          displayMessages: [],
        } as any);
      });

      await act(async () => {
        await store.getState().continueGeneration('msg-not-exist');
      });

      // Should not create operation if message not found
      expect(mockStartOperation).not.toHaveBeenCalled();
      expect(mockExecuteClientAgent).not.toHaveBeenCalled();
    });
  });

  // Retrying the failed step of a turn used to be "delete the block, then call
  // continueGeneration and hope it still finds a group". Verified live: it did
  // not. Both shapes below deleted the failed step and then created NO operation
  // at all — the answer was gone and nothing was running, with no toast.
});
