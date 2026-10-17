import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ResourceConfigAccessGate from './ResourceConfigAccessGate';

const mocks = vi.hoisted(() => ({
  accessConfirmed: true,
  accessError: undefined as Error | undefined,
  accessResolved: true,
  canEditContent: true,
  canEditResource: false,
  canManageResource: false,
  // Generation of the confirming request; Infinity = issued after the gate opened.
  confirmedGeneration: Number.POSITIVE_INFINITY as number | undefined,
  generation: 0,
  isValidating: false,
  navigate: vi.fn(),
  retryAccess: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { info: mocks.toastInfo },
}));
vi.mock('@/components/AsyncBoundary', () => ({
  // Mirrors the real precedence: loading → error → children, and a settled
  // `data` keeps children on screen through a failed revalidation.
  default: ({
    children,
    data,
    error,
    isLoading,
    loading,
  }: {
    children: ReactNode;
    data: unknown;
    error?: unknown;
    isLoading: boolean;
    loading: ReactNode;
  }) =>
    data !== undefined ? (
      children
    ) : isLoading ? (
      loading
    ) : error ? (
      <div>Access error</div>
    ) : (
      children
    ),
}));
vi.mock('@/components/Skeleton/Surface', () => ({ default: () => null }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canEditContent }),
}));
vi.mock('./useResourceAccess', () => ({
  getAccessRequestGeneration: () => mocks.generation,
  useResourceAccess: () => ({
    accessError: mocks.accessError,
    canEditResource: mocks.canEditResource,
    canManageResource: mocks.canManageResource,
    confirmedGeneration: mocks.confirmedGeneration,
    isAccessConfirmed: mocks.accessConfirmed,
    isAccessResolved: mocks.accessResolved,
    isLoading: false,
    isValidating: mocks.isValidating,
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
    mocks.canEditContent = true;
    mocks.canEditResource = false;
    mocks.canManageResource = false;
    mocks.accessConfirmed = true;
    mocks.accessError = undefined;
    mocks.accessResolved = true;
    mocks.confirmedGeneration = Number.POSITIVE_INFINITY;
    mocks.generation = 0;
    mocks.isValidating = false;
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

  // Stale-first: a persisted grant renders the config page on first paint
  // while the access record revalidates, instead of a full-form skeleton.
  it('renders the config page from a cached grant while access revalidates', () => {
    mocks.accessConfirmed = false;
    mocks.canEditResource = true;

    const { getByText } = renderGate('agent', <div>Profile loading</div>);

    expect(getByText('Agent config')).toBeInTheDocument();
  });

  it('waits for revalidation before acting on a cached denial', async () => {
    mocks.accessConfirmed = false;

    const { getByText, rerender } = renderGate('agent', <div>Profile loading</div>);

    expect(getByText('Profile loading')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();

    mocks.accessConfirmed = true;
    rerender(
      <ResourceConfigAccessGate
        loading={<div>Profile loading</div>}
        redirectPath="/agent/agent-1"
        resourceId="agent-1"
        resourceType="agent"
      >
        <div>Agent config</div>
      </ResourceConfigAccessGate>,
    );

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/agent/agent-1', { replace: true });
    });
  });

  // Regression: a cached-but-blocked state counted as settled, so when its
  // re-check failed the boundary kept the child skeleton forever with no Retry.
  it('shows the error state when a cached denial fails to revalidate', () => {
    mocks.accessConfirmed = false;
    mocks.accessError = new Error('network');

    const { getByText, queryByText } = renderGate('agent', <div>Profile loading</div>);

    expect(getByText('Access error')).toBeInTheDocument();
    expect(queryByText('Profile loading')).not.toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('shows the error state when an unconfirmed manage gate fails to revalidate', () => {
    mocks.accessConfirmed = false;
    mocks.accessError = new Error('network');
    mocks.canEditResource = true;

    const { getByText } = renderGate('agent', <div>Profile loading</div>, 'manage');

    expect(getByText('Access error')).toBeInTheDocument();
  });

  it('keeps a cached grant on screen when its revalidation fails', () => {
    mocks.accessConfirmed = false;
    mocks.accessError = new Error('network');
    mocks.canEditResource = true;

    const { getByText } = renderGate('agent', <div>Profile loading</div>);

    expect(getByText('Agent config')).toBeInTheDocument();
  });

  // Regression: a view-only record a sidebar row confirmed earlier this session
  // stayed confirmed, so after a same-session grant the gate redirected before
  // its own re-check could return the new access.
  it('does not redirect on a denial confirmed before the gate mounted', async () => {
    mocks.confirmedGeneration = 0;

    const { getByText, rerender } = renderGate('agent', <div>Profile loading</div>);

    expect(getByText('Profile loading')).toBeInTheDocument();
    await waitFor(() => expect(mocks.retryAccess).toHaveBeenCalledTimes(1));
    expect(mocks.navigate).not.toHaveBeenCalled();

    // The re-check returns the new grant.
    mocks.confirmedGeneration = Number.POSITIVE_INFINITY;
    mocks.canEditResource = true;
    rerender(
      <ResourceConfigAccessGate
        loading={<div>Profile loading</div>}
        redirectPath="/agent/agent-1"
        resourceId="agent-1"
        resourceType="agent"
      >
        <div>Agent config</div>
      </ResourceConfigAccessGate>,
    );

    expect(getByText('Agent config')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  // Regression: SWR keeps the previous error while Retry revalidates, so the
  // blocked gate kept an enabled Retry with no progress feedback.
  it('shows progress instead of the error while a blocked retry is in flight', () => {
    mocks.accessConfirmed = false;
    mocks.accessError = new Error('network');
    mocks.isValidating = true;

    const { getByText, queryByText } = renderGate('agent', <div>Profile loading</div>);

    expect(getByText('Profile loading')).toBeInTheDocument();
    expect(queryByText('Access error')).not.toBeInTheDocument();
  });

  // Regression: router reuses the gate across `/agent/A/profile` →
  // `/agent/B/profile`, so a denial of B confirmed after A opened (but before
  // B did) passed the freshness check and redirected before B's re-check.
  it('requires a fresh check per resource when the gate is reused', async () => {
    mocks.generation = 1;
    mocks.canEditResource = true;
    const gate = (resourceId: string) => (
      <ResourceConfigAccessGate
        loading={<div>Profile loading</div>}
        redirectPath="/agent/agent-1"
        resourceId={resourceId}
        resourceType="agent"
      >
        <div>Agent config</div>
      </ResourceConfigAccessGate>
    );
    const { getByText, rerender } = render(gate('agent-a'));
    expect(getByText('Agent config')).toBeInTheDocument();

    // B's view-only record was confirmed by request 2, after A opened (at 1)
    // but before B opened (at 3).
    mocks.generation = 3;
    mocks.canEditResource = false;
    mocks.confirmedGeneration = 2;
    rerender(gate('agent-b'));

    expect(getByText('Profile loading')).toBeInTheDocument();
    await waitFor(() => expect(mocks.retryAccess).toHaveBeenCalledTimes(1));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  // Regression: freshness compared millisecond timestamps with `>=`, so a
  // sidebar request issued in the same millisecond the gate opened counted as
  // the gate's own re-check. Generations order requests strictly.
  it('does not treat a request issued before opening as fresh, even at the same instant', async () => {
    mocks.generation = 5;
    mocks.confirmedGeneration = 5;

    const { getByText } = renderGate('agent', <div>Profile loading</div>);

    expect(getByText('Profile loading')).toBeInTheDocument();
    await waitFor(() => expect(mocks.retryAccess).toHaveBeenCalledTimes(1));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
