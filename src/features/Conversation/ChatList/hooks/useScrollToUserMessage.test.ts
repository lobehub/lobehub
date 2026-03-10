import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useScrollToUserMessage } from './useScrollToUserMessage';

describe('useScrollToUserMessage', () => {
  describe('when user sends a new message', () => {
    it('should scroll to user message when 2 new messages are added (user + assistant pair)', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 2,
            isSecondLastMessageFromUser: false,
          },
        },
      );

      // User sends a new message (2 messages added: user + assistant, second-to-last is user)
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
      });

      expect(scrollToIndex).toHaveBeenCalledTimes(1);
      // Should scroll to index 2 (dataSourceLength - 2 = 4 - 2 = 2, the user message)
      expect(scrollToIndex).toHaveBeenCalledWith(2, { align: 'start', smooth: true });
    });

    it('should scroll to correct index when multiple user messages are sent', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 4,
            isSecondLastMessageFromUser: false,
          },
        },
      );

      // User sends a new message (2 messages added)
      rerender({
        dataSourceLength: 6,
        isSecondLastMessageFromUser: true,
      });

      // Should scroll to index 4 (dataSourceLength - 2 = 6 - 2 = 4)
      expect(scrollToIndex).toHaveBeenCalledWith(4, { align: 'start', smooth: true });
    });
  });

  describe('when AI/agent responds', () => {
    it('should NOT scroll when only 1 new message is added (AI response)', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 4,
            isSecondLastMessageFromUser: true,
          },
        },
      );

      // AI adds another message (only 1 message added, not 2)
      rerender({
        dataSourceLength: 5,
        isSecondLastMessageFromUser: false,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should NOT scroll when multiple agents respond in group chat', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 4,
            isSecondLastMessageFromUser: true,
          },
        },
      );

      // First agent responds (1 message added)
      rerender({
        dataSourceLength: 5,
        isSecondLastMessageFromUser: false,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();

      // Second agent responds (1 message added)
      rerender({
        dataSourceLength: 6,
        isSecondLastMessageFromUser: false,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should NOT scroll when 2 messages added but second-to-last is not user', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 4,
            isSecondLastMessageFromUser: false,
          },
        },
      );

      // 2 messages added but both are from AI (e.g., system messages)
      rerender({
        dataSourceLength: 6,
        isSecondLastMessageFromUser: false,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should NOT scroll when length decreases (message deleted)', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 6,
            isSecondLastMessageFromUser: true,
          },
        },
      );

      // Message deleted (length decreases)
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should NOT scroll when length stays the same', () => {
      const scrollToIndex = vi.fn();

      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex,
          }),
        {
          initialProps: {
            dataSourceLength: 4,
            isSecondLastMessageFromUser: true,
          },
        },
      );

      // Length stays the same (content update, not new message)
      rerender({
        dataSourceLength: 4,
        isSecondLastMessageFromUser: true,
      });

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('should handle null scrollToIndex gracefully', () => {
      const { rerender } = renderHook(
        ({ dataSourceLength, isSecondLastMessageFromUser }) =>
          useScrollToUserMessage({
            dataSourceLength,
            isSecondLastMessageFromUser,
            scrollToIndex: null,
          }),
        {
          initialProps: {
            dataSourceLength: 2,
            isSecondLastMessageFromUser: false,
          },
        },
      );

      // Should not throw when scrollToIndex is null
      expect(() => {
        rerender({
          dataSourceLength: 4,
          isSecondLastMessageFromUser: true,
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
        }),
      );

      // Should not scroll on initial render even if second-to-last message is from user
      expect(scrollToIndex).not.toHaveBeenCalled();
    });
  });
});
