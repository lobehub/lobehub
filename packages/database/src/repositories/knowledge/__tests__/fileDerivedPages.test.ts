// @vitest-environment node
import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { FilesTabs } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { documents, files, knowledgeBaseFiles, knowledgeBases } from '../../../schemas/file';
import { users } from '../../../schemas/user';
import { workspaces } from '../../../schemas/workspace';
import { KnowledgeRepo } from '../index';

const userId = 'file-derived-pages-user';
const otherUserId = 'file-derived-pages-other-user';
const workspaceId = 'file-derived-pages-workspace';
const content = 'Extracted PDF text';
const db = await getTestDB();

const addParsedPdf = async (
  id: string,
  ownerId: string,
  options: { fileVisibility?: 'private' | 'public'; workspaceId?: string } = {},
) => {
  const fileId = `${id}-file`;
  const source = `${id}.pdf`;
  await db.insert(files).values({
    fileType: 'application/pdf',
    id: fileId,
    name: source,
    size: 100,
    url: source,
    userId: ownerId,
    visibility: options.fileVisibility,
    workspaceId: options.workspaceId,
  });
  await db.insert(documents).values({
    content,
    fileId,
    fileType: CUSTOM_DOCUMENT_FILE_TYPE,
    id,
    source,
    sourceType: 'file',
    title: id,
    totalCharCount: content.length,
    totalLineCount: 1,
    userId: ownerId,
    visibility: 'public',
    workspaceId: options.workspaceId,
  });

  return fileId;
};

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

describe('KnowledgeRepo.query — file-derived pages', () => {
  it('lists accessible parsed uploads in Pages while All and Drive keep one file row', async () => {
    const fileId = await addParsedPdf('parsed-page', userId);
    const libraryFileId = await addParsedPdf('library-page', userId);
    await addParsedPdf('other-user-page', otherUserId);
    const knowledgeBaseId = 'parsed-pages-library';
    await db.insert(knowledgeBases).values({ id: knowledgeBaseId, name: 'Test library', userId });
    await db.insert(knowledgeBaseFiles).values({ fileId: libraryFileId, knowledgeBaseId, userId });

    const repo = new KnowledgeRepo(db, userId);
    const pages = await repo.query({ category: FilesTabs.Pages });
    expect(pages).toMatchObject([
      {
        content,
        fileId,
        fileType: CUSTOM_DOCUMENT_FILE_TYPE,
        id: 'parsed-page',
        sourceType: 'document',
      },
    ]);

    const pagesWithLibraryFiles = await repo.query({
      category: FilesTabs.Pages,
      showFilesInKnowledgeBase: true,
    });
    expect(pagesWithLibraryFiles.map((item) => item.id).sort()).toEqual([
      'library-page',
      'parsed-page',
    ]);

    const pagesWithoutRestrictedLibrary = await repo.query({
      category: FilesTabs.Pages,
      excludeKnowledgeBaseIds: [knowledgeBaseId],
      showFilesInKnowledgeBase: true,
    });
    expect(pagesWithoutRestrictedLibrary.map((item) => item.id)).toEqual(['parsed-page']);

    const all = await repo.query({ category: FilesTabs.All });
    const drive = await repo.query({
      filesOnly: true,
      parentId: null,
      showFilesInKnowledgeBase: true,
    });
    for (const listing of [all, drive]) {
      expect(listing.filter((item) => item.fileId === fileId)).toMatchObject([
        { fileType: 'application/pdf', sourceType: 'file' },
      ]);
    }
  });

  it('hides a public workspace page when its backing file is private to another user', async () => {
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Test workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    await addParsedPdf('public-file-page', otherUserId, { fileVisibility: 'public', workspaceId });
    await addParsedPdf('private-file-page', otherUserId, {
      fileVisibility: 'private',
      workspaceId,
    });

    const repo = new KnowledgeRepo(db, userId, workspaceId);
    const publicPages = await repo.query({ category: FilesTabs.Pages, visibility: 'public' });
    const privatePages = await repo.query({ category: FilesTabs.Pages, visibility: 'private' });

    expect(publicPages.map((item) => item.id)).toEqual(['public-file-page']);
    expect(privatePages).toEqual([]);
  });
});
