import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGroupPermission } from './useGroupPermission';

const mocks = vi.hoisted(() => ({
  access: undefined as { accessLevel: string; canManage: boolean } | undefined,
  accessError: undefined as unknown,
  canEditContent: true,
  groupMap: {} as Record<string, object>,
  permissionResourceId: undefined as string | undefined,
  policiesAgentId: undefined as string | undefined,
  setAccessLevel: vi.fn(),
  setModelPolicy: vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canEditContent }),
}));

// The Editable-settings half is the shared agent hook; assert which agent the
// group page points it at rather than re-testing its internals.
vi.mock('@/features/ResourcePermission/useAgentSelectionPolicies', () => ({
  useAgentSelectionPolicies: (agentId: string) => {
    mocks.policiesAgentId = agentId;

    return {
      canFixExecutionTarget: true,
      executionTargetPolicy: 'member',
      modelPolicy: 'member',
      setExecutionTargetPolicy: vi.fn(),
      setModelPolicy: mocks.setModelPolicy,
    };
  },
}));

vi.mock('@/features/ResourcePermission/useResourcePermission', () => ({
  useResourcePermission: (_type: string, resourceId: string | undefined) => {
    mocks.permissionResourceId = resourceId;

    return {
      data: mocks.access,
      error: mocks.accessError,
      isLoading: false,
      mutate: vi.fn(),
      setAccessLevel: mocks.setAccessLevel,
      updating: false,
    };
  },
}));

vi.mock('@/projection', () => ({
  chatGroupProjectionSelectors: {
    getGroupById: (groupId: string) => () => mocks.groupMap[groupId],
  },
  useChatGroupProjection: (selector: (scope?: unknown) => unknown) => selector(undefined),
}));

const workspaceGroup = (overrides: Record<string, unknown> = {}) => ({
  id: 'group-1',
  supervisorAgentId: 'agt-supervisor',
  visibility: 'public',
  workspaceId: 'workspace-1',
  ...overrides,
});

const setup = (groupId = 'group-1') => renderHook(() => useGroupPermission(groupId));

describe('useGroupPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access = { accessLevel: 'edit', canManage: true };
    mocks.accessError = undefined;
    mocks.canEditContent = true;
    mocks.permissionResourceId = undefined;
    mocks.policiesAgentId = undefined;
    mocks.groupMap = { 'group-1': workspaceGroup() };
  });

  it('exposes member access for a shared workspace group', () => {
    const { result } = setup();

    expect(result.current.isWorkspaceGroup).toBe(true);
    expect(mocks.permissionResourceId).toBe('group-1');
    expect(result.current.accessLevel).toBe('edit');
    expect(result.current.canManageAccess).toBe(true);
  });

  it('keeps the member level readable and settable on a private group', () => {
    // The server stores it and `publishGroupToWorkspace` reads it back, so the
    // creator can decide ahead of sharing.
    mocks.groupMap = { 'group-1': workspaceGroup({ visibility: 'private' }) };

    const { result } = setup();

    expect(result.current.isPrivate).toBe(true);
    expect(mocks.permissionResourceId).toBe('group-1');
    expect(result.current.canManageAccess).toBe(true);
  });

  it('reports a personal group as out of scope for permissions', () => {
    mocks.groupMap = { 'group-1': { id: 'group-1', visibility: 'private' } };

    const { result } = setup();

    expect(result.current.isWorkspaceGroup).toBe(false);
    // No workspace means no permission row to fetch at all.
    expect(mocks.permissionResourceId).toBeUndefined();
  });

  it('reports a member who cannot re-level the group', () => {
    mocks.access = { accessLevel: 'use', canManage: false };

    const { result } = setup();

    expect(result.current.canManageAccess).toBe(false);
    expect(result.current.accessLevel).toBe('use');
  });

  it('forwards a level change to the permission service', () => {
    const { result } = setup();

    result.current.setAccessLevel('use');

    expect(mocks.setAccessLevel).toHaveBeenCalledWith('use');
  });

  it('surfaces a failed permission fetch instead of an empty level', () => {
    mocks.access = undefined;
    mocks.accessError = new Error('boom');

    const { result } = setup();

    expect(result.current.accessError).toBeInstanceOf(Error);
    expect(result.current.accessLevel).toBeUndefined();
    expect(result.current.canManageAccess).toBe(false);
  });

  describe('editable settings', () => {
    it('reads and writes the policies on the supervisor agent', () => {
      // A group conversation IS a conversation with the supervisor
      // (`useGroupContext` resolves the chat agentId to supervisorAgentId), so
      // the group chat's model switcher reads exactly that row.
      const { result } = setup();

      expect(mocks.policiesAgentId).toBe('agt-supervisor');
      expect(result.current.modelPolicy).toBe('member');
      expect(result.current.executionTargetPolicy).toBe('member');

      result.current.setModelPolicy('fixed');
      expect(mocks.setModelPolicy).toHaveBeenCalledWith('fixed');
    });

    it('reports a group whose supervisor has not resolved yet', () => {
      mocks.groupMap = { 'group-1': workspaceGroup({ supervisorAgentId: undefined }) };

      const { result } = setup();

      expect(result.current.hasSupervisor).toBe(false);
      // No row to write to — the form hides the card rather than saving to ''.
      expect(mocks.policiesAgentId).toBe('');
    });

    it('gates the policies on the role-level content permission', () => {
      mocks.canEditContent = false;

      const { result } = setup();

      expect(result.current.canEditConfig).toBe(false);
    });
  });
});
