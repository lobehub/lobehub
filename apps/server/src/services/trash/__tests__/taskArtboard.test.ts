// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { FileSource } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArtboardModel } from '@/database/models/artboard';
import { TaskModel } from '@/database/models/task';
import { WorkModel } from '@/database/models/work';
import { artboards, files, projects, tasks, users, works } from '@/database/schemas';

import { TrashService, trashTasksInTransaction } from '../index';

const { blobs, unpublishCanvasSite } = vi.hoisted(() => ({
  blobs: new Map<string, number>(),
  unpublishCanvasSite: vi.fn(),
}));

vi.mock('@/business/server/canvasPublish', () => ({ unpublishCanvasSite }));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      deleteFiles: async (keys: string[]) => {
        for (const key of keys) blobs.delete(key);
      },
      listFileObjects: async (prefix: string) =>
        [...blobs]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, size]) => ({ etag: key, key, size })),
    };
  }),
}));

const db = await getTestDB();
const userId = 'trash-task-artboard-user';
const projectId = 'prj_trash_task_artboard';

const shareArtboard = async () => {
  const task = await new TaskModel(db, userId).create({ instruction: 'Onboarding', projectId });
  const artboard = await new ArtboardModel(db, userId).create({
    projectId,
    taskId: task.id,
    title: 'Onboarding board',
  });
  const workModel = new WorkModel(db, userId);
  await workModel.registerArtboard({
    artboardId: artboard.id,
    changeType: 'created',
    projectId,
    title: artboard.title,
    toolIdentifier: 'lobe-artboard',
    toolName: 'createArtboard',
  });
  await workModel.recordArtboardPublish(artboard.id, {
    deploymentId: 'dep_trash_task',
    publishedRevision: 1,
    publisherUserId: userId,
    snapshotHash: 'hash',
    url: 'https://onboarding.lobe.page',
  });
  blobs.set(`artboards/${artboard.id}/files/pages/home.html`, 120);
  await db.insert(files).values({
    fileType: 'text/html; charset=utf-8',
    metadata: { artboardId: artboard.id, path: 'pages/home.html' },
    name: 'home.html',
    size: 120,
    source: FileSource.Artboard,
    url: `artboards/${artboard.id}/files/pages/home.html`,
    userId,
  });
  blobs.set(`artboards/${artboard.id}/files/shots/home.png`, 4096);
  return { artboard, task };
};

const trashTask = (task: { id: string; status: string }) =>
  db.transaction((tx) =>
    trashTasksInTransaction(tx as unknown as typeof db, { userId }, [
      { status: task.status, taskId: task.id, topicIds: [] },
    ]),
  );

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(projects).values({ id: projectId, name: 'Onboarding', userId });
  blobs.clear();
  blobs.set('artboards/art_someone_else/files/pages/home.html', 64);
  unpublishCanvasSite.mockReset();
});

afterEach(async () => {
  await db.delete(tasks).where(eq(tasks.createdByUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('Task trash handler and artboards', () => {
  it('purging a trashed task deletes its artboard, the Work, the stored files and the share', async () => {
    const { artboard, task } = await shareArtboard();
    await trashTask(task);
    const service = new TrashService(db, userId);
    const { items } = await service.list({ resourceType: 'task' });

    await service.purge(items.map((item) => item.id));

    expect(await db.select().from(artboards).where(eq(artboards.id, artboard.id))).toEqual([]);
    expect(await db.select().from(works).where(eq(works.resourceId, artboard.id))).toEqual([]);
    expect([...blobs.keys()]).toEqual(['artboards/art_someone_else/files/pages/home.html']);
    expect(await db.select().from(files).where(eq(files.userId, userId))).toEqual([]);
    expect(unpublishCanvasSite).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: 'dep_trash_task', userId }),
    );
  });

  it('restoring a trashed task keeps its artboard and files', async () => {
    const { artboard, task } = await shareArtboard();
    await trashTask(task);
    const service = new TrashService(db, userId);
    const { items } = await service.list({ resourceType: 'task' });

    await service.restore(items.map((item) => item.id));

    expect(await new ArtboardModel(db, userId).findById(artboard.id)).toMatchObject({
      id: artboard.id,
    });
    expect(blobs.has(`artboards/${artboard.id}/files/pages/home.html`)).toBe(true);
  });
});
