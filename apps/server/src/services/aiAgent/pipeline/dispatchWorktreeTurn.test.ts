import type { LobeChatDatabase } from '@lobechat/database';
import type { WorktreeStartRun } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchWorktreeTurn } from './dispatchWorktreeTurn';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createCheckout: vi.fn(),
  devices: vi.fn(),
  execAgent: vi.fn(),
  listBranches: vi.fn(),
  message: vi.fn(),
  mergeMetadata: vi.fn(),
  operation: vi.fn(),
  recordDispatchFailure: vi.fn(),
  saveCheckout: vi.fn(),
  scheduleCleanup: vi.fn(),
  updateMessage: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    findById = mocks.operation;
    mergeMetadata = mocks.mergeMetadata;
    recordDispatchFailure = mocks.recordDispatchFailure;
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findById = mocks.message;
    update = mocks.updateMessage;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    recordFirstSendWorktreeCheckout = mocks.saveCheckout;
  },
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = mocks.execAgent;
  },
}));
vi.mock('@/server/routers/lambda/_helpers/workspaceAgentGuard', () => ({
  assertCanUseWorkspaceAgent: vi.fn(),
}));
vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: mocks.authorize,
}));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: mocks.devices,
}));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { listGitBranches: mocks.listBranches },
}));
vi.mock('./createFirstSendWorktree', () => ({ createFirstSendWorktree: mocks.createCheckout }));
vi.mock('@/server/services/worktreeCleanup', () => ({
  scheduleWorktreeCleanup: mocks.scheduleCleanup,
}));

const now = '2026-11-17T18:00:00.000Z';
const run: WorktreeStartRun = {
  claim: { claimedAt: now, expiresAt: now, id: 'claim-1' },
  createdAt: now,
  kind: 'worktree_start',
  operationId: 'op_1',
  runAt: now,
  updatedAt: now,
  userMessageId: 'msg_1',
};
const topic = {
  agentId: 'agt_1',
  id: 'tpc_1',
  metadata: { scheduledRun: run },
  status: 'scheduled',
  userId: 'usr_1',
};
const request = {
  baseBranch: 'release',
  branch: 'lobehub/new',
  deviceId: 'dev_1',
  path: '/repo',
  repoType: 'git',
  sourcePath: '/repo',
};
const { branch: _branch, ...unassignedWorktree } = request;
const checkout = {
  git: { activeWorktree: '/checkout/new', branch: 'lobehub/new', isWorktree: true },
  path: '/repo',
  repoType: 'git',
  sessionPath: '/checkout/new',
};
const operation = {
  agentId: topic.agentId,
  id: run.operationId,
  metadata: {
    firstSendWorktree: {
      assistantMessageId: 'msg_2',
      userMessageId: run.userMessageId,
      worktree: request,
    },
  },
  status: 'idle',
  topicId: topic.id,
  userId: topic.userId,
};
const dispatch = () => dispatchWorktreeTurn(run, { db: {} as LobeChatDatabase, topic });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.operation.mockResolvedValue(operation);
  mocks.message.mockResolvedValue({
    content: 'Use the selected branch',
    id: run.userMessageId,
    role: 'user',
    topicId: topic.id,
    userId: topic.userId,
  });
  mocks.devices.mockResolvedValue([{ deviceId: request.deviceId, online: true }]);
  mocks.saveCheckout.mockResolvedValue({ canDispatch: true });
  mocks.recordDispatchFailure.mockResolvedValue(true);
  mocks.mergeMetadata.mockResolvedValue(true);
  mocks.updateMessage.mockResolvedValue(undefined);
  mocks.listBranches.mockResolvedValue([{ name: 'lobehub' }]);
  mocks.createCheckout.mockResolvedValue(checkout);
  mocks.execAgent.mockResolvedValue({ success: true });
});

