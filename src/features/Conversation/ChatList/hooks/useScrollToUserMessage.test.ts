import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScrollToUserMessage } from './useScrollToUserMessage';

type Props = {
  dataSourceLength: number;
  isSecondLastMessageFromUser: boolean;
  scrollShrinking?: boolean;
  spacerActive: boolean;
  spacerLayoutVersion?: number;
};

const makeRender = (scrollToIndex: ReturnType<typeof vi.fn> | null, initialProps: Props) =>
  renderHook(
    (props: Props) =>
      useScrollToUserMessage({
        dataSourceLength: props.dataSourceLength,
        isSecondLastMessageFromUser: props.isSecondLastMessageFromUser,
        scrollShrinking: props.scrollShrinking,
        scrollToIndex,
        spacerActive: props.spacerActive,
        spacerLayoutVersion: props.spacerLayoutVersion,
      }),
    { initialProps },
  );

describe('useScrollToUserMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('when user sends a new message', () => {
    it('should retry scrolling to user message when 2 new messages are added and spacer is active', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 2,
        isSecondLastMessageFromUser: false,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      act(() => {
        vi.runAllTimers();
      });

      // send-triggered retries + spacerActive follow-up fire in the same tick;
      // executeScroll clears prior pending timers so only the last retry wave runs.
      expect(scrollToIndex).toHaveBeenCalledTimes(3);
      expect(scrollToIndex).toHaveBeenNthCalledWith(1, 2, { align: 'start', smooth: true });
    });

    it('should scroll immediately and re-scroll when spacer becomes active', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 2,
        isSecondLastMessageFromUser: false,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(scrollToIndex).toHaveBeenCalledTimes(3);
      expect(scrollToIndex).toHaveBeenNthCalledWith(1, 2, { align: 'start', smooth: true });

      scrollToIndex.mockClear();

      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(scrollToIndex).toHaveBeenCalledTimes(3);
      expect(scrollToIndex).toHaveBeenNthCalledWith(1, 2, { align: 'start', smooth: true });
    });

    it('should re-scroll whenever spacerLayoutVersion bumps while active', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 2,
        isSecondLastMessageFromUser: false,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      // user sends message; spacer becomes active
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      act(() => {
        vi.runAllTimers();
      });
      scrollToIndex.mockClear();

      // spacer DOM is measured; version bumps -> should re-fire scroll
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
        spacerLayoutVersion: 1,
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(scrollToIndex).toHaveBeenCalledTimes(3);
      expect(scrollToIndex).toHaveBeenNthCalledWith(1, 2, { align: 'start', smooth: true });
    });

    it('should stop re-scrolling once the spacer unmounts', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 2,
        isSecondLastMessageFromUser: false,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
        spacerLayoutVersion: 1,
      });

      act(() => {
        vi.runAllTimers();
      });
      scrollToIndex.mockClear();

      // spacer unmounts -> pending cleared
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: false,
        spacerLayoutVersion: 1,
      });

      // a subsequent version bump with spacer gone must not re-scroll
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: false,
        spacerLayoutVersion: 2,
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should cancel queued retry timers when user scrolls up before they fire', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 2,
        isSecondLastMessageFromUser: false,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      // user sends message -> 0/32/96ms retry timers are scheduled but not fired yet
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      // user immediately starts scrolling up before any retry timer fires
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        scrollShrinking: true,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      act(() => {
        vi.runAllTimers();
      });

      // no queued retry should have yanked the viewport back
      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should cancel queued retry timers when spacer unmounts before they fire', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 2,
        isSecondLastMessageFromUser: false,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      // spacer unmounts before any retry timer fires
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should stop pinning when user starts shrinking the spacer manually', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 2,
        isSecondLastMessageFromUser: false,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
        spacerLayoutVersion: 1,
      });

      act(() => {
        vi.runAllTimers();
      });
      scrollToIndex.mockClear();

      // user scrolls up -> scrollShrinking true, pending cleared
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        scrollShrinking: true,
        spacerActive: true,
        spacerLayoutVersion: 1,
      });

      // even if layout keeps ticking, we must not pin back to top
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        scrollShrinking: true,
        spacerActive: true,
        spacerLayoutVersion: 2,
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should scroll without spacer when spacer never mounts (content fills viewport)', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 2,
        isSecondLastMessageFromUser: false,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(scrollToIndex).toHaveBeenCalledTimes(3);
      expect(scrollToIndex).toHaveBeenNthCalledWith(1, 2, { align: 'start', smooth: true });
    });

    it('should scroll to correct index when multiple user messages are sent', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 4,
        isSecondLastMessageFromUser: false,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      rerender({
        dataSourceLength: 6,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(scrollToIndex).toHaveBeenNthCalledWith(1, 4, { align: 'start', smooth: true });
    });
  });

  describe('when AI/agent responds', () => {
    it('should NOT scroll when only 1 new message is added (AI response)', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      rerender({
        dataSourceLength: 5,
        isSecondLastMessageFromUser: false,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should NOT scroll when multiple agents respond in group chat', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      rerender({
        dataSourceLength: 5,
        isSecondLastMessageFromUser: false,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();

      rerender({
        dataSourceLength: 6,
        isSecondLastMessageFromUser: false,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should NOT scroll when 2 messages added but second-to-last is not user', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 4,
        isSecondLastMessageFromUser: false,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      rerender({
        dataSourceLength: 6,
        isSecondLastMessageFromUser: false,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should NOT scroll when length decreases (message deleted)', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 6,
        isSecondLastMessageFromUser: true,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should NOT scroll when length stays the same', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = makeRender(scrollToIndex, {
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
        spacerActive: true,
        spacerLayoutVersion: 0,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should handle null scrollToIndex gracefully', () => {
      const { rerender } = makeRender(null, {
        dataSourceLength: 2,
        isSecondLastMessageFromUser: false,
        spacerActive: false,
        spacerLayoutVersion: 0,
      });

      expect(() => {
        rerender({
          dataSourceLength: 4,
          isSecondLastMessageFromUser: true,
          spacerActive: true,
          spacerLayoutVersion: 0,
        });
      }).not.toThrow();
    });

    it('should NOT scroll on initial render', () => {
      const scrollToIndex = vi.fn();

      renderHook(() =>
        useScrollToUserMessage({
          dataSourceLength: 6,
          isSecondLastMessageFromUser: true,
          scrollToIndex,
          spacerActive: true,
          spacerLayoutVersion: 0,
        }),
      );

      expect(scrollToIndex).not.toHaveBeenCalled();
    });
  });
});
