import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ConversationContext, type ConversationHooks } from '../../../types';
import { createStore } from '../../index';

// Mock dependencies
const mockApproveToolCalling = vi.fn();
const mockRejectAndContinueToolCalling = vi.fn();

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      messagesMap: {},
      operations: {},
      approveToolCalling: mockApproveToolCalling,
      rejectAndContinueToolCalling: mockRejectAndContinueToolCalling,
      cancelOperations: vi.fn(),
      cancelOperation: vi.fn(),
      deleteMessage: vi.fn(),
      modifyMessageContent: vi.fn(),
      copyMessage: vi.fn(),
      toggleMessageEditing: vi.fn(),
      regenerateUserMessage: vi.fn(),
      regenerateAssistantMessage: vi.fn(),
      continueGenerationMessage: vi.fn(),
      optimisticCreateMessage: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  displayMessageSelectors: {
    lastDisplayMessageId: vi.fn(() => 'last-msg-id'),
    getDisplayMessagesByKey: vi.fn(() => () => []),
    findLastMessageId: vi.fn(() => () => 'parent-id'),
    getDisplayMessageById: vi.fn(() => () => ({ content: 'original content' })),
  },
  dbMessageSelectors: {
    dbUserFiles: vi.fn(() => []),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    createMessage: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    updateMessage: vi.fn().mockResolvedValue({ success: true, messages: [] }),
    updateMessageMetadata: vi.fn().mockResolvedValue({ success: true, messages: [] }),
    updateMessagePlugin: vi.fn().mockResolvedValue({ success: true, messages: [] }),
    removeMessage: vi.fn().mockResolvedValue({ success: true, messages: [] }),
    removeMessages: vi.fn().mockResolvedValue({ success: true, messages: [] }),
    removeMessagesByAssistant: vi.fn(),
    updateMessagePluginArguments: vi.fn(),
  },
}));

