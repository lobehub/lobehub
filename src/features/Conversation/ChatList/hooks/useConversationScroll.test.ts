/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
import { type VListHandle } from 'virtua';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ConversationStoreModule from '../../store';
import { useConversationStore } from '../../store';
import {
  calculateConversationSpacerHeight,
  CONVERSATION_SPACER_ID,
  getConversationSpacerScrollEffect,
  useConversationScroll,
} from './useConversationScroll';

vi.mock('zustand/traditional');

vi.mock('../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof ConversationStoreModule>();
  return {
    ...actual,
    useConversationStore: vi.fn(),
  };
});

// ResizeObserver mock capturing the latest callback so tests can trigger it.
class MockResizeObserver {
  static latest: MockResizeObserver | null = null;
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.latest = this;
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.observed = [];
  }
  unobserve() {}
  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

describe('useConversationScroll — helpers', () => {
  it('calculates remaining spacer height behind the latest assistant message', () => {
    expect(calculateConversationSpacerHeight(800, 200, 80)).toBe(520);
  });

  it('clamps spacer height to zero when content already fills the viewport', () => {
    expect(calculateConversationSpacerHeight(800, 300, 600)).toBe(0);
  });

  it('keeps the reserved spacer id stable', () => {
    expect(CONVERSATION_SPACER_ID).toBe('__conversation_spacer__');
  });

  it('cancels pin retries without shrinking the spacer while AI is streaming', () => {
    expect(
      getConversationSpacerScrollEffect({
        delta: -24,
        hasPrevOffset: true,
        isAIGenerating: true,
        isMounted: true,
      }),
    ).toEqual({ cancelPin: true, shrinkSpacer: false });
  });

  it('both cancels pin retries and shrinks the spacer after streaming stops', () => {
    expect(
      getConversationSpacerScrollEffect({
        delta: -24,
        hasPrevOffset: true,
        isAIGenerating: false,
        isMounted: true,
      }),
    ).toEqual({ cancelPin: true, shrinkSpacer: true });
  });

  it('does nothing when there is no previous offset to diff against', () => {
    expect(
      getConversationSpacerScrollEffect({
        delta: -999,
        hasPrevOffset: false,
        isAIGenerating: false,
        isMounted: true,
      }),
    ).toEqual({ cancelPin: false, shrinkSpacer: false });
  });
});

