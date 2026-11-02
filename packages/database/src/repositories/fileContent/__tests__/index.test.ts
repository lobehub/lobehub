// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { FileModel } from '../../../models/file';
import { asyncTasks, documents, files, globalFiles, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { FileContentRepository } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'file-content-user';
const fileModel = new FileModel(serverDB, userId);
const repository = new FileContentRepository(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(files);
  await serverDB.delete(globalFiles);
});

describe('FileContentRepository', () => {
  it('replaceStoredContent drops parsed data so a re-export cannot serve stale text', async () => {
    const [task] = await serverDB
      .insert(asyncTasks)
      .values({ status: 'success', type: 'chunk', userId })
      .returning();
    await fileModel.create(
      { fileHash: 'hash-a', fileType: 'docx', id: 'file-a', name: 'a', size: 1, url: 'key' },
      true,
    );
    await serverDB.update(files).set({ chunkTaskId: task!.id }).where(eq(files.id, 'file-a'));
    await serverDB.insert(documents).values({
      content: 'old text',
      fileId: 'file-a',
      fileType: 'docx',
      source: 'key',
      sourceType: 'file',
      totalCharCount: 8,
      totalLineCount: 1,
      userId,
    });

    const file = await fileModel.findById('file-a');
    await repository.replaceStoredContent(file!, { fileType: 'application/pdf', size: 99 });

    expect(await fileModel.findById('file-a')).toMatchObject({
      chunkTaskId: null,
      fileType: 'application/pdf',
      size: 99,
    });
    expect(await serverDB.select().from(documents).where(eq(documents.fileId, 'file-a'))).toEqual(
      [],
    );
    expect(await serverDB.select().from(asyncTasks).where(eq(asyncTasks.id, task!.id))).toEqual([]);
  });
});
