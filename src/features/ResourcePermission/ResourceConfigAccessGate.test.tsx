import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ResourceConfigAccessGate from './ResourceConfigAccessGate';

const mocks = vi.hoisted(() => ({
  accessResolved: true,
  canEditContent: true,
  canEditResource: false,
  canManageResource: false,
  navigate: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { info: mocks.toastInfo },
}));
vi.mock('@/components/AsyncBoundary', () => ({
  default: ({
    children,
    isLoading,
    loading,
  }: {
    children: ReactNode;
    isLoading: boolean;
    loading: ReactNode;
  }) => (isLoading ? loading : children),
}));
vi.mock('@/components/Skeleton/Surface', () => ({ default: () => null }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canEditContent }),
}));
vi.mock('./useResourceAccess', () => ({
  useResourceAccess: () => ({
    accessError: undefined,
    canEditResource: mocks.canEditResource,
    canManageResource: mocks.canManageResource,
    isAccessResolved: mocks.accessResolved,
    isLoading: false,
    retryAccess: vi.fn(),
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
    mocks.canEditContent = true;
    mocks.canEditResource = false;
    mocks.canManageResource = false;
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
    mocks.accessResolved = false;

    const { getByText } = renderGate('agent', <div>Profile loading</div>);

    expect(getByText('Profile loading')).toBeInTheDocument();
  });
});
