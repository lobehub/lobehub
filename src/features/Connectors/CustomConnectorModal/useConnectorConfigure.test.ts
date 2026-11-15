import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import { useConnectorConfigure } from './useConnectorConfigure';

const mocks = vi.hoisted(() => ({
  isOwner: false,
  openConnectorEditDrawer: vi.fn(),
  policy: undefined as
    { canEditPolicy: boolean; canManage: boolean; memberManage: string } | undefined,
}));

vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useClientDataSWR: () => ({ data: mocks.policy, error: undefined }),
}));
vi.mock('@/business/client/hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => mocks.isOwner,
}));
vi.mock('./imperative', () => ({ openConnectorEditDrawer: mocks.openConnectorEditDrawer }));

const connector = (overrides: Record<string, unknown> = {}) => ({
  id: 'conn-1',
  mcpConnectionType: 'http',
  userId: 'me',
  ...overrides,
});

const configureOf = (row: ReturnType<typeof connector>) =>
  renderHook(() => useConnectorConfigure()).result.current(row);

describe('useConnectorConfigure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isOwner = false;
    mocks.policy = { canEditPolicy: false, canManage: true, memberManage: 'all_members' };
    useUserStore.setState({ user: { id: 'me' } } as never);
  });

  it("opens the edit drawer on the viewer's own connector", () => {
    configureOf(connector())?.onConfigure();

    expect(mocks.openConnectorEditDrawer).toHaveBeenCalledWith('conn-1');
  });

  // The drawer reads the stored credentials (`connector.getForEdit`), which the
  // server refuses to another workspace member: the picker must not offer it.
  it("offers no Configure on another member's connector unless the viewer owns the workspace", () => {
    expect(configureOf(connector({ userId: 'arvin' }))).toBeUndefined();

    mocks.isOwner = true;
    expect(configureOf(connector({ userId: 'arvin' }))).toBeDefined();
  });

  it('offers no Configure while the policy loads or when it restricts the viewer', () => {
    mocks.policy = undefined;
    expect(configureOf(connector())).toBeUndefined();

    mocks.policy = { canEditPolicy: false, canManage: false, memberManage: 'admins_only' };
    expect(configureOf(connector())).toBeUndefined();
  });

  it('offers no Configure on a market-hosted connector, which has no connection settings', () => {
    expect(configureOf(connector({ mcpConnectionType: 'cloud' }))).toBeUndefined();
  });
});
