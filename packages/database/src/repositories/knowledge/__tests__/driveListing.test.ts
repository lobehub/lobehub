// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { documents, files, knowledgeBaseFiles, knowledgeBases } from '../../../schemas/file';
import { users } from '../../../schemas/user';
import type { LobeChatDatabase } from '../../../type';
import { KnowledgeRepo } from '../index';

const userId = 'drive-listing-user';

const serverDB: LobeChatDatabase = await getTestDB();

let knowledgeRepo: KnowledgeRepo;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  knowledgeRepo = new KnowledgeRepo(serverDB, userId);

  await serverDB.insert(knowledgeBases).values([
    { id: 'drive-kb-1', name: 'KB One', userId },
    { id: 'drive-kb-2', name: 'KB Two', userId },
  ]);
  await serverDB.insert(files).values([
    {
      fileType: 'application/pdf',
      id: 'drive-kb-file',
      name: 'in-two-kbs.pdf',
      size: 100,
      url: 'drive-kb-file-url',
      userId,
    },
    {
      fileType: 'application/pdf',
      id: 'drive-loose-file',
      name: 'loose.pdf',
      size: 100,
      url: 'drive-loose-file-url',
      userId,
    },
  ]);
  await serverDB.insert(knowledgeBaseFiles).values([
    { fileId: 'drive-kb-file', knowledgeBaseId: 'drive-kb-1', userId },
    { fileId: 'drive-kb-file', knowledgeBaseId: 'drive-kb-2', userId },
  ]);
  await serverDB.insert(documents).values([
    {
      content: 'page',
      fileType: 'custom/document',
      filename: 'standalone-page',
      id: 'drive-page',
      source: 'document',
      sourceType: 'api',
      totalCharCount: 4,
      totalLineCount: 1,
      userId,
    },
    {
      content: '',
      fileType: 'custom/folder',
      filename: 'nested-folder',
      id: 'drive-folder',
      source: 'document',
      sourceType: 'document',
      title: 'nested-folder',
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
    },
    {
      content: 'kb page',
      fileType: 'custom/document',
      filename: 'kb-page',
      id: 'drive-kb-page',
      knowledgeBaseId: 'drive-kb-1',
      source: 'document',
      sourceType: 'api',
      totalCharCount: 7,
      totalLineCount: 1,
      userId,
    },
  ]);
  // The folder has to exist first: `files.parent_id` references `documents.id`.
  await serverDB.insert(files).values([
    {
      fileType: 'application/pdf',
      id: 'drive-nested-file',
      name: 'nested.pdf',
      parentId: 'drive-folder',
      size: 100,
      url: 'drive-nested-file-url',
      userId,
    },
  ]);
});

describe('KnowledgeRepo.query — drive listing', () => {
  it('lists uploaded files and the folders holding them, but never pages, for filesOnly', async () => {
    const results = await knowledgeRepo.query({
      filesOnly: true,
      // The drive root, exactly as the explorer asks for it.
      parentId: null,
      showFilesInKnowledgeBase: true,
    });

    // The folder at the root is the only way into its children, so the drive has
    // to keep it; pages belong to the sidebar's Docs sections.
    expect(results.map((item) => item.id).sort()).toEqual([
      'drive-folder',
      'drive-kb-file',
      'drive-loose-file',
    ]);
  });

  it('keeps a nested file reachable from its folder', async () => {
    const results = await knowledgeRepo.query({
      filesOnly: true,
      parentId: 'drive-folder',
      showFilesInKnowledgeBase: true,
    });

    expect(results.map((item) => item.id)).toEqual(['drive-nested-file']);
  });

  it('reports every knowledge base a file belongs to', async () => {
    const results = await knowledgeRepo.query({ filesOnly: true, showFilesInKnowledgeBase: true });
    const byId = Object.fromEntries(results.map((item) => [item.id, item]));

    expect(byId['drive-kb-file'].knowledgeBaseIds?.sort()).toEqual(['drive-kb-1', 'drive-kb-2']);
    expect(byId['drive-loose-file'].knowledgeBaseIds).toEqual([]);
  });

  it('reports the knowledge base of a document row in the combined listing', async () => {
    const results = await knowledgeRepo.query({ showFilesInKnowledgeBase: true });
    const byId = Object.fromEntries(results.map((item) => [item.id, item]));

    expect(byId['drive-page'].knowledgeBaseIds).toEqual([]);
    expect(byId['drive-kb-page'].knowledgeBaseIds).toEqual(['drive-kb-1']);
  });
});
