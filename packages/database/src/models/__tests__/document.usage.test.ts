// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents, files, globalFiles, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';
import { FileModel } from '../file';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'document-usage-test-user';
const userId2 = 'document-usage-test-user-2';
const documentModel = new DocumentModel(serverDB, userId);
const fileModel = new FileModel(serverDB, userId);
const fileModel2 = new FileModel(serverDB, userId2);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(files);
  await serverDB.delete(documents);
  await serverDB.delete(globalFiles);
  await serverDB.delete(users);
});

describe('DocumentModel.countAddedStorageBytesInSubtree', () => {
  // A personal space with no files yet.
  const target = { userId: 'doc-usage-target' };

  it('should return 0 when the root document does not exist', async () => {
    const total = await documentModel.countAddedStorageBytesInSubtree('non-existent-root', target);
    expect(total).toBe(0);
  });

  it('should sum sizes of files anchored to the document and its descendants', async () => {
    const root = await documentModel.findOrCreateFolder('root-folder');
    const child = await documentModel.findOrCreateFolder('child-folder', root.id);
    const grandchild = await documentModel.findOrCreateFolder('grandchild-folder', child.id);

    // Files anchored to documents in the subtree (parentId points at a document)
    await fileModel.create({
      fileType: 'text/plain',
      name: 'root-file.txt',
      parentId: root.id,
      size: 100,
      url: 'https://example.com/root-file.txt',
    });
    await fileModel.create({
      fileType: 'text/plain',
      name: 'child-file.txt',
      parentId: child.id,
      size: 250,
      url: 'https://example.com/child-file.txt',
    });
    await fileModel.create({
      fileType: 'text/plain',
      name: 'grandchild-file.txt',
      parentId: grandchild.id,
      size: 50,
      url: 'https://example.com/grandchild-file.txt',
    });

    const total = await documentModel.countAddedStorageBytesInSubtree(root.id, target);
    expect(total).toBe(400);
  });

  it('should return 0 when the subtree has no anchored files', async () => {
    const root = await documentModel.findOrCreateFolder('empty-folder');
    const total = await documentModel.countAddedStorageBytesInSubtree(root.id, target);
    expect(total).toBe(0);
  });

  it('should not count files owned by another user', async () => {
    const root = await documentModel.findOrCreateFolder('scoped-folder');
    // A file anchored to the doc but owned by user2 must be ignored.
    await fileModel2.create({
      fileType: 'text/plain',
      name: 'other-user-file.txt',
      parentId: root.id,
      size: 999,
      url: 'https://example.com/other-user-file.txt',
    });

    const total = await documentModel.countAddedStorageBytesInSubtree(root.id, target);
    expect(total).toBe(0);
  });

  it('adds a shared object once and nothing for one the target already stores', async () => {
    const root = await documentModel.findOrCreateFolder('shared-folder');
    await serverDB.insert(globalFiles).values({
      creator: userId,
      fileType: 'application/pdf',
      hashId: 'doc-usage-hash',
      size: 600,
      url: 'files/doc-usage.pdf',
    });
    const shared = {
      fileHash: 'doc-usage-hash',
      fileType: 'application/pdf',
      parentId: root.id,
      size: 600,
      url: 'files/doc-usage.pdf',
      userId,
    };
    await serverDB.insert(files).values([
      { ...shared, name: 'original.pdf' },
      { ...shared, name: 'renamed.pdf' },
    ]);

    expect(await documentModel.countAddedStorageBytesInSubtree(root.id, target)).toBe(600);
    // The caller's personal space already stores the object.
    expect(await documentModel.countAddedStorageBytesInSubtree(root.id, { userId })).toBe(0);
  });
});
