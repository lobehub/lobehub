// @vitest-environment node
import { deriveOperationEditedFiles } from '@lobechat/builtin-tools/operationArtifacts';
import { resolveConversationTail } from '@lobechat/conversation-flow';
import { type LobeChatDatabase } from '@lobechat/database';
import { chatGroups, messagePlugins, messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageRouter } from '../../message';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      deleteFile: vi.fn().mockResolvedValue(undefined),
      deleteFiles: vi.fn().mockResolvedValue(undefined),
      getFileAccessUrl: vi.fn().mockResolvedValue('mock-url'),
      getFullFileUrl: vi.fn().mockResolvedValue('mock-url'),
    };
  }),
}));

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const featureFlags = vi.hoisted(() => ({ enableTopicPreview: true }));
vi.mock('@/server/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn(async () => featureFlags),
}));

const at = (seconds: number) => new Date(Date.UTC(2024, 0, 1, 0, 0, seconds));

describe('message.getTopicPreviews', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;

  const createTopic = async (values: Partial<typeof topics.$inferInsert> = {}) => {
    const [topic] = await serverDB
      .insert(topics)
      .values({ userId, ...values })
      .returning();
    return topic;
  };

  const seedSingleReply = async (topicId: string) => {
    await serverDB.insert(messages).values([
      { content: 'older', createdAt: at(0), id: `${topicId}-u0`, role: 'user', topicId, userId },
      {
        content: 'older answer',
        createdAt: at(1),
        id: `${topicId}-a0`,
        parentId: `${topicId}-u0`,
        role: 'assistant',
        topicId,
        userId,
      },
      {
        content: 'question',
        createdAt: at(2),
        id: `${topicId}-u1`,
        parentId: `${topicId}-a0`,
        role: 'user',
        topicId,
        userId,
      },
      {
        content: 'final answer',
        createdAt: at(3),
        id: `${topicId}-a1`,
        parentId: `${topicId}-u1`,
        role: 'assistant',
        topicId,
        userId,
      },
    ]);
  };

  const seedToolRound = async (
    topicId: string,
    { finished, writesFile = false }: { finished: boolean; writesFile?: boolean },
  ) => {
    const tool = writesFile
      ? {
          apiName: 'writeFile',
          arguments: '{"path":"/workspace/a.ts","content":"x"}',
          identifier: 'lobe-cloud-sandbox',
          state: { path: '/workspace/a.ts', success: true },
        }
      : { apiName: 'search', arguments: '{"query":"x"}', identifier: 'lobe-web-browsing' };
    await serverDB.insert(messages).values([
      { content: 'question', createdAt: at(0), id: `${topicId}-u1`, role: 'user', topicId, userId },
      {
        content: '',
        createdAt: at(1),
        id: `${topicId}-a1`,
        parentId: `${topicId}-u1`,
        role: 'assistant',
        tools: [
          {
            apiName: tool.apiName,
            arguments: tool.arguments,
            id: `${topicId}-call`,
            identifier: tool.identifier,
            type: 'builtin',
          },
        ],
        topicId,
        userId,
      },
      {
        content: 'search result',
        createdAt: at(2),
        id: `${topicId}-t1`,
        parentId: `${topicId}-a1`,
        role: 'tool',
        topicId,
        userId,
      },
    ]);
    await serverDB.insert(messagePlugins).values({
      ...tool,
      id: `${topicId}-t1`,
      toolCallId: `${topicId}-call`,
      userId,
    });
    if (finished) {
      await serverDB.insert(messages).values({
        content: 'final answer',
        createdAt: at(3),
        id: `${topicId}-a2`,
        parentId: `${topicId}-t1`,
        role: 'assistant',
        topicId,
        userId,
      });
    }
  };

  const readHeadPage = async (topicId: string) => {
    const caller = messageRouter.createCaller(createTestContext(userId));
    return caller.getMessagesByCursor({
      countBudget: 50,
      includeFileWorks: true,
      projectToolPayloads: true,
      roundLimit: 1000,
      topicId,
    });
  };

  const headPageTail = async (topicId: string) => {
    const caller = messageRouter.createCaller(createTestContext(userId));
    const page = await caller.getMessagesByCursor({
      countBudget: 50,
      includeFileWorks: true,
      projectToolPayloads: true,
      roundLimit: 1000,
      topicId,
    });
    return page.messages.at(-1);
  };

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    featureFlags.enableTopicPreview = true;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  it('returns the head page final answer for a plain reply', async () => {
    const topic = await createTopic();
    await seedSingleReply(topic.id);
    const caller = messageRouter.createCaller(createTestContext(userId));

    const [item] = await caller.getTopicPreviews({ topicIds: [topic.id] });

    expect(item).toMatchObject({ kind: 'single', status: 'ok', topicId: topic.id });
    if (item.status !== 'ok') throw new Error('expected a preview');
    expect(item.message).toEqual(await headPageTail(topic.id));
    expect(item.topicUpdatedAt).toBe(topic.updatedAt.toISOString());
  });

  it('returns a group tail for a round that called tools', async () => {
    const topic = await createTopic();
    await seedToolRound(topic.id, { finished: true });
    const caller = messageRouter.createCaller(createTestContext(userId));

    const [item] = await caller.getTopicPreviews({ topicIds: [topic.id] });

    expect(item).toMatchObject({ kind: 'group', status: 'ok' });
    if (item.status !== 'ok') throw new Error('expected a preview');
    expect(item.message.id).toBe(`${topic.id}-a2`);
    expect(item.message).toEqual(await headPageTail(topic.id));
    expect(item).toMatchObject({
      editedFiles: [],
      goals: [],
      workRootOperationId: null,
      works: [],
    });
  });

  it('carries the question and step timeline when the round is the whole topic', async () => {
    const topic = await createTopic();
    await seedToolRound(topic.id, { finished: true });
    const caller = messageRouter.createCaller(createTestContext(userId));

    const [item] = await caller.getTopicPreviews({ topicIds: [topic.id] });

    if (item.status !== 'ok') throw new Error('expected a preview');
    const page = await readHeadPage(topic.id);
    const rendered = resolveConversationTail(page.messages);
    expect(item.leading).toEqual([page.messages[0]]);
    expect(item.blocks).toEqual(rendered?.message.children);
    expect(item.timeline.map((row) => row.id)).toEqual(page.messages.map((row) => row.id));
  });

  it('leaves out the question when earlier rounds exist', async () => {
    const topic = await createTopic();
    await seedSingleReply(topic.id);
    const caller = messageRouter.createCaller(createTestContext(userId));

    const [item] = await caller.getTopicPreviews({ topicIds: [topic.id] });

    if (item.status !== 'ok') throw new Error('expected a preview');
    expect(item.leading).toBeNull();
    expect(item.blocks).toEqual([]);
  });

  it('derives edited files the same way the renderer does over the head page', async () => {
    const topic = await createTopic();
    await seedToolRound(topic.id, { finished: true, writesFile: true });
    const caller = messageRouter.createCaller(createTestContext(userId));

    const [item] = await caller.getTopicPreviews({ topicIds: [topic.id] });

    if (item.status !== 'ok') throw new Error('expected a preview');
    const rendered = resolveConversationTail((await readHeadPage(topic.id)).messages);
    expect(item.editedFiles).toHaveLength(1);
    expect(item.editedFiles).toEqual(deriveOperationEditedFiles(rendered?.message.children));
    expect(item.kind).toBe(rendered?.kind);
  });

  it('skips a running topic', async () => {
    const topic = await createTopic({ status: 'running' });
    await seedSingleReply(topic.id);
    const caller = messageRouter.createCaller(createTestContext(userId));

    const [item] = await caller.getTopicPreviews({ topicIds: [topic.id] });

    expect(item).toEqual({ reason: 'running', status: 'skipped', topicId: topic.id });
  });

  it('skips a topic that ends on a tool result', async () => {
    const topic = await createTopic();
    await seedToolRound(topic.id, { finished: false });
    const caller = messageRouter.createCaller(createTestContext(userId));

    const [item] = await caller.getTopicPreviews({ topicIds: [topic.id] });

    expect(item).toEqual({ reason: 'notFinalAnswer', status: 'skipped', topicId: topic.id });
  });

  it('skips group chat topics', async () => {
    const [group] = await serverDB.insert(chatGroups).values({ userId }).returning();
    const topic = await createTopic({ groupId: group.id });
    const caller = messageRouter.createCaller(createTestContext(userId));

    const [item] = await caller.getTopicPreviews({ groupId: group.id, topicIds: [topic.id] });

    expect(item).toEqual({ reason: 'unsupported', status: 'skipped', topicId: topic.id });
  });

  it("reports a topic it cannot read as not found, keeping the other topics' previews", async () => {
    const topic = await createTopic();
    await seedSingleReply(topic.id);
    const caller = messageRouter.createCaller(createTestContext(userId));

    const items = await caller.getTopicPreviews({ topicIds: ['tpc_missing', topic.id] });

    expect(items[0]).toEqual({ reason: 'notFound', status: 'skipped', topicId: 'tpc_missing' });
    expect(items[1]).toMatchObject({ status: 'ok', topicId: topic.id });
  });

  it('answers disabled for every topic when the flag is off', async () => {
    featureFlags.enableTopicPreview = false;
    const topic = await createTopic();
    await seedSingleReply(topic.id);
    const caller = messageRouter.createCaller(createTestContext(userId));

    const items = await caller.getTopicPreviews({ topicIds: [topic.id] });

    expect(items).toEqual([{ reason: 'disabled', status: 'skipped', topicId: topic.id }]);
  });
});
