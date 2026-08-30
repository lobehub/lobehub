import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentManagementAccess } from './useAgentManagementAccess';

const testState = vi.hoisted(() => ({
  agent: undefined as
    { visibility?: 'private' | 'public'; workspaceId?: string | null } | undefined,
  permission: {
    canManageResource: false,
    isAccessResolved: true,
    isLoading: false,
  },
}));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => testState.permission,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/store/agent/projection', () => ({
  useAgentData: () => testState.agent,
}));

describe('useAgentManagementAccess', () => {
  beforeEach(() => {
    testState.agent = undefined;
    testState.permission.canManageResource = false;
    testState.permission.isAccessResolved = true;
    testState.permission.isLoading = false;
  });

  it('fails closed while the Agent identity is loading', () => {
    const { result } = renderHook(() => useAgentManagementAccess('agent-1'));

    expect(result.current).toEqual({ canManageAgent: false, isAccessLoading: true });
  });

  it('uses server-confirmed management access for public Workspace Agents', () => {
    testState.agent = { visibility: 'public', workspaceId: 'workspace-1' };
    testState.permission.canManageResource = true;

    const { result } = renderHook(() => useAgentManagementAccess('agent-1'));

    expect(result.current).toEqual({ canManageAgent: true, isAccessLoading: false });
  });

  it('does not treat an ordinary public-resource editor as an Agent manager', () => {
    testState.agent = { visibility: 'public', workspaceId: 'workspace-1' };

    const { result } = renderHook(() => useAgentManagementAccess('agent-1'));

    expect(result.current).toEqual({ canManageAgent: false, isAccessLoading: false });
  });

  it('keeps personal and private Agents owner-controlled', () => {
    testState.agent = { visibility: 'private', workspaceId: 'workspace-1' };

    const { result } = renderHook(() => useAgentManagementAccess('agent-1'));

    expect(result.current).toEqual({ canManageAgent: true, isAccessLoading: false });
  });
});
