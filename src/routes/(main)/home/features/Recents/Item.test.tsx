import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecentItem } from '@/server/routers/lambda/recent';

import RecentListItem from './Item';

const mocks = vi.hoisted(() => ({
  getPlatformIcon: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => null,
  DropdownMenu: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: ({ fill, icon: IconComponent }: { fill?: string; icon: ComponentType }) => (
    <span data-fill={fill}>
      <IconComponent />
    </span>
  ),
}));

vi.mock('antd-style', () => ({
  cssVar: {
    colorTextDescription: 'description',
    colorWarning: 'warning',
  },
}));

vi.mock('lucide-react', () => ({
  FileTextIcon: () => <span data-testid="file-icon" />,
  MoreHorizontalIcon: () => null,
  StarIcon: () => <span data-testid="favorite-icon" />,
}));

vi.mock('@/components/InlineRename', () => ({ default: () => null }));
vi.mock('@/features/AgentTasks/features/TaskStatusIcon', () => ({ default: () => null }));
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ icon, title }: { icon?: ReactNode; title: ReactNode }) => (
    <div>
      {icon}
      {title}
    </div>
  ),
}));
vi.mock('@/hooks/usePrefetchAgent', () => ({ usePrefetchAgent: () => vi.fn() }));
vi.mock('@/hooks/usePrefetchPage', () => ({ usePrefetchPage: () => vi.fn() }));
vi.mock('@/routes/(main)/agent/channel/const', () => ({
  getPlatformIcon: mocks.getPlatformIcon,
}));
vi.mock('./useDropdownMenu', () => ({
  useRecentItemDropdownMenu: () => ({ dropdownMenu: () => [], handleRename: vi.fn() }),
}));

const platformTopic = {
  agentId: 'agent-1',
  favorite: false,
  icon: 'topic',
  id: 'topic-1',
  metadata: {
    bot: {
      applicationId: 'slack-app',
      isOwner: true,
      platform: 'slack',
      platformThreadId: 'thread-1',
      senderExternalUserId: 'user-1',
    },
  },
  routePath: '/chat/agent-1/topic/topic-1',
  status: null,
  title: 'Slack topic',
  type: 'topic',
  updatedAt: new Date('2026-07-15T00:00:00.000Z'),
} satisfies RecentItem;

const PlatformIcon = () => <span data-testid="platform-icon" />;

describe('RecentListItem topic icon', () => {
  beforeEach(() => {
    mocks.getPlatformIcon.mockReset();
    mocks.getPlatformIcon.mockReturnValue(PlatformIcon);
  });

  afterEach(cleanup);

  it('renders the platform icon for an unfavorited platform topic', () => {
    render(<RecentListItem {...platformTopic} />);

    expect(screen.getByTestId('platform-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('favorite-icon')).not.toBeInTheDocument();
    expect(mocks.getPlatformIcon).toHaveBeenCalledWith('slack');
  });

  it('renders the favorite star instead of the platform icon for a favorited platform topic', () => {
    render(<RecentListItem {...platformTopic} favorite />);

    expect(screen.getByTestId('favorite-icon').parentElement).toHaveAttribute(
      'data-fill',
      'warning',
    );
    expect(screen.queryByTestId('platform-icon')).not.toBeInTheDocument();
    expect(mocks.getPlatformIcon).not.toHaveBeenCalled();
  });
});
