import { type UIChatMessage } from '@lobechat/types';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import type { ConversationContext } from '../../../../types';
import { createStore } from '../../../index';

// Mock conversation-flow parse so createStore initialization never reaches a real parser.
vi.mock('@lobechat/conversation-flow', () => ({
  parse: (messages: UIChatMessage[]) => {
    const messageMap: Record<string, UIChatMessage> = {};
    for (const msg of messages) messageMap[msg.id] = msg;
    return { flatList: [...messages].sort((a, b) => a.createdAt - b.createdAt), messageMap };
  },
}));

const createTestStore = (context?: Partial<ConversationContext>) =>
  createStore({
    context: {
      agentId: 'agent-1',
      topicId: 'topic-1',
      threadId: null,
      ...context,
    },
  });

describe('message convenience actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('addAIMessage', () => {
    it('creates an assistant message with its conversation context and the submitted text', async () => {
      const store = createTestStore();
      const createMessage = vi.fn().mockResolvedValue('message-1');
      store.setState({ createMessage });

      await act(async () => {
        await store.getState().addAIMessage('assistant content');
      });

      expect(createMessage).toHaveBeenCalledWith({
        agentId: 'agent-1',
        content: 'assistant content',
        parentId: undefined,
        role: 'assistant',
        threadId: undefined,
        topicId: 'topic-1',
      });
    });

    it('does not forward groupId to createMessage (canary-aligned context)', async () => {
      const store = createTestStore({ groupId: 'group-1', scope: 'group' });
      const createMessage = vi.fn().mockResolvedValue('message-1');
      store.setState({ createMessage });

      await act(async () => {
        await store.getState().addAIMessage('assistant content');
      });

      expect(createMessage).toHaveBeenCalledWith(
        expect.not.objectContaining({ groupId: expect.anything() }),
      );
    });

    it('still allows an empty assistant placeholder', async () => {
      const store = createTestStore();
      const createMessage = vi.fn().mockResolvedValue('message-1');
      store.setState({ createMessage });

      await act(async () => {
        await store.getState().addAIMessage('');
      });

      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: '', role: 'assistant' }),
      );
    });

    it('uses the last display message as the parent id', async () => {
      const store = createTestStore();
      const createMessage = vi.fn().mockResolvedValue('message-1');
      store.setState({
        createMessage,
        displayMessages: [
          { id: 'prev-1', content: 'previous', role: 'user', createdAt: 1, updatedAt: 1 },
        ],
      });

      await act(async () => {
        await store.getState().addAIMessage('assistant content');
      });

      expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'prev-1' }));
    });

    it('fires the onMessageCreated hook for the created assistant message', async () => {
      const onMessageCreated = vi.fn();
      const store = createTestStore();
      const created: UIChatMessage = {
        id: 'message-1',
        content: 'assistant content',
        role: 'assistant',
        createdAt: 1,
        updatedAt: 1,
      };
      store.setState({
        createMessage: vi.fn().mockResolvedValue('message-1'),
        displayMessages: [created],
        hooks: { onMessageCreated },
      });

      await act(async () => {
        await store.getState().addAIMessage('assistant content');
      });

      expect(onMessageCreated).toHaveBeenCalledWith(created);
    });

    it('clears the input after successful creation', async () => {
      const store = createTestStore();
      store.setState({
        createMessage: vi.fn().mockResolvedValue('message-1'),
        inputMessage: 'submitted draft',
      });

      await act(async () => {
        await store.getState().addAIMessage('submitted draft');
      });

      expect(store.getState().inputMessage).toBe('');
    });

    it('does not clear the input when creation fails', async () => {
      const store = createTestStore();
      store.setState({
        createMessage: vi.fn().mockResolvedValue(undefined),
        inputMessage: 'submitted draft',
      });

      await act(async () => {
        await store.getState().addAIMessage('submitted draft');
      });

      expect(store.getState().inputMessage).toBe('submitted draft');
    });
  });

  describe('addUserMessage', () => {
    it('creates a user message with its conversation context, files and the submitted text', async () => {
      const store = createTestStore();
      const createMessage = vi.fn().mockResolvedValue('message-1');
      store.setState({ createMessage });

      await act(async () => {
        await store.getState().addUserMessage({ message: 'user content', fileList: ['file-1'] });
      });

      expect(createMessage).toHaveBeenCalledWith({
        agentId: 'agent-1',
        content: 'user content',
        files: ['file-1'],
        parentId: undefined,
        role: 'user',
        threadId: undefined,
        topicId: 'topic-1',
      });
    });

    it('does not forward groupId to createMessage (canary-aligned context)', async () => {
      const store = createTestStore({ groupId: 'group-1', scope: 'group' });
      const createMessage = vi.fn().mockResolvedValue('message-1');
      store.setState({ createMessage });

      await act(async () => {
        await store.getState().addUserMessage({ message: 'user content' });
      });

      expect(createMessage).toHaveBeenCalledWith(
        expect.not.objectContaining({ groupId: expect.anything() }),
      );
    });

    it('clears the input after successful creation', async () => {
      const store = createTestStore();
      store.setState({
        createMessage: vi.fn().mockResolvedValue('message-1'),
        inputMessage: 'submitted draft',
      });

      await act(async () => {
        await store.getState().addUserMessage({ message: 'submitted draft' });
      });

      expect(store.getState().inputMessage).toBe('');
    });

    it('does not clear the input when creation fails', async () => {
      const store = createTestStore();
      store.setState({
        createMessage: vi.fn().mockResolvedValue(undefined),
        inputMessage: 'submitted draft',
      });

      await act(async () => {
        await store.getState().addUserMessage({ message: 'submitted draft' });
      });

      expect(store.getState().inputMessage).toBe('submitted draft');
    });
  });
});

describe('sendMessage composer ownership', () => {
  it('keeps the active text draft when dispatching a separate voice message', async () => {
    const store = createTestStore();
    const sendMessage = vi.fn().mockResolvedValue({
      assistantMessageId: 'assistant-1',
      userMessageId: 'user-1',
    });
    vi.spyOn(useChatStore, 'getState').mockReturnValue({ sendMessage } as any);
    store.setState({ inputMessage: 'keep this draft' });

    await act(async () => {
      await store.getState().sendMessage({
        files: [
          {
            audioMetadata: {
              codec: 'opus',
              durationMs: 1200,
              mimeType: 'audio/webm;codecs=opus',
            },
            file: new File(['audio'], 'voice.webm', { type: 'audio/webm;codecs=opus' }),
            id: 'audio-1',
            status: 'success',
          },
        ],
        message: '',
        preserveComposer: true,
      });
    });

    expect(store.getState().inputMessage).toBe('keep this draft');
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ preserveComposer: true }));
  });
});
