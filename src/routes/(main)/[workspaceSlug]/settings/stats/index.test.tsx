/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceStatsSetting from './index';

const useFetchWorkspaceMembersMock = vi.hoisted(() => vi.fn());
const statsPagePropsMock = vi.hoisted(() => vi.fn());

vi.mock('@/business/client/hooks/useFetchWorkspaceMembers', () => ({
  useFetchWorkspaceMembers: useFetchWorkspaceMembersMock,
}));

vi.mock('@/routes/(main)/settings/stats/features/overview/WorkspaceWelcome', () => ({
  default: () => <div>Workspace Welcome</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      key === 'usage.activeModels.removedUserName' ? `${options?.name} (Removed)` : key,
  }),
}));

vi.mock('@/routes/(main)/settings/stats', () => ({
  default: (props: {
    resolveUser: (userId: string) => { avatar?: string | null; name: string };
    showSettingHeader?: boolean;
  }) => {
    statsPagePropsMock(props);
    const { resolveUser } = props;
    const activeUser = resolveUser('user-1');
    const removedUser = resolveUser('user-2');
    const noAvatarUser = resolveUser('user-3');

    return (
      <div>
        <span>{activeUser.name}</span>
        <span>{activeUser.avatar}</span>
        <span>{removedUser.name}</span>
        <span>{noAvatarUser.name}</span>
      </div>
    );
  },
}));

const workspaceMembers = [
  {
    deletedAt: null,
    user: {
      avatar: 'https://example.com/avatar.png',
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      username: 'ada',
    },
    userId: 'user-1',
  },
  {
    deletedAt: new Date('2026-05-27T00:00:00.000Z'),
    user: {
      avatar: null,
      email: null,
      fullName: null,
      username: 'grace',
    },
    userId: 'user-2',
  },
  {
    deletedAt: null,
    user: {
      avatar: null,
      email: null,
      fullName: null,
      username: 'alan',
    },
    userId: 'user-3',
  },
];

describe('WorkspaceStatsSetting', () => {
  it('fetches deleted workspace members for user display resolution', () => {
    useFetchWorkspaceMembersMock.mockReturnValue({ data: workspaceMembers });

    render(<WorkspaceStatsSetting />);

    expect(useFetchWorkspaceMembersMock).toHaveBeenCalledWith({ includeDeleted: true });
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/avatar.png')).toBeInTheDocument();
    expect(screen.getByText('grace (Removed)')).toBeInTheDocument();
    expect(screen.getByText('alan')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'tab.stats' })).toBeInTheDocument();
    expect(statsPagePropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ showSettingHeader: false }),
    );
  });
});
