import { type UserCredSummary } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type CredsApi } from './useCredsApi';
import WorkspaceCredsList from './WorkspaceCredsList';

vi.mock('@/layout/AuthProvider/MarketAuth', () => ({
  useMarketAuth: () => ({ session: { userInfo: { accountId: 1 } } }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: '' }),
}));

vi.mock('@/libs/trpc/client', () => ({ lambdaClient: { market: { creds: {} } } }));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { avatar: 'me.png', fullName: 'Me' } }),
}));

const { createViewCredModal } = vi.hoisted(() => ({ createViewCredModal: vi.fn() }));
vi.mock('./ViewCredModal', () => ({ createViewCredModal }));

const cred = (overrides: Partial<UserCredSummary>): UserCredSummary =>
  ({
    createdAt: '2026-11-19T00:00:00.000Z',
    createdByAccountId: 1,
    id: 1,
    key: 'KEY',
    name: 'cred',
    ownerType: 'organization',
    type: 'kv-env',
    updatedAt: '2026-11-19T00:00:00.000Z',
    visibility: 'public',
    ...overrides,
  }) as UserCredSummary;

const credsApiWith = (rows: UserCredSummary[]) =>
  ({
    client: { delete: { mutate: vi.fn() } },
    query: {
      list: {
        useQuery: () => ({
          data: { data: rows },
          error: null,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
    },
    setVisibility: vi.fn(),
  }) as unknown as CredsApi;

describe('WorkspaceCredsList', () => {
  it("shows each row's visibility and, for the viewer's own credentials, their avatar", () => {
    render(
      <WorkspaceCredsList
        credsApi={credsApiWith([
          cred({ id: 1, key: 'TEAM_TOKEN', name: 'Team token', visibility: 'public' }),
          cred({ id: 2, key: 'MY_TOKEN', name: 'My token', visibility: 'private' }),
          cred({ createdByAccountId: 9, id: 3, key: 'OTHER', name: 'Other', visibility: 'public' }),
        ])}
      />,
    );

    // Visibility is an icon beside the name (team or lock), labelled for screen readers.
    const workspaceIcon = screen.getByTestId('cred-visibility-1');
    expect(workspaceIcon).toHaveAttribute('data-visibility', 'workspace');
    expect(workspaceIcon).toHaveAccessibleName('visibilityFilter.workspace');
    expect(workspaceIcon.parentElement).toHaveTextContent('Team token');
    expect(screen.getByTestId('cred-visibility-2')).toHaveAttribute('data-visibility', 'private');
    expect(screen.queryByText('visibilityFilter.workspace')).toBeNull();
    expect(screen.getByTestId('cred-author-1')).toBeInTheDocument();
    // Market returns no profile for another member's workspace credential.
    expect(screen.queryByTestId('cred-author-3')).toBeNull();
    // The row no longer carries a write-only tag or a private lock.
    expect(screen.queryByText('creds.writeOnly.tag')).toBeNull();
    expect(screen.queryByTestId('private-lock')).toBeNull();
  });

  it('explains write-only values in the detail instead of reading them', () => {
    render(
      <WorkspaceCredsList
        credsApi={credsApiWith([
          cred({ id: 1, key: 'TEAM_TOKEN', name: 'Team token', visibility: 'public' }),
          cred({ id: 2, key: 'MY_TOKEN', name: 'My token', visibility: 'private' }),
        ])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Team token/ }));
    fireEvent.click(screen.getByRole('button', { name: /My token/ }));

    const [team, mine] = createViewCredModal.mock.calls.map((call) => call[0]);
    expect(team.canReadValues).toBe(false);
    expect(team.valuesHint).toBe('creds.writeOnly.tooltip');
    expect(mine.canReadValues).toBe(true);
    expect(mine.valuesHint).toBeUndefined();
    expect(mine.extraItems.map((item: { key: string }) => item.key)).toEqual([
      'visibility',
      'author',
    ]);
    createViewCredModal.mockClear();
  });

  it('opens the detail from the row, carrying its remove, edit and visibility actions', () => {
    render(
      <WorkspaceCredsList
        credsApi={credsApiWith([
          cred({ id: 2, key: 'MY_TOKEN', name: 'My token', visibility: 'private' }),
        ])}
      />,
    );

    // No "..." menu on the row any more: the row itself is the button.
    expect(screen.queryByTitle('more')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /My token/ }));

    expect(createViewCredModal).toHaveBeenCalledTimes(1);
    const props = createViewCredModal.mock.calls[0][0];
    expect(props.cred.id).toBe(2);
    expect(props.onDelete).toBeTypeOf('function');
    expect(props.onEdit).toBeTypeOf('function');
    expect(props.actions.map((action: { key: string }) => action.key)).toContain('publish');
  });
});
