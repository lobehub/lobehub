import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExecRunContext } from '../../types';
import { dispatchToWakingCliDevice } from './device';
import type { PreparedHeteroRun } from './prepare';
import type { HeteroDispatchDeps, HeteroRun } from './types';

const mocks = vi.hoisted(() => ({
  afterWork: [] as (() => Promise<unknown> | unknown)[],
  dispatchAgentRun: vi.fn(),
  finalizeHeteroDispatchError: vi.fn(),
  isRunningOnTopic: vi.fn(),
  readDeviceSystemInfo: vi.fn(),
  resolveDeviceDispatchAuthorizationFailure: vi.fn(),
  selectCodexDeviceDispatch: vi.fn(),
  waitForManagedDeviceOnline: vi.fn(),
  wakeManagedDevice: vi.fn(),
}));

vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  afterUnscoped: (work: () => Promise<unknown> | unknown) => {
    mocks.afterWork.push(work);
  },
}));

vi.mock('@/server/services/deviceGateway/managedDeviceWake', () => ({
  waitForManagedDeviceOnline: mocks.waitForManagedDeviceOnline,
  wakeManagedDevice: mocks.wakeManagedDevice,
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return { isRunningOnTopic: mocks.isRunningOnTopic };
  }),
}));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(function () {
    return {
      findByDeviceId: vi.fn().mockResolvedValue(undefined),
      findWorkspaceDeviceById: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    dispatchAgentRun: mocks.dispatchAgentRun,
    readDeviceSystemInfo: mocks.readDeviceSystemInfo,
  },
}));

vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: mocks.resolveDeviceDispatchAuthorizationFailure,
}));

vi.mock('@/server/services/agentQuota', () => ({
  AgentQuotaService: vi.fn(function () {
    return {
      planDeviceRouting: vi.fn().mockResolvedValue(null),
      resolveDeviceRowId: async (id?: string) => id,
    };
  }),
}));

vi.mock('../codexDeviceRuntime', () => ({
  selectCodexDeviceDispatch: mocks.selectCodexDeviceDispatch,
}));

vi.mock('../finalizeHeteroDispatchError', () => ({
  finalizeHeteroDispatchError: mocks.finalizeHeteroDispatchError,
}));

const device = { deviceId: 'managed-a', scope: 'personal' as const };
const run: HeteroRun = {
  agentId: 'agent-1',
  assistantMessageId: 'asst-1',
  operationId: 'op-1',
  topicId: 'topic-1',
  userMessageId: 'user-msg-1',
};

const createDeps = () => {
  const topicModel = {
    patchRunningOperation: vi.fn().mockResolvedValue(true),
  };
  const deps = {
    bindTopicWorkingDirectory: vi.fn().mockResolvedValue(undefined),
    db: {} as any,
    getMarketService: vi.fn(),
    messageModel: {} as any,
    resolveDeviceWorkspaceId: vi.fn().mockResolvedValue(undefined),
    topicModel: topicModel as any,
    userId: 'user-1',
    withholdGatewayToken: false,
  } satisfies HeteroDispatchDeps;
  return { deps, topicModel };
};

const dispatch = (deps: HeteroDispatchDeps) =>
  dispatchToWakingCliDevice(deps, run, {
    agentConfig: { agencyConfig: {}, id: 'agent-1' } as unknown as ExecRunContext['agentConfig'],
    appContext: undefined,
    device,
    heteroPlan: { deviceId: 'managed-a', kind: 'device-wakeable', target: 'device' },
    heteroType: 'claude-code',
    heterogeneousProvider: { type: 'claude-code' },
    prepared: { heteroParams: {} } as unknown as PreparedHeteroRun,
  });

const runScheduledWork = async () => {
  const work = mocks.afterWork.splice(0);
  for (const item of work) await item();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterWork.length = 0;
  mocks.dispatchAgentRun.mockResolvedValue({ success: true });
  mocks.finalizeHeteroDispatchError.mockResolvedValue(true);
  mocks.isRunningOnTopic.mockResolvedValue(true);
  mocks.resolveDeviceDispatchAuthorizationFailure.mockResolvedValue(undefined);
  mocks.selectCodexDeviceDispatch.mockResolvedValue({ kind: 'exec' });
  mocks.waitForManagedDeviceOnline.mockResolvedValue(true);
  mocks.wakeManagedDevice.mockResolvedValue(true);
});

describe('dispatchToWakingCliDevice', () => {
  it('wakes the device before returning and dispatches only after the response', async () => {
    const { deps, topicModel } = createDeps();

    await expect(dispatch(deps)).resolves.toBeUndefined();

    expect(mocks.wakeManagedDevice).toHaveBeenCalledWith('user-1', device);
    expect(mocks.waitForManagedDeviceOnline).not.toHaveBeenCalled();
    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();

    await runScheduledWork();

    expect(mocks.waitForManagedDeviceOnline).toHaveBeenCalledWith(
      'user-1',
      device,
      expect.objectContaining({ shouldStop: expect.any(Function) }),
    );
    expect(mocks.dispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'managed-a' }),
    );
    expect(topicModel.patchRunningOperation).toHaveBeenCalledWith(
      'topic-1',
      'op-1',
      expect.objectContaining({ deviceId: 'managed-a' }),
    );
  });

  it('dispatches after a timed-out wait so the offline handling takes over', async () => {
    mocks.waitForManagedDeviceOnline.mockResolvedValue(false);
    mocks.dispatchAgentRun.mockResolvedValue({ error: 'DEVICE_OFFLINE', success: false });
    const { deps } = createDeps();

    await dispatch(deps);
    await runScheduledWork();

    expect(mocks.dispatchAgentRun).toHaveBeenCalledTimes(1);
    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({
        deviceRoute: expect.objectContaining({ deviceId: 'managed-a' }),
        operationId: 'op-1',
      }),
    );
  });

  it('dispatches at once without waiting when the provider refuses the wake', async () => {
    mocks.wakeManagedDevice.mockResolvedValue(false);
    mocks.dispatchAgentRun.mockResolvedValue({ error: 'DEVICE_OFFLINE', success: false });
    const { deps } = createDeps();

    await dispatch(deps);

    expect(mocks.afterWork).toHaveLength(0);
    expect(mocks.waitForManagedDeviceOnline).not.toHaveBeenCalled();
    expect(mocks.dispatchAgentRun).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'managed-a' }),
    );
    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({
        deviceRoute: expect.objectContaining({ deviceId: 'managed-a' }),
        operationId: 'op-1',
      }),
    );
  });

  it('does not dispatch a run that was stopped while the device woke', async () => {
    mocks.isRunningOnTopic.mockResolvedValue(false);
    const { deps } = createDeps();

    await dispatch(deps);
    await runScheduledWork();

    expect(mocks.isRunningOnTopic).toHaveBeenCalledWith('op-1', 'topic-1');
    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
    expect(mocks.finalizeHeteroDispatchError).not.toHaveBeenCalled();
  });

  it('settles the run when the background dispatch throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.selectCodexDeviceDispatch.mockRejectedValue(new Error('db down'));
    const { deps } = createDeps();

    await dispatch(deps);
    await runScheduledWork();

    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({ detail: 'db down', operationId: 'op-1' }),
    );
    error.mockRestore();
  });
});
