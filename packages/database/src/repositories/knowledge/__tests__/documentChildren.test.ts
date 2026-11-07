// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { documents, files, knowledgeBaseFiles, knowledgeBases } from '../../../schemas/file';
import { users } from '../../../schemas/user';
import type { LobeChatDatabase } from '../../../type';
import { KnowledgeRepo } from '../index';

const userId = 'doc-children-user';
const otherUserId = 'doc-children-other-user';
const kbId = 'doc-children-kb';

const serverDB: LobeChatDatabase = await getTestDB();

let knowledgeRepo: KnowledgeRepo;

const page = (id: string, extra: Partial<typeof documents.$inferInsert> = {}) => ({
  content: id,
  fileType: 'custom/document',
  filename: id,
  id,
  knowledgeBaseId: kbId,
  source: 'document',
  sourceType: 'api' as const,
  title: id,
  totalCharCount: id.length,
  totalLineCount: 1,
  userId,
  ...extra,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  knowledgeRepo = new KnowledgeRepo(serverDB, userId);

  await serverDB.insert(knowledgeBases).values([{ id: kbId, name: 'KB', userId }]);
  // Parents first: `parent_id` references `documents.id`.
  await serverDB
    .insert(documents)
    .values([page('parent-doc'), page('leaf-doc'), page('file-parent-doc'), page('trash-parent')]);
  await serverDB.insert(documents).values([
    page('child-doc', { parentId: 'parent-doc' }),
    page('trashed-child', { isDeleted: true, parentId: 'trash-parent' }),
    // Another user's row can't make the caller's document expandable.
    page('foreign-child', { knowledgeBaseId: null, parentId: 'leaf-doc', userId: otherUserId }),
  ]);
  await serverDB.insert(files).values([
    {
      fileType: 'application/pdf',
      id: 'child-file',
      name: 'child.pdf',
      parentId: 'file-parent-doc',
      size: 100,
      url: 'child-file-url',
      userId,
    },
  ]);
  await serverDB
    .insert(knowledgeBaseFiles)
    .values([{ fileId: 'child-file', knowledgeBaseId: kbId, userId }]);
});

describe('KnowledgeRepo.query — documents with children', () => {
  it('reports hasChildren for a document holding a document or a file', async () => {
    const results = await knowledgeRepo.query({ knowledgeBaseId: kbId, parentId: null });
    const byId = Object.fromEntries(results.map((item) => [item.id, item]));

    expect(byId['parent-doc'].hasChildren).toBe(true);
    expect(byId['file-parent-doc'].hasChildren).toBe(true);
    expect(byId['leaf-doc'].hasChildren).toBe(false);
    expect(byId['trash-parent'].hasChildren).toBe(false);
  });

  it('reports hasChildren in the summary listing too', async () => {
    const results = await knowledgeRepo.query({
      includeContent: false,
      knowledgeBaseId: kbId,
      parentId: null,
    });
    const byId = Object.fromEntries(results.map((item) => [item.id, item]));

    expect(byId['parent-doc'].hasChildren).toBe(true);
    expect(byId['leaf-doc'].hasChildren).toBe(false);
  });

  it('lists the children of a document inside the knowledge base', async () => {
    const docChildren = await knowledgeRepo.query({
      knowledgeBaseId: kbId,
      parentId: 'parent-doc',
    });
    const fileChildren = await knowledgeRepo.query({
      knowledgeBaseId: kbId,
      parentId: 'file-parent-doc',
    });

    expect(docChildren.map((item) => item.id)).toEqual(['child-doc']);
    expect(docChildren[0].hasChildren).toBe(false);
    expect(fileChildren.map((item) => item.id)).toEqual(['child-file']);
    expect(fileChildren[0].hasChildren).toBe(false);
  });
});
