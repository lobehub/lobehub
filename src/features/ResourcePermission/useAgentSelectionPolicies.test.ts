/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentSelectionPolicies } from './useAgentSelectionPolicies';

const state = vi.hoisted(() => ({
  agent: {
    agencyConfig: {
      boundDeviceId: 'ws-device',
      executionTarget: 'device',
      executionTargetSelectionPolicy: 'member',
    },
    id: 'agent-1',
    userId: 'user-1',
  } as Record<string, unknown>,
  deviceList: { data: [] as unknown[], isConfirmed: false },
  updateAgentConfigById: vi.fn(),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) =>
    selector({ agentMap: {}, updateAgentConfigById: state.updateAgentConfigById }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { getAgentById: () => () => state.agent },
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: () => 'user-1' },
}));
vi.mock('@/store/device', () => ({ useDeviceList: () => state.deviceList }));

const workspaceDevice = {
  channels: [],
  deviceId: 'ws-device',
  online: true,
  scope: 'workspace',
  visibility: 'public',
};

describe('useAgentSelectionPolicies', () => {
  beforeEach(() => {
    state.updateAgentConfigById.mockReset();
  });

  it('does not fix the execution target from an unconfirmed device list', () => {
    // The stored copy still lists a device that may since have been removed.
    state.deviceList = { data: [workspaceDevice], isConfirmed: false };

    const { result } = renderHook(() => useAgentSelectionPolicies('agent-1'));

    expect(result.current.canFixExecutionTarget).toBe(false);
    result.current.setExecutionTargetPolicy('fixed');
    expect(state.updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('fixes the resolved device once the server confirmed the list', () => {
    state.deviceList = { data: [workspaceDevice], isConfirmed: true };

    const { result } = renderHook(() => useAgentSelectionPolicies('agent-1'));

    expect(result.current.canFixExecutionTarget).toBe(true);
    result.current.setExecutionTargetPolicy('fixed');
    expect(state.updateAgentConfigById).toHaveBeenCalledWith('agent-1', {
      agencyConfig: expect.objectContaining({
        boundDeviceId: 'ws-device',
        executionTargetSelectionPolicy: 'fixed',
      }),
    });
  });
});

describe('useAgentSelectionPolicies with a non-device target', () => {
  it('fixes a cloud / no-environment target without waiting for the device list', () => {
    state.agent = {
      ...state.agent,
      agencyConfig: { executionTarget: 'none', executionTargetSelectionPolicy: 'member' },
    };
    state.deviceList = { data: [], isConfirmed: false };
    state.updateAgentConfigById.mockReset();

    const { result } = renderHook(() => useAgentSelectionPolicies('agent-1'));

    expect(result.current.canFixExecutionTarget).toBe(true);
    result.current.setExecutionTargetPolicy('fixed');
    expect(state.updateAgentConfigById).toHaveBeenCalledWith('agent-1', {
      agencyConfig: expect.objectContaining({
        executionTarget: 'none',
        executionTargetSelectionPolicy: 'fixed',
      }),
    });
  });
});