describe('dispatchWorktreeTurn', () => {
  it('saves a non-conflicting branch before checkout and reuses it on retry', async () => {
    const job = { ...operation.metadata.firstSendWorktree, worktree: unassignedWorktree };
    mocks.operation.mockResolvedValue({
      ...operation,
      metadata: { firstSendWorktree: job },
    });
    mocks.createCheckout.mockRejectedValueOnce(new Error('Device disconnected'));

    await expect(dispatch()).resolves.toMatchObject({ retryable: true, success: false });
    expect(mocks.listBranches).toHaveBeenCalledWith({
      deviceId: request.deviceId,
      path: request.path,
      userId: topic.userId,
      workspaceId: undefined,
    });
    expect(mocks.mergeMetadata).toHaveBeenCalledBefore(mocks.createCheckout);
    const persisted = mocks.mergeMetadata.mock.calls[0][1];
    const selected = persisted.firstSendWorktree.worktree;
    expect(selected.branch).toMatch(/^lobehub-/);
    expect(mocks.createCheckout).toHaveBeenCalledWith(selected, expect.any(Object));

    mocks.operation.mockResolvedValue({ ...operation, metadata: persisted });
    mocks.listBranches.mockResolvedValue([{ name: 'lobehub' }, { name: selected.branch }]);
    await expect(dispatch()).resolves.toEqual({ success: true });
    expect(mocks.listBranches).toHaveBeenCalledTimes(1);
    expect(mocks.createCheckout).toHaveBeenLastCalledWith(selected, expect.any(Object));
  });

  it('does not mutate Git when it cannot read the refs or save the branch choice', async () => {
    mocks.operation.mockResolvedValue({
      ...operation,
      metadata: {
        firstSendWorktree: {
          ...operation.metadata.firstSendWorktree,
          worktree: unassignedWorktree,
        },
      },
    });
    mocks.listBranches.mockResolvedValueOnce(undefined);
    await expect(dispatch()).resolves.toMatchObject({ retryable: true, success: false });
    expect(mocks.mergeMetadata).not.toHaveBeenCalled();

    mocks.mergeMetadata.mockResolvedValueOnce(false);
    await expect(dispatch()).resolves.toMatchObject({ retryable: true, success: false });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it('uses the saved message and binds the checkout before dispatching to the selected device', async () => {
    await expect(dispatch()).resolves.toEqual({ success: true });
    expect(mocks.createCheckout).toHaveBeenCalledWith(request, {
      userId: topic.userId,
      workspaceId: undefined,
    });
    expect(mocks.saveCheckout).toHaveBeenCalledBefore(mocks.execAgent);
    expect(mocks.saveCheckout).toHaveBeenCalledWith(topic.id, {
      claimId: run.claim!.id,
      deviceId: request.deviceId,
      workingDirectoryConfig: checkout,
    });
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: { topicId: topic.id },
        deviceId: request.deviceId,
        parentMessageId: run.userMessageId,
        persistedUserMessageId: run.userMessageId,
        prompt: 'Use the selected branch',
        requireDevice: true,
        reservedOperationId: run.operationId,
        suppressUserMessage: true,
      }),
    );
  });

  it('keeps an offline device’s turn pending without using another device', async () => {
    mocks.devices.mockResolvedValue([{ deviceId: 'other-device', online: true }]);
    await expect(dispatch()).resolves.toEqual({ retryAt: expect.any(String), success: false });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
    expect(mocks.execAgent).not.toHaveBeenCalled();
  });

  it('uses the saved device scope independently of the conversation workspace', async () => {
    const db = {} as LobeChatDatabase;
    const workspaceId = 'ws_1';
    await expect(dispatchWorktreeTurn(run, { db, topic, workspaceId })).resolves.toEqual({
      success: true,
    });
    expect(mocks.devices).toHaveBeenCalledWith(db, topic.userId, undefined);
    expect(mocks.createCheckout).toHaveBeenCalledWith(request, {
      userId: topic.userId,
      workspaceId: undefined,
    });

    mocks.operation.mockResolvedValue({
      ...operation,
      metadata: {
        firstSendWorktree: {
          ...operation.metadata.firstSendWorktree,
          deviceWorkspaceId: workspaceId,
        },
      },
    });
    await expect(dispatchWorktreeTurn(run, { db, topic, workspaceId })).resolves.toEqual({
      success: true,
    });
    expect(mocks.devices).toHaveBeenLastCalledWith(db, topic.userId, workspaceId);
    expect(mocks.createCheckout).toHaveBeenLastCalledWith(request, {
      userId: topic.userId,
      workspaceId,
    });
  });

  it('does not report success or dispatch again for a consumed reservation without a handoff', async () => {
    mocks.operation.mockResolvedValue({ ...operation, status: 'running' });
    await expect(dispatch()).resolves.toMatchObject({ success: false });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
    expect(mocks.execAgent).not.toHaveBeenCalled();
  });

  it('uses the durable handoff receipt to acknowledge a redelivery', async () => {
    await expect(dispatch()).resolves.toMatchObject({ success: true });
    expect(mocks.mergeMetadata).toHaveBeenLastCalledWith(run.operationId, {
      firstSendWorktreeHandedOff: true,
    });
    mocks.operation.mockResolvedValue({
      ...operation,
      metadata: { firstSendWorktreeHandedOff: true },
      status: 'running',
    });
    await expect(dispatch()).resolves.toMatchObject({ success: true });
    expect(mocks.execAgent).toHaveBeenCalledTimes(1);
  });

  it('settles a startup failure after consuming the reservation', async () => {
    mocks.execAgent.mockImplementationOnce(async () => {
      mocks.operation.mockResolvedValue({ ...operation, status: 'running' });
      throw new Error('Could not prepare the resume session');
    });

    await expect(dispatch()).resolves.toMatchObject({
      error: 'Could not prepare the resume session',
      retryable: false,
      success: false,
    });
    expect(mocks.recordDispatchFailure).toHaveBeenCalledWith(
      run.operationId,
      'Could not prepare the resume session',
    );
    expect(mocks.updateMessage).toHaveBeenCalledWith(
      'msg_2',
      expect.objectContaining({ error: expect.any(Object) }),
    );
  });

  it.each(['archived', 'trashed'])(
    'queues cleanup for a checkout completed after retirement (%s)',
    async (trigger) => {
      mocks.saveCheckout.mockResolvedValue({ canDispatch: false, cleanupTrigger: trigger });
      await expect(dispatch()).resolves.toMatchObject({ success: false });
      expect(mocks.scheduleCleanup).toHaveBeenCalledWith(
        expect.objectContaining({ topicIds: [topic.id], trigger, userId: topic.userId }),
      );
      expect(mocks.mergeMetadata).toHaveBeenCalledWith(
        run.operationId,
        expect.objectContaining({ firstSendWorktree: expect.objectContaining({ checkout }) }),
      );
      expect(mocks.execAgent).not.toHaveBeenCalled();
    },
  );

  it('returns the checkout error and leaves the saved message available', async () => {
    const error = new Error('Base branch no longer exists');
    mocks.createCheckout.mockRejectedValue(error);
    await expect(dispatch()).resolves.toEqual({
      error: error.message,
      retryable: true,
      success: false,
    });
    expect(mocks.saveCheckout).not.toHaveBeenCalled();
    expect(mocks.execAgent).not.toHaveBeenCalled();
  });
});
