import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from './store';
import { type ConversationContext, type ConversationHooks } from './types';

// Mock dependencies
vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      messagesMap: {},
      operations: {},
      optimisticCreateMessage: vi.fn(),
      optimisticCreateTmpMessage: vi.fn(),
      internal_toggleMessageLoading: vi.fn(),
      startOperation: vi.fn(() => ({
        operationId: 'test-op-id',
        abortController: new AbortController(),
      })),
      completeOperation: vi.fn(),
      cancelOperation: vi.fn(),
      cancelOperations: vi.fn(),
      failOperation: vi.fn(),
      deleteMessage: vi.fn(),
      modifyMessageContent: vi.fn(),
      copyMessage: vi.fn(),
      toggleMessageEditing: vi.fn(),
      regenerateUserMessage: vi.fn(),
      regenerateAssistantMessage: vi.fn(),
      continueGenerationMessage: vi.fn(),
      approveToolCalling: vi.fn(),
      rejectToolCalling: vi.fn(),
      switchMessageBranch: vi.fn(),
      updateOperationMetadata: vi.fn(),
      associateMessageWithOperation: vi.fn(),
      replaceMessages: vi.fn(),
      internal_dispatchMessage: vi.fn(),
      internal_dispatchTopic: vi.fn(),
      internal_execAgentRuntime: vi.fn(),
      switchTopic: vi.fn(),
      summaryTopicTitle: vi.fn(),
      internal_updateTopicLoading: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: vi.fn(() => ({
    addFilesToAgent: vi.fn(),
  })),
  agentSelectors: {
    currentAgentConfig: vi.fn(() => ({ model: 'gpt-4', provider: 'openai' })),
  },
}));

