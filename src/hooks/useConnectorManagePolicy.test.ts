import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectorManageable } from './useConnectorManagePolicy';

const mocks = vi.hoisted(() => ({
  policy: undefined as
    { canEditPolicy: boolean; canManage: boolean; memberManage: string } | undefined,
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: () => ({ data: mocks.policy }),
}));

vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: (userId?: string | null) => !userId || userId === 'me',
}));

const manageable = (connector?: { agentId?: string | null; userId?: string | null }) =>
  renderHook(() => useConnectorManageable(connector)).result.current;

describe('useConnectorManageable', () => {
  beforeEach(() => {
    mocks.policy = { canEditPolicy: false, canManage: true, memberManage: 'all_members' };
  });

  it("lets members maintain a shared row but keeps another member's credentials out", () => {
    expect(manageable({ userId: 'arvin' })).toEqual({
      canManage: true,
      canManageCredentials: false,
      restrictedByPolicy: false,
    });
    expect(manageable({ userId: 'me' })).toEqual({
      canManage: true,
      canManageCredentials: true,
      restrictedByPolicy: false,
    });
  });

  it('blocks every write on shared rows when the policy restricts members', () => {
    mocks.policy = { canEditPolicy: false, canManage: false, memberManage: 'admins_only' };

    expect(manageable({ userId: 'me' })).toEqual({
      canManage: false,
      canManageCredentials: false,
      restrictedByPolicy: true,
    });
  });

  it('keeps the creator rule for agent-scoped rows regardless of the policy', () => {
    mocks.policy = { canEditPolicy: false, canManage: false, memberManage: 'admins_only' };

    expect(manageable({ agentId: 'a1', userId: 'me' })).toMatchObject({ canManage: true });
    expect(manageable({ agentId: 'a1', userId: 'arvin' })).toMatchObject({ canManage: false });
  });
});
