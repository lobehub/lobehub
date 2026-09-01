import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { agentSelectors } from '@/store/agent/selectors';
import * as agentDispatcher from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';
import * as heterogeneousAgentExecutor from '@/store/chat/slices/agentRun/actions/transports/hetero/heterogeneousAgentExecutor';
import { INPUT_LOADING_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';

import { type ConversationContext, type ConversationHooks } from '../../../types';
import { createStore } from '../../index';
import { MAX_HETERO_AUTO_RETRIES } from './heteroRetryConfig';

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

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      messagesMap: {
        'session-1-': [
          { id: 'msg-1', role: 'user', content: 'Hello' },
          { id: 'msg-2', role: 'assistant', content: 'Hi there', parentId: 'msg-1' },
        ],
      },
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
    })),
    setState: vi.fn(),
  },
}));

describe('Generation Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('stopGenerating', () => {
    it('should cancel all running execAgentRuntime operations', () => {
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
      };

      const store = createStore({ context });

      act(() => {
        store.getState().stopGenerating();
      });

      expect(mockCancelOperations).toHaveBeenCalledWith(
        {
          agentId: 'session-1',
          groupId: undefined,
          isNew: undefined,
          scope: undefined,
          status: 'running',
          threadId: null,
          topicId: 'topic-1',
          type: INPUT_LOADING_OPERATION_TYPES,
        },
        expect.any(String),
      );
    });

    it('should isolate a creating thread from the main conversation in the same topic', () => {
      const editor = { setJSONState: vi.fn() };
      const context: ConversationContext = {
        agentId: 'session-1',
        isNew: true,
        scope: 'thread',
        threadId: null,
        topicId: 'topic-1',
      };

      const store = createStore({ context });
      store.setState({ editor });

      act(() => {
        store.getState().stopGenerating();
      });

      expect(mockCancelOperations).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'session-1',
          isNew: true,
          scope: 'thread',
          threadId: null,
          topicId: 'topic-1',
        }),
        expect.any(String),
      );
      expect(mockCancelSendMessageInServer).toHaveBeenCalledWith(context, editor);
    });

    it('should call onGenerationStop hook', () => {
      const onGenerationStop = vi.fn();
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };
      const hooks: ConversationHooks = { onGenerationStop };

      const store = createStore({ context, hooks });

      act(() => {
        store.getState().stopGenerating();
      });

      expect(onGenerationStop).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelOperation', () => {
    it('should cancel specific operation via ChatStore', () => {
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      act(() => {
        store.getState().cancelOperation('op-1', 'User cancelled');
      });

      expect(mockCancelOperation).toHaveBeenCalledWith('op-1', 'User cancelled');
    });

    it('should call onOperationCancelled hook', () => {
      const onOperationCancelled = vi.fn();
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };
      const hooks: ConversationHooks = { onOperationCancelled };

      const store = createStore({ context, hooks });

      act(() => {
        store.getState().cancelOperation('op-1');
      });

      expect(onOperationCancelled).toHaveBeenCalledWith('op-1');
    });
  });

  describe('clearOperations', () => {
    it('should be a no-op since operations are managed by ChatStore', () => {
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      // clearOperations should be callable without error
      act(() => {
        store.getState().clearOperations();
      });

      // No assertions needed - it's a no-op
    });
  });

  describe('continueGeneration', () => {
    it('should continue generation from assistantGroup message with last child as blockId', async () => {
      // Reset mock to ensure all required functions are available
      vi.mocked(await import('@/store/chat').then((m) => m.useChatStore.getState)).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
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
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
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
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
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
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
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
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
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
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
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
  describe('retryFailedAssistantStep', () => {
    const context: ConversationContext = {
      agentId: 'session-1',
      topicId: 'topic-1',
      threadId: null,
    };

    const mockChatStore = async () => {
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        dbMessagesMap: {},
        operations: {},
        operationsByMessage: {},
        deleteMessage: mockDeleteMessage,
        switchMessageBranch: mockSwitchMessageBranch,
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        executeClientAgent: mockExecuteClientAgent,
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      } as any);
    };

    it('replaces the whole turn when the failed block is the turn only step', async () => {
      await mockChatStore();
      const store = createStore({ context });
      const deleteDBMessage = vi.fn();

      act(() => {
        store.setState({
          deleteDBMessage,
          displayMessages: [
            { id: 'user-1', role: 'user', content: 'Hi' },
            {
              id: 'group-1',
              role: 'assistantGroup',
              content: '',
              parentId: 'user-1',
              children: [{ id: 'group-1', content: '...', error: { type: 'ProviderBizError' } }],
            },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().retryFailedAssistantStep('group-1', 'group-1');
      });

      // Never delete the only block speculatively — that is what destroyed the
      // group and left continueGeneration with nothing to find.
      expect(deleteDBMessage).not.toHaveBeenCalled();
      // The turn is replaced instead: delete-then-regenerate from the user turn.
      expect(mockDeleteMessage).toHaveBeenCalledWith('group-1', { operationId: 'test-op-id' });
      expect(mockExecuteClientAgent).toHaveBeenCalled();
    });

    it('continues in place when the turn has earlier steps to keep', async () => {
      await mockChatStore();
      const store = createStore({ context });
      const deleteDBMessage = vi.fn();

      act(() => {
        store.setState({
          deleteDBMessage,
          displayMessages: [
            { id: 'user-1', role: 'user', content: 'Hi' },
            {
              id: 'group-1',
              role: 'assistantGroup',
              content: '',
              parentId: 'user-1',
              children: [
                { id: 'block-1', content: 'step one' },
                { id: 'block-2', content: '...', error: { type: 'ProviderBizError' } },
              ],
            },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().retryFailedAssistantStep('group-1', 'block-2');
      });

      expect(deleteDBMessage).toHaveBeenCalledWith('block-2');
      expect(mockStartOperation).toHaveBeenCalledWith({
        context: { ...context, messageId: 'group-1' },
        type: 'continue',
      });
      expect(mockExecuteClientAgent).toHaveBeenCalled();
    });

    it('falls back to replacing the turn when continuing turns out to be impossible', async () => {
      await mockChatStore();
      const store = createStore({ context });
      // Deleting the failed block makes the turn stop resolving as a group —
      // observed live, where continueGeneration then bailed on role !==
      // 'assistantGroup' and left the turn dead.
      const deleteDBMessage = vi.fn(async () => {
        act(() => {
          store.setState({
            displayMessages: [
              { id: 'user-1', role: 'user', content: 'Hi' },
              { id: 'group-1', role: 'assistant', content: 'step one', parentId: 'user-1' },
            ],
          } as any);
        });
      });

      act(() => {
        store.setState({
          deleteDBMessage,
          displayMessages: [
            { id: 'user-1', role: 'user', content: 'Hi' },
            {
              id: 'group-1',
              role: 'assistantGroup',
              content: '',
              parentId: 'user-1',
              children: [
                { id: 'group-1', content: 'step one' },
                { id: 'block-2', content: '...', error: { type: 'ProviderBizError' } },
              ],
            },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().retryFailedAssistantStep('group-1', 'block-2');
      });

      expect(deleteDBMessage).toHaveBeenCalledWith('block-2');
      // No `continue` op could be started …
      expect(mockStartOperation).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'continue' }),
      );
      // … so the turn must still end up regenerated rather than silently dead.
      expect(mockStartOperation).toHaveBeenCalledWith({
        context: { ...context, messageId: 'group-1' },
        type: 'regenerate',
      });
      expect(mockExecuteClientAgent).toHaveBeenCalled();
    });

    it('routes a heterogeneous status error to the session-resuming path', async () => {
      await mockChatStore();
      const store = createStore({ context });
      const deleteDBMessage = vi.fn();
      const continueHeteroAfterError = vi.fn();

      act(() => {
        store.setState({
          continueHeteroAfterError,
          deleteDBMessage,
          displayMessages: [
            { id: 'user-1', role: 'user', content: 'Hi' },
            {
              id: 'group-1',
              role: 'assistantGroup',
              content: '',
              parentId: 'user-1',
              children: [
                { id: 'block-1', content: 'step one' },
                {
                  id: 'block-2',
                  content: '...',
                  error: {
                    type: 'ProviderBizError',
                    body: { agentType: 'claude-code', code: 'overloaded' },
                  },
                },
              ],
            },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().retryFailedAssistantStep('group-1', 'block-2');
      });

      expect(continueHeteroAfterError).toHaveBeenCalledWith('group-1');
      expect(deleteDBMessage).not.toHaveBeenCalled();
    });
  });

  describe('delAndRegenerateMessage', () => {
    it('should create operation with context and pass operationId to deleteMessage', async () => {
      // Re-setup mock to ensure all required functions are available
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},

        cancelOperations: mockCancelOperations,
        cancelOperation: mockCancelOperation,
        deleteMessage: mockDeleteMessage,
        switchMessageBranch: mockSwitchMessageBranch,
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

      // Set displayMessages after store creation
      act(() => {
        store.setState({
          displayMessages: [
            { id: 'msg-1', role: 'user', content: 'Hello' },
            { id: 'msg-2', role: 'assistant', content: 'Hi there', parentId: 'msg-1' },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().delAndRegenerateMessage('msg-2');
      });

      // Should create operation with context
      expect(mockStartOperation).toHaveBeenCalledWith({
        context: { ...context, messageId: 'msg-2' },
        type: 'regenerate',
      });

      // Should pass operationId to deleteMessage for correct context isolation
      expect(mockDeleteMessage).toHaveBeenCalledWith('msg-2', { operationId: 'test-op-id' });

      // Should complete operation
      expect(mockCompleteOperation).toHaveBeenCalledWith('test-op-id');
    });

    it('should delete message BEFORE regeneration to prevent message not found issue ()', async () => {
      // This test verifies the fix:
      // When "delete and regenerate" is called, if regeneration happens first,
      // it switches to a new branch, causing the original message to no longer
      // appear in displayMessages. Then deleteMessage cannot find the message
      // and fails silently.
      //
      // The fix: delete first, then regenerate.

      const callOrder: string[] = [];

      // Re-setup mock to track call order
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},

        cancelOperations: mockCancelOperations,
        cancelOperation: mockCancelOperation,
        deleteMessage: vi.fn().mockImplementation(() => {
          callOrder.push('deleteMessage');
          return Promise.resolve();
        }),
        switchMessageBranch: vi.fn().mockImplementation(() => {
          callOrder.push('switchMessageBranch');
          return Promise.resolve();
        }),
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        executeClientAgent: vi.fn().mockImplementation(() => {
          callOrder.push('executeClientAgent');
          return Promise.resolve();
        }),
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      } as any);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
        groupId: 'group-1',
      };

      const store = createStore({ context });

      // Set displayMessages and dbMessages
      act(() => {
        store.setState({
          displayMessages: [
            { id: 'msg-1', role: 'user', content: 'Hello' },
            { id: 'msg-2', role: 'assistant', content: 'Hi there', parentId: 'msg-1' },
          ],
          dbMessages: [
            { id: 'msg-1', role: 'user', content: 'Hello' },
            { id: 'msg-2', role: 'assistant', content: 'Hi there', parentId: 'msg-1' },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().delAndRegenerateMessage('msg-2');
      });

      // CRITICAL: deleteMessage must be called BEFORE switchMessageBranch and executeClientAgent
      // If regeneration (which calls switchMessageBranch) happens first, the message
      // won't be found in displayMessages and deletion will fail silently.
      expect(callOrder[0]).toBe('deleteMessage');
      expect(callOrder).toContain('switchMessageBranch');
      expect(callOrder).toContain('executeClientAgent');

      // Verify deleteMessage is called before any regeneration-related calls
      const deleteIndex = callOrder.indexOf('deleteMessage');
      const switchIndex = callOrder.indexOf('switchMessageBranch');
      const execIndex = callOrder.indexOf('executeClientAgent');

      expect(deleteIndex).toBeLessThan(switchIndex);
      expect(deleteIndex).toBeLessThan(execIndex);
    });

    it('should not proceed if assistant message has no parentId', async () => {
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},

        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        deleteMessage: mockDeleteMessage,
      } as any);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      // Set displayMessages with assistant message that has no parentId
      act(() => {
        store.setState({
          displayMessages: [
            { id: 'msg-1', role: 'assistant', content: 'Hi there' }, // no parentId
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().delAndRegenerateMessage('msg-1');
      });

      // Should not proceed - no operation created, no delete called
      expect(mockStartOperation).not.toHaveBeenCalled();
      expect(mockDeleteMessage).not.toHaveBeenCalled();
    });

    it('completes the retry even if a Stop cancels the outer op during delete (best-effort Stop)', async () => {
      const { useChatStore } = await import('@/store/chat');
      // The outer op is whitelisted (shows Stop); simulate a Stop landing while
      // deleteMessage is in flight by flipping the op to cancelled inside it.
      // The old message is already deleted, so bailing here would be destructive
      // data loss — regeneration must proceed regardless (Stop is best-effort in
      // this sub-second window and applies to the fresh run instead).
      let operationCount = 0;
      const chatState: any = {
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
        cancelOperations: mockCancelOperations,
        cancelOperation: mockCancelOperation,
        switchMessageBranch: mockSwitchMessageBranch,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        startOperation: vi.fn(() => {
          const operationId = operationCount++ === 0 ? 'outer-op-id' : 'inner-op-id';
          chatState.operations[operationId] = { id: operationId, status: 'running' };
          return { operationId };
        }),
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        executeClientAgent: mockExecuteClientAgent,
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      };
      chatState.deleteMessage = vi.fn().mockImplementation(async () => {
        chatState.operations['outer-op-id'] = { id: 'outer-op-id', status: 'cancelled' };
      });
      vi.mocked(useChatStore.getState).mockReturnValue(chatState);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
        groupId: 'group-1',
      };

      const store = createStore({ context });

      act(() => {
        store.setState({
          displayMessages: [
            { id: 'msg-1', role: 'user', content: 'Hello' },
            { id: 'msg-2', role: 'assistant', content: 'Hi there', parentId: 'msg-1' },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().delAndRegenerateMessage('msg-2');
      });

      // Delete ran, and regeneration completes atomically despite the cancelled
      // outer op — no orphaned deletion.
      expect(chatState.deleteMessage).toHaveBeenCalledWith('msg-2', {
        operationId: 'outer-op-id',
      });
      expect(mockExecuteClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          parentMessageId: 'msg-1',
          parentOperationId: 'inner-op-id',
        }),
      );
      expect(mockCompleteOperation).toHaveBeenCalledWith('inner-op-id');
      expect(mockCompleteOperation).toHaveBeenCalledWith('outer-op-id');
    });

    it('regenerates in the originating conversation when the context switches during deletion', async () => {
      const { useChatStore } = await import('@/store/chat');
      const oldContext: ConversationContext = {
        agentId: 'session-1',
        groupId: 'group-1',
        threadId: null,
        topicId: 'topic-old',
      };
      const currentContext: ConversationContext = {
        agentId: 'session-1',
        groupId: 'group-1',
        threadId: null,
        topicId: 'topic-current',
      };
      const oldUserMessage = { content: 'old prompt', id: 'user-old', role: 'user' };
      const oldAssistantMessage = {
        content: 'old response',
        id: 'assistant-old',
        parentId: 'user-old',
        role: 'assistant',
      };
      const currentMessages = [{ content: 'current prompt', id: 'user-current', role: 'user' }];
      const oldContextKey = messageMapKey(oldContext);
      let resolveDelete!: () => void;
      const deleteGate = new Promise<void>((resolve) => {
        resolveDelete = resolve;
      });
      const chatState: any = {
        dbMessagesMap: { [oldContextKey]: [oldUserMessage, oldAssistantMessage] },
        messagesMap: { [oldContextKey]: [oldUserMessage, oldAssistantMessage] },
        operations: {},
        operationsByMessage: {},
        cancelOperations: mockCancelOperations,
        cancelOperation: mockCancelOperation,
        completeOperation: mockCompleteOperation,
        deleteMessage: vi.fn().mockImplementation(async () => {
          await deleteGate;
          chatState.dbMessagesMap[oldContextKey] = [oldUserMessage];
          chatState.messagesMap[oldContextKey] = [oldUserMessage];
        }),
        executeClientAgent: mockExecuteClientAgent,
        failOperation: mockFailOperation,
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        switchMessageBranch: mockSwitchMessageBranch,
      };
      vi.mocked(useChatStore.getState).mockReturnValue(chatState);

      const store = createStore({ context: oldContext });
      store.setState({
        dbMessages: [oldUserMessage, oldAssistantMessage],
        displayMessages: [oldUserMessage, oldAssistantMessage],
      } as any);

      const regeneratePromise = store.getState().delAndRegenerateMessage('assistant-old');

      act(() => {
        store.setState({
          context: currentContext,
          dbMessages: currentMessages,
          displayMessages: currentMessages,
        } as any);
      });

      await act(async () => {
        resolveDelete();
        await regeneratePromise;
      });

      expect(mockSwitchMessageBranch).toHaveBeenCalledWith('user-old', 0, {
        operationId: 'test-op-id',
      });
      expect(mockExecuteClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          context: oldContext,
          messages: [oldUserMessage],
          parentMessageId: 'user-old',
          parentMessageType: 'user',
        }),
      );
      expect(store.getState().context).toEqual(currentContext);
      expect(store.getState().dbMessages).toEqual(currentMessages);
    });

    it('settles the wrapper op via failOperation when regeneration throws (no stuck loading)', async () => {
      const { useChatStore } = await import('@/store/chat');
      let operationCount = 0;
      const executeClientAgent = vi.fn().mockRejectedValue(new Error('boom'));
      const chatState: any = {
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
        cancelOperations: mockCancelOperations,
        cancelOperation: mockCancelOperation,
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        switchMessageBranch: mockSwitchMessageBranch,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        startOperation: vi.fn(() => {
          const operationId = operationCount++ === 0 ? 'outer-op-id' : 'inner-op-id';
          chatState.operations[operationId] = { id: operationId, status: 'running' };
          return { operationId };
        }),
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        executeClientAgent,
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      };
      vi.mocked(useChatStore.getState).mockReturnValue(chatState);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
        groupId: 'group-1',
      };

      const store = createStore({ context });

      act(() => {
        store.setState({
          displayMessages: [
            { id: 'msg-1', role: 'user', content: 'Hello' },
            { id: 'msg-2', role: 'assistant', content: 'Hi there', parentId: 'msg-1' },
          ],
        } as any);
      });

      await act(async () => {
        await expect(store.getState().delAndRegenerateMessage('msg-2')).rejects.toThrow('boom');
      });

      expect(mockFailOperation).toHaveBeenCalledWith(
        'outer-op-id',
        expect.objectContaining({ type: 'RegenerateError' }),
      );
      expect(mockCompleteOperation).not.toHaveBeenCalledWith('outer-op-id');
    });
  });

  describe('delAndResendThreadMessage', () => {
    it('should create operation with context and pass operationId to deleteMessage', async () => {
      // Re-setup mock to ensure startOperation is available
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},

        cancelOperations: mockCancelOperations,
        cancelOperation: mockCancelOperation,
        deleteMessage: mockDeleteMessage,
        switchMessageBranch: mockSwitchMessageBranch,
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        executeClientAgent: mockExecuteClientAgent,
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      } as any);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: 'thread-1',
        groupId: 'group-1',
      };

      const store = createStore({ context });

      // Set displayMessages after store creation
      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
        } as any);
      });

      await act(async () => {
        await store.getState().delAndResendThreadMessage('msg-1');
      });

      // Should create operation with context including threadId
      expect(mockStartOperation).toHaveBeenCalledWith({
        context: { ...context, messageId: 'msg-1' },
        type: 'regenerate',
      });

      // Should pass operationId to deleteMessage
      expect(mockDeleteMessage).toHaveBeenCalledWith('msg-1', { operationId: 'test-op-id' });

      // Should complete operation
      expect(mockCompleteOperation).toHaveBeenCalledWith('test-op-id');
    });
  });

  describe('regenerateUserMessage', () => {
    it('should pass operationId to switchMessageBranch for correct context', async () => {
      // Re-setup mock with all required properties
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},

        cancelOperations: mockCancelOperations,
        cancelOperation: mockCancelOperation,
        deleteMessage: mockDeleteMessage,
        switchMessageBranch: mockSwitchMessageBranch,
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

      // Set displayMessages and dbMessages after store creation
      // dbMessages is used to calculate children count for branch index
      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'user', content: 'Hello', branch: { count: 2 } }],
          dbMessages: [
            { id: 'msg-1', role: 'user', content: 'Hello' },
            { id: 'child-1', role: 'assistant', content: 'Response 1', parentId: 'msg-1' },
            { id: 'child-2', role: 'assistant', content: 'Response 2', parentId: 'msg-1' },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      // Should create operation with context
      expect(mockStartOperation).toHaveBeenCalledWith({
        context: { ...context, messageId: 'msg-1' },
        type: 'regenerate',
      });

      // Should pass operationId to switchMessageBranch
      // nextBranchIndex = childrenCount = 2 (two assistant messages with parentId: 'msg-1')
      expect(mockSwitchMessageBranch).toHaveBeenCalledWith('msg-1', 2, {
        operationId: 'test-op-id',
      });
    });

    it('should pass context to executeClientAgent', async () => {
      // Re-setup mock with all required properties
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},

        cancelOperations: mockCancelOperations,
        cancelOperation: mockCancelOperation,
        deleteMessage: mockDeleteMessage,
        switchMessageBranch: mockSwitchMessageBranch,
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

      // Set displayMessages after store creation
      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      // Should pass full context to executeClientAgent
      expect(mockExecuteClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          parentMessageId: 'msg-1',
          parentMessageType: 'user',
          parentOperationId: 'test-op-id',
        }),
      );
    });

    it('should bail out if the interim op was cancelled during preflight (Stop pressed)', async () => {
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        // Simulate the user hitting Stop during the preflight awaits: stopGenerating
        // has already flipped the interim regenerate op to 'cancelled'.
        operations: { 'test-op-id': { id: 'test-op-id', status: 'cancelled' } },
        operationsByMessage: {},

        cancelOperations: mockCancelOperations,
        cancelOperation: mockCancelOperation,
        deleteMessage: mockDeleteMessage,
        switchMessageBranch: mockSwitchMessageBranch,
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
      };

      const store = createStore({ context });

      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      // The interim op is still created up front (so the input shows loading
      // instantly)...
      expect(mockStartOperation).toHaveBeenCalledWith({
        context: { ...context, messageId: 'msg-1' },
        type: 'regenerate',
      });
      // ...but because Stop cancelled it during preflight, the run must NOT start.
      expect(mockSwitchMessageBranch).not.toHaveBeenCalled();
      expect(mockExecuteClientAgent).not.toHaveBeenCalled();
    });

    it('should bail out if the interim op was cancelled during switchMessageBranch (Stop pressed)', async () => {
      const { useChatStore } = await import('@/store/chat');
      // The op passes the preflight guard as 'running', then a Stop lands while
      // switchMessageBranch is awaiting — flip it to cancelled inside the mock.
      const chatState: any = {
        messagesMap: {},
        operations: { 'test-op-id': { id: 'test-op-id', status: 'running' } },
        operationsByMessage: {},
        dbMessages: [],
        cancelOperations: mockCancelOperations,
        cancelOperation: mockCancelOperation,
        deleteMessage: mockDeleteMessage,
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        executeClientAgent: mockExecuteClientAgent,
        executeGatewayAgent: mockExecuteGatewayAgent,
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      };
      chatState.switchMessageBranch = vi.fn().mockImplementation(async () => {
        chatState.operations = { 'test-op-id': { id: 'test-op-id', status: 'cancelled' } };
      });
      vi.mocked(useChatStore.getState).mockReturnValue(chatState);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
      };

      const store = createStore({ context });

      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      // The branch switch ran (preflight passed), but the Stop during it must
      // stop the runtime from starting.
      expect(chatState.switchMessageBranch).toHaveBeenCalled();
      expect(mockExecuteClientAgent).not.toHaveBeenCalled();
      expect(mockExecuteGatewayAgent).not.toHaveBeenCalled();
    });

    it('should restore mention-based initialContext when regenerating a user message', async () => {
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},

        cancelOperations: mockCancelOperations,
        cancelOperation: mockCancelOperation,
        deleteMessage: mockDeleteMessage,
        switchMessageBranch: mockSwitchMessageBranch,
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
      };

      const store = createStore({ context });

      act(() => {
        store.setState({
          displayMessages: [
            {
              id: 'msg-1',
              role: 'user',
              content: '<mention name="Agent A" id="agent-a" /> hello',
              editorData: {
                root: {
                  type: 'root',
                  children: [
                    {
                      type: 'paragraph',
                      children: [
                        {
                          type: 'mention',
                          label: 'Agent A',
                          metadata: { id: 'agent-a', type: 'agent' },
                        },
                        { type: 'text', text: ' hello' },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      expect(mockExecuteClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: {
            initialContext: {
              mentionedAgents: [{ id: 'agent-a', name: 'Agent A' }],
              selectedTools: [{ identifier: AgentManagementIdentifier, name: 'Agent Management' }],
            },
            phase: 'init',
          },
        }),
      );
    });

    it('should use executeGatewayAgent when gateway mode is enabled', async () => {
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},

        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        isGatewayModeEnabled: vi.fn(() => true),
        executeGatewayAgent: mockExecuteGatewayAgent,
        executeClientAgent: mockExecuteClientAgent,
        switchMessageBranch: mockSwitchMessageBranch,
      } as any);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
      };

      const store = createStore({ context });

      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'user', content: 'Hello world' }],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      // Should switch message branch before gateway call
      expect(mockSwitchMessageBranch).toHaveBeenCalledWith('msg-1', 0, {
        operationId: 'test-op-id',
      });

      // Should call executeGatewayAgent with parentMessageId, original content, and onComplete
      // — and, critically, the wrapper op id. `executeGatewayAgent` completes
      // `parentOperationId` at phase-1 (child runtime op running), which is the
      // only thing that keeps a WS drop before session end from stranding a
      // running `regenerate` op on the user turn. The retry guard reads exactly
      // that op type, so a stranded wrapper would brick retry for the turn
      // permanently (Codex review P1 on this PR).
      expect(mockExecuteGatewayAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          message: 'Hello world',
          parentMessageId: 'msg-1',
          parentOperationId: 'test-op-id',
          onComplete: expect.any(Function),
        }),
      );

      // Should NOT call client-mode executeClientAgent
      expect(mockExecuteClientAgent).not.toHaveBeenCalled();

      // The flow itself must not settle the wrapper — phase-1 handoff belongs
      // to executeGatewayAgent (mocked here), and double-settling would mask a
      // missing handoff.
      expect(mockCompleteOperation).not.toHaveBeenCalled();

      // Simulate gateway session complete
      const onComplete = mockExecuteGatewayAgent.mock.calls[0][0].onComplete;
      onComplete();
      expect(mockCompleteOperation).toHaveBeenCalledWith('test-op-id');
    });

    it('should call onRegenerateComplete hook after gateway regeneration', async () => {
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},

        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        isGatewayModeEnabled: vi.fn(() => true),
        executeGatewayAgent: mockExecuteGatewayAgent,
        switchMessageBranch: mockSwitchMessageBranch,
      } as any);

      const onRegenerateComplete = vi.fn();
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
      };

      const store = createStore({ context, hooks: { onRegenerateComplete } });

      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      // Hook is called via onComplete callback, not directly
      expect(onRegenerateComplete).not.toHaveBeenCalled();

      // Simulate gateway session complete
      const onComplete = mockExecuteGatewayAgent.mock.calls[0][0].onComplete;
      onComplete();
      expect(onRegenerateComplete).toHaveBeenCalledWith('msg-1');
    });

    it('should fall back to client mode when gateway is disabled', async () => {
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},

        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        isGatewayModeEnabled: vi.fn(() => false),
        executeGatewayAgent: mockExecuteGatewayAgent,
        executeClientAgent: mockExecuteClientAgent,
        switchMessageBranch: mockSwitchMessageBranch,
      } as any);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
      };

      const store = createStore({ context });

      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      // Should NOT call executeGatewayAgent
      expect(mockExecuteGatewayAgent).not.toHaveBeenCalled();

      // Should call client-mode executeClientAgent
      expect(mockExecuteClientAgent).toHaveBeenCalled();
    });

    it('should not regenerate if the message already has a running regenerate op', async () => {
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {
          'op-1': {
            id: 'op-1',
            type: 'regenerate',
            status: 'running',
            context: { messageIds: ['msg-1'] },
          },
        },
        operationsByMessage: { 'msg-1': ['op-1'] },
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
      } as any);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      // Set displayMessages after store creation
      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      // Should not create operation if already regenerating
      expect(mockStartOperation).not.toHaveBeenCalled();
    });

    // Regression: the guard used to be `isMessageProcessing` — ANY running op on
    // the message. A stray op that outlived its run (a translate, or a gateway
    // regenerate whose WS dropped non-terminally so `onComplete` never fired)
    // then killed retry for that turn permanently, and silently.
    it('regenerates despite an unrelated running op left on the message', async () => {
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        dbMessagesMap: {},
        operations: {
          'stale-op': {
            id: 'stale-op',
            type: 'translate',
            status: 'running',
            context: { messageIds: ['msg-1'] },
          },
        },
        operationsByMessage: { 'msg-1': ['stale-op'] },
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        switchMessageBranch: mockSwitchMessageBranch,
        executeClientAgent: mockExecuteClientAgent,
        isGatewayModeEnabled: mockIsGatewayModeEnabled,
      } as any);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      expect(mockStartOperation).toHaveBeenCalledWith({
        context: { ...context, messageId: 'msg-1' },
        type: 'regenerate',
      });
      expect(mockExecuteClientAgent).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // CHARACTERIZATION TESTS (lifecycle refactor regression net)
  //
  // These lock the CURRENT behavior of the non-sendMessage entry points so an
  // upcoming lifecycle refactor cannot silently change them. They assert what
  // the code does NOW — including behavior that looks buggy (called out inline).
  // ===========================================================================
  describe('regenerate hetero branch characterization (lifecycle refactor regression net)', () => {
    // The hetero regenerate path lives behind `runtimeType === 'hetero'`. We
    // force that decision (it normally requires desktop + a local CLI provider)
    // by stubbing `selectRuntimeType`, and supply a `heterogeneousProvider` via
    // the agent config selector so the `runtimeType === 'hetero' && provider`
    // guard passes.
    const heterogeneousProvider = { type: 'claude-code' } as any;

    const setupHeteroChatStore = async (overrides: Record<string, any> = {}) => {
      const mockRefreshMessages = vi.fn().mockResolvedValue(undefined);
      const mockAssociateMessageWithOperation = vi.fn();
      const mockHeteroStartOperation = vi
        .fn()
        .mockReturnValueOnce({ operationId: 'regen-op-id' }) // parent regenerate op
        .mockReturnValueOnce({ operationId: 'hetero-op-id' }); // child execHeterogeneousAgent op

      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
        // topicSelectors.getTopicById reads topicDataMap during workingDirectory
        // resolution; an empty map keeps the selector chain from throwing.
        topicDataMap: {},

        startOperation: mockHeteroStartOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        isGatewayModeEnabled: vi.fn(() => false),
        switchMessageBranch: mockSwitchMessageBranch,
        refreshMessages: mockRefreshMessages,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        executeClientAgent: mockExecuteClientAgent,
        executeGatewayAgent: mockExecuteGatewayAgent,
        ...overrides,
      } as any);

      return {
        mockAssociateMessageWithOperation,
        mockHeteroStartOperation,
        mockRefreshMessages,
      };
    };

    let executeHeterogeneousAgentSpy: ReturnType<typeof vi.spyOn>;
    let createMessageSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Force the hetero routing decision.
      vi.spyOn(agentDispatcher, 'selectRuntimeType').mockReturnValue('hetero');
      // Supply a config that carries the hetero provider used by the branch.
      vi.spyOn(agentSelectors, 'getAgentConfigById').mockReturnValue(
        () => ({ agencyConfig: { heterogeneousProvider } }) as any,
      );

      createMessageSpy = vi
        .spyOn(messageService, 'createMessage')
        .mockResolvedValue({ id: 'hetero-assistant-msg', messages: [] } as any) as any;

      executeHeterogeneousAgentSpy = vi
        .spyOn(heterogeneousAgentExecutor, 'executeHeterogeneousAgent')
        .mockResolvedValue(undefined) as any;
    });

    it('routes regenerateUserMessage through executeHeterogeneousAgent with imageList + parentOperationId', async () => {
      const { mockRefreshMessages } = await setupHeteroChatStore();

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
      };

      const store = createStore({ context });

      const originalImageList = [{ id: 'img-1', url: 'data:image/png;base64,xxx' }];
      act(() => {
        store.setState({
          displayMessages: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'Draw a cat',
              imageList: originalImageList,
            },
          ],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      // A fresh assistant row is created branched off the user message.
      expect(createMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'msg-1',
          role: 'assistant',
          provider: 'claude-code',
        }),
      );

      // Store is refreshed so the loading bubble shows while the CLI streams.
      expect(mockRefreshMessages).toHaveBeenCalled();

      // The executor receives the new assistant row id, the original user
      // message's images, the original prompt, and the child hetero op id.
      expect(executeHeterogeneousAgentSpy).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          assistantMessageId: 'hetero-assistant-msg',
          heterogeneousProvider,
          imageList: originalImageList,
          message: 'Draw a cat',
          operationId: 'hetero-op-id',
        }),
      );
    });

    it('regenerates with the topic-pinned heterogeneous model', async () => {
      await setupHeteroChatStore({
        topicDataMap: {
          test: {
            items: [{ id: 'topic-1', model: 'opus', provider: 'claude-code' }],
          },
        },
      });
      const context: ConversationContext = {
        agentId: 'session-1',
        threadId: null,
        topicId: 'topic-1',
      };
      const store = createStore({ context });
      store.setState({
        displayMessages: [{ content: 'Retry with the pinned model', id: 'msg-1', role: 'user' }],
      } as any);

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      expect(executeHeterogeneousAgentSpy).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          heterogeneousProvider: expect.objectContaining({ model: 'opus', type: 'claude-code' }),
        }),
      );
    });

    it('preserves a legacy subscription resume when the Provider Binding Lab is enabled', async () => {
      const previousLab = useUserStore.getState().preference.lab;
      useUserStore.setState((state) => ({
        preference: {
          ...state.preference,
          lab: { ...state.preference.lab, enableAgentProviderBinding: true },
        },
      }));
      await setupHeteroChatStore({
        topicDataMap: {
          test: {
            items: [
              {
                id: 'topic-1',
                metadata: {
                  heteroSessionId: 'legacy-session',
                  workingDirectory: '/repo',
                },
              },
            ],
          },
        },
      });

      const context: ConversationContext = {
        agentId: 'session-1',
        threadId: null,
        topicId: 'topic-1',
      };
      const store = createStore({ context });
      store.setState({
        displayMessages: [{ content: 'Retry me', id: 'msg-1', role: 'user' }],
      } as any);

      try {
        await store.getState().regenerateUserMessage('msg-1');

        expect(executeHeterogeneousAgentSpy).toHaveBeenCalledWith(
          expect.any(Function),
          expect.objectContaining({
            resumeBindingKey: undefined,
            resumeSessionId: 'legacy-session',
            workingDirectory: '/repo',
          }),
        );
      } finally {
        useUserStore.setState((state) => ({
          preference: { ...state.preference, lab: previousLab },
        }));
      }
    });

    it('creates the child execHeterogeneousAgent op as a child of the parent regenerate op', async () => {
      const { mockHeteroStartOperation, mockAssociateMessageWithOperation } =
        await setupHeteroChatStore();

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
      };

      const store = createStore({ context });

      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      // First op: the regenerate op for the user message.
      expect(mockHeteroStartOperation).toHaveBeenNthCalledWith(1, {
        context: { ...context, messageId: 'msg-1' },
        type: 'regenerate',
      });

      // Second op: the execHeterogeneousAgent op parented to the regenerate op.
      expect(mockHeteroStartOperation).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          parentOperationId: 'regen-op-id',
          type: 'execHeterogeneousAgent',
        }),
      );

      // The new assistant row is associated with the child hetero op.
      expect(mockAssociateMessageWithOperation).toHaveBeenCalledWith(
        'hetero-assistant-msg',
        'hetero-op-id',
      );
    });

    it('CURRENT BEHAVIOR: completes the regenerate op AND calls onRegenerateComplete in the hetero branch', async () => {
      // NOTE: This characterizes the actual current behavior of the hetero
      // branch (action.ts ~548-549): after `runHeterogeneousFromExistingMessage`
      // resolves it DOES call `completeOperation(operationId)` and DOES invoke
      // `hooks.onRegenerateComplete(messageId)` — synchronously, unlike the
      // gateway branch which defers both to an async `onComplete` callback.
      // Locked here so the refactor cannot silently flip this without a failing
      // test forcing a deliberate decision.
      const { mockHeteroStartOperation } = await setupHeteroChatStore();
      void mockHeteroStartOperation;

      const onRegenerateComplete = vi.fn();
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
      };

      const store = createStore({ context, hooks: { onRegenerateComplete } });

      act(() => {
        store.setState({
          displayMessages: [{ id: 'msg-1', role: 'user', content: 'Hello' }],
        } as any);
      });

      await act(async () => {
        await store.getState().regenerateUserMessage('msg-1');
      });

      // The parent regenerate op is completed synchronously after the executor.
      expect(mockCompleteOperation).toHaveBeenCalledWith('regen-op-id');
      // And the hook fires synchronously (no deferred onComplete like gateway).
      expect(onRegenerateComplete).toHaveBeenCalledWith('msg-1');
    });
  });

  describe('continue hetero early-return characterization (lifecycle refactor regression net)', () => {
    // continueGenerationMessage bails out early for hetero agents (action.ts
    // ~336): CLIs have no "continue a cut-off response" primitive, so the
    // button is a documented no-op. Lock that no runtime is dispatched.
    beforeEach(() => {
      vi.spyOn(agentDispatcher, 'selectRuntimeType').mockReturnValue('hetero');
      vi.spyOn(agentSelectors, 'getAgentConfigById').mockReturnValue(
        () =>
          ({
            agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
          }) as any,
      );
    });

    it('returns early without starting an operation or dispatching any runtime', async () => {
      const { useChatStore } = await import('@/store/chat');
      vi.mocked(useChatStore.getState).mockReturnValue({
        messagesMap: {},
        operations: {},
        operationsByMessage: {},
        startOperation: mockStartOperation,
        associateMessageWithOperation: mockAssociateMessageWithOperation,
        completeOperation: mockCompleteOperation,
        failOperation: mockFailOperation,
        executeClientAgent: mockExecuteClientAgent,
        executeGatewayAgent: mockExecuteGatewayAgent,
        isGatewayModeEnabled: vi.fn(() => false),
      } as any);

      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
      };

      const store = createStore({ context });

      act(() => {
        store.setState({
          displayMessages: [{ id: 'block-1', role: 'assistant', content: 'partial' }],
        } as any);
      });

      await act(async () => {
        await store.getState().continueGenerationMessage('block-1', 'block-1');
      });

      // Hetero short-circuits BEFORE creating the continue operation.
      expect(mockStartOperation).not.toHaveBeenCalled();
      expect(mockExecuteClientAgent).not.toHaveBeenCalled();
      expect(mockExecuteGatewayAgent).not.toHaveBeenCalled();
    });
  });

  describe('heterogeneous overloaded auto-retry counter', () => {
    const context: ConversationContext = {
      agentId: 'session-1',
      threadId: null,
      topicId: 'topic-1',
    };

    it('increments the counter keyed by parent user message id', () => {
      const store = createStore({ context });

      act(() => {
        store.getState().recordHeteroOverloadRetry('user-1');
        store.getState().recordHeteroOverloadRetry('user-1');
        store.getState().recordHeteroOverloadRetry('user-2');
      });

      expect(store.getState().heteroOverloadRetryAttempts).toEqual({ 'user-1': 2, 'user-2': 1 });
    });

    it('resets a single scope without touching others', () => {
      const store = createStore({ context });

      act(() => {
        store.getState().recordHeteroOverloadRetry('user-1');
        store.getState().recordHeteroOverloadRetry('user-2');
        store.getState().resetHeteroOverloadRetry('user-1');
      });

      expect(store.getState().heteroOverloadRetryAttempts).toEqual({ 'user-2': 1 });
    });

    it('pins the counter to the cap when marked exhausted (cancel)', () => {
      const store = createStore({ context });

      act(() => {
        store.getState().markHeteroOverloadRetryExhausted('user-1');
      });

      expect(store.getState().heteroOverloadRetryAttempts['user-1']).toBe(MAX_HETERO_AUTO_RETRIES);
    });
  });
});
