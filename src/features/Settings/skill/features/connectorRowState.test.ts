import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isSettledByConnection, useConnectorManageGate } from './connectorRowState';

const mocks = vi.hoisted(() => ({
  connectors: [] as Array<{
    authorizedByName?: string | null;
    identifier: string;
    userId?: string;
  }>,
  isOwner: false,
}));

vi.mock('@/store/tool', () => ({
  useToolStore: <T>(selector: (state: { connectors: typeof mocks.connectors }) => T): T =>
    selector({ connectors: mocks.connectors }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: <T>(selector: (state: { user: { id: string } }) => T): T =>
    selector({ user: { id: 'me' } }),
}));

vi.mock('@/business/client/hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => mocks.isOwner,
}));

describe('useConnectorManageGate', () => {
  beforeEach(() => {
    mocks.connectors = [];
    mocks.isOwner = false;
  });

  const gate = () => renderHook(() => useConnectorManageGate('gmail')).result.current;

  it('gates a member out of a connection another member created, naming the creator', () => {
    mocks.connectors = [{ authorizedByName: 'Arvin', identifier: 'gmail', userId: 'arvin' }];
    expect(gate()).toEqual({ canManage: false, creatorName: 'Arvin' });
  });

  it('lets the creator and a workspace owner manage it', () => {
    mocks.connectors = [{ authorizedByName: 'Me', identifier: 'gmail', userId: 'me' }];
    expect(gate()).toEqual({ canManage: true, creatorName: undefined });

    mocks.connectors = [{ authorizedByName: 'Arvin', identifier: 'gmail', userId: 'arvin' }];
    mocks.isOwner = true;
    expect(gate()).toEqual({ canManage: true, creatorName: undefined });
  });

  it('keeps the normal flow when nobody has connected it yet', () => {
    expect(gate()).toEqual({ canManage: true, creatorName: undefined });
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
