// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { FileSource } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileModel } from '@/database/models/file';
import { TaskModel } from '@/database/models/task';
import { files, projects, tasks, users } from '@/database/schemas';

import { ArtboardService } from '../index';
import { memoryStore } from './files.integration.test';

const userId = 'artboard-storage-usage-user';
const projectId = 'prj_artboard_storage_usage';

const db: LobeChatDatabase = await getTestDB();

let memory: ReturnType<typeof memoryStore>;

const service = () =>
  new ArtboardService(db, userId, undefined, {
    context: { agentId: null },
    fileStore: memory.store,
    sources: { imageBytes: async () => undefined, importPage: async () => undefined },
  });

const artboardRows = () =>
  db
    .select({ metadata: files.metadata, name: files.name, size: files.size, url: files.url })
    .from(files)
    .where(and(eq(files.userId, userId), eq(files.source, FileSource.Artboard)));

const createBoard = async () => {
  const task = await new TaskModel(db, userId).create({ instruction: 'Onboarding', projectId });
  const { artboard } = await service().create(
    {
      files: {
        writes: [
          { content: '<html>home</html>', path: 'pages/home.html' },
          { content: 'body{}', path: 'pages/base.css' },
        ],
      },
      taskId: task.identifier,
      title: 'Onboarding',
    },
    {},
  );
  return artboard;
};

beforeEach(async () => {
  memory = memoryStore();
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(projects).values({ id: projectId, name: 'Onboarding', userId });
});

afterEach(async () => {
  await db.delete(tasks).where(eq(tasks.createdByUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('artboard files in storage usage', () => {
  it("counts every stored file toward the owner's storage usage", async () => {
    const artboard = await createBoard();

    expect((await artboardRows()).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      {
        metadata: { artboardId: artboard.id, path: 'pages/base.css' },
        name: 'base.css',
        size: 6,
        url: `artboards/${artboard.id}/files/pages/base.css`,
      },
      {
        metadata: { artboardId: artboard.id, path: 'pages/home.html' },
        name: 'home.html',
        size: 17,
        url: `artboards/${artboard.id}/files/pages/home.html`,
      },
    ]);
    expect(await new FileModel(db, userId).countUsage()).toBe(23);
  });

  it('counts a file uploaded through a signed URL at its stored size', async () => {
    const artboard = await createBoard();
    await memory.store.write(
      `artboards/${artboard.id}/files/shots/home.png`,
      new Uint8Array(4096),
      'image/png',
    );

    await service().writeFiles(artboard.id, {
      writes: [{ path: 'shots/home.png', uploaded: true }],
    });

    expect(await artboardRows()).toContainEqual(
      expect.objectContaining({ name: 'home.png', size: 4096 }),
    );
  });

  it('follows an overwrite and a delete', async () => {
    const artboard = await createBoard();

    await service().writeFiles(artboard.id, {
      deletes: ['pages/base.css'],
      writes: [{ content: '<html>welcome home</html>', path: 'pages/home.html' }],
    });

    expect(await artboardRows()).toEqual([
      expect.objectContaining({ name: 'home.html', size: 25 }),
    ]);
    expect(await new FileModel(db, userId).countUsage()).toBe(25);
  });
});
