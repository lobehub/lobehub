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
  scrollToMessage: vi.fn(),
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

describe('setActiveIndex', () => {
  it('does not notify subscribers when the index is unchanged', () => {
    // Regression: the list's scroll handler reports the active index on every
    // scroll event; publishing equal values woke every activeIndex subscriber.
    const { store } = createStoreWithMethods();
    act(() => store.getState().setActiveIndex(1));

    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    act(() => store.getState().setActiveIndex(1));
    expect(listener).not.toHaveBeenCalled();

    act(() => store.getState().setActiveIndex(0));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().activeIndex).toBe(0);
    unsubscribe();
  });
});
