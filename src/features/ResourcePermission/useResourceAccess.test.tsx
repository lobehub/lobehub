import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResourceGeneralAccess } from '@/services/resourcePermission';

import { useResourceAccess } from './useResourceAccess';

const testState = vi.hoisted(() => ({
  data: undefined as ResourceGeneralAccess | undefined,
  hasActiveWorkspace: true,
}));

vi.mock('@/business/client/hooks/useHasActiveWorkspace', () => ({
  useHasActiveWorkspace: () => testState.hasActiveWorkspace,
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({
    data: testState.data,
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

describe('useResourceAccess', () => {
  beforeEach(() => {
    testState.data = undefined;
    testState.hasActiveWorkspace = true;
  });

  it('does not apply view-only Member Permissions to an Agent author or admin', () => {
    testState.data = {
      accessLevel: 'view',
      canManage: true,
      creatorId: 'creator',
      generalAccess: 'viewer',
      visibility: 'public',
    };

    const { result } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({
      canEditResource: true,
      canManageResource: true,
      canUseResource: true,
    });
  });

  it('still applies view-only Member Permissions to an ordinary member', () => {
    testState.data = {
      accessLevel: 'view',
      canManage: false,
      creatorId: 'creator',
      generalAccess: 'viewer',
      visibility: 'public',
    };

    const { result } = renderHook(() => useResourceAccess('agent', 'agent-1'));

    expect(result.current).toMatchObject({
      canEditResource: false,
      canManageResource: false,
      canUseResource: false,
    });
  });
});