describe('Tool Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('approveToolCall', () => {
    it('should pass entire context object to ChatStore.approveToolCalling', async () => {
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      await act(async () => {
        await store.getState().approveToolCall('tool-call-1', 'group-1');
      });

      // Verify context is passed as third argument
      expect(mockApproveToolCalling).toHaveBeenCalledWith('tool-call-1', 'group-1', context);
    });

    it('should pass agent_builder scope context correctly', async () => {
      const context: ConversationContext = {
        agentId: 'builder-agent',
        topicId: 'builder-topic',
        threadId: 'builder-thread',
        scope: 'agent_builder',
      };

      const store = createStore({ context });

      await act(async () => {
        await store.getState().approveToolCall('tool-call-1', 'group-1');
      });

      // Verify entire context object is passed (including scope)
      expect(mockApproveToolCalling).toHaveBeenCalledWith('tool-call-1', 'group-1', context);
    });

    it('should call onToolApproved hook before approval', async () => {
      const onToolApproved = vi.fn().mockResolvedValue(true);
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };
      const hooks: ConversationHooks = { onToolApproved };

      const store = createStore({ context, hooks });

      await act(async () => {
        await store.getState().approveToolCall('tool-call-1', 'group-1');
      });

      expect(onToolApproved).toHaveBeenCalledWith('tool-call-1');
      expect(mockApproveToolCalling).toHaveBeenCalledWith('tool-call-1', 'group-1', context);
    });

    it('should respect onToolApproved hook returning false', async () => {
      const onToolApproved = vi.fn().mockResolvedValue(false);
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };
      const hooks: ConversationHooks = { onToolApproved };

      const store = createStore({ context, hooks });

      await act(async () => {
        await store.getState().approveToolCall('tool-call-1', 'group-1');
      });

      expect(onToolApproved).toHaveBeenCalledWith('tool-call-1');
      expect(mockApproveToolCalling).not.toHaveBeenCalled();
    });

    it('should call onToolCallComplete hook after approval', async () => {
      const onToolCallComplete = vi.fn();
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };
      const hooks: ConversationHooks = { onToolCallComplete };

      const store = createStore({ context, hooks });

      await act(async () => {
        await store.getState().approveToolCall('tool-call-1', 'group-1');
      });

      expect(onToolCallComplete).toHaveBeenCalledWith('tool-call-1', undefined);
    });
  });

  describe('rejectToolCall', () => {
    it('should call onToolRejected hook before rejection', async () => {
      const onToolRejected = vi.fn().mockResolvedValue(true);
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };
      const hooks: ConversationHooks = { onToolRejected };

      const store = createStore({ context, hooks });

      await act(async () => {
        await store.getState().rejectToolCall('tool-call-1', 'Reason');
      });

      expect(onToolRejected).toHaveBeenCalledWith('tool-call-1', 'Reason');
    });

    it('should respect onToolRejected hook returning false', async () => {
      const onToolRejected = vi.fn().mockResolvedValue(false);
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };
      const hooks: ConversationHooks = { onToolRejected };

      const store = createStore({ context, hooks });

      await act(async () => {
        await store.getState().rejectToolCall('tool-call-1', 'Reason');
      });

      expect(onToolRejected).toHaveBeenCalledWith('tool-call-1', 'Reason');
      // Should not proceed when hook returns false
    });
  });

  describe('rejectAndContinueToolCall', () => {
    it('should pass entire context object to ChatStore.rejectAndContinueToolCalling', async () => {
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      await act(async () => {
        await store.getState().rejectAndContinueToolCall('tool-call-1', 'Reason');
      });

      // Verify context is passed as third argument
      expect(mockRejectAndContinueToolCalling).toHaveBeenCalledWith(
        'tool-call-1',
        'Reason',
        context,
      );
    });

    it('should pass agent_builder scope context correctly', async () => {
      const context: ConversationContext = {
        agentId: 'builder-agent',
        topicId: 'builder-topic',
        threadId: 'builder-thread',
        scope: 'agent_builder',
      };

      const store = createStore({ context });

      await act(async () => {
        await store.getState().rejectAndContinueToolCall('tool-call-1', 'User rejected');
      });

      // Verify entire context object is passed (including scope)
      expect(mockRejectAndContinueToolCalling).toHaveBeenCalledWith(
        'tool-call-1',
        'User rejected',
        context,
      );
    });

    it('should pass context with undefined reason', async () => {
      const context: ConversationContext = {
        agentId: 'builder-agent',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      await act(async () => {
        await store.getState().rejectAndContinueToolCall('tool-call-1');
      });

      // Verify context is passed even with undefined reason
      expect(mockRejectAndContinueToolCalling).toHaveBeenCalledWith(
        'tool-call-1',
        undefined,
        context,
      );
    });
  });

  describe('waitForPendingArgsUpdate integration', () => {
    it('approveToolCall should wait for pending args update before proceeding', async () => {
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      // Manually set a pending promise in the store
      let resolvePending: () => void;
      const pendingPromise = new Promise<void>((resolve) => {
        resolvePending = resolve;
      });

      act(() => {
        store.setState({
          pendingArgsUpdates: new Map([['tool-call-1', pendingPromise]]),
        });
      });

      // Start approve (should wait for pending promise)
      let approveFinished = false;
      const approveAction = act(async () => {
        await store.getState().approveToolCall('tool-call-1', 'group-1');
        approveFinished = true;
      });

      // Give time for approve to start waiting
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Approve should not have finished yet (waiting for pending promise)
      expect(approveFinished).toBe(false);
      expect(mockApproveToolCalling).not.toHaveBeenCalled();

      // Resolve the pending promise
      resolvePending!();
      await approveAction;

      // Now approve should have finished
      expect(approveFinished).toBe(true);
      expect(mockApproveToolCalling).toHaveBeenCalledWith('tool-call-1', 'group-1', context);
    });

    it('rejectToolCall should wait for pending args update before proceeding', async () => {
      const onToolRejected = vi.fn().mockResolvedValue(true);
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };
      const hooks: ConversationHooks = { onToolRejected };

      const store = createStore({ context, hooks });

      // Manually set a pending promise in the store
      let resolvePending: () => void;
      const pendingPromise = new Promise<void>((resolve) => {
        resolvePending = resolve;
      });

      act(() => {
        store.setState({
          pendingArgsUpdates: new Map([['tool-call-1', pendingPromise]]),
        });
      });

      // Start reject (should wait for pending promise)
      let rejectFinished = false;
      const rejectAction = act(async () => {
        await store.getState().rejectToolCall('tool-call-1', 'Reason');
        rejectFinished = true;
      });

      // Give time for reject to start waiting
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Reject should not have finished yet (waiting for pending promise)
      expect(rejectFinished).toBe(false);
      expect(onToolRejected).not.toHaveBeenCalled();

      // Resolve the pending promise
      resolvePending!();
      await rejectAction;

      // Now reject should have finished
      expect(rejectFinished).toBe(true);
      expect(onToolRejected).toHaveBeenCalledWith('tool-call-1', 'Reason');
    });

    it('rejectAndContinueToolCall should wait for pending args update before proceeding', async () => {
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const store = createStore({ context });

      // Manually set a pending promise in the store
      let resolvePending: () => void;
      const pendingPromise = new Promise<void>((resolve) => {
        resolvePending = resolve;
      });

      act(() => {
        store.setState({
          pendingArgsUpdates: new Map([['tool-call-1', pendingPromise]]),
        });
      });

      // Start rejectAndContinue (should wait for pending promise)
      let rejectFinished = false;
      const rejectAction = act(async () => {
        await store.getState().rejectAndContinueToolCall('tool-call-1', 'Reason');
        rejectFinished = true;
      });

      // Give time for reject to start waiting
      await new Promise((resolve) => setTimeout(resolve, 10));

      // RejectAndContinue should not have finished yet (waiting for pending promise)
      expect(rejectFinished).toBe(false);
      expect(mockRejectAndContinueToolCalling).not.toHaveBeenCalled();

      // Resolve the pending promise
      resolvePending!();
      await rejectAction;

      // Now rejectAndContinue should have finished
      expect(rejectFinished).toBe(true);
      expect(mockRejectAndContinueToolCalling).toHaveBeenCalledWith(
        'tool-call-1',
        'Reason',
        context,
      );
    });
  });
});
