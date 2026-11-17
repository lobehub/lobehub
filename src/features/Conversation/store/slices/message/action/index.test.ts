import { type UIChatMessage } from '@lobechat/types';
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { mcpAppContext } from '@/store/mcpApp/context';

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

describe('sendMessage composer ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('uses an explicit migrated context without forwarding the old provider messages', async () => {
    const store = createTestStore({ topicId: null });
    const sendMessage = vi.fn().mockResolvedValue({
      assistantMessageId: 'assistant-1',
      userMessageId: 'user-1',
    });
    vi.spyOn(useChatStore, 'getState').mockReturnValue({ sendMessage } as any);
    store.setState({
      displayMessages: [
        {
          content: 'stale new-topic message',
          createdAt: 1,
          id: 'old-message',
          role: 'user',
          updatedAt: 1,
        },
      ],
    });
    const targetContext = { agentId: 'agent-1', threadId: null, topicId: 'topic-created' };

    await act(async () => {
      await store.getState().sendMessage({
        conversationContext: targetContext,
        files: [],
        message: 'voice follow-up',
        preserveComposer: true,
      });
    });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ context: targetContext, message: 'voice follow-up' }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.not.objectContaining({ messages: expect.anything() }),
    );
  });

  it('does not clear or dispatch the draft when cancellation happens inside the before-send hook', async () => {
    const store = createTestStore();
    const sendMessage = vi.fn();
    const controller = new AbortController();
    const abortError = new DOMException('cancelled', 'AbortError');
    let releaseHook!: (allowed: boolean) => void;
    const onBeforeSendMessage = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          releaseHook = resolve;
        }),
    );
    vi.spyOn(useChatStore, 'getState').mockReturnValue({ sendMessage } as any);
    store.setState({
      hooks: { onBeforeSendMessage },
      inputMessage: 'keep this draft',
    });

    const result = store.getState().sendMessage({
      message: 'draft',
      signal: controller.signal,
    });
    controller.abort(abortError);
    releaseHook(true);

    await expect(result).rejects.toBe(abortError);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.getState().inputMessage).toBe('keep this draft');
  });
});

describe('MCP App context dispatch', () => {
  afterEach(() => vi.restoreAllMocks());
  it('preserves the original request shape when no enabled app context exists', async () => {
    const store = createTestStore();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useChatStore, 'getState').mockReturnValue({ sendMessage } as any);
    vi.spyOn(mcpAppContext, 'take').mockReturnValue({ selections: [], restore: vi.fn() });
    await store.getState().sendMessage({ message: 'hello' });
    expect(sendMessage.mock.calls[0][0]).not.toHaveProperty('contextSelections');
    expect(sendMessage.mock.calls[0][0]).not.toHaveProperty('onPreflightFailure');
    expect(sendMessage.mock.calls[0][0]).not.toHaveProperty('onMessageAccepted');
  });
  it('attaches the snapshot and restores it on a failed send', async () => {
    const selection = {
      id: 'view',
      source: 'mcpApp' as const,
      identifier: 'notes',
      content: 'selected',
    };
    const restore = vi.fn();
    const store = createTestStore();
    const sendMessage = vi.fn().mockRejectedValue(new Error('offline'));
    vi.spyOn(useChatStore, 'getState').mockReturnValue({ sendMessage } as any);
    vi.spyOn(mcpAppContext, 'take').mockReturnValue({ selections: [selection], restore });
    await expect(store.getState().sendMessage({ message: 'hello' })).rejects.toThrow('offline');
    expect(sendMessage.mock.calls[0][0].contextSelections).toEqual([selection]);
    expect(restore).toHaveBeenCalledOnce();
  });
  it('keeps the snapshot for the next message when a command stores none', async () => {
    const selection = {
      id: 'view',
      source: 'mcpApp' as const,
      identifier: 'notes',
      content: 'ctx',
    };
    const restore = vi.fn();
    const store = createTestStore();
    // `/compact` compresses history and returns without accepting a message
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useChatStore, 'getState').mockReturnValue({ sendMessage } as any);
    vi.spyOn(mcpAppContext, 'take').mockReturnValue({ selections: [selection], restore });
    await store.getState().sendMessage({ message: '/compact' });
    expect(restore).toHaveBeenCalledOnce();
  });
  it('spends the snapshot on an accepted message', async () => {
    const selection = {
      id: 'view',
      source: 'mcpApp' as const,
      identifier: 'notes',
      content: 'ctx',
    };
    const restore = vi.fn();
    const onMessageAccepted = vi.fn();
    const store = createTestStore();
    const sendMessage = vi.fn(async (params: { onMessageAccepted?: () => void }) => {
      params.onMessageAccepted?.();
      return undefined;
    });
    vi.spyOn(useChatStore, 'getState').mockReturnValue({ sendMessage } as any);
    vi.spyOn(mcpAppContext, 'take').mockReturnValue({ selections: [selection], restore });
    await store.getState().sendMessage({ message: 'hello', onMessageAccepted });
    expect(restore).not.toHaveBeenCalled();
    expect(onMessageAccepted).toHaveBeenCalledOnce();
  });
});
