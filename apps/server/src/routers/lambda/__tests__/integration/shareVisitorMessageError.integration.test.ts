// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageRouter } from '../../message';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockResolvedValue('mock-url'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => testDB) }));

/**
 * Regression guard for share-visitor error persistence.
 *
 * `gatewayEventHandler`'s `error` branch persists the failure through the
 * ordinary owner-scoped `message.update` for share runs too. That works because
 * a share run's conversation rows are VISITOR-owned (only the execution
 * principal belongs to the creator) while the assistant row carries the
 * CREATOR's `agentId` — the exact pair the share client sends. This test pins
 * that shape end to end: if `message.update` ever stops resolving a visitor's
 * row under the creator's `agentId`, the visitor's error would silently stop
 * persisting and disappear on refresh.
 */
describe('share visitor message.update', () => {
  let serverDB: LobeChatDatabase;
  let creatorId: string;
  let visitorId: string;
  let creatorAgentId: string;
  let visitorTopicId: string;
  let assistantMessageId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    creatorId = await createTestUser(serverDB);
    visitorId = await createTestUser(serverDB);

    const [agent] = await serverDB
      .insert(agents)
      .values({ title: 'Shared agent', userId: creatorId })
      .returning();
    creatorAgentId = agent.id;

    // The visitor's topic: owned by the VISITOR, pointing at the CREATOR's agent.
    const [topic] = await serverDB
      .insert(topics)
      .values({
        agentId: creatorAgentId,
        shareId: '00000000-0000-4000-8000-000000000001',
        title: 'Visitor topic',
        userId: visitorId,
      })
      .returning();
    visitorTopicId = topic.id;

    // Mirrors `AiAgentService.execAgent`'s assistant placeholder for a share
    // run: visitor-owned row stamped with the creator's `agentId`.
    // Explicit id + no `.returning()`: tsgo collapses the `messages` insert
    // builder's `.returning()` type to `any[] | QueryResult<never>`, so follow
    // the sibling integration tests' explicit-id convention instead.
    assistantMessageId = 'share-visitor-assistant-message';
    await serverDB.insert(messages).values({
      agentId: creatorAgentId,
      content: '',
      id: assistantMessageId,
      role: 'assistant',
      topicId: visitorTopicId,
      userId: visitorId,
    });
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, creatorId);
    await cleanupTestUser(serverDB, visitorId);
  });

  it('persists the error onto the visitor-owned assistant message and returns the refreshed bucket', async () => {
    const caller = messageRouter.createCaller(createTestContext(visitorId) as any);

    const result = await caller.update({
      agentId: creatorAgentId,
      id: assistantMessageId,
      topicId: visitorTopicId,
      value: {
        error: { body: { detail: 'boom' }, message: 'boom', type: 'ApplicationRuntimeError' },
      } as any,
    });

    const [row] = await serverDB
      .select({ error: messages.error })
      .from(messages)
      .where(eq(messages.id, assistantMessageId));

    expect(row?.error).toMatchObject({ message: 'boom', type: 'ApplicationRuntimeError' });
    // The returned bucket must not come back empty — the client replaces the
    // whole message list with it.
    expect(result?.messages?.length).toBeGreaterThan(0);
    expect(result?.messages?.find((m: any) => m.id === assistantMessageId)?.error).toMatchObject({
      message: 'boom',
    });
  });
});
