// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { agents, topics } from '@/database/schemas';

import { taskRouter } from '../../task';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

const seedConversation = async (db: LobeChatDatabase, userId: string) => {
  const [agent] = await db.insert(agents).values({ userId }).returning();
  const [topic] = await db.insert(topics).values({ agentId: agent.id, userId }).returning();
  return { agentId: agent.id, topicId: topic.id };
};

describe('Task Router context.origin', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let otherUserId: string;
  let caller: ReturnType<typeof taskRouter.createCaller>;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    otherUserId = await createTestUser(serverDB);
    caller = taskRouter.createCaller(createTestContext(userId));
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    await cleanupTestUser(serverDB, otherUserId);
  });

  it("stores an origin on the caller's own conversation", async () => {
    const own = await seedConversation(serverDB, userId);

    const created = await caller.create({
      context: { origin: { ...own, operationId: 'op_cli', toolCallId: 'call_cli' } },
      instruction: 'Report back when done',
    });

    const stored = await new TaskModel(serverDB, userId).findById(created.data.id);
    expect(stored?.context).toEqual({
      origin: { ...own, operationId: 'op_cli', toolCallId: 'call_cli' },
    });
  });

  it('creates a task without an origin and leaves context at its default, as before', async () => {
    const created = await caller.create({ instruction: 'No one to notify' });
    const withEmptyContext = await caller.create({ context: {}, instruction: 'Still no one' });

    const model = new TaskModel(serverDB, userId);
    expect((await model.findById(created.data.id))?.context).toEqual({});
    expect((await model.findById(withEmptyContext.data.id))?.context).toEqual({});
  });

  it("refuses a forged origin on another user's topic and creates nothing", async () => {
    const own = await seedConversation(serverDB, userId);
    const foreign = await seedConversation(serverDB, otherUserId);

    await expect(
      caller.create({ context: { origin: foreign }, instruction: 'Spam their topic' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Origin conversation not found' });
    await expect(
      caller.create({
        context: { origin: { agentId: own.agentId, topicId: foreign.topicId } },
        instruction: 'Spam their topic with my agent',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect((await caller.list({})).data).toHaveLength(0);
  });

  it('rejects an origin missing its topic', async () => {
    const own = await seedConversation(serverDB, userId);

    await expect(
      caller.create({
        context: { origin: { agentId: own.agentId } as never },
        instruction: 'Half an origin',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it("refuses an update that re-points the origin at another user's topic", async () => {
    const own = await seedConversation(serverDB, userId);
    const foreign = await seedConversation(serverDB, otherUserId);
    const created = await caller.create({
      context: { origin: own },
      instruction: 'Report back when done',
    });

    await expect(
      caller.update({ context: { origin: foreign }, id: created.data.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Re-saving the stored context unchanged still works.
    await expect(
      caller.update({ context: { origin: own }, id: created.data.id, name: 'Renamed' }),
    ).resolves.toMatchObject({ success: true });
    const stored = await new TaskModel(serverDB, userId).findById(created.data.id);
    expect(stored?.context).toEqual({ origin: own });
  });

  it('keeps origin optional on update: a context without a deliverable origin is stored as sent', async () => {
    const created = await caller.create({ instruction: 'Report back when done' });

    await expect(
      caller.update({ context: { note: 'kept' }, id: created.data.id }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      caller.update({ context: { origin: { topicId: 'tpc_partial' } }, id: created.data.id }),
    ).resolves.toMatchObject({ success: true });

    const stored = await new TaskModel(serverDB, userId).findById(created.data.id);
    expect(stored?.context).toEqual({ origin: { topicId: 'tpc_partial' } });
  });

  it('stores the origin ids an update validated, trimmed', async () => {
    const own = await seedConversation(serverDB, userId);
    const created = await caller.create({ instruction: 'Report back when done' });

    await caller.update({
      context: { origin: { agentId: ` ${own.agentId} `, topicId: `${own.topicId} ` } },
      id: created.data.id,
    });

    const stored = await new TaskModel(serverDB, userId).findById(created.data.id);
    expect(stored?.context).toEqual({ origin: own });
  });
});