describe('useConversationScroll — pin behavior', () => {
  const scrollToIndex = vi.fn();
  const virtuaRef: RefObject<VListHandle | null> = createRef<VListHandle>();
  const assistantId = 'assistant-1';
  const userId = 'user-1';

  /**
   * State the mocked store will return. displayMessages is read by the hook
   * to verify "user + assistant pair was just appended".
   */
  type StoreFixture = {
    displayMessages: Array<{ id: string; role: 'user' | 'assistant' }>;
    isAIGenerating: boolean;
    virtuaScrollMethods: {
      getItemOffset?: (i: number) => number;
      getItemSize?: (i: number) => number;
      getScrollOffset?: () => number;
      getViewportSize?: () => number;
    } | null;
  };

  // Latest fixture is mutable so rerenders see up-to-date displayMessages.
  let currentFixture: StoreFixture = {
    displayMessages: [],
    isAIGenerating: false,
    virtuaScrollMethods: null,
  };

  const deriveDisplayMessages = (isSecondLastFromUser: boolean) =>
    isSecondLastFromUser
      ? [
          { id: userId, role: 'user' as const },
          { id: assistantId, role: 'assistant' as const },
        ]
      : [{ id: assistantId, role: 'assistant' as const }];

  const installStoreMock = () => {
    vi.mocked(useConversationStore).mockImplementation((selector: any) => {
      const probe: any = {
        displayMessages: currentFixture.displayMessages,
        operationState: { isAIGenerating: currentFixture.isAIGenerating },
        virtuaScrollMethods: currentFixture.virtuaScrollMethods,
      };
      return selector(probe);
    });
  };

  const renderScrollHook = (props: {
    dataSource: string[];
    isSecondLastMessageFromUser: boolean;
    fixture?: Partial<StoreFixture>;
  }) => {
    currentFixture = {
      displayMessages: deriveDisplayMessages(props.isSecondLastMessageFromUser),
      isAIGenerating: false,
      virtuaScrollMethods: {
        getScrollOffset: () => 0,
        getViewportSize: () => 800,
      },
      ...props.fixture,
    };
    installStoreMock();

    const hook = renderHook(
      ({ dataSource, isSecondLastMessageFromUser }) =>
        useConversationScroll({ dataSource, isSecondLastMessageFromUser, virtuaRef }),
      {
        initialProps: {
          dataSource: props.dataSource,
          isSecondLastMessageFromUser: props.isSecondLastMessageFromUser,
        },
      },
    );

    const rerender = (next: { dataSource: string[]; isSecondLastMessageFromUser: boolean }) => {
      currentFixture = {
        ...currentFixture,
        displayMessages: deriveDisplayMessages(next.isSecondLastMessageFromUser),
      };
      hook.rerender(next);
    };

    return { ...hook, rerender };
  };

  beforeEach(() => {
    scrollToIndex.mockReset();
    // Attach a live mock handle; scrollToPinned reads virtuaRef.current at call time.
    virtuaRef.current = { scrollToIndex } as unknown as VListHandle;
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    MockResizeObserver.latest = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('scrolls to the user message when a user+assistant pair is appended', () => {
    const { rerender } = renderScrollHook({
      dataSource: [assistantId, 'prev'],
      isSecondLastMessageFromUser: false,
    });

    rerender({
      dataSource: ['m0', 'm1', userId, assistantId],
      isSecondLastMessageFromUser: true,
    });

    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    expect(scrollToIndex).toHaveBeenCalledWith(2, { align: 'start', smooth: true });
  });

  it('does not scroll when only the assistant message is appended', () => {
    const { rerender } = renderScrollHook({
      dataSource: [userId, assistantId],
      isSecondLastMessageFromUser: true,
    });
    scrollToIndex.mockClear();

    rerender({
      dataSource: [userId, assistantId, 'followup'],
      isSecondLastMessageFromUser: false,
    });

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not scroll when the dataSource length is unchanged', () => {
    const { rerender } = renderScrollHook({
      dataSource: ['a', 'b', 'c', 'd'],
      isSecondLastMessageFromUser: true,
    });
    scrollToIndex.mockClear();

    rerender({
      dataSource: ['a', 'b', 'c', 'd'],
      isSecondLastMessageFromUser: true,
    });

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not scroll when the dataSource shrinks (deletion)', () => {
    const { rerender } = renderScrollHook({
      dataSource: ['a', 'b', 'c', 'd', userId, assistantId],
      isSecondLastMessageFromUser: true,
    });
    scrollToIndex.mockClear();

    rerender({
      dataSource: ['a', 'b', 'c', 'd'],
      isSecondLastMessageFromUser: true,
    });

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not throw or scroll when virtuaRef is not ready at send time', () => {
    virtuaRef.current = null;

    const { rerender } = renderScrollHook({
      dataSource: [assistantId],
      isSecondLastMessageFromUser: false,
    });

    expect(() =>
      rerender({
        dataSource: ['m0', userId, assistantId],
        isSecondLastMessageFromUser: true,
      }),
    ).not.toThrow();

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('stops pinning once the user scrolls up', () => {
    const { result, rerender } = renderScrollHook({
      dataSource: [assistantId, 'prev'],
      isSecondLastMessageFromUser: false,
    });

    rerender({
      dataSource: ['m0', 'm1', userId, assistantId],
      isSecondLastMessageFromUser: true,
    });
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    scrollToIndex.mockClear();

    // User scrolls up: offset decreased (hook tracks prev via getScrollOffset=0)
    act(() => {
      // simulate viewport mount via prev offset seeding: first call seeds prev=0
      result.current.onScrollOffset(0);
      // then user scrolls up (negative delta)
      result.current.onScrollOffset(-50);
    });

    // Simulate a later layout bump that would have re-fired a scroll before.
    // Since pin was cleared, no scroll should be called.
    // Re-render with same dataSource triggers the pin-re-fire effect path only
    // when pinRef is set; it's null now.
    rerender({
      dataSource: ['m0', 'm1', userId, assistantId],
      isSecondLastMessageFromUser: true,
    });

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not scroll on initial render', () => {
    renderScrollHook({
      dataSource: ['a', 'b', userId, assistantId],
      isSecondLastMessageFromUser: true,
    });

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('targets the correct index when multiple turns accumulate', () => {
    const { rerender } = renderScrollHook({
      dataSource: ['a', 'b', 'c', 'd'],
      isSecondLastMessageFromUser: false,
    });

    rerender({
      dataSource: ['a', 'b', 'c', 'd', userId, assistantId],
      isSecondLastMessageFromUser: true,
    });

    expect(scrollToIndex).toHaveBeenLastCalledWith(4, { align: 'start', smooth: true });
  });

  it('updates the pin index for the latest turn when a second pair is appended', () => {
    const { rerender } = renderScrollHook({
      dataSource: ['a', 'b'],
      isSecondLastMessageFromUser: false,
    });

    // first send
    rerender({
      dataSource: ['a', 'b', userId, assistantId],
      isSecondLastMessageFromUser: true,
    });
    expect(scrollToIndex).toHaveBeenLastCalledWith(2, { align: 'start', smooth: true });

    // second send — fixture keeps displayMessages ending in user+assistant
    rerender({
      dataSource: ['a', 'b', userId, assistantId, 'u2', 'a2'],
      isSecondLastMessageFromUser: true,
    });

    expect(scrollToIndex).toHaveBeenLastCalledWith(4, { align: 'start', smooth: true });
  });

  // Regression: the messages ResizeObserver must rebind to the freshly sent
  // user + assistant DOM nodes. The earlier memo had `[dataSource,
  // displayMessages]` deps but read an ref that is updated later inside the
  // send-detection effect — so the signature could remain stale on the next
  // render and the observer would never hook the new turn.
  it('observes the freshly sent user + assistant DOM nodes after a send', async () => {
    // Render user/assistant nodes with data-message-id so the hook's
    // document.querySelector('[data-message-id="..."]') can find them.
    const userEl = document.createElement('div');
    userEl.setAttribute('data-message-id', userId);
    const assistantEl = document.createElement('div');
    assistantEl.setAttribute('data-message-id', assistantId);
    document.body.append(userEl, assistantEl);

    try {
      const { rerender } = renderScrollHook({
        dataSource: [assistantId, 'prev'],
        isSecondLastMessageFromUser: false,
      });

      // Grab the observer that was created before the send. It may already
      // exist (empty deps) or not; either way we reset the "latest" slot so
      // the post-send observer is the one we inspect.
      MockResizeObserver.latest = null;

      rerender({
        dataSource: ['m0', 'm1', userId, assistantId],
        isSecondLastMessageFromUser: true,
      });

      // Flush any pending microtasks + rAFs the send effect scheduled.
      await act(async () => {
        vi.runAllTimers();
        await Promise.resolve();
      });

      const observer = MockResizeObserver.latest as MockResizeObserver | null;
      expect(observer, 'no ResizeObserver was created for messages').not.toBeNull();
      const observedIds = observer!.observed.map((el: Element) =>
        (el as HTMLElement).getAttribute('data-message-id'),
      );
      expect(observedIds).toContain(userId);
      expect(observedIds).toContain(assistantId);
    } finally {
      userEl.remove();
      assistantEl.remove();
    }
  });
});
