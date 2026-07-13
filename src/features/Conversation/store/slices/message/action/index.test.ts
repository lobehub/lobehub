import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationContext } from '../../../../types';
import { createStore } from '../../../index';

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

  it('creates an assistant message with its conversation context', async () => {
    const store = createTestStore({
      groupId: 'group-1',
      scope: 'group',
    });
    const createMessage = vi.fn().mockResolvedValue('message-1');
    store.setState({ createMessage });

    await act(async () => {
      await store.getState().addAIMessage('assistant content');
    });

    expect(createMessage).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: 'assistant content',
      groupId: 'group-1',
      parentId: undefined,
      role: 'assistant',
      threadId: undefined,
      topicId: 'topic-1',
    });
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

  it('does not clear a newer draft after message creation finishes', async () => {
    let resolveCreateMessage: (id: string) => void;
    const createMessageResult = new Promise<string>((resolve) => {
      resolveCreateMessage = resolve;
    });
    const store = createTestStore();
    const createMessage = vi.fn().mockReturnValue(createMessageResult);
    store.setState({ createMessage, inputMessage: 'submitted draft' });

    const createPromise = store.getState().addAIMessage('submitted draft');
    act(() => store.getState().updateInputMessage('new draft'));
    resolveCreateMessage!('message-1');
    await act(async () => createPromise);

    expect(store.getState().inputMessage).toBe('new draft');
  });

  it('clears the submitted draft after successful creation', async () => {
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
});