vi.mock('@/store/agent/selectors', () => ({
  agentChatConfigSelectors: {
    currentChatConfig: vi.fn(() => ({
      enableAutoCreateTopic: false,
      autoCreateTopicThreshold: 5,
    })),
  },
  agentSelectors: {
    currentAgentConfig: vi.fn(() => ({ model: 'gpt-4', provider: 'openai' })),
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
  topicSelectors: {
    getTopicById: vi.fn(() => () => null),
  },
}));

vi.mock('@/store/file/store', () => ({
  getFileStoreState: vi.fn(() => ({
    chatUploadFileList: [],
  })),
}));

vi.mock('@/store/session', () => ({
  getSessionStoreState: vi.fn(() => ({
    triggerSessionUpdate: vi.fn(),
  })),
}));

vi.mock('@/services/aiChat', () => ({
  aiChatService: {
    sendMessageInServer: vi.fn(),
  },
}));

vi.mock('@/store/chat/utils/messageMapKey', () => ({
  messageMapKey: vi.fn((sessionId, topicId) => `${sessionId}-${topicId ?? ''}`),
}));

describe('ConversationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('createStore', () => {
    it('should create a store with correct initial state', () => {
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: null,
      };

      const store = createStore({ context });
      const state = store.getState();

      expect(state.context).toEqual(context);
      expect(state.inputMessage).toBe('');
      expect(state.editor).toBeNull();
      expect(state.hooks).toEqual({});
    });

    it('should create store with custom hooks', () => {
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const hooks: ConversationHooks = {
        onBeforeSendMessage: vi.fn(),
        onAfterSendMessage: vi.fn(),
      };

      const store = createStore({ context, hooks });
      const state = store.getState();

      expect(state.hooks).toBe(hooks);
      expect(state.hooks.onBeforeSendMessage).toBeDefined();
      expect(state.hooks.onAfterSendMessage).toBeDefined();
    });

    it('should create store with thread context', () => {
      const context: ConversationContext = {
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: 'thread-1',
      };

      const store = createStore({ context });
      const state = store.getState();

      expect(state.context.threadId).toBe('thread-1');
    });

    it('should create store with group scope context', () => {
      const context: ConversationContext = {
        agentId: 'agent-1',
        groupId: 'group-1',
        topicId: 'topic-1',
        threadId: null,
        scope: 'group',
      };

      const store = createStore({ context });
      const state = store.getState();

      expect(state.context.scope).toBe('group');
      expect(state.context.groupId).toBe('group-1');
      expect(state.context.agentId).toBe('agent-1');
    });

    it('should create store with group_agent scope context', () => {
      const context: ConversationContext = {
        agentId: 'agent-1',
        groupId: 'group-1',
        topicId: 'topic-1',
        threadId: 'agent-topic-1',
        scope: 'group_agent',
      };

      const store = createStore({ context });
      const state = store.getState();

      expect(state.context.scope).toBe('group_agent');
      expect(state.context.groupId).toBe('group-1');
      expect(state.context.threadId).toBe('agent-topic-1');
    });
  });

  describe('UI Actions', () => {
    describe('updateInputMessage', () => {
      it('should update input message', () => {
        const context: ConversationContext = {
          agentId: 'session-1',
          topicId: null,
          threadId: null,
        };

        const store = createStore({ context });

        act(() => {
          store.getState().updateInputMessage('Hello, world!');
        });

        expect(store.getState().inputMessage).toBe('Hello, world!');
      });

      it('should handle empty message', () => {
        const context: ConversationContext = {
          agentId: 'session-1',
          topicId: null,
          threadId: null,
        };

        const store = createStore({ context });

        act(() => {
          store.getState().updateInputMessage('Hello');
          store.getState().updateInputMessage('');
        });

        expect(store.getState().inputMessage).toBe('');
      });
    });

    describe('setEditor', () => {
      it('should set editor instance', () => {
        const context: ConversationContext = {
          agentId: 'session-1',
          topicId: null,
          threadId: null,
        };

        const store = createStore({ context });
        const mockEditor = { getJSONState: vi.fn() };

        act(() => {
          store.getState().setEditor(mockEditor);
        });

        expect(store.getState().editor).toBe(mockEditor);
      });

      it('should allow setting editor to null', () => {
        const context: ConversationContext = {
          agentId: 'session-1',
          topicId: null,
          threadId: null,
        };

        const store = createStore({ context });
        const mockEditor = { getJSONState: vi.fn() };

        act(() => {
          store.getState().setEditor(mockEditor);
          store.getState().setEditor(null);
        });

        expect(store.getState().editor).toBeNull();
      });
    });

    describe('cleanupInput', () => {
      it('should reset input state on cleanupInput', () => {
        const context: ConversationContext = {
          agentId: 'session-1',
          topicId: null,
          threadId: null,
        };

        const store = createStore({ context });
        const mockEditor = { getJSONState: vi.fn() };

        act(() => {
          store.getState().updateInputMessage('Hello');
          store.getState().setEditor(mockEditor);
        });

        expect(store.getState().inputMessage).toBe('Hello');
        expect(store.getState().editor).toBe(mockEditor);

        act(() => {
          store.getState().cleanupInput();
        });

        expect(store.getState().inputMessage).toBe('');
        expect(store.getState().editor).toBeNull();
      });
    });
  });

  describe('Store Isolation', () => {
    it('should create independent store instances', () => {
      const context1: ConversationContext = {
        agentId: 'session-1',
        topicId: null,
        threadId: null,
      };

      const context2: ConversationContext = {
        agentId: 'session-2',
        topicId: null,
        threadId: null,
      };

      const store1 = createStore({ context: context1 });
      const store2 = createStore({ context: context2 });

      act(() => {
        store1.getState().updateInputMessage('Message 1');
        store2.getState().updateInputMessage('Message 2');
      });

      expect(store1.getState().inputMessage).toBe('Message 1');
      expect(store2.getState().inputMessage).toBe('Message 2');
      expect(store1.getState().context.agentId).toBe('session-1');
      expect(store2.getState().context.agentId).toBe('session-2');
    });

    it('should isolate stores with different scopes', () => {
      const mainContext: ConversationContext = {
        agentId: 'agent-1',
        topicId: 'topic-1',
        threadId: null,
        scope: 'main',
      };

      const groupContext: ConversationContext = {
        agentId: 'agent-1',
        groupId: 'group-1',
        topicId: 'topic-1',
        threadId: null,
        scope: 'group',
      };

      const store1 = createStore({ context: mainContext });
      const store2 = createStore({ context: groupContext });

      act(() => {
        store1.getState().updateInputMessage('Main message');
        store2.getState().updateInputMessage('Group message');
      });

      expect(store1.getState().inputMessage).toBe('Main message');
      expect(store2.getState().inputMessage).toBe('Group message');
      expect(store1.getState().context.scope).toBe('main');
      expect(store2.getState().context.scope).toBe('group');
      expect(store2.getState().context.groupId).toBe('group-1');
    });

    it('should isolate group and group_agent stores', () => {
      const groupContext: ConversationContext = {
        agentId: 'agent-1',
        groupId: 'group-1',
        topicId: 'topic-1',
        threadId: null,
        scope: 'group',
      };

      const groupAgentContext: ConversationContext = {
        agentId: 'agent-1',
        groupId: 'group-1',
        topicId: 'topic-1',
        threadId: 'agent-topic-1',
        scope: 'group_agent',
      };

      const store1 = createStore({ context: groupContext });
      const store2 = createStore({ context: groupAgentContext });

      act(() => {
        store1.getState().updateInputMessage('Group main');
        store2.getState().updateInputMessage('Group agent');
      });

      expect(store1.getState().inputMessage).toBe('Group main');
      expect(store2.getState().inputMessage).toBe('Group agent');
      expect(store1.getState().context.scope).toBe('group');
      expect(store2.getState().context.scope).toBe('group_agent');
      expect(store1.getState().context.groupId).toBe('group-1');
      expect(store2.getState().context.groupId).toBe('group-1');
      expect(store1.getState().context.threadId).toBeNull();
      expect(store2.getState().context.threadId).toBe('agent-topic-1');
    });
  });
});
