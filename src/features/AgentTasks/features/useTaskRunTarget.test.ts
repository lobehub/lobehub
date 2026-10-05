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
  /**
   * What the hook resolves when it applies the ACTIVE chat topic's machine
   * binding (no `topicId: null`), standing in for an open conversation bound
   * to a different device than the agent.
   */
  activeTopicAgency: undefined as undefined | { agencyConfig: Record<string, unknown> },
  agentState: { agentMap: {} as Record<string, { workspaceId?: string }> },
  devices: [] as { deviceId: string; scope?: string; visibility?: string }[],
  electron: { currentDeviceId: undefined as string | undefined, isDesktop: false },
}));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    get isDesktop() {
      return mocks.electron.isDesktop;
    },
  };
});

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: unknown) => unknown) =>
    selector({ gatewayDeviceInfo: { deviceId: mocks.electron.currentDeviceId } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/DeviceManager/useDeviceList', () => ({
  useDeviceList: () => ({ data: mocks.devices, isLoading: false }),
}));

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: (_agentId?: string, options: { topicId?: string | null } = {}) =>
    options.topicId === null || !mocks.activeTopicAgency
      ? mocks.agency
      : { ...mocks.agency, ...mocks.activeTopicAgency },
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

const deviceBoundAgent = {
  boundDeviceId: DEVICE_AGENT_BOUND,
  executionTarget: 'device',
  heterogeneousProvider: { type: 'claude-code' },
};

beforeEach(() => {
  mocks.activeTopicAgency = undefined;
  mocks.agency.agencyConfig = {};
  mocks.agency.canSelectExecutionTarget = true;
  mocks.agency.isPreferenceLoading = false;
  mocks.agentState.agentMap = {};
  mocks.devices = [];
  mocks.electron = { currentDeviceId: undefined, isDesktop: false };
});

describe('useTaskRunTarget', () => {
  // A task's runs never carry the open chat topic's binding, so the machine
  // shown for a task must not follow whatever conversation happens to be active.
  it('ignores the active chat topic device binding', () => {
    mocks.agency.agencyConfig = deviceBoundAgent;
    mocks.activeTopicAgency = {
      agencyConfig: { ...deviceBoundAgent, boundDeviceId: 'device-chat-topic' },
    };

    const { result } = renderHook(() => useTaskRunTarget('agent-1'));

    expect(result.current.deviceId).toBe(DEVICE_AGENT_BOUND);
  });

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

  it('offers the directory control for a local target on this desktop', () => {
    // A `local` run still starts in a path on a machine — this desktop. This
    // used to report `none`, leaving the task with a dead "Follow agent" hint.
    mocks.electron = { currentDeviceId: 'device-this-desktop', isDesktop: true };
    mocks.agency.agencyConfig = {
      executionTarget: 'local',
      heterogeneousProvider: { type: 'claude-code' },
    };

    const { result } = renderHook(() => useTaskRunTarget('agent-1'));

    expect(result.current.inheritedTarget).toBe('local');
    expect(result.current.deviceId).toBe('device-this-desktop');
    expect(result.current.directoryKind).toBe('device');
    expect(result.current.pinnedDeviceId).toBeUndefined();
  });

  it('prefers the bound device for a local target, the machine the server routes to', () => {
    mocks.electron = { currentDeviceId: 'device-this-desktop', isDesktop: true };
    mocks.agency.agencyConfig = {
      boundDeviceId: DEVICE_AGENT_BOUND,
      executionTarget: 'local',
      heterogeneousProvider: { type: 'claude-code' },
    };

    const { result } = renderHook(() => useTaskRunTarget('agent-1'));

    expect(result.current.deviceId).toBe(DEVICE_AGENT_BOUND);
    expect(result.current.directoryKind).toBe('device');
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

  it('offers a shared task only public workspace devices', () => {
    // Automated runs execute as the task's creator, who cannot resolve a
    // colleague's private workspace device — so a private row is not pinnable.
    mocks.agentState.agentMap = { 'agent-1': { workspaceId: 'ws-1' } };
    mocks.devices = [
      { deviceId: 'device-private', scope: 'workspace', visibility: 'private' },
      WORKSPACE_DEVICE,
    ];

    const { result } = renderHook(() => useTaskRunTarget('agent-1'));

    expect(result.current.devices?.map((device) => device.deviceId)).toEqual([
      WORKSPACE_DEVICE.deviceId,
    ]);
  });

  it('offers an agent outside a workspace only its own machines', () => {
    mocks.devices = [PERSONAL_DEVICE, WORKSPACE_DEVICE];

    const { result } = renderHook(() => useTaskRunTarget('agent-1'));

    expect(result.current.devices?.map((device) => device.deviceId)).toEqual([
      PERSONAL_DEVICE.deviceId,
    ]);
  });
});
