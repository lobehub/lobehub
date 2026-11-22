import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canGoNative } from '@/libs/contextMenu/canGoNative';

import { useAgentVisibilityMenu } from './useAgentVisibilityMenu';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: 'workspace-1' as string | null,
  canEdit: true,
  canEditResource: true,
  confirmModal: vi.fn(),
  publishAgentToWorkspace: vi.fn(),
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

vi.mock('../../../../hooks', () => ({ useRevealSidebarSection: () => vi.fn() }));

type Params = Parameters<typeof useAgentVisibilityMenu>[0];

const render = (params: Partial<Params> = {}) =>
  renderHook(() =>
    useAgentVisibilityMenu({ id: 'agent-1', userId: 'me', visibility: 'private', ...params }),
  ).result.current;

type CheckboxOption = {
  checked: boolean;
  desc: string;
  key: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

const options = (menu: ReturnType<typeof useAgentVisibilityMenu>) =>
  menu.options as unknown as CheckboxOption[];

describe('useAgentVisibilityMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspaceId = 'workspace-1';
    mocks.canEdit = true;
    mocks.canEditResource = true;
  });

  it('shows the current scope on the Visibility row and checks it in the options', () => {
    const menu = render({ visibility: 'private' });

    expect(menu.canChange).toBe(true);
    expect(menu.submenu).toMatchObject({
      extra: 'agent.visibility.private',
      key: 'visibility',
      label: 'agent.visibility',
    });
    expect(
      options(menu).map(({ checked, desc, key, label }) => ({ checked, desc, key, label })),
    ).toEqual([
      {
        checked: true,
        desc: 'agent.visibility.privateDesc',
        key: 'visibility-private',
        label: 'agent.visibility.private',
      },
      {
        checked: false,
        desc: 'agent.visibility.workspaceDesc',
        key: 'visibility-public',
        label: 'agent.visibility.workspace',
      },
    ]);
  });

  it('labels a published Agent as Workspace', () => {
    const menu = render({ visibility: 'public' });

    expect(menu.submenu).toMatchObject({ extra: 'agent.visibility.workspace' });
    expect(options(menu).find((o) => o.checked)?.key).toBe('visibility-public');
  });

  it('stays eligible for the native desktop context menu', () => {
    const menu = render();

    expect(canGoNative([menu.submenu])).toBe(true);
  });

  it('confirms and publishes when Workspace is picked on a private Agent', async () => {
    const menu = render({ visibility: 'private' });

    options(menu)[1].onCheckedChange(true);
    expect(mocks.confirmModal).toHaveBeenCalledTimes(1);

    await act(async () => {
      await mocks.confirmModal.mock.calls[0][0].onOk();
    });

    expect(mocks.publishAgentToWorkspace).toHaveBeenCalledWith('agent-1');
    expect(mocks.refreshAgentList).toHaveBeenCalled();
    expect(mocks.refreshWorkspaceUserPreference).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('agent.publishToWorkspaceSuccess');
  });

  it('confirms and makes private when Private is picked on a published Agent', async () => {
    const menu = render({ visibility: 'public' });

    options(menu)[0].onCheckedChange(true);
    expect(mocks.confirmModal).toHaveBeenCalledTimes(1);

    await act(async () => {
      await mocks.confirmModal.mock.calls[0][0].onOk();
    });

    expect(mocks.setAgentVisibility).toHaveBeenCalledWith('agent-1', 'private');
  });

  it('does nothing when the current scope is picked again', () => {
    const menu = render({ visibility: 'private' });

    options(menu)[0].onCheckedChange(false);
    options(menu)[0].onCheckedChange(true);

    expect(mocks.confirmModal).not.toHaveBeenCalled();
  });

  it("does not let a member change another member's published Agent", () => {
    const menu = render({ userId: 'someone-else', visibility: 'public' });

    expect(menu).toEqual({ canChange: false, options: [], submenu: null });
  });

  it('is absent outside a workspace', () => {
    mocks.activeWorkspaceId = null;

    expect(render().canChange).toBe(false);
  });

  it('is absent on builtin agents', () => {
    expect(render({ slug: 'inbox', visibility: 'public' }).canChange).toBe(false);
  });

  it('is absent when the viewer cannot configure the Agent', () => {
    mocks.canEditResource = false;

    expect(render().canChange).toBe(false);
  });
});
