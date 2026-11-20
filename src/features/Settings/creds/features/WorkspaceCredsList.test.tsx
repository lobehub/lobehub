import { type UserCredSummary } from '@lobechat/types';
import { render, screen, within } from '@testing-library/react';
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
  it('lists shared and private credentials together and locks only the private ones', () => {
    render(
      <WorkspaceCredsList
        credsApi={credsApiWith([
          cred({ id: 1, key: 'TEAM_TOKEN', name: 'Team token', visibility: 'public' }),
          cred({ id: 2, key: 'MY_TOKEN', name: 'My token', visibility: 'private' }),
        ])}
      />,
    );

    const shared = screen.getByText('Team token').parentElement!;
    const mine = screen.getByText('My token').parentElement!;

    expect(within(shared).queryByTestId('private-lock')).toBeNull();
    expect(within(mine).getByTestId('private-lock')).toBeInTheDocument();
    expect(screen.getAllByTestId('private-lock')).toHaveLength(1);
  });

  it('marks only workspace credentials shared with everyone as write-only', () => {
    render(
      <WorkspaceCredsList
        credsApi={credsApiWith([
          cred({ id: 1, key: 'TEAM_TOKEN', name: 'Team token', visibility: 'public' }),
          cred({ id: 2, key: 'MY_TOKEN', name: 'My token', visibility: 'private' }),
          cred({
            id: 3,
            key: 'SHARED_IN',
            name: 'Shared in',
            ownerAccountId: 1,
            ownerType: 'user',
            visibility: 'public',
          }),
        ])}
      />,
    );

    // Only "Team token": the private one stays readable by its creator, and a
    // personal credential shared in stays readable by its owner.
    expect(screen.getAllByText('creds.writeOnly.tag')).toHaveLength(1);
  });
});
