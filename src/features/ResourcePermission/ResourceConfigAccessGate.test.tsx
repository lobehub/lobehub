import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResourceGeneralAccess } from '@/services/resourcePermission';

import ResourceConfigAccessGate from './ResourceConfigAccessGate';

const mocks = vi.hoisted(() => ({
  access: undefined as Partial<ResourceGeneralAccess> | undefined,
  accessError: undefined as unknown,
  accessResolved: true,
  canEditContent: true,
  canEditResource: false,
  navigate: vi.fn(),
  retryAccess: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { info: mocks.toastInfo },
}));
vi.mock('@/components/AsyncBoundary', () => ({
  default: ({
    children,
    error,
    isLoading,
    loading,
  }: {
    children: ReactNode;
    error?: unknown;
    isLoading: boolean;
    loading: ReactNode;
  }) => (error ? <div>Access error</div> : isLoading ? loading : children),
}));
vi.mock('@/components/Skeleton/Surface', () => ({ default: () => <div>Skeleton</div> }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canEditContent }),
}));
vi.mock('./useResourceAccess', () => ({
  useResourceAccess: () => ({
    access: mocks.access,
    accessError: mocks.accessError,
    canEditResource: mocks.canEditResource,
    isAccessResolved: mocks.accessResolved,
    retryAccess: mocks.retryAccess,
  }),
}));

const renderGate = (
  resourceType: 'agent' | 'agentGroup' = 'agent',
  loading?: ReactNode,
  requiredAccess: 'edit' | 'manage' = 'edit',
) =>
  render(
    <ResourceConfigAccessGate
      loading={loading}
      redirectPath="/agent/agent-1"
      requiredAccess={requiredAccess}
      resourceId="agent-1"
      resourceType={resourceType}
    >
      <div>Agent config</div>
    </ResourceConfigAccessGate>,
  );

describe('ResourceConfigAccessGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access = { accessLevel: 'use', canManage: false };
    mocks.accessError = undefined;
    mocks.canEditContent = true;
    mocks.canEditResource = false;
    mocks.accessResolved = true;
  });

  it('uses workspace-aware navigation when returning a chat-only collaborator to chat', async () => {
    renderGate();

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/agent/agent-1', { replace: true });
    });
    expect(mocks.toastInfo).toHaveBeenCalledWith('permission.configAccess.agentChatOnly');
  });

  // "only collaborators with Can edit" read as an authorship denial to
  // users who had authored the resource; the two denial reasons are now distinct.
  it('names the workspace role as the reason when the role cannot configure Agents', async () => {
    mocks.canEditContent = false;
    mocks.canEditResource = true;

    renderGate();

    await waitFor(() => {
      expect(mocks.toastInfo).toHaveBeenCalledWith('permission.configAccess.agentRoleRestricted');
    });
  });

  it('names the workspace role as the reason for agent groups too', async () => {
    mocks.canEditContent = false;
    mocks.canEditResource = true;

    renderGate('agentGroup');

    await waitFor(() => {
      expect(mocks.toastInfo).toHaveBeenCalledWith('permission.configAccess.groupRoleRestricted');
    });
  });

  it('keeps the resource-level message for a group the caller may only use', async () => {
    renderGate('agentGroup');

    await waitFor(() => {
      expect(mocks.toastInfo).toHaveBeenCalledWith('permission.configAccess.groupChatOnly');
    });
  });

  it('explains when Agent sharing requires creator or admin access', async () => {
    mocks.canEditResource = true;

    renderGate('agent', undefined, 'manage');

    await waitFor(() => {
      expect(mocks.toastInfo).toHaveBeenCalledWith('permission.configAccess.agentManageRestricted');
    });
  });

  it('uses the surface-specific loading state while access is resolving', () => {
    mocks.access = undefined;
    mocks.accessResolved = false;

    const { getByText } = renderGate('agent', <div>Profile loading</div>);

    expect(getByText('Profile loading')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('opens the config page from the record on screen without waiting for the server', () => {
    // A persisted grant that this session has not re-fetched yet.
    mocks.access = { accessLevel: 'edit', canManage: false };
    mocks.canEditResource = true;

    const { getByText, queryByText } = renderGate();

    expect(getByText('Agent config')).toBeInTheDocument();
    expect(queryByText('Skeleton')).toBeNull();
  });

  it('opens the share page from a persisted management grant', () => {
    mocks.access = { accessLevel: 'view', canManage: true };
    mocks.canEditResource = true;

    const { getByText } = renderGate('agent', undefined, 'manage');

    expect(getByText('Agent config')).toBeInTheDocument();
  });

  it('returns a chat-only caller to chat from the record on screen, without a skeleton', () => {
    // A persisted use-only record: decided on the first render.
    const { queryByText } = renderGate();

    expect(queryByText('Skeleton')).toBeNull();
    expect(queryByText('Agent config')).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agent-1', { replace: true });
  });

  it('redirects when a revalidation withdraws the grant on screen', () => {
    mocks.access = { accessLevel: 'edit', canManage: false };
    mocks.canEditResource = true;
    const { getByText, queryByText, rerender } = renderGate();
    expect(getByText('Agent config')).toBeInTheDocument();

    mocks.access = { accessLevel: 'use', canManage: false };
    mocks.canEditResource = false;
    rerender(
      <ResourceConfigAccessGate
        redirectPath="/agent/agent-1"
        resourceId="agent-1"
        resourceType="agent"
      >
        <div>Agent config</div>
      </ResourceConfigAccessGate>,
    );

    expect(queryByText('Agent config')).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agent-1', { replace: true });
  });

  it('redirects once the server denies access with no record left', () => {
    mocks.access = undefined;

    renderGate();

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agent-1', { replace: true });
  });

  it('shows the error page when the first load fails with nothing to render', () => {
    mocks.access = undefined;
    mocks.accessResolved = false;
    mocks.accessError = new Error('offline');

    const { getByText } = renderGate();

    expect(getByText('Access error')).toBeInTheDocument();
  });
});
