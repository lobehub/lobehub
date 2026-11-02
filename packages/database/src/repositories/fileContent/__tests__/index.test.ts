// @vitest-environment node
import { AsyncTaskStatus } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { FileModel } from '../../../models/file';
import { asyncTasks, documents, files, globalFiles, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { FileContentRepository } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'file-content-user';
const url = 'code-interpreter-exports/2026-11-02/topic/report.docx';
const fileModel = new FileModel(serverDB, userId);
const repository = new FileContentRepository(serverDB, userId);
const newContent = { fileType: 'application/pdf', size: 99 };

const insertFile = async (id: string, createdAt: Date) => {
  await fileModel.create(
    { createdAt, fileHash: `hash-${id}`, fileType: 'docx', id, name: 'a', size: 1, url },
    true,
  );
};

const attachChunkTask = async (id: string, status: AsyncTaskStatus) => {
  const [task] = await serverDB
    .insert(asyncTasks)
    .values({ status, type: 'chunk', userId })
    .returning();
  await serverDB.update(files).set({ chunkTaskId: task!.id }).where(eq(files.id, id));

  return task!.id;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(files);
  await serverDB.delete(globalFiles);
});

describe('FileContentRepository.replaceStoredContent', () => {
  it('drops parsed data on every row of the key and returns the newest', async () => {
    await insertFile('file-old', new Date('2026-11-01'));
    await insertFile('file-new', new Date('2026-11-02'));
    const taskId = await attachChunkTask('file-old', AsyncTaskStatus.Success);
    await serverDB.insert(documents).values({
      content: 'old text',
      fileId: 'file-old',
      fileType: 'docx',
      source: url,
      sourceType: 'file',
      totalCharCount: 8,
      totalLineCount: 1,
      userId,
    });

    await expect(repository.replaceStoredContent(url, newContent)).resolves.toBe('file-new');

    expect(await fileModel.findById('file-old')).toMatchObject({
      chunkTaskId: null,
      ...newContent,
    });
    expect(await fileModel.findById('file-new')).toMatchObject(newContent);
    expect(await serverDB.select().from(documents).where(eq(documents.fileId, 'file-old'))).toEqual(
      [],
    );
    expect(await serverDB.select().from(asyncTasks).where(eq(asyncTasks.id, taskId))).toEqual([]);
  });

  it.each([AsyncTaskStatus.Pending, AsyncTaskStatus.Processing])(
    'does not reuse rows while a %s task may still write old chunks',
    async (status) => {
      await insertFile('file-a', new Date());
      const taskId = await attachChunkTask('file-a', status);

      await expect(repository.replaceStoredContent(url, newContent)).resolves.toBeUndefined();

      expect(await fileModel.findById('file-a')).toMatchObject({ chunkTaskId: taskId, size: 1 });
    },
  );

  it('resolves undefined when no row owns the key', async () => {
    await expect(repository.replaceStoredContent(url, newContent)).resolves.toBeUndefined();
  });
});
