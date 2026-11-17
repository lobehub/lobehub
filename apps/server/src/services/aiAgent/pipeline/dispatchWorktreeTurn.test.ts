import type { LobeChatDatabase } from '@lobechat/database';
import type { WorktreeStartRun } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TopicItem } from '@/database/schemas/topic';

import { dispatchWorktreeTurn } from './dispatchWorktreeTurn';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createCheckout: vi.fn(),
  devices: vi.fn(),
  execAgent: vi.fn(),
  message: vi.fn(),
  mergeMetadata: vi.fn(),
  operation: vi.fn(),
  topic: vi.fn(),
  updateTopic: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    findById = mocks.operation;
    mergeMetadata = mocks.mergeMetadata;
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findById = mocks.message;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = mocks.topic;
    updateMetadata = mocks.updateTopic;
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
vi.mock('./createFirstSendWorktree', () => ({ createFirstSendWorktree: mocks.createCheckout }));

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
} as TopicItem;
const request = {
  baseBranch: 'release',
  branch: 'lobehub/new',
  deviceId: 'dev_1',
  path: '/repo',
  repoType: 'git',
  sourcePath: '/repo',
};
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
  mocks.topic.mockResolvedValue(topic);
  mocks.createCheckout.mockResolvedValue(checkout);
  mocks.execAgent.mockResolvedValue({ success: true });
});

describe('dispatchWorktreeTurn', () => {
  it('uses the saved message and binds the checkout before dispatching to the selected device', async () => {
    await expect(dispatch()).resolves.toEqual({ success: true });
    expect(mocks.createCheckout).toHaveBeenCalledWith(request, {
      userId: topic.userId,
      workspaceId: undefined,
    });
    expect(mocks.updateTopic).toHaveBeenCalledBefore(mocks.execAgent);
    expect(mocks.updateTopic).toHaveBeenCalledWith(topic.id, {
      boundDeviceId: request.deviceId,
      workingDirectory: checkout.sessionPath,
      workingDirectoryConfig: checkout,
    });
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: { topicId: topic.id },
        deviceId: request.deviceId,
        parentMessageId: run.userMessageId,
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

  it('does not dispatch again when a prior delivery consumed the operation reservation', async () => {
    mocks.operation.mockResolvedValue({ ...operation, status: 'running' });
    await expect(dispatch()).resolves.toMatchObject({ success: true });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
    expect(mocks.execAgent).not.toHaveBeenCalled();
  });

  it('returns the checkout error and leaves the saved message available', async () => {
    const error = new Error('Base branch no longer exists');
    mocks.createCheckout.mockRejectedValue(error);
    await expect(dispatch()).resolves.toEqual({
      error: error.message,
      retryable: true,
      success: false,
    });
    expect(mocks.updateTopic).not.toHaveBeenCalled();
    expect(mocks.execAgent).not.toHaveBeenCalled();
  });
});
