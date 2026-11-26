// @vitest-environment node
import type * as BusinessConst from '@lobechat/business-const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createContextInner } from '@/libs/trpc/lambda/context';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => ({})) }));
vi.mock('@lobechat/business-const', async () => {
  const actual = await vi.importActual<typeof BusinessConst>('@lobechat/business-const');
  return {
    ...actual,
    // Read dynamically by `packages/utils/src/apiKey.ts`; the Cloud override omits it.
    API_KEY_PREFIX: (actual as Record<string, unknown>).API_KEY_PREFIX,
    ENABLE_BUSINESS_FEATURES: true,
  };
});
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi
    .fn()
    .mockResolvedValue({ enableAgentShare: true }),
}));

const mocks = vi.hoisted(() => ({
  accessCheck: vi.fn(),
  findById: vi.fn(),
  submitAs: vi.fn(),
}));

vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: {
    findByShareIdWithAccessCheck: mocks.accessCheck,
    isRunStillAuthorized: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { findById: mocks.findById, isRunningOperationAlive: vi.fn().mockResolvedValue(true) };
  }),
}));
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(function () {
    return { getUserSettings: vi.fn().mockResolvedValue({}) };
  }),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../aiAgent/heteroInterventionSubmit', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  submitHeteroInterventionAs: mocks.submitAs,
}));

const { shareChatRouter } = await import('../shareChat');

const VISITOR = 'visitor-1';
const share = {
  agentId: 'agt_share',
  ownerId: 'owner-1',
  shareConfig: { toolGrants: [] },
  shareId: 'share-1',
  visibility: 'link',
  workspaceId: 'ws-1',
};
const visitorTopic = {
  agentId: share.agentId,
  id: 'tpc_visitor',
  metadata: { runningOperation: { operationId: 'op-1' } },
  senderId: VISITOR,
};
const input = {
  operationId: 'op-1',
  resolutionRequestId: '2f4c5a7e-3b1d-4c8a-9e6f-0a1b2c3d4e5f',
  result: { answer: 'yes' },
  shareId: 'share-1',
  toolCallId: 'tool-1',
  topicId: 'tpc_visitor',
};

describe('shareChatRouter.submitHeteroIntervention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessCheck.mockResolvedValue(share);
    mocks.findById.mockResolvedValue(visitorTopic);
    mocks.submitAs.mockResolvedValue({ status: 'resolving', success: true });
  });

  const call = async (override: Partial<typeof input> = {}) =>
    shareChatRouter
      .createCaller(await createContextInner({ userId: VISITOR }))
      .submitHeteroIntervention({ ...input, ...override });

  it("publishes the answer in the creator's scope without the share routing fields", async () => {
    await expect(call()).resolves.toEqual({ status: 'resolving', success: true });

    expect(mocks.submitAs).toHaveBeenCalledTimes(1);
    const [intervention, scope] = mocks.submitAs.mock.calls[0];
    expect(scope).toEqual({ userId: 'owner-1', workspaceId: 'ws-1' });
    expect(intervention).toMatchObject({
      operationId: 'op-1',
      result: { answer: 'yes' },
      toolCallId: 'tool-1',
    });
    expect(intervention).not.toHaveProperty('shareId');
    expect(intervention).not.toHaveProperty('topicId');
  });

  it('rejects an operation that is not the one running on the visitor topic', async () => {
    await expect(call({ operationId: 'op-someone-elses' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mocks.submitAs).not.toHaveBeenCalled();
  });

  it('rejects a topic that is not the visitor own topic', async () => {
    mocks.findById.mockResolvedValue({ ...visitorTopic, senderId: 'someone-else' });

    await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.submitAs).not.toHaveBeenCalled();
  });
});
