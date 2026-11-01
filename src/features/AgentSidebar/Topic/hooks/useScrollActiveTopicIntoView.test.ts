/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import {
  markSidebarTopicActivation,
  useScrollActiveTopicIntoView,
} from './useScrollActiveTopicIntoView';

const calls: { element: Element; options: unknown }[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  calls.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element, options: unknown) {
    calls.push({ element: this, options });
  });
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  useChatStore.setState({ creatingTopicIds: [] });
});

const mountWithRow = (topicId: string) => {
  const container = document.createElement('div');
  const row = document.createElement('div');
  row.dataset.topicId = topicId;
  container.append(row);

  const hook = renderHook(({ ready }) => useScrollActiveTopicIntoView(topicId, ready), {
    initialProps: { ready: '' },
  });
  act(() => {
    (hook.result.current as MutableRefObject<HTMLDivElement | null>).current = container;
  });
  return hook;
};

describe('useScrollActiveTopicIntoView', () => {
  it('scrolls the active topic row into the nearest visible position', () => {
    const container = document.createElement('div');
    const row = document.createElement('div');
    row.dataset.topicId = 'topic-2';
    container.append(row);

    const { result, rerender } = renderHook(
      ({ ready }) => useScrollActiveTopicIntoView('topic-2', ready),
      { initialProps: { ready: '' } },
    );
    act(() => {
      (result.current as MutableRefObject<HTMLDivElement | null>).current = container;
    });
    rerender({ ready: 'topic-2' });

    expect(calls).toEqual([{ element: row, options: { block: 'nearest' } }]);
  });

  it('waits until an asynchronously loaded active row is rendered', () => {
    const container = document.createElement('div');
    const { result, rerender } = renderHook(
      ({ ready }) => useScrollActiveTopicIntoView('topic-2', ready),
      { initialProps: { ready: '' } },
    );
    act(() => {
      (result.current as MutableRefObject<HTMLDivElement | null>).current = container;
    });
    rerender({ ready: 'topic-1' });
    expect(calls).toHaveLength(0);

    const row = document.createElement('div');
    row.dataset.topicId = 'topic-2';
    container.append(row);
    rerender({ ready: 'topic-1:topic-2' });

    expect(calls).toHaveLength(1);
  });

  it('does not reveal the same active topic again when unrelated list state changes', () => {
    const container = document.createElement('div');
    const row = document.createElement('div');
    row.dataset.topicId = 'topic-2';
    container.append(row);

    const { result, rerender } = renderHook(
      ({ ready }) => useScrollActiveTopicIntoView('topic-2', ready),
      { initialProps: { ready: '' } },
    );
    act(() => {
      (result.current as MutableRefObject<HTMLDivElement | null>).current = container;
    });
    rerender({ ready: 'topic-2' });
    rerender({ ready: 'topic-2:unrelated-group' });

    expect(calls).toHaveLength(1);
  });
  it('does not reveal a topic the user opened from a sidebar row', () => {
    markSidebarTopicActivation('topic-2');
    const { rerender } = mountWithRow('topic-2');
    rerender({ ready: 'topic-2' });

    expect(calls).toHaveLength(0);
  });

  it('does not reveal a topic this client is creating for its first send', () => {
    useChatStore.setState({ creatingTopicIds: ['topic-2'] });
    const { rerender } = mountWithRow('topic-2');
    rerender({ ready: 'topic-2' });

    expect(calls).toHaveLength(0);
  });

  it('keeps the skip after the optimistic topic is confirmed', () => {
    useChatStore.setState({ creatingTopicIds: ['topic-2'] });
    const { rerender } = mountWithRow('topic-2');
    rerender({ ready: 'topic-2' });
    act(() => useChatStore.setState({ creatingTopicIds: [] }));
    rerender({ ready: 'topic-2:other' });

    expect(calls).toHaveLength(0);
  });

  it('still reveals an externally navigated topic after a sidebar click on another topic', () => {
    markSidebarTopicActivation('topic-1');
    const { rerender } = mountWithRow('topic-2');
    rerender({ ready: 'topic-2' });

    expect(calls).toHaveLength(1);
  });
});
