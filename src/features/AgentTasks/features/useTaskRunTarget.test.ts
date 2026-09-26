import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskRunTarget } from './useTaskRunTarget';

const DEVICE_AGENT_BOUND = 'device-agent-bound';
const DEVICE_TASK_PIN = 'device-task-pin';

const PERSONAL_DEVICE = { deviceId: 'device-personal', scope: 'personal' } as const;
const WORKSPACE_DEVICE = {
  deviceId: 'device-workspace',
  scope: 'workspace',
  visibility: 'public',
} as const;

const mocks = vi.hoisted(() => ({
  agency: {
    agencyConfig: {} as Record<string, unknown>,
    canSelectExecutionTarget: true,
    isPreferenceLoading: false,
    workspaceScoped: false,
  },
  agentState: { agentMap: {} as Record<string, { workspaceId?: string }> },
  devices: [] as { deviceId: string; scope?: string; visibility?: string }[],
  deviceState: { defaultCwd: {} as Record<string, string>, workingDirs: {} as Record<string, []> },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/DeviceManager/useDeviceList', () => ({
  useDeviceList: () => ({ data: mocks.devices, isLoading: false }),
}));

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => mocks.agency,
}));

vi.mock('@/helpers/gatewayMode', () => ({
  useIsGatewayModeEnabled: () => false,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ agentMap: mocks.agentState.agentMap, localAgentWorkingDirectoryMap: {} }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { isAgentHeterogeneousById: () => () => true },
}));

vi.mock('@/store/device', () => ({
  deviceSelectors: {
    getDeviceDefaultCwd: (deviceId?: string) => (state: (typeof mocks)['deviceState']) =>
      state.defaultCwd[deviceId ?? ''],
    getDeviceWorkingDirs: (deviceId?: string) => (state: (typeof mocks)['deviceState']) =>
      state.workingDirs[deviceId ?? ''] ?? [],
  },
  useDeviceStore: (selector: (state: (typeof mocks)['deviceState']) => unknown) =>
    selector(mocks.deviceState),
}));

const deviceBoundAgent = {
  boundDeviceId: DEVICE_AGENT_BOUND,
  executionTarget: 'device',
  heterogeneousProvider: { type: 'claude-code' },
};

beforeEach(() => {
  mocks.agency.agencyConfig = {};
  mocks.agency.canSelectExecutionTarget = true;
  mocks.agency.isPreferenceLoading = false;
  mocks.agentState.agentMap = {};
  mocks.devices = [];
  mocks.deviceState = { defaultCwd: {}, workingDirs: {} };
});

describe('useTaskRunTarget', () => {
  it('offers the directory control when the machine comes from the AGENT, not the task', () => {
    // The machine the run lands on may be the assignee's own bound device. This
    // used to report `none`, so the task showed a non-interactive hint and had
    // no way to pick a directory even though the runner supports one.
    mocks.agency.agencyConfig = deviceBoundAgent;

    const { result } = renderHook(() => useTaskRunTarget('agent-1'));

    expect(result.current.deviceId).toBe(DEVICE_AGENT_BOUND);
    expect(result.current.directoryKind).toBe('device');
    expect(result.current.pinnedDeviceId).toBeUndefined();
  });

  it('ignores a task pin the run side would drop for a fixed selection policy', () => {
    // `resolveExecutionPlan` clears `requestedDeviceId` when the policy is
    // fixed, so showing that pin would name a machine the run never reaches —
    // and would offer that machine's paths, which still reach the topic.
    mocks.agency.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'claude-code' },
    };
    mocks.agency.canSelectExecutionTarget = false;

    const { result } = renderHook(() => useTaskRunTarget('agent-1', DEVICE_TASK_PIN));

    expect(result.current.pinnedDeviceId).toBeUndefined();
    expect(result.current.isDeviceTarget).toBe(false);
    expect(result.current.deviceId).not.toBe(DEVICE_TASK_PIN);
    expect(result.current.directoryKind).not.toBe('device');
  });

  it('falls back to the agent device when a pin is dropped by a fixed policy', () => {
    mocks.agency.agencyConfig = deviceBoundAgent;
    mocks.agency.canSelectExecutionTarget = false;

    const { result } = renderHook(() => useTaskRunTarget('agent-1', DEVICE_TASK_PIN));

    expect(result.current.pinnedDeviceId).toBeUndefined();
    expect(result.current.deviceId).toBe(DEVICE_AGENT_BOUND);
  });

  it('honours a task pin when the policy allows selection', () => {
    mocks.agency.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'claude-code' },
    };

    const { result } = renderHook(() => useTaskRunTarget('agent-1', DEVICE_TASK_PIN));

    expect(result.current.pinnedDeviceId).toBe(DEVICE_TASK_PIN);
    expect(result.current.isDeviceTarget).toBe(true);
    expect(result.current.effectiveTarget).toBe('device');
    expect(result.current.deviceId).toBe(DEVICE_TASK_PIN);
    expect(result.current.directoryKind).toBe('device');
  });

  it('offers a workspace agent only the workspace pool', () => {
    // A deviceId carries the identity it was enrolled under, so a personal
    // machine is not resolvable by a workspace agent's run — and a Task's
    // scheduled runs use the workspace principal, not the member looking at it.
    // The pin itself still stands (the run routes to it), which is why the chip
    // has to render it as a device rather than silently falling back.
    mocks.agentState.agentMap = { 'agent-1': { workspaceId: 'ws-1' } };
    mocks.devices = [PERSONAL_DEVICE, WORKSPACE_DEVICE];

    const { result } = renderHook(() => useTaskRunTarget('agent-1', PERSONAL_DEVICE.deviceId));

    expect(result.current.devices?.map((device) => device.deviceId)).toEqual([
      WORKSPACE_DEVICE.deviceId,
    ]);
    expect(result.current.pinnedDeviceId).toBe(PERSONAL_DEVICE.deviceId);
  });

  it('offers an agent outside a workspace only its own machines', () => {
    mocks.devices = [PERSONAL_DEVICE, WORKSPACE_DEVICE];

    const { result } = renderHook(() => useTaskRunTarget('agent-1'));

    expect(result.current.devices?.map((device) => device.deviceId)).toEqual([
      PERSONAL_DEVICE.deviceId,
    ]);
  });
});
