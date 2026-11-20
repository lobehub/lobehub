import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MembersSettings } from './MembersSettings';

const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('./useProjectReview', () => ({
  isForbidden: () => false,
  useProjectMembers: () => ({ data: mocks.data, error: undefined, mutate: vi.fn() }),
}));

vi.mock('../ProjectCreator', () => ({
  default: ({ userId }: { userId: string }) => <div data-testid="creator-row">{userId}</div>,
}));

vi.mock('./MemberRow', () => ({
  MemberRow: ({ isCreator, member }: { isCreator?: boolean; member: { userId: string } }) => (
    <div data-creator={String(!!isCreator)} data-testid="member-row">
      {member.userId}
    </div>
  ),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'user_me' } }),
}));

const project = { createdAt: '2026-10-01T08:00:00Z', id: 'proj_1', userId: 'user_creator' };

beforeEach(() => {
  mocks.data = undefined;
});

describe('MembersSettings', () => {
  it('lists the creator in a personal project, above the workspace-only note', () => {
    mocks.data = { workspaceId: null };

    render(<MembersSettings project={project} />);

    expect(screen.getByTestId('creator-row')).toHaveTextContent('user_creator');
    expect(screen.getByText('review.members.workspaceOnly')).toBeInTheDocument();
  });

  it('lists the creator first when they have no project role', () => {
    mocks.data = {
      availableMembers: [],
      members: [{ id: 'm1', role: 'reviewer', userId: 'user_other' }],
      workspaceId: 'ws_1',
    };

    render(<MembersSettings project={project} />);

    expect(screen.getByTestId('creator-row')).toBeInTheDocument();
    expect(screen.getByTestId('member-row')).toHaveAttribute('data-creator', 'false');
  });

  it('tags the creator on their role row instead of listing them twice', () => {
    mocks.data = {
      availableMembers: [],
      members: [{ id: 'm1', role: 'reviewer', userId: 'user_creator' }],
      workspaceId: 'ws_1',
    };

    render(<MembersSettings project={project} />);

    expect(screen.queryByTestId('creator-row')).toBeNull();
    expect(screen.getByTestId('member-row')).toHaveAttribute('data-creator', 'true');
  });
});
