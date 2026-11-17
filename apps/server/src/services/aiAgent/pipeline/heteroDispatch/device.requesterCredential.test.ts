import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExecRunContext } from '../../types';
import { dispatchToCliDevice } from './device';
import type { PreparedHeteroRun } from './prepare';
import type { HeteroDispatchDeps, HeteroRun } from './types';

const mocks = vi.hoisted(() => ({
  afterWork: [] as (() => Promise<unknown> | unknown)[],
  dispatchAgentRun: vi.fn(),
  findByDeviceId: vi.fn(),
  findWorkspaceDeviceById: vi.fn(),
  finalizeHeteroDispatchError: vi.fn(),
  isRunningOnTopic: vi.fn(),
  readDeviceSystemInfo: vi.fn(),
  resolveDeviceRequesterCredential: vi.fn(),
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
      findByDeviceId: mocks.findByDeviceId,
      findWorkspaceDeviceById: mocks.findWorkspaceDeviceById,
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

vi.mock('@/server/services/scm/requester/deviceCredential', () => ({
  resolveDeviceRequesterCredential: mocks.resolveDeviceRequesterCredential,
}));

vi.mock('../finalizeHeteroDispatchError', () => ({
  finalizeHeteroDispatchError: mocks.finalizeHeteroDispatchError,
}));

const run: HeteroRun = {
  agentId: 'agent-1',
  assistantMessageId: 'asst-1',
  operationId: 'op-1',
  topicId: 'topic-1',
  userMessageId: 'user-msg-1',
};

const createDeps = () =>
  ({
    bindTopicWorkingDirectory: vi.fn().mockResolvedValue(undefined),
    db: {} as any,
    getMarketService: vi.fn(),
    messageModel: {} as any,
    resolveDeviceWorkspaceId: vi.fn().mockResolvedValue(undefined),
    topicModel: { patchRunningOperation: vi.fn().mockResolvedValue(true) } as any,
    userId: 'user-1',
    withholdGatewayToken: false,
    workspaceId: 'ws-1',
  }) satisfies HeteroDispatchDeps;

const resign = vi.fn();

const dispatch = (deps: HeteroDispatchDeps) =>
  dispatchToCliDevice(deps, run, {
    agentConfig: { agencyConfig: {}, id: 'agent-1' } as unknown as ExecRunContext['agentConfig'],
    appContext: undefined,
    cliDeviceWorkspaceId: 'ws-1',
    heteroPlan: { deviceId: 'device-jp-1', kind: 'device', target: 'device' } as any,
    heteroType: 'claude-code',
    heterogeneousProvider: { type: 'claude-code' },
    prepared: {
      agentSystemContext: 'Agent instructions',
      heteroParams: { githubToken: 'gh-org-token', jwt: 'jwt-original' },
      requesterInput: { ownerUserId: 'user-1', trigger: 'chat' },
      resignOperationJwt: resign,
    } as unknown as PreparedHeteroRun,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatchAgentRun.mockResolvedValue({ success: true });
  mocks.finalizeHeteroDispatchError.mockResolvedValue(true);
  mocks.resolveDeviceDispatchAuthorizationFailure.mockResolvedValue(undefined);
  mocks.selectCodexDeviceDispatch.mockResolvedValue({ kind: 'exec' });
  mocks.resolveDeviceRequesterCredential.mockResolvedValue({ kind: 'off' });
  mocks.findByDeviceId.mockResolvedValue(undefined);
  mocks.findWorkspaceDeviceById.mockResolvedValue(undefined);
});

describe('dispatchToCliDevice requester credential', () => {
  it('sends the requester-scoped token and git identity to an in-scope device', async () => {
    mocks.resolveDeviceRequesterCredential.mockResolvedValue({
      jwt: 'jwt-requester',
      kind: 'issue',
      requesterLine: 'This run was requested by Arvin Xu (@arvinxx).',
      scmCredential: { gitEmail: '42+arvinxx@users.noreply.github.com', gitName: 'Arvin Xu' },
    });

    await expect(dispatch(createDeps())).resolves.toBeUndefined();

    const params = mocks.dispatchAgentRun.mock.calls[0][0];
    expect(params).toMatchObject({
      jwt: 'jwt-requester',
      scmCredential: { gitEmail: '42+arvinxx@users.noreply.github.com', gitName: 'Arvin Xu' },
    });
    expect(params.systemContext).toContain('This run was requested by Arvin Xu (@arvinxx).');
    expect(mocks.resolveDeviceRequesterCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'device-jp-1',
        requesterInput: { ownerUserId: 'user-1', trigger: 'chat' },
        resign,
      }),
    );
  });

  it("judges the shared node by the workspace's row, not the owner's personal row for the same machine", async () => {
    const workspaceRow = { id: 'row-ws', visibility: 'public', workspaceId: 'ws-1' };
    mocks.findByDeviceId.mockResolvedValue({
      id: 'row-personal',
      visibility: 'private',
      workspaceId: null,
    });
    mocks.findWorkspaceDeviceById.mockResolvedValue(workspaceRow);

    await dispatch(createDeps());

    expect(mocks.resolveDeviceRequesterCredential).toHaveBeenCalledWith(
      expect.objectContaining({ device: workspaceRow }),
    );
  });

  it('sends an isolated run only to the CLI connection that can honour it', async () => {
    mocks.resolveDeviceRequesterCredential.mockResolvedValue({
      jwt: 'jwt-requester',
      kind: 'issue',
      requesterLine: 'line',
      scmCredential: {},
    });

    await dispatch(createDeps());

    expect(mocks.dispatchAgentRun.mock.calls[0][0].clientKinds).toEqual(['cli']);
  });

  it('keeps the original token and sends no git identity when the policy does not apply', async () => {
    await dispatch(createDeps());

    const params = mocks.dispatchAgentRun.mock.calls[0][0];
    expect(params.jwt).toBe('jwt-original');
    expect(params).not.toHaveProperty('scmCredential');
  });

  it('refuses the run instead of pushing as the device when the credential cannot be issued', async () => {
    mocks.resolveDeviceRequesterCredential.mockResolvedValue({
      detail: 'The lh CLI on this shared device is too old.',
      kind: 'refuse',
      reason: 'cli_too_old',
    });
    const deps = createDeps();

    const result = await dispatch(deps);

    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false });
  });
});
