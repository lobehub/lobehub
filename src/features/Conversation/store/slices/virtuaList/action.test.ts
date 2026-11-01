import { type UIChatMessage } from '@lobechat/types';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createStore } from '../../index';
import { type VirtuaScrollMethods } from './initialState';

vi.mock('@lobechat/conversation-flow', () => ({
  parse: (messages: UIChatMessage[]) => ({
    flatList: messages,
    messageMap: Object.fromEntries(messages.map((m) => [m.id, m])),
  }),
}));

const messages = [
  { content: 'hi', createdAt: 1, id: 'u1', role: 'user', updatedAt: 1 },
  { content: 'hello', createdAt: 2, id: 'a1', role: 'assistant', updatedAt: 2 },
] as UIChatMessage[];

const createScrollMethods = (): VirtuaScrollMethods => ({
  getItemOffset: vi.fn(),
  getItemSize: vi.fn(),
  getScrollElement: vi.fn(() => null),
  getScrollOffset: vi.fn(),
  getScrollSize: vi.fn(),
  getTotalCount: vi.fn(() => 2),
  getViewportSize: vi.fn(),
  scrollTo: vi.fn(),
  scrollToEnd: vi.fn(),
  scrollToIndex: vi.fn(),
});

const createStoreWithMethods = () => {
  const store = createStore({ context: { agentId: 'agent', threadId: null, topicId: null } });
  const methods = createScrollMethods();
  act(() => {
    store.getState().replaceMessages(messages);
    store.getState().registerVirtuaScrollMethods(methods);
  });
  return { methods, store };
};

describe('scrollToBottom', () => {
  it('follows streaming with a one-shot jump instead of a virtua imperative scroll', () => {
    // Regression: virtua's scrollToIndex re-applies its target on every item
    // resize within 150ms, so streaming kept pulling a user who scrolled up
    // back to the bottom.
    const { methods, store } = createStoreWithMethods();

    store.getState().scrollToBottom(false);

    expect(methods.scrollToEnd).toHaveBeenCalledTimes(1);
    expect(methods.scrollToIndex).not.toHaveBeenCalled();
  });

  it('keeps the smooth BackBottom scroll on virtua', () => {
    const { methods, store } = createStoreWithMethods();

    store.getState().scrollToBottom(true);

    expect(methods.scrollToIndex).toHaveBeenCalledWith(1, { align: 'end', smooth: true });
    expect(methods.scrollToEnd).not.toHaveBeenCalled();
  });
});
