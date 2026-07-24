/**
 * @vitest-environment happy-dom
 */
import type { TopicCommentItem } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AnchorPreview from './AnchorPreview';

const mocks = vi.hoisted(() => ({
  clearPortalStack: vi.fn(),
  messages: [{ id: 'message-1' }, { id: 'message-2' }] as Array<{
    id: string;
    tasks?: Array<{ id: string }>;
  }>,
  scrollToIndex: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  Icon: () => null,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<PropertyKey, unknown>) => unknown) =>
    selector({
      activeAgentId: 'agent-1',
      activeThreadId: 'thread-1',
      activeTopicId: 'topic-1',
      clearPortalStack: mocks.clearPortalStack,
      mainConversationScrollToIndex: mocks.scrollToIndex,
      messagesMap: { 'main_agent-1_topic-1': mocks.messages },
    }),
}));

vi.mock('@/store/chat/selectors', () => ({
  displayMessageSelectors: {
    activeDisplayMessages: (state: { activeThreadId?: string }) =>
      state.activeThreadId ? [] : mocks.messages,
  },
}));

vi.mock('./styles', () => ({
  styles: { anchor: 'anchor' },
}));

const comment = {
  anchorPreview: { excerpt: 'Anchored message' },
  messageId: 'message-2',
  topicId: 'topic-1',
} as TopicCommentItem;

describe('TopicCommentAnchorPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messages = [{ id: 'message-1' }, { id: 'message-2' }];
    let timestamp = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      timestamp += 16;
      callback(timestamp);
      return 1;
    });
  });

  it('locates the virtualized message without closing the comments portal', () => {
    const target = document.createElement('div');
    target.setAttribute('data-message-id', 'message-2');
    document.body.appendChild(target);

    try {
      render(<AnchorPreview comment={comment} />);

      fireEvent.click(screen.getByRole('button'));

      expect(mocks.clearPortalStack).not.toHaveBeenCalled();
      expect(mocks.scrollToIndex).toHaveBeenCalledWith(1, {
        align: 'center',
        smooth: true,
      });
      expect(target).toHaveAttribute('data-message-locate-highlight');
    } finally {
      target.remove();
    }
  });

  it('locates a persisted task inside its virtual aggregate row', () => {
    mocks.messages = [{ id: 'virtual-tasks', tasks: [{ id: 'message-2' }] }];
    const target = document.createElement('div');
    target.setAttribute('data-message-id', 'virtual-tasks');
    document.body.appendChild(target);

    try {
      render(<AnchorPreview comment={comment} />);
      fireEvent.click(screen.getByRole('button'));

      expect(mocks.scrollToIndex).toHaveBeenCalledWith(0, {
        align: 'center',
        smooth: true,
      });
      expect(target).toHaveAttribute('data-message-locate-highlight');
    } finally {
      target.remove();
    }
  });

  it('starts highlighting only after the target message stops moving', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const runNextFrame = (timestamp: number) => {
      const frame = frames.shift();
      expect(frame).toBeDefined();
      frame!(timestamp);
    };
    const target = document.createElement('div');
    target.setAttribute('data-message-id', 'message-2');
    let targetTop = 300;
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, targetTop, 100, 40),
    );
    document.body.appendChild(target);

    try {
      render(<AnchorPreview comment={comment} />);
      fireEvent.click(screen.getByRole('button'));

      runNextFrame(0);
      expect(target).not.toHaveAttribute('data-message-locate-highlight');

      for (const [timestamp, top] of [
        [16, 300],
        [32, 240],
        [48, 180],
        [64, 120],
      ] as const) {
        targetTop = top;
        runNextFrame(timestamp);
        expect(target).not.toHaveAttribute('data-message-locate-highlight');
      }

      for (let timestamp = 80; timestamp <= 224; timestamp += 16) {
        runNextFrame(timestamp);
        expect(target).not.toHaveAttribute('data-message-locate-highlight');
      }

      runNextFrame(240);
      expect(target).toHaveAttribute('data-message-locate-highlight');
    } finally {
      target.remove();
    }
  });

  it('does not highlight when the target never stops moving', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const target = document.createElement('div');
    target.setAttribute('data-message-id', 'message-2');
    let targetTop = 300;
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, targetTop--, 100, 40),
    );
    document.body.appendChild(target);

    try {
      render(<AnchorPreview comment={comment} />);
      fireEvent.click(screen.getByRole('button'));

      for (let frame = 0; frame < 260 && frames.length > 0; frame += 1) {
        frames.shift()!(frame * 16);
      }

      expect(frames).toHaveLength(0);
      expect(target).not.toHaveAttribute('data-message-locate-highlight');
    } finally {
      target.remove();
    }
  });
});
