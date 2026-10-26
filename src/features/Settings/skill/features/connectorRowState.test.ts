import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isSettledByConnection, useConnectorManageGate } from './connectorRowState';

const mocks = vi.hoisted(() => ({
  connectors: [] as Array<{ identifier: string; userId?: string }>,
  policy: undefined as
    { canEditPolicy: boolean; canManage: boolean; memberManage: string } | undefined,
}));

vi.mock('@/store/tool', () => ({
  useToolStore: <T>(selector: (state: { connectors: typeof mocks.connectors }) => T): T =>
    selector({ connectors: mocks.connectors }),
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: () => ({ data: mocks.policy }),
}));

vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: (userId?: string | null) => !userId || userId === 'me',
}));

describe('useConnectorManageGate', () => {
  beforeEach(() => {
    mocks.connectors = [];
    mocks.policy = undefined;
  });

  const gate = () => renderHook(() => useConnectorManageGate('gmail')).result.current;

  it('lets a member co-maintain a connection another member created by default', () => {
    mocks.connectors = [{ identifier: 'gmail', userId: 'arvin' }];
    mocks.policy = { canEditPolicy: false, canManage: true, memberManage: 'all_members' };
    expect(gate()).toEqual({ canManage: true });
  });

  it('gates a member out once admins restricted connector management', () => {
    mocks.connectors = [{ identifier: 'gmail', userId: 'me' }];
    mocks.policy = { canEditPolicy: false, canManage: false, memberManage: 'admins_only' };
    expect(gate()).toEqual({ canManage: false });

    // Not connected yet: Connect is gated too, the row itself stays.
    mocks.connectors = [];
    expect(gate()).toEqual({ canManage: false });
  });

  it('keeps the normal flow while the policy is still loading', () => {
    expect(gate()).toEqual({ canManage: true });
  });
});

describe('isSettledByConnection', () => {
  it('clears a connect failure once the connection is active', () => {
    expect(isSettledByConnection(true, { action: 'connect', code: 'AUTH_INCOMPLETE' })).toBe(true);
  });

  it('keeps a failed remove on an active row', () => {
    expect(isSettledByConnection(true, { action: 'remove', code: 'NETWORK' })).toBe(false);
  });

  it('keeps any failure while not connected', () => {
    expect(isSettledByConnection(false, { action: 'connect', code: 'FORBIDDEN' })).toBe(false);
  });
});
