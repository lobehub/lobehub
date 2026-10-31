// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  documents,
  files,
  globalFiles,
  knowledgeBaseFiles,
  knowledgeBases,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { KnowledgeBaseModel } from '../knowledgeBase';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'kb-usage-user';
const otherUserId = 'kb-usage-other';

const model = new KnowledgeBaseModel(serverDB, userId);

const seedFile = async (id: string, size: number, ownerId = userId) => {
  await serverDB.insert(globalFiles).values({
    creator: ownerId,
    fileType: 'application/pdf',
    hashId: `hash-${id}`,
    size,
    url: `https://example.com/${id}.pdf`,
  });
  await serverDB.insert(files).values({
    fileHash: `hash-${id}`,
    fileType: 'application/pdf',
    id,
    name: `${id}.pdf`,
    size,
    url: `https://example.com/${id}.pdf`,
    userId: ownerId,
  });
};

const linkFile = async (
  knowledgeBaseId: string,
  fileId: string,
  ownerId = userId,
  workspaceId?: string,
) => {
  await serverDB
    .insert(knowledgeBaseFiles)
    .values({ fileId, knowledgeBaseId, userId: ownerId, workspaceId });
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(globalFiles);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(globalFiles);
});

describe('KnowledgeBaseModel.countAddedStorageBytes', () => {
  // A personal space with no files yet.
  const target = { userId: 'kb-usage-target' };

  it('sums the size of every file linked to the knowledge base', async () => {
    const { id: kbId } = await model.create({ name: 'Usage' });
    await seedFile('usage-a', 120);
    await seedFile('usage-b', 80);
    await linkFile(kbId, 'usage-a');
    await linkFile(kbId, 'usage-b');

    await expect(model.countAddedStorageBytes(kbId, target)).resolves.toBe(200);
  });

  it('returns 0 when the knowledge base has no files', async () => {
    const { id: kbId } = await model.create({ name: 'Empty' });

    await expect(model.countAddedStorageBytes(kbId, target)).resolves.toBe(0);
  });

  it('counts files that share one stored object once', async () => {
    const { id: kbId } = await model.create({ name: 'Duplicates' });
    await seedFile('usage-original', 600);
    await serverDB.insert(files).values({
      fileHash: 'hash-usage-original',
      fileType: 'application/pdf',
      id: 'usage-renamed',
      name: 'renamed.pdf',
      size: 600,
      url: 'https://example.com/usage-original.pdf',
      userId,
    });
    await linkFile(kbId, 'usage-original');
    await linkFile(kbId, 'usage-renamed');

    await expect(model.countAddedStorageBytes(kbId, target)).resolves.toBe(600);
    // The caller's personal space already stores the object.
    await expect(model.countAddedStorageBytes(kbId, { userId })).resolves.toBe(0);
  });

  it("does not count another user's links for the same knowledge base", async () => {
    const { id: kbId } = await model.create({ name: 'Mixed links' });
    await seedFile('usage-mine', 50);
    await seedFile('usage-theirs', 500, otherUserId);
    await linkFile(kbId, 'usage-mine');
    await linkFile(kbId, 'usage-theirs', otherUserId);

    await expect(model.countAddedStorageBytes(kbId, target)).resolves.toBe(50);
  });
});

describe('KnowledgeBaseModel.hasForeignLinkedRows', () => {
  it('returns false when every linked row belongs to the caller', async () => {
    const { id: kbId } = await model.create({ name: 'Owned' });
    await seedFile('foreign-none', 10);
    await linkFile(kbId, 'foreign-none');

    await expect(model.hasForeignLinkedRows(kbId)).resolves.toBe(false);
  });

  it('returns true when a linked file belongs to someone else', async () => {
    const { id: kbId } = await model.create({ name: 'Shared file' });
    await seedFile('foreign-file', 10, otherUserId);
    await linkFile(kbId, 'foreign-file');

    await expect(model.hasForeignLinkedRows(kbId)).resolves.toBe(true);
  });

  it('returns true when a derived document belongs to someone else', async () => {
    const { id: kbId } = await model.create({ name: 'Foreign doc' });
    await serverDB.insert(documents).values({
      content: 'teammate content',
      fileType: 'text/plain',
      id: 'docs_foreign_doc',
      knowledgeBaseId: kbId,
      source: 'note.txt',
      sourceType: 'file',
      title: 'Teammate note',
      totalCharCount: 16,
      totalLineCount: 1,
      userId: otherUserId,
    });

    await expect(model.hasForeignLinkedRows(kbId)).resolves.toBe(true);
  });

  it('checks documents by linked file when the caller owns the files', async () => {
    const { id: kbId } = await model.create({ name: 'Derived' });
    await seedFile('foreign-derived', 10);
    await linkFile(kbId, 'foreign-derived');
    await serverDB.insert(documents).values({
      content: 'mine',
      fileId: 'foreign-derived',
      fileType: 'application/pdf',
      id: 'docs_mine',
      source: 'foreign-derived.pdf',
      sourceType: 'file',
      title: 'Mine',
      totalCharCount: 4,
      totalLineCount: 1,
      userId,
    });

    await expect(model.hasForeignLinkedRows(kbId)).resolves.toBe(false);
  });
});

describe('KnowledgeBaseModel.deleteAllWithFiles creator scope', () => {
  it('keeps a file alive while a surviving member knowledge base still links to it', async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'kb-usage-ws', primaryOwnerId: otherUserId, slug: 'kb-usage-ws' })
      .returning();
    const scoped = new KnowledgeBaseModel(serverDB, userId, workspace.id);

    const mine = await scoped.create({ name: 'Mine' });
    // A teammate's library in the same workspace survives a narrowed clear-all.
    const [theirs] = await serverDB
      .insert(knowledgeBases)
      .values({ name: "Teammate's", userId: otherUserId, workspaceId: workspace.id })
      .returning();

    await serverDB.insert(globalFiles).values({
      creator: userId,
      fileType: 'application/pdf',
      hashId: 'hash-shared-link',
      size: 30,
      url: 'https://example.com/shared-link.pdf',
    });
    await serverDB.insert(files).values({
      fileHash: 'hash-shared-link',
      fileType: 'application/pdf',
      id: 'shared-link',
      name: 'shared-link.pdf',
      size: 30,
      url: 'https://example.com/shared-link.pdf',
      userId,
      workspaceId: workspace.id,
    });
    // The links carry the workspace scope the clear-all reads them back with.
    // Seeded without it they would be invisible to `deleteAllWithFiles`, which
    // would then never even try to delete the file — leaving the assertion
    // green with the surviving-KB rule removed.
    await linkFile(mine.id, 'shared-link', userId, workspace.id);
    await linkFile(theirs.id, 'shared-link', userId, workspace.id);

    await scoped.deleteAllWithFiles(true, { restrictToCreator: true });

    const remainingKbs = await serverDB.select().from(knowledgeBases);
    expect(remainingKbs.map((kb) => kb.id)).toEqual([theirs.id]);
    const remainingFiles = await serverDB.select().from(files);
    expect(remainingFiles.map((file) => file.id)).toEqual(['shared-link']);
  });
});
