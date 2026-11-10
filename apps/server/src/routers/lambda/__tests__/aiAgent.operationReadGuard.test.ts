// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agentOperations, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

const { mockHistoryPage, mockRuntimeMetadata } = vi.hoisted(() => ({
  mockHistoryPage: vi.fn(),
  mockRuntimeMetadata: vi.fn(),
}));
vi.mock('@/server/modules/AgentRuntime/factory', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createStreamEventManager: () => ({ getStreamHistoryPage: mockHistoryPage }),
  createAgentStateManager: () => ({ getOperationMetadata: mockRuntimeMetadata }),
}));

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const mockGetOperationStatus = vi.fn();
const mockGetPendingInterventions = vi.fn();
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {
      getOperationStatus: mockGetOperationStatus,
      getPendingInterventions: mockGetPendingInterventions,
    };
  }),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

/**
 * Operation ids are creator-scoped but, since Agent Share, are handed to a
 * DIFFERENT user (the visitor) so they can attach to the redacted Gateway
 * stream. These read endpoints return the raw, unredacted operation metadata
 * from the coordinator, so the id alone must never be enough to read them.
 */
describe('aiAgentRouter operation read guard', () => {
  let serverDB: LobeChatDatabase;
  let ownerId: string;
  let visitorId: string;
  let operationId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    ownerId = await createTestUser(serverDB);
    visitorId = await createTestUser(serverDB);
    operationId = `op-share-run-${crypto.randomUUID()}`;

    await serverDB.insert(agentOperations).values({
      id: operationId,
      model: 'gpt-4o-mini',
      provider: 'openai',
      status: 'running',
      userId: ownerId,
    });

    mockHistoryPage
      .mockReset()
      .mockResolvedValue({ available: true, events: [], hasMore: false, nextCursor: '0' });
    mockRuntimeMetadata.mockReset().mockResolvedValue(null);
    mockGetOperationStatus.mockReset().mockResolvedValue({ metadata: { agentConfig: {} } });
    mockGetPendingInterventions.mockReset().mockResolvedValue({ pendingInterventions: [] });
  });

  afterEach(async () => {
    await serverDB.delete(agentOperations).where(eq(agentOperations.id, operationId));
    await cleanupTestUser(serverDB, visitorId);
    await cleanupTestUser(serverDB, ownerId);
    vi.clearAllMocks();
  });

  const callerFor = (userId: string) =>
    aiAgentRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  describe('getOperationStatus', () => {
    it('lets the owner read their own operation', async () => {
      const result = await callerFor(ownerId).getOperationStatus({ operationId });

      expect(result).toEqual({ metadata: { agentConfig: {} } });
      expect(mockGetOperationStatus).toHaveBeenCalledWith(expect.objectContaining({ operationId }));
    });

    it('rejects a share visitor holding the creator-scoped operation id', async () => {
      await expect(callerFor(visitorId).getOperationStatus({ operationId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      expect(mockGetOperationStatus).not.toHaveBeenCalled();
    });

    // Share runs execute under the CREATOR's userId inside a visitor topic
    // (`topics.senderId`), so plain ownership would let the creator read the
    // visitor's run — the same exclusion `findOwnOperationById` applies.
    it('hides a visitor-topic operation from its creator-owner', async () => {
      const [topic] = await serverDB
        .insert(topics)
        .values({ senderId: visitorId, title: 'visitor chat', userId: ownerId })
        .returning();
      await serverDB
        .update(agentOperations)
        .set({ topicId: topic.id })
        .where(eq(agentOperations.id, operationId));

      await expect(callerFor(ownerId).getOperationStatus({ operationId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        callerFor(ownerId).getPendingInterventions({ operationId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockGetOperationStatus).not.toHaveBeenCalled();
      expect(mockGetPendingInterventions).not.toHaveBeenCalled();
    });

    it('rejects an unknown operation id without touching the runtime', async () => {
      await expect(
        callerFor(ownerId).getOperationStatus({ operationId: 'op-does-not-exist' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockGetOperationStatus).not.toHaveBeenCalled();
    });
  });

  describe('getPendingInterventions', () => {
    it('rejects a foreign operation id', async () => {
      await expect(
        callerFor(visitorId).getPendingInterventions({ operationId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(mockGetPendingInterventions).not.toHaveBeenCalled();
    });

    it("refuses to list another user's operations by userId", async () => {
      await expect(
        callerFor(visitorId).getPendingInterventions({ userId: ownerId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(mockGetPendingInterventions).not.toHaveBeenCalled();
    });

    it("lists only the caller's own operations", async () => {
      await callerFor(ownerId).getPendingInterventions({ userId: ownerId });

      expect(mockGetPendingInterventions).toHaveBeenCalledWith({
        operationId: undefined,
        userId: ownerId,
      });
    });
  });

  describe('getOperationStreamHistory', () => {
    it('returns a bounded page only to an authorized operation owner', async () => {
      await callerFor(ownerId).getOperationStreamHistory({
        operationId,
        cursor: '12-0',
        limit: 20,
      });
      expect(mockHistoryPage).toHaveBeenCalledWith(operationId, '12-0', 20);
      await expect(
        callerFor(visitorId).getOperationStreamHistory({ operationId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockHistoryPage).toHaveBeenCalledTimes(1);
    });

    it('uses runtime ownership after a non-fatal initial database insert failure', async () => {
      await serverDB.delete(agentOperations).where(eq(agentOperations.id, operationId));
      mockRuntimeMetadata.mockResolvedValue({ userId: ownerId });
      await callerFor(ownerId).getOperationStreamHistory({ operationId });
      expect(mockHistoryPage).toHaveBeenCalledWith(operationId, '0', 200);
      await expect(
        callerFor(visitorId).getOperationStreamHistory({ operationId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockHistoryPage).toHaveBeenCalledTimes(1);
    });

    it('never exposes a share run through the runtime fallback', async () => {
      await serverDB.delete(agentOperations).where(eq(agentOperations.id, operationId));
      mockRuntimeMetadata.mockResolvedValue({ userId: ownerId, streamOwnerUserId: visitorId });
      await expect(
        callerFor(ownerId).getOperationStreamHistory({ operationId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        callerFor(visitorId).getOperationStreamHistory({ operationId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockHistoryPage).not.toHaveBeenCalled();
    });

    it('does not bypass a persisted visitor-topic exclusion with owner metadata', async () => {
      const [topic] = await serverDB
        .insert(topics)
        .values({ senderId: visitorId, title: 'visitor', userId: ownerId })
        .returning();
      await serverDB
        .update(agentOperations)
        .set({ topicId: topic.id })
        .where(eq(agentOperations.id, operationId));
      mockRuntimeMetadata.mockResolvedValue({ userId: ownerId });
      await expect(
        callerFor(ownerId).getOperationStreamHistory({ operationId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockHistoryPage).not.toHaveBeenCalled();
      expect(mockRuntimeMetadata).not.toHaveBeenCalled();
    });

    it('rejects an unknown operation and invalid cursor/limit without reading events', async () => {
      await expect(
        callerFor(ownerId).getOperationStreamHistory({ operationId: 'missing' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        callerFor(ownerId).getOperationStreamHistory({ operationId, cursor: '$' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        callerFor(ownerId).getOperationStreamHistory({ operationId, limit: 201 }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mockHistoryPage).not.toHaveBeenCalled();
    });
  });
});
