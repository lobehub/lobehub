// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { documents, knowledgeBases, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { hydrateKnowledgeBaseDocuments } from '../elasticsearch/hydration';
import { FtsSearchRepo } from '../index';
import { PgLikeFtsSearchBackend } from '../pgLike';

const userId = 'kb-snippet-user';
const knowledgeBaseId = 'kb-snippet';
const documentId = 'docs_snippet';
const content = `${'无关内容。'.repeat(400)}普通员工住宿标准为每晚 500 元。${'无关内容。'.repeat(400)}`;

const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(knowledgeBases).values({ id: knowledgeBaseId, name: 'KB', userId });
  await serverDB.insert(documents).values({
    content,
    fileType: 'custom/document',
    filename: 'policy',
    id: documentId,
    knowledgeBaseId,
    source: 'internal://policy',
    sourceType: 'file',
    title: 'policy',
    totalCharCount: content.length,
    totalLineCount: 1,
    userId,
  });
});

describe('knowledge base document snippets', () => {
  it('shows the matched passage from PostgreSQL search', async () => {
    const repo = new FtsSearchRepo(serverDB, userId, undefined, undefined, {
      backend: new PgLikeFtsSearchBackend(serverDB, { userId }),
    });

    const [hit] = await repo.searchKnowledgeBaseDocuments('住宿标准', [knowledgeBaseId], 5);

    expect(hit.snippet).toContain('每晚 500 元');
  });

  it('shows the matched passage when hydrating Elasticsearch hits', async () => {
    const [hit] = await hydrateKnowledgeBaseDocuments(
      serverDB,
      [{ id: documentId, score: 2 }],
      { userId },
      5,
      [knowledgeBaseId],
      '住宿标准',
    );

    expect(hit.snippet).toContain('每晚 500 元');
  });
});
