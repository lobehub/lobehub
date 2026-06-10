/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TopicList from './index';

const pushMock = vi.hoisted(() => vi.fn());
const closeAllTopicsDrawerMock = vi.hoisted(() => vi.fn());
const permissionMock = vi.hoisted(() => ({
  create_content: true,
}));

vi.mock('@/features/NavPanel/components/EmptyNavItem', () => ({
  default: ({
    disabled,
    onClick,
    title,
  }: {
    disabled?: boolean;
    onClick: () => void;
    title: string;
  }) => (
    <button disabled={disabled} type="button" onClick={disabled ? undefined : onClick}>
      {title}
    </button>
  ),
}));

vi.mock('@/features/NavPanel/components/SkeletonList', () => ({
  default: () => <div data-testid="skeleton-list" />,
}));

vi.mock('@/hooks/useFetchChatTopics', () => ({
  useFetchChatTopics: vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content') => ({
    allowed: permissionMock[action],
    reason: permissionMock[action] ? '' : 'requires member',
  }),
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({
    push: pushMock,
  }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (
    selector: (state: {
      activeAgentId: string;
      allTopicsDrawerOpen: boolean;
      closeAllTopicsDrawer: () => void;
      isUndefinedTopics: boolean;
      topicLength: number;
    }) => unknown,
  ) =>
    selector({
      activeAgentId: 'agent-1',
      allTopicsDrawerOpen: false,
      closeAllTopicsDrawer: closeAllTopicsDrawerMock,
      isUndefinedTopics: false,
      topicLength: 0,
    }),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentTopicLength: (state: { topicLength: number }) => state.topicLength,
    isUndefinedTopics: (state: { isUndefinedTopics: boolean }) => state.isUndefinedTopics,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../AllTopicsDrawer', () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-open={String(open)} data-testid="all-topics-drawer" />
  ),
}));

vi.mock('../hooks/useAgentTopicGroupMode', () => ({
  useAgentTopicGroupMode: () => ({ topicGroupMode: 'flat' }),
}));

vi.mock('../TopicListContent/ByProjectMode', () => ({
  default: () => <div data-testid="by-project-mode" />,
}));

vi.mock('../TopicListContent/ByTimeMode', () => ({
  default: () => <div data-testid="by-time-mode" />,
}));

vi.mock('../TopicListContent/FlatMode', () => ({
  default: () => <div data-testid="flat-mode" />,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

describe('Agent topic list', () => {
  beforeEach(() => {
    pushMock.mockReset();
    closeAllTopicsDrawerMock.mockReset();
    permissionMock.create_content = true;
  });

  it('opens the agent chat route from the empty start topic entry', () => {
    render(<TopicList />);

    fireEvent.click(screen.getByRole('button', { name: 'actions.addNewTopic' }));

    expect(pushMock).toHaveBeenCalledWith('/agent/agent-1');
  });

  it('disables the empty start topic entry for workspace viewers', () => {
    permissionMock.create_content = false;

    render(<TopicList />);

    const startButton = screen.getByRole('button', { name: 'actions.addNewTopic' });
    expect(startButton).toBeDisabled();

    fireEvent.click(startButton);

    expect(pushMock).not.toHaveBeenCalled();
  });
});
