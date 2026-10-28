// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agentOperations, topics, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestUser, createTestUser } from '../__tests__/integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

// The General-access `use` guard has its own tests; this file covers the
// run-ownership rule layered on top of it.
vi.mock('../_helpers/conversationResourceGuard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertCanUseTopicTargets: vi.fn(async () => []),
}));

// A live run whose non-fatal `agent_operations` insert failed is known only to
// the runtime state.
const mockGetOperationMetadata = vi.hoisted(() => vi.fn());
vi.mock('@/server/modules/AgentRuntime/factory', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAgentStateManager: () => ({ getOperationMetadata: mockGetOperationMetadata }),
}));

const { topicRouter } = await import('./index');

describe('topic.settleRunningOperation in a workspace', () => {
  let starterId: string;
  let teammateId: string;
  let workspaceId: string;

  beforeEach(async () => {
    testDB = await getTestDB();
    starterId = await createTestUser(testDB);
    teammateId = await createTestUser(testDB);
    const [workspace] = await testDB
      .insert(workspaces)
      .values({ name: 'Team', primaryOwnerId: starterId, slug: `ws-settle-${starterId}` })
      .returning();
    workspaceId = workspace.id;
  });

  afterEach(async () => {
    mockGetOperationMetadata.mockReset();
    await cleanupTestUser(testDB, teammateId);
    await cleanupTestUser(testDB, starterId);
  });

  /** A workspace topic whose run, started by `starterId`, waits on a human. */
  const seedWaitingRun = async () => {
    const operationId = `op-${starterId}`;
    const [topic] = await testDB
      .insert(topics)
      .values({
        metadata: {
          runningOperation: {
            assistantMessageId: 'msg-1',
            operationId,
            startedAt: new Date().toISOString(),
          },
        },
        status: 'running',
        title: 'Waiting',
        userId: starterId,
        workspaceId,
      })
      .returning();
    await testDB.insert(agentOperations).values({
      id: operationId,
      status: 'waiting_for_human',
      topicId: topic.id,
      userId: starterId,
      workspaceId,
    });
    return { operationId, topicId: topic.id };
  };

  const readMarker = async (topicId: string) => {
    const [row] = await testDB.select().from(topics).where(eq(topics.id, topicId));
    return row.metadata?.runningOperation?.operationId;
  };

  it("does not let a teammate clear another member's live run", async () => {
    const { operationId, topicId } = await seedWaitingRun();
    const caller = topicRouter.createCaller({ userId: teammateId, workspaceId } as any);

    await expect(
      caller.settleRunningOperation({ id: topicId, operationId, status: 'active' }),
    ).resolves.toEqual({ activeOperationId: operationId, status: 'not_owner' });
    expect(await readMarker(topicId)).toBe(operationId);
  });

  it('still settles for the member who started the run', async () => {
    const { operationId, topicId } = await seedWaitingRun();
    const caller = topicRouter.createCaller({ userId: starterId, workspaceId } as any);

    await caller.settleRunningOperation({ id: topicId, operationId, status: 'active' });

    expect(await readMarker(topicId)).toBeUndefined();
  });

  it("guards a teammate's unpersisted run by its runtime metadata", async () => {
    const { operationId, topicId } = await seedWaitingRun();
    await testDB.delete(agentOperations).where(eq(agentOperations.id, operationId));
    mockGetOperationMetadata.mockResolvedValue({ userId: starterId });
    const caller = topicRouter.createCaller({ userId: teammateId, workspaceId } as any);

    await expect(
      caller.settleRunningOperation({ id: topicId, operationId, status: 'active' }),
    ).resolves.toEqual({ activeOperationId: operationId, status: 'not_owner' });
    expect(await readMarker(topicId)).toBe(operationId);
  });
});
