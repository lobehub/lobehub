// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { files, globalFiles, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { trashStamp } from '../../utils/softDelete';
import { FileModel } from '../file';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'shared-storage-user';
const sharedKey = 'code-interpreter-exports/2026-11-02/topic/report.docx';
const fileModel = new FileModel(serverDB, userId);

const insertExport = async (id: string, hash: string, url = sharedKey) => {
  await fileModel.create(
    { fileHash: hash, fileType: 'docx', id, name: 'report.docx', size: 1, url },
    true,
  );
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

describe('FileModel shared storage objects', () => {
  it('delete keeps the object while another row with a different hash points at it', async () => {
    await insertExport('file-a', 'hash-a');
    await insertExport('file-b', 'hash-b');

    await expect(fileModel.delete('file-a')).resolves.toBeUndefined();
    expect(await fileModel.findById('file-b')).toMatchObject({ url: sharedKey });

    await expect(fileModel.delete('file-b')).resolves.toMatchObject({ url: sharedKey });
  });

  it('deleteMany keeps the object while a row outside the batch points at it', async () => {
    await insertExport('file-a', 'hash-a');
    await insertExport('file-b', 'hash-b');
    await insertExport('file-other', 'hash-other', 'other-key');

    const removed = await fileModel.deleteMany(['file-a', 'file-other']);

    expect(removed.map((file) => file.url)).toEqual(['other-key']);
    const globals = await serverDB
      .select()
      .from(globalFiles)
      .where(eq(globalFiles.hashId, 'hash-b'));
    expect(globals).toHaveLength(1);
  });

  it('deleteMany returns a shared object once when the batch removes every row', async () => {
    await insertExport('file-a', 'hash-a');
    await insertExport('file-b', 'hash-b');

    const removed = await fileModel.deleteMany(['file-a', 'file-b']);

    expect(removed.map((file) => file.url)).toEqual([sharedKey]);
  });

  it('counts recycle-bin rows as references', async () => {
    await insertExport('file-a', 'hash-a');
    await insertExport('file-b', 'hash-b');
    await serverDB.update(files).set(trashStamp(new Date())).where(eq(files.id, 'file-b'));

    await expect(fileModel.delete('file-a')).resolves.toBeUndefined();
  });

  it('findByUrl returns the latest accessible row and ignores other users', async () => {
    await serverDB.insert(users).values({ id: 'other-user' });
    await new FileModel(serverDB, 'other-user').create(
      { fileHash: 'hash-x', fileType: 'docx', id: 'file-x', name: 'x', size: 1, url: 'foreign' },
      true,
    );
    await insertExport('file-a', 'hash-a');

    expect((await fileModel.findByUrl(sharedKey))?.id).toBe('file-a');
    expect(await fileModel.findByUrl('foreign')).toBeUndefined();
  });

  it('findByUrl skips recycle-bin rows', async () => {
    await insertExport('file-a', 'hash-a');
    await serverDB.update(files).set(trashStamp(new Date())).where(eq(files.id, 'file-a'));

    expect(await fileModel.findByUrl(sharedKey)).toBeUndefined();
  });

  it('keeps the object for a workspace member private row without exposing that row', async () => {
    const memberId = 'shared-storage-member';
    await serverDB.insert(users).values({ id: memberId });
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'Shared', primaryOwnerId: userId, slug: 'shared-storage-workspace' })
      .returning();
    const ownerModel = new FileModel(serverDB, userId, workspace!.id);
    const memberModel = new FileModel(serverDB, memberId, workspace!.id);
    const exported = { fileType: 'docx', name: 'report.docx', size: 1, url: sharedKey };
    await ownerModel.create({ ...exported, fileHash: 'hash-a', id: 'file-a' }, true);
    await memberModel.create(
      { ...exported, fileHash: 'hash-b', id: 'file-b', visibility: 'private' },
      true,
    );

    await expect(ownerModel.delete('file-a')).resolves.toBeUndefined();
    expect(await ownerModel.findByUrl(sharedKey)).toBeUndefined();
  });
});
