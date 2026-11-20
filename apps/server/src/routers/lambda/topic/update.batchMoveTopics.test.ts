// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, topics, workspaces } from '@lobechat/database/schemas';
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

// The General-access `use` guards have their own tests; this file covers the
// creator/role rule layered on top of them.
vi.mock('../_helpers/conversationResourceGuard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertCanUseConversationTargets: vi.fn(async () => {}),
  assertCanUseTopicTargets: vi.fn(async () => []),
}));

const { topicRouter } = await import('./index');

describe('topic.batchMoveTopics in a workspace', () => {
  let creatorId: string;
  let operatorId: string;
  let workspaceId: string;

  beforeEach(async () => {
    testDB = await getTestDB();
    creatorId = await createTestUser(testDB);
    operatorId = await createTestUser(testDB);
    const [workspace] = await testDB
      .insert(workspaces)
      .values({ name: 'Team', primaryOwnerId: creatorId, slug: `ws-move-${creatorId}` })
      .returning();
    workspaceId = workspace.id;
  });

  afterEach(async () => {
    await cleanupTestUser(testDB, operatorId);
    await cleanupTestUser(testDB, creatorId);
  });

  /** A teammate's topic on one workspace agent, plus a second agent to move it to. */
  const seedTeammateTopic = async () => {
    const [source, target] = await testDB
      .insert(agents)
      .values([
        { slug: `src-${creatorId}`, userId: creatorId, workspaceId },
        { slug: `dst-${creatorId}`, userId: creatorId, workspaceId },
      ])
      .returning();
    const [topic] = await testDB
      .insert(topics)
      .values({ agentId: source.id, title: 'Teammate topic', userId: creatorId, workspaceId })
      .returning();
    return { targetAgentId: target.id, topicId: topic.id };
  };

  const readAgentId = async (topicId: string) => {
    const [row] = await testDB.select().from(topics).where(eq(topics.id, topicId));
    return row.agentId;
  };

  it("lets a workspace admin move a teammate's topic", async () => {
    const { targetAgentId, topicId } = await seedTeammateTopic();
    const caller = topicRouter.createCaller({
      userId: operatorId,
      workspaceId,
      workspaceRole: 'admin',
    } as any);

    await caller.batchMoveTopics({ targetAgentId, topicIds: [topicId] });

    expect(await readAgentId(topicId)).toBe(targetAgentId);
  });

  it("still refuses a plain member moving a teammate's topic", async () => {
    const { targetAgentId, topicId } = await seedTeammateTopic();
    const caller = topicRouter.createCaller({
      userId: operatorId,
      workspaceId,
      workspaceRole: 'member',
    } as any);

    await expect(
      caller.batchMoveTopics({ targetAgentId, topicIds: [topicId] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await readAgentId(topicId)).not.toBe(targetAgentId);
  });
});
