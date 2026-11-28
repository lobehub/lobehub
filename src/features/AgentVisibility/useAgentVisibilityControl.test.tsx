import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentVisibilityControl } from './useAgentVisibilityControl';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: 'workspace-1' as string | null,
  canEdit: true,
  canEditResource: true,
  confirmModal: vi.fn(),
  publishAgentToWorkspace: vi.fn(),
  refreshAgentConfig: vi.fn(),
  refreshAgentList: vi.fn(),
  refreshWorkspaceUserPreference: vi.fn(),
  setAgentVisibility: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: mocks.confirmModal,
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: mocks.canEditResource, isAccessResolved: true }),
}));

vi.mock('@/features/VisibilityConfirmContent', () => ({ default: () => null }));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canEdit, reason: '' }),
}));

vi.mock('@/services/agent', () => ({
  agentService: {
    publishAgentToWorkspace: mocks.publishAgentToWorkspace,
    setAgentVisibility: mocks.setAgentVisibility,
  },
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (s: { refreshAgentList: unknown }) => unknown) =>
    selector({ refreshAgentList: mocks.refreshAgentList }),
}));

interface UserStateMock {
  refreshWorkspaceUserPreference: unknown;
  userId: string;
}

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: UserStateMock) => unknown) =>
    selector({
      refreshWorkspaceUserPreference: mocks.refreshWorkspaceUserPreference,
      userId: 'me',
    }),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: (s: UserStateMock) => s.userId },
}));

vi.mock('@/features/HomeSidebar/hooks/useRevealSidebarSection', () => ({
  useRevealSidebarSection: () => vi.fn(),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: { internal_refreshAgentConfig: unknown }) => unknown) =>
    selector({ internal_refreshAgentConfig: mocks.refreshAgentConfig }),
}));

type Params = Parameters<typeof useAgentVisibilityControl>[0];

const render = (params: Partial<Params> = {}) =>
  renderHook(() =>
    useAgentVisibilityControl({ id: 'agent-1', userId: 'me', visibility: 'private', ...params }),
  ).result.current;

describe('useAgentVisibilityControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspaceId = 'workspace-1';
    mocks.canEdit = true;
    mocks.canEditResource = true;
  });

  it('reports the current scope and lets the creator change it', () => {
    expect(render({ visibility: 'private' })).toMatchObject({
      canChange: true,
      current: 'private',
      lockReason: undefined,
    });
    expect(render({ visibility: 'public' })).toMatchObject({ canChange: true, current: 'public' });
  });

  it('confirms and publishes when Workspace is picked on a private Agent', async () => {
    render({ visibility: 'private' }).select('public');
    expect(mocks.confirmModal).toHaveBeenCalledTimes(1);

    await act(async () => {
      await mocks.confirmModal.mock.calls[0][0].onOk();
    });

    expect(mocks.publishAgentToWorkspace).toHaveBeenCalledWith('agent-1');
    expect(mocks.refreshAgentList).toHaveBeenCalled();
    // The settings page reads the agent store, so its scope must refresh too.
    expect(mocks.refreshAgentConfig).toHaveBeenCalledWith('agent-1');
    expect(mocks.refreshWorkspaceUserPreference).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('agent.publishToWorkspaceSuccess');
  });

  it('confirms and makes private when Private is picked on a published Agent', async () => {
    render({ visibility: 'public' }).select('private');
    expect(mocks.confirmModal).toHaveBeenCalledTimes(1);

    await act(async () => {
      await mocks.confirmModal.mock.calls[0][0].onOk();
    });

    expect(mocks.setAgentVisibility).toHaveBeenCalledWith('agent-1', 'private');
    expect(mocks.refreshAgentConfig).toHaveBeenCalledWith('agent-1');
  });

  it('does nothing when the current scope is picked again', () => {
    render({ visibility: 'private' }).select('private');

    expect(mocks.confirmModal).not.toHaveBeenCalled();
  });

  it("locks another member's published Agent and says why", () => {
    const control = render({ userId: 'someone-else', visibility: 'public' });

    expect(control).toMatchObject({
      canChange: false,
      current: 'public',
      lockReason: 'notCreator',
    });
    control.select('private');
    expect(mocks.confirmModal).not.toHaveBeenCalled();
  });

  it('has no scope outside a workspace', () => {
    mocks.activeWorkspaceId = null;

    expect(render()).toMatchObject({ canChange: false, current: undefined });
  });

  it('locks builtin agents', () => {
    expect(render({ slug: 'inbox', visibility: 'public' })).toMatchObject({
      canChange: false,
      lockReason: 'builtin',
    });
  });

  it('is read-only when the viewer cannot configure the Agent', () => {
    mocks.canEditResource = false;

    expect(render().canChange).toBe(false);
  });
});
