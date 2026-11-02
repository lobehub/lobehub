import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useOpenCreateAgentModal } from './useOpenCreateAgentModal';

const mocks = vi.hoisted(() => ({
  canCreate: true,
  navigate: vi.fn(),
  openCreateAgentIdentityModal: vi.fn(),
}));

vi.mock('./index', () => ({
  openCreateAgentIdentityModal: mocks.openCreateAgentIdentityModal,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canCreate }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canCreate = true;
});

describe('useOpenCreateAgentModal', () => {
  it('opens the identity form and lands the new agent on its profile', () => {
    const { result } = renderHook(() => useOpenCreateAgentModal());

    result.current({ groupId: 'grp', visibility: 'private' });

    expect(mocks.openCreateAgentIdentityModal).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ groupId: 'grp', visibility: 'private' }),
    );
    const { onCreated } = mocks.openCreateAgentIdentityModal.mock.calls[0][0];
    onCreated('agent-new');
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agent-new/profile');
  });

  it('does nothing without create permission', () => {
    mocks.canCreate = false;
    const { result } = renderHook(() => useOpenCreateAgentModal());

    result.current();

    expect(mocks.openCreateAgentIdentityModal).not.toHaveBeenCalled();
  });
});
