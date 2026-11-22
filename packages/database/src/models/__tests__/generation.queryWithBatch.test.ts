// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  asyncTasks,
  generationBatches,
  generations,
  generationTopics,
  users,
  workspaceMembers,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { GenerationModel as GenerationModelType } from '../generation';

const serverDB: LobeChatDatabase = await getTestDB();

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {};
  }),
}));

const userId = 'gen-query-user';
const otherUserId = 'gen-query-other';
const workspaceId = 'gen-query-ws';
let GenerationModel: typeof GenerationModelType;

// The server-db suite runs with `isolate: false`; load a fresh copy bound to this
// file's FileService mock and leave no mocked module behind (see generation.music.test.ts).
beforeAll(async () => {
  vi.resetModules();
  ({ GenerationModel } = await import('../generation'));
});

afterAll(() => {
  vi.doUnmock('@/server/services/file');
  vi.resetModules();
});

/** One topic of `type` with one batch holding `count` generations, oldest first. */
const seed = async (
  owner: string,
  type: 'image' | 'video',
  count: number,
  options: { minuteOffset?: number; workspaceId?: string } = {},
) => {
  const scope = { userId: owner, workspaceId: options.workspaceId ?? null };
  const [topic] = await serverDB
    .insert(generationTopics)
    .values({ ...scope, title: `${type} topic`, type })
    .returning();
  const [batch] = await serverDB
    .insert(generationBatches)
    .values({
      ...scope,
      generationTopicId: topic.id,
      model: `${type}-model`,
      prompt: `a ${type}`,
      provider: 'provider',
    })
    .returning();

  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const [task] = await serverDB
      .insert(asyncTasks)
      .values({ ...scope, status: 'pending', type })
      .returning();
    const [row] = await serverDB
      .insert(generations)
      .values({
        ...scope,
        asyncTaskId: task.id,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, (options.minuteOffset ?? 0) + i)),
        generationBatchId: batch.id,
      })
      .returning();
    ids.push(row.id);
  }
  return { batch, ids, topic };
};

beforeEach(async () => {
  await serverDB.delete(generations);
  await serverDB.delete(generationBatches);
  await serverDB.delete(generationTopics);
  await serverDB.delete(asyncTasks);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Query', primaryOwnerId: userId, slug: 'gen-query' });
});

describe('GenerationModel.queryWithBatch', () => {
  it("pages the caller's generations newest first with their batch and topic kind", async () => {
    const images = await seed(userId, 'image', 2);
    const videos = await seed(userId, 'video', 1, { minuteOffset: 10 });
    await seed(otherUserId, 'image', 3, { minuteOffset: 20 });
    const model = new GenerationModel(serverDB, userId);

    const first = await model.queryWithBatch({ limit: 2, offset: 0 });
    expect(first.total).toBe(3);
    expect(first.items.map((item) => item.id)).toEqual([videos.ids[0], images.ids[1]]);
    expect(first.items[0]).toMatchObject({
      asyncTask: { status: 'pending' },
      batch: {
        generationTopicId: videos.topic.id,
        id: videos.batch.id,
        model: 'video-model',
        prompt: 'a video',
        provider: 'provider',
        topic: { type: 'video' },
      },
    });

    const second = await model.queryWithBatch({ limit: 2, offset: 2 });
    expect(second.items.map((item) => item.id)).toEqual([images.ids[0]]);
  });

  it('narrows to one kind', async () => {
    await seed(userId, 'image', 2);
    const videos = await seed(userId, 'video', 1);
    const model = new GenerationModel(serverDB, userId);

    const result = await model.queryWithBatch({ limit: 20, offset: 0, type: 'video' });
    expect(result).toMatchObject({ total: 1 });
    expect(result.items.map((item) => item.id)).toEqual(videos.ids);
  });

  it('keeps personal and workspace generations apart', async () => {
    const personal = await seed(userId, 'image', 1);
    const shared = await seed(userId, 'image', 1, { workspaceId });

    const inPersonal = await new GenerationModel(serverDB, userId).queryWithBatch({
      limit: 20,
      offset: 0,
    });
    const inWorkspace = await new GenerationModel(serverDB, userId, workspaceId).queryWithBatch({
      limit: 20,
      offset: 0,
    });

    expect(inPersonal.items.map((item) => item.id)).toEqual(personal.ids);
    expect(inWorkspace.items.map((item) => item.id)).toEqual(shared.ids);
  });
});

describe('GenerationModel.findByIdsWithBatch', () => {
  it('returns the visible rows in the order asked, skipping others', async () => {
    const mine = await seed(userId, 'image', 2);
    const theirs = await seed(otherUserId, 'image', 1);
    const model = new GenerationModel(serverDB, userId);

    const rows = await model.findByIdsWithBatch([mine.ids[1], theirs.ids[0], mine.ids[0]]);

    expect(rows.map((row) => row.id)).toEqual([mine.ids[1], mine.ids[0]]);
    expect(rows[0].batch.topic).toEqual({ type: 'image' });
    expect(await model.findByIdsWithBatch([])).toEqual([]);
  });
});
