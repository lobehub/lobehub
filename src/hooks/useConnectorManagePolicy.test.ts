import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectorManageable } from './useConnectorManagePolicy';

const mocks = vi.hoisted(() => ({
  error: undefined as Error | undefined,
  policy: undefined as
    { canEditPolicy: boolean; canManage: boolean; memberManage: string } | undefined,
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: () => ({ data: mocks.policy, error: mocks.error }),
}));

vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: (userId?: string | null) => !userId || userId === 'me',
}));

const manageable = (connector?: { agentId?: string | null; userId?: string | null }) =>
  renderHook(() => useConnectorManageable(connector)).result.current;

describe('useConnectorManageable', () => {
  beforeEach(() => {
    mocks.error = undefined;
    mocks.policy = { canEditPolicy: false, canManage: true, memberManage: 'all_members' };
  });

  it('keeps actions disabled, without a permission reason, until the policy loads', () => {
    mocks.policy = undefined;

    expect(manageable({ userId: 'me' })).toEqual({
      canManage: false,
      canManageCredentials: false,
      isPending: true,
      restrictedByPolicy: false,
    });
  });

  it('falls back to the default when the policy cannot be read', () => {
    mocks.policy = undefined;
    mocks.error = new Error('network');

    expect(manageable({ userId: 'me' })).toMatchObject({ canManage: true, isPending: false });
  });

  it("lets members maintain a shared row but keeps another member's credentials out", () => {
    expect(manageable({ userId: 'arvin' })).toEqual({
      canManage: true,
      canManageCredentials: false,
      isPending: false,
      restrictedByPolicy: false,
    });
    expect(manageable({ userId: 'me' })).toEqual({
      canManage: true,
      canManageCredentials: true,
      isPending: false,
      restrictedByPolicy: false,
    });
  });

  it('blocks every write on shared rows when the policy restricts members', () => {
    mocks.policy = { canEditPolicy: false, canManage: false, memberManage: 'admins_only' };

    expect(manageable({ userId: 'me' })).toEqual({
      canManage: false,
      canManageCredentials: false,
      isPending: false,
      restrictedByPolicy: true,
    });
  });

  it('keeps the creator rule for agent-scoped rows regardless of the policy', () => {
    mocks.policy = { canEditPolicy: false, canManage: false, memberManage: 'admins_only' };

    expect(manageable({ agentId: 'a1', userId: 'me' })).toMatchObject({ canManage: true });
    expect(manageable({ agentId: 'a1', userId: 'arvin' })).toMatchObject({ canManage: false });
  });
});
