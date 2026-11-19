// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  chunks,
  documents,
  embeddings,
  fileChunks,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { KnowledgeBaseModel } from '../knowledgeBase';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'kb-index-user';
const memberId = 'kb-index-member';
const workspaceId = 'kb-index-ws';

interface Scope {
  userId?: string;
  visibility?: 'private' | 'public';
  workspaceId?: string;
}

const addFile = async (id: string, knowledgeBaseId: string, scope: Scope = {}) => {
  const owner = scope.userId ?? userId;
  await serverDB.insert(files).values({
    fileType: 'text/markdown',
    id,
    name: `${id}.md`,
    size: 10,
    url: `files/${id}.md`,
    userId: owner,
    visibility: scope.visibility,
    workspaceId: scope.workspaceId,
  });
  await serverDB
    .insert(knowledgeBaseFiles)
    .values({ fileId: id, knowledgeBaseId, userId: owner, workspaceId: scope.workspaceId });
};

const embedFile = async (fileId: string, scope: Scope = {}) => {
  const owner = scope.userId ?? userId;
  const [chunk] = await serverDB
    .insert(chunks)
    .values({ text: 'chunk', userId: owner, workspaceId: scope.workspaceId })
    .returning();
  await serverDB
    .insert(fileChunks)
    .values({ chunkId: chunk.id, fileId, userId: owner, workspaceId: scope.workspaceId });
  await serverDB.insert(embeddings).values({
    chunkId: chunk.id,
    embeddings: Array.from({ length: 1024 }, () => 0.1),
    model: 'test-embedding',
    userId: owner,
    workspaceId: scope.workspaceId,
  });
};

const addPage = (
  id: string,
  values: { content: string; fileId?: string; fileType?: string; knowledgeBaseId?: string },
  scope: Scope = {},
) =>
  serverDB.insert(documents).values({
    fileType: 'custom/document',
    id,
    source: 'document',
    sourceType: 'api',
    title: id,
    totalCharCount: values.content.length,
    totalLineCount: 1,
    userId: scope.userId ?? userId,
    visibility: scope.visibility,
    workspaceId: scope.workspaceId,
    ...values,
  });

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: memberId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: workspaceId, primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(workspaces).where(inArray(workspaces.id, [workspaceId]));
  await serverDB.delete(users).where(inArray(users.id, [userId, memberId]));
});

describe('KnowledgeBaseModel.getSearchIndexStatus', () => {
  it('sorts library items by which search path can read them', async () => {
    await serverDB.insert(knowledgeBases).values([
      { id: 'kb_index_main', name: 'Docs', userId },
      { id: 'kb_index_other', name: 'Other', userId },
    ]);

    // Embedded upload: semantic search reaches it.
    await addFile('file_embedded', 'kb_index_main');
    await embedFile('file_embedded');
    // Parsed upload without embeddings, and a page with its mirror file: keyword search only.
    await addFile('file_parsed', 'kb_index_main');
    await addPage('docs_parsed', { content: 'parsed text', fileId: 'file_parsed' });
    await addFile('file_page_mirror', 'kb_index_main');
    await addPage('docs_page', {
      content: 'page body',
      fileId: 'file_page_mirror',
      knowledgeBaseId: 'kb_index_main',
    });
    // A page with no backing file row is keyword-searchable too; a folder holds no text.
    await addPage('docs_standalone', { content: 'note', knowledgeBaseId: 'kb_index_main' });
    await addPage('docs_folder', {
      content: '',
      fileType: 'custom/folder',
      knowledgeBaseId: 'kb_index_main',
    });
    // Never parsed nor embedded — and an empty parse result does not count as text.
    await addFile('file_unindexed', 'kb_index_main');
    await addFile('file_empty_parse', 'kb_index_main');
    await addPage('docs_empty_parse', { content: '', fileId: 'file_empty_parse' });
    // Outside the searched library.
    await addFile('file_elsewhere', 'kb_index_other');

    const status = await new KnowledgeBaseModel(serverDB, userId).getSearchIndexStatus([
      'kb_index_main',
    ]);

    expect(status).toEqual({
      embeddedFiles: 1,
      keywordOnlyItems: 3,
      unindexedFiles: 2,
      unindexedFileSamples: [
        { id: 'file_empty_parse', name: 'file_empty_parse.md' },
        { id: 'file_unindexed', name: 'file_unindexed.md' },
      ],
    });
  });

  it("never counts or names a member's private file for a shared agent", async () => {
    const ws = { workspaceId };
    await serverDB
      .insert(knowledgeBases)
      .values({ id: 'kb_index_ws', name: 'Team', userId, visibility: 'public', workspaceId });
    await addFile('file_public', 'kb_index_ws', { ...ws, visibility: 'public' });
    await addFile('file_member_private', 'kb_index_ws', {
      ...ws,
      userId: memberId,
      visibility: 'private',
    });
    await addFile('file_caller_private', 'kb_index_ws', { ...ws, visibility: 'private' });

    const model = new KnowledgeBaseModel(serverDB, userId, workspaceId);

    // The caller's own private file is theirs to see on a private agent…
    expect(await model.getSearchIndexStatus(['kb_index_ws'])).toMatchObject({
      unindexedFileSamples: [
        { id: 'file_caller_private', name: 'file_caller_private.md' },
        { id: 'file_public', name: 'file_public.md' },
      ],
      unindexedFiles: 2,
    });
    // …but a workspace-shared agent sees public items only.
    expect(await model.getSearchIndexStatus(['kb_index_ws'], 'public')).toMatchObject({
      unindexedFileSamples: [{ id: 'file_public', name: 'file_public.md' }],
      unindexedFiles: 1,
    });
  });

  it('reports nothing for an empty scope', async () => {
    expect(await new KnowledgeBaseModel(serverDB, userId).getSearchIndexStatus([])).toEqual({
      embeddedFiles: 0,
      keywordOnlyItems: 0,
      unindexedFiles: 0,
      unindexedFileSamples: [],
    });
  });
});
