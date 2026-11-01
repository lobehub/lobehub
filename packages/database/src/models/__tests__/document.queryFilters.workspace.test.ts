// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';

const serverDB: LobeChatDatabase = await getTestDB();

const userA = 'doc-query-filters-user-a';
const userB = 'doc-query-filters-user-b';

let workspaceId = '';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userA }, { id: userB }]);
  const [ws] = await serverDB
    .insert(workspaces)
    .values({ name: 'doc-query-filters-ws', primaryOwnerId: userA, slug: 'doc-query-filters-ws' })
    .returning();
  workspaceId = ws.id;
  await serverDB.insert(knowledgeBases).values({
    id: 'kb-query-filters',
    name: 'KB',
    userId: userA,
    visibility: 'public',
    workspaceId,
  });
});

afterEach(async () => {
  await serverDB.delete(documents);
  await serverDB.delete(knowledgeBases);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

const insertPage = async (params: {
  id: string;
  knowledgeBaseId?: string;
  userId: string;
  visibility: 'private' | 'public';
}) => {
  await serverDB.insert(documents).values({
    fileType: 'custom/document',
    id: params.id,
    knowledgeBaseId: params.knowledgeBaseId ?? null,
    source: 'document',
    sourceType: 'api',
    title: params.id,
    totalCharCount: 0,
    totalLineCount: 0,
    userId: params.userId,
    visibility: params.visibility,
    workspaceId,
  });
};

const queryIds = async (userId: string, params: Parameters<DocumentModel['query']>[0]) => {
  const result = await new DocumentModel(serverDB, userId, workspaceId).query(params);
  return { ids: result.items.map((item) => item.id).sort(), total: result.total };
};

describe('DocumentModel.query — creator / standaloneOnly filters', () => {
  beforeEach(async () => {
    await insertPage({ id: 'a-standalone', userId: userA, visibility: 'public' });
    await insertPage({ id: 'a-private', userId: userA, visibility: 'private' });
    await insertPage({
      id: 'a-in-kb',
      knowledgeBaseId: 'kb-query-filters',
      userId: userA,
      visibility: 'public',
    });
    await insertPage({ id: 'b-standalone', userId: userB, visibility: 'public' });
    await insertPage({ id: 'b-private', userId: userB, visibility: 'private' });
    await insertPage({
      id: 'b-in-kb',
      knowledgeBaseId: 'kb-query-filters',
      userId: userB,
      visibility: 'public',
    });
  });

  it("lists the caller's own standalone pages for creator=self", async () => {
    expect(await queryIds(userA, { creator: 'self', standaloneOnly: true })).toEqual({
      ids: ['a-private', 'a-standalone'],
      total: 2,
    });
  });

  it("lists other members' public standalone pages for creator=others", async () => {
    expect(await queryIds(userA, { creator: 'others', standaloneOnly: true })).toEqual({
      ids: ['b-standalone'],
      total: 1,
    });
  });

  it('keeps knowledge-base pages when standaloneOnly is not set', async () => {
    expect(await queryIds(userA, { creator: 'self' })).toEqual({
      ids: ['a-in-kb', 'a-private', 'a-standalone'],
      total: 3,
    });
  });

  it('applies no creator narrowing by default', async () => {
    expect(await queryIds(userA, { standaloneOnly: true })).toEqual({
      ids: ['a-private', 'a-standalone', 'b-standalone'],
      total: 3,
    });
  });
});

describe('DocumentModel.query — standaloneOnly vs library-backed parsed files', () => {
  beforeEach(async () => {
    // A file that lives inside a library, and one that never joined a library.
    await serverDB.insert(files).values([
      {
        fileType: 'application/pdf',
        id: 'file-in-library',
        name: 'in-library.pdf',
        size: 1,
        url: 'https://example.com/in-library.pdf',
        userId: userA,
        workspaceId,
      },
      {
        fileType: 'application/pdf',
        id: 'file-standalone',
        name: 'standalone.pdf',
        size: 1,
        url: 'https://example.com/standalone.pdf',
        userId: userA,
        workspaceId,
      },
    ]);

    await serverDB.insert(knowledgeBaseFiles).values({
      fileId: 'file-in-library',
      knowledgeBaseId: 'kb-query-filters',
      userId: userA,
      workspaceId,
    });

    // Parsing a library file yields a document with `fileId` but no `knowledgeBaseId`.
    await serverDB.insert(documents).values([
      {
        fileId: 'file-in-library',
        fileType: 'application/pdf',
        id: 'a-parsed-from-library',
        knowledgeBaseId: null,
        source: 'document',
        sourceType: 'file',
        title: 'a-parsed-from-library',
        totalCharCount: 0,
        totalLineCount: 0,
        userId: userA,
        visibility: 'public',
        workspaceId,
      },
      {
        fileId: 'file-standalone',
        fileType: 'application/pdf',
        id: 'a-own-file',
        knowledgeBaseId: null,
        source: 'document',
        sourceType: 'file',
        title: 'a-own-file',
        totalCharCount: 0,
        totalLineCount: 0,
        userId: userA,
        visibility: 'public',
        workspaceId,
      },
    ]);
  });

  afterEach(async () => {
    await serverDB.delete(knowledgeBaseFiles);
  });

  it('leaves out a parsed file whose backing file belongs to a library', async () => {
    expect(await queryIds(userA, { creator: 'self', standaloneOnly: true })).toEqual({
      ids: ['a-own-file'],
      total: 1,
    });
  });

  it('keeps the library-backed parsed file when standaloneOnly is not set', async () => {
    expect(await queryIds(userA, { creator: 'self' })).toEqual({
      ids: ['a-own-file', 'a-parsed-from-library'],
      total: 2,
    });
  });
});

describe('DocumentModel.query — sortBy', () => {
  beforeEach(async () => {
    const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T00:00:00Z`);
    // Created order b → c → a, updated order c → a → b, title order a → b → c.
    for (const [id, createdDay, updatedDay] of [
      ['page-a', 3, 5],
      ['page-b', 1, 4],
      ['page-c', 2, 6],
    ] as const) {
      await serverDB.insert(documents).values({
        createdAt: at(createdDay),
        fileType: 'custom/document',
        id,
        source: 'document',
        sourceType: 'api',
        title: id,
        totalCharCount: 0,
        totalLineCount: 0,
        updatedAt: at(updatedDay),
        userId: userA,
        workspaceId,
      });
    }
  });

  const orderedIds = async (sortBy?: 'createdAt' | 'title' | 'updatedAt') => {
    const result = await new DocumentModel(serverDB, userA, workspaceId).query({ sortBy });
    return result.items.map((item) => item.id);
  };

  it('lists the most recently updated first by default', async () => {
    expect(await orderedIds()).toEqual(['page-c', 'page-a', 'page-b']);
  });

  it('lists the newest created first for createdAt', async () => {
    expect(await orderedIds('createdAt')).toEqual(['page-a', 'page-c', 'page-b']);
  });

  it('lists titles A→Z for title', async () => {
    expect(await orderedIds('title')).toEqual(['page-a', 'page-b', 'page-c']);
  });
});
