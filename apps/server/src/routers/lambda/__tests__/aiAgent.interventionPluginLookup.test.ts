// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { messagePlugins, messages } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as MessageModelModule from '@/database/models/message';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

const businessV2 = vi.hoisted(() => ({
  getAgentInterventionReview: vi.fn(),
  getAgentInterventionReviewBySource: vi.fn(),
  onAgentInterventionResolutionPublished: vi.fn(),
  resolveAgentIntervention: vi.fn(),
  resolveAgentInterventionBySource: vi.fn(),
  rollbackAgentInterventionResolution: vi.fn(),
}));
vi.mock('@/business/server/agent-run/agentInterventionReview', () => businessV2);

const aiAgentService = vi.hoisted(() => ({
  retirePendingApprovalOperation: vi.fn(),
  stopPendingApproval: vi.fn(),
}));

// `findMessagePlugin` is an instance arrow property, so wrap it per instance to
// count the plugin reads in flight across every MessageModel the code builds.
const pluginLookups = vi.hoisted(() => ({ calls: 0, inFlight: 0, maxInFlight: 0 }));
vi.mock('@/database/models/message', async (importOriginal) => {
  const actual = await importOriginal<typeof MessageModelModule>();
  class TrackedMessageModel extends actual.MessageModel {
    constructor(...args: ConstructorParameters<typeof actual.MessageModel>) {
      super(...args);
      const original = this.findMessagePlugin;
      this.findMessagePlugin = async (messageId) => {
        pluginLookups.calls += 1;
        pluginLookups.inFlight += 1;
        pluginLookups.maxInFlight = Math.max(pluginLookups.maxInFlight, pluginLookups.inFlight);
        try {
          return await original(messageId);
        } finally {
          pluginLookups.inFlight -= 1;
        }
      };
    }
  }
  return { ...actual, MessageModel: TrackedMessageModel };
});

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return aiAgentService;
  }),
}));
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@/server/services/heterogeneousAgent', () => ({
  HeterogeneousAgentService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

const TOOL_COUNT = 12;
const MAX_PLUGIN_LOOKUPS_IN_FLIGHT = 5;

describe('aiAgentRouter — tool plugin lookups for a large Stop batch', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    Object.assign(pluginLookups, { calls: 0, inFlight: 0, maxInFlight: 0 });

    businessV2.onAgentInterventionResolutionPublished.mockResolvedValue(undefined);
    businessV2.rollbackAgentInterventionResolution.mockResolvedValue(undefined);
    aiAgentService.retirePendingApprovalOperation.mockResolvedValue(undefined);
    aiAgentService.stopPendingApproval.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await cleanupTestUser(serverDB, userId);
  });

  const userCaller = () => aiAgentRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  const insertPendingTools = async (batchId: string, operationId: string) => {
    const ids = Array.from({ length: TOOL_COUNT }, (_, index) => `message-stop-${index}`);
    await serverDB
      .insert(messages)
      .values(ids.map((id) => ({ content: '', id, role: 'tool', userId })));
    await serverDB.insert(messagePlugins).values(
      ids.map((id, index) => ({
        apiName: 'editFile',
        arguments: '{}',
        id,
        identifier: 'lobe-local-system',
        intervention: { batchId, operationId, status: 'pending' },
        toolCallId: `call-stop-${index}`,
        type: 'default',
        userId,
      })),
    );
    return ids;
  };

  it('keeps target order and caps concurrent plugin reads in the router and dispatcher', async () => {
    const batchId = 'batch-large-stop';
    const operationId = 'operation-large-stop';
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000099';
    const toolMessageIds = await insertPendingTools(batchId, operationId);
    businessV2.resolveAgentInterventionBySource.mockResolvedValueOnce({
      claimId: 'claim-large-stop',
      contractVersion: 2,
      handled: true,
      ownerUserId: userId,
      resolutionRequestId,
      runtimeAction: {
        batchId,
        operationId,
        terminalStatus: 'stopped',
        toolMessageIds,
        topicId: 'topic-large-stop',
        type: 'stop',
      },
      state: 'claimed',
    });

    await expect(
      userCaller().stopPendingApproval({ batchId, operationId, toolMessageIds, topicId: '' }),
    ).resolves.toEqual({ operationId, settledToolMessageIds: toolMessageIds, success: true });

    // Results stay index-aligned with the requested ids.
    expect(businessV2.resolveAgentInterventionBySource).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: toolMessageIds.map((toolMessageId, index) => ({
          toolCallId: `call-stop-${index}`,
          toolMessageId,
        })),
      }),
    );
    expect(aiAgentService.stopPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({ approvalResolutionRequestId: resolutionRequestId, toolMessageIds }),
    );
    // Router lookup + dispatcher probe: one read per id each, never all at once.
    expect(pluginLookups.calls).toBe(TOOL_COUNT * 2);
    expect(pluginLookups.maxInFlight).toBeGreaterThan(1);
    expect(pluginLookups.maxInFlight).toBeLessThanOrEqual(MAX_PLUGIN_LOOKUPS_IN_FLIGHT);
  });
});
