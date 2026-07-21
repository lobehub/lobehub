import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ResourceConfigAccessGate from './ResourceConfigAccessGate';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', () => ({ toast: { info: mocks.toastInfo } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/AsyncBoundary', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/Loading/BrandTextLoading', () => ({ default: () => null }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('./useResourceAccess', () => ({
  useResourceAccess: () => ({
    accessError: undefined,
    canEditResource: false,
    isAccessResolved: true,
    isLoading: false,
    retryAccess: vi.fn(),
  }),
}));

describe('ResourceConfigAccessGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses workspace-aware navigation when returning a chat-only collaborator to chat', async () => {
    render(
      <ResourceConfigAccessGate
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
    expect(mocks.toastInfo).toHaveBeenCalledWith('permission.configAccess.agentChatOnly');
  });
});
