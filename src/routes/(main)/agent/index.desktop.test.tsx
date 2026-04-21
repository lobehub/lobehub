/**
 * @vitest-environment happy-dom
 */
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';

import ChatPage from './index.desktop';

vi.hoisted(() => {
  const storage = {
    clear: vi.fn(),
    getItem: vi.fn(() => null),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
});

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({
    children,
    horizontal,
    ...props
  }: {
    children?: ReactNode;
    horizontal?: boolean;
    [key: string]: unknown;
  }) => (
    <div data-horizontal={horizontal ? 'true' : undefined} {...props}>
      {children}
    </div>
  ),
  ShikiLobeTheme: {},
}));

vi.mock('@/features/TopicPopupGuard', () => ({
  default: () => <div data-testid="topic-popup-guard" />,
}));

vi.mock('@/features/TopicPopupGuard/useTopicPopupsRegistry', () => ({
  useTopicInPopup: ({ topicId }: { topicId: string }) =>
    topicId === 'popup-topic'
      ? {
          agentId: 'agent-1',
          identifier: 'popup-1',
          scope: 'agent',
          topicId: 'popup-topic',
        }
      : undefined,
}));

vi.mock('./features/Conversation', () => ({
  default: () => <div data-testid="conversation" />,
}));

vi.mock('./features/Conversation/WorkingSidebar', () => ({
  default: () => <div data-testid="working-sidebar" />,
}));

vi.mock('./features/PageTitle', () => ({
  default: () => <div data-testid="page-title" />,
}));

vi.mock('./features/Portal', () => ({
  default: () => <div data-testid="portal" />,
}));

vi.mock('./features/TelemetryNotification', () => ({
  default: () => <div data-testid="telemetry-notification" />,
}));

const SearchProbe = () => {
  const location = useLocation();

  return <div data-testid="search-probe">{location.search}</div>;
};

describe('Agent desktop topic popup guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    useChatStore.setState(
      {
        ...initialChatState,
        activeAgentId: 'agent-1',
        activeTopicId: 'popup-topic',
      },
      false,
    );
  });

  afterEach(() => {
    useChatStore.setState(initialChatState, false);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps the topic query synchronized while the popup guard is visible', async () => {
    render(
      <MemoryRouter initialEntries={['/agent/agent-1?topic=popup-topic']}>
        <SearchProbe />
        <ChatPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('topic-popup-guard')).toBeInTheDocument();
    expect(screen.getByTestId('search-probe')).toHaveTextContent('?topic=popup-topic');

    act(() => {
      useChatStore.setState({ activeTopicId: 'other-topic' });
    });

    expect(screen.queryByTestId('topic-popup-guard')).not.toBeInTheDocument();
    expect(screen.getByTestId('conversation')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(screen.getByTestId('search-probe')).toHaveTextContent('?topic=other-topic');
  });
});
