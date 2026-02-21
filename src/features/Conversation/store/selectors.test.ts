import { describe, expect, it } from 'vitest';

import { DEFAULT_OPERATION_STATE } from '../types/operation';
import { type State } from './initialState';
import { conversationSelectors } from './selectors';

// Helper to create a mock state
const createMockState = (overrides: Partial<State> = {}): State => ({
  // Input state
  editor: null,
  inputMessage: '',

  // MessageState
  messageEditingIds: [],
  messageLoadingIds: [],
  pendingArgsUpdates: new Map(),

  // VirtuaList state
  activeIndex: null,
  atBottom: true,
  isScrolling: false,
  virtuaScrollMethods: null,
  visibleItems: new Map(),

  // Core state
  context: {
    agentId: 'session-1',
    topicId: null,
    threadId: null,
  },
  dbMessages: [],
  displayMessages: [],
  hooks: {},
  messagesInit: false,
  operationState: DEFAULT_OPERATION_STATE,
  skipFetch: false,
  ...overrides,
});

describe('conversationSelectors', () => {
  describe('Context Selectors', () => {
    describe('context', () => {
      it('should return the full context', () => {
        const store = createMockState({
          context: {
            agentId: 'session-1',
            topicId: 'topic-1',
            threadId: 'thread-1',
          },
        });

        const result = conversationSelectors.context(store);

        expect(result).toEqual({
          agentId: 'session-1',
          topicId: 'topic-1',
          threadId: 'thread-1',
        });
      });
    });

    describe('sessionId', () => {
      it('should return sessionId from context', () => {
        const store = createMockState({
          context: { agentId: 'my-session', topicId: null, threadId: null },
        });

        expect(conversationSelectors.agentId(store)).toBe('my-session');
      });
    });

    describe('topicId', () => {
      it('should return topicId when set', () => {
        const store = createMockState({
          context: { agentId: 'session-1', topicId: 'topic-123', threadId: null },
        });

        expect(conversationSelectors.topicId(store)).toBe('topic-123');
      });

      it('should return null when topicId is not set', () => {
        const store = createMockState({
          context: { agentId: 'session-1', topicId: null, threadId: null },
        });

        expect(conversationSelectors.topicId(store)).toBeNull();
      });
    });

    describe('threadId', () => {
      it('should return threadId when set', () => {
        const store = createMockState({
          context: { agentId: 'session-1', topicId: 'topic-1', threadId: 'thread-456' },
        });

        expect(conversationSelectors.threadId(store)).toBe('thread-456');
      });

      it('should return null when threadId is not set', () => {
        const store = createMockState({
          context: { agentId: 'session-1', topicId: null, threadId: null },
        });

        expect(conversationSelectors.threadId(store)).toBeNull();
      });
    });

    describe('isThread', () => {
      it('should return true when threadId is set', () => {
        const store = createMockState({
          context: { agentId: 'session-1', topicId: 'topic-1', threadId: 'thread-1' },
        });

        expect(conversationSelectors.isThread(store)).toBe(true);
      });

      it('should return false when threadId is null', () => {
        const store = createMockState({
          context: { agentId: 'session-1', topicId: 'topic-1', threadId: null },
        });

        expect(conversationSelectors.isThread(store)).toBe(false);
      });
    });

    describe('isTopic', () => {
      it('should return true when topicId is set', () => {
        const store = createMockState({
          context: { agentId: 'session-1', topicId: 'topic-1', threadId: null },
        });

        expect(conversationSelectors.isTopic(store)).toBe(true);
      });

      it('should return false when topicId is null', () => {
        const store = createMockState({
          context: { agentId: 'session-1', topicId: null, threadId: null },
        });

        expect(conversationSelectors.isTopic(store)).toBe(false);
      });
    });
  });

  describe('UI State Selectors', () => {
    describe('editor', () => {
      it('should return editor instance when set', () => {
        const mockEditor = { getJSONState: () => ({}) };
        const store = createMockState({ editor: mockEditor });

        expect(conversationSelectors.editor(store)).toBe(mockEditor);
      });

      it('should return null when editor is not set', () => {
        const store = createMockState({ editor: null });

        expect(conversationSelectors.editor(store)).toBeNull();
      });
    });

    describe('inputMessage', () => {
      it('should return input message', () => {
        const store = createMockState({ inputMessage: 'Hello, world!' });

        expect(conversationSelectors.inputMessage(store)).toBe('Hello, world!');
      });

      it('should return empty string when no input', () => {
        const store = createMockState({ inputMessage: '' });

        expect(conversationSelectors.inputMessage(store)).toBe('');
      });
    });

    describe('hasInput', () => {
      it('should return true when input has content', () => {
        const store = createMockState({ inputMessage: 'Hello' });

        expect(conversationSelectors.hasInput(store)).toBe(true);
      });

      it('should return false when input is empty', () => {
        const store = createMockState({ inputMessage: '' });

        expect(conversationSelectors.hasInput(store)).toBe(false);
      });

      it('should return false when input has only whitespace', () => {
        const store = createMockState({ inputMessage: '   ' });

        expect(conversationSelectors.hasInput(store)).toBe(false);
      });
    });
  });

  describe('Hook Selectors', () => {
    describe('hooks', () => {
      it('should return hooks object', () => {
        const mockHooks = {
          onBeforeSendMessage: async () => true,
          onAfterSendMessage: async () => {},
        };
        const store = createMockState({ hooks: mockHooks });

        expect(conversationSelectors.hooks(store)).toBe(mockHooks);
      });

      it('should return empty object when no hooks', () => {
        const store = createMockState({ hooks: {} });

        expect(conversationSelectors.hooks(store)).toEqual({});
      });
    });

    describe('hook', () => {
      it('should return specific hook when exists', () => {
        const onBeforeSendMessage = async () => true;
        const store = createMockState({
          hooks: { onBeforeSendMessage },
        });

        const hookSelector = conversationSelectors.hook('onBeforeSendMessage');
        expect(hookSelector(store)).toBe(onBeforeSendMessage);
      });

      it('should return undefined when hook does not exist', () => {
        const store = createMockState({ hooks: {} });

        const hookSelector = conversationSelectors.hook('onBeforeSendMessage');
        expect(hookSelector(store)).toBeUndefined();
      });
    });
  });
});
