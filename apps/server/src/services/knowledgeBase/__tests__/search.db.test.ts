// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FtsSearchRepo, PgLikeFtsSearchBackend } from '@/database/repositories/ftsSearch';
import { documents, files, knowledgeBaseFiles, knowledgeBases, users } from '@/database/schemas';

import { KnowledgeBaseSearchService } from '../index';

vi.mock('@/server/globalConfig', () => ({
  getServerDefaultFilesConfig: () => ({ embeddingModel: { model: 'test', provider: 'openai' } }),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: async () => ({
    embeddings: async () => [Array.from({ length: 1024 }, () => 0.01)],
  }),
}));
// The extension-free provider runs on the test database; the strict "every word in one field"
// rule it shares with pg_search and Elasticsearch is what these queries exercise.
vi.mock('@/server/services/ftsSearch', () => ({
  createFtsSearchRepo: async (input: any) => {
    const scope = {
      callerAgentVisibility: input.callerAgentVisibility,
      userId: input.userId,
      workspaceId: input.workspaceId,
    };
    return new FtsSearchRepo(
      input.db,
      input.userId,
      input.workspaceId,
      input.callerAgentVisibility,
      {
        backend: new PgLikeFtsSearchBackend(input.db, scope),
        ftsSearchCandidateEnabled: true,
      },
    );
  },
}));

const serverDB = await getTestDB();
const userId = 'kb-search-db-user';
const kbId = 'kb_search_db';

const addPage = async (id: string, title: string, content: string) => {
  // A knowledge-base page, as `lh kb create-doc` / the createDocument tool write it: a mirror file
  // row in the library plus the page that holds the text. Neither has embeddings.
  await serverDB.insert(files).values({
    fileType: 'custom/document',
    id: `file_${id}`,
    name: title,
    size: content.length,
    url: 'internal://document/placeholder',
    userId,
  });
  await serverDB
    .insert(knowledgeBaseFiles)
    .values({ fileId: `file_${id}`, knowledgeBaseId: kbId, userId });
  await serverDB.insert(documents).values({
    content,
    fileId: `file_${id}`,
    fileType: 'custom/document',
    id,
    knowledgeBaseId: kbId,
    source: 'document',
    sourceType: 'api',
    title,
    totalCharCount: content.length,
    totalLineCount: content.split('\n').length,
    userId,
  });
};

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(knowledgeBases).values({ id: kbId, name: 'LobeHub 答疑', userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('KnowledgeBaseSearchService.semanticSearchForChat (database)', () => {
  it('finds a page holding some of the keywords when none holds them all', async () => {
    await addPage(
      'docs_env',
      'environment-variables',
      '# 环境变量\n\nLobeHub 在部署时提供了一些额外的配置项，你可以使用环境变量进行自定义设置。',
    );
    await addPage(
      'docs_provider',
      'model-provider',
      '### `OPENAI_API_KEY`\n\nThis is the API key you apply on the OpenAI account page.',
    );
    await addPage('docs_faq', 'faq', 'Frequently asked questions about login.');

    const service = new KnowledgeBaseSearchService(serverDB, userId);
    const result = await service.semanticSearchForChat({
      knowledgeIds: [kbId],
      query: '环境变量 OPENAI_API_KEY 配置',
    });

    // The zh page holds two of the three keywords, the provider page one, the FAQ none.
    expect(result.documents.map((doc) => doc.documentId)).toEqual(['docs_env', 'docs_provider']);
    expect(result.totalResults).toBe(2);
    expect(result.indexStatus).toBeUndefined();
  });

  it('reports a keyword-only library when no keyword matches', async () => {
    await addPage('docs_env', 'environment-variables', '# Environment Variables');

    const service = new KnowledgeBaseSearchService(serverDB, userId);
    const result = await service.semanticSearchForChat({
      knowledgeIds: [kbId],
      query: 'kubernetes helm',
    });

    expect(result.totalResults).toBe(0);
    expect(result.indexStatus).toEqual({
      embeddedFiles: 0,
      keywordOnlyItems: 1,
      unindexedFiles: 0,
      unindexedFileSamples: [],
    });
  });

  it('reports uploads that were never parsed or embedded', async () => {
    await serverDB.insert(files).values({
      fileType: 'text/markdown',
      id: 'file_upload',
      name: 'environment-variables.mdx',
      size: 10,
      url: 'files/environment-variables.mdx',
      userId,
    });
    await serverDB
      .insert(knowledgeBaseFiles)
      .values({ fileId: 'file_upload', knowledgeBaseId: kbId, userId });

    const service = new KnowledgeBaseSearchService(serverDB, userId);
    const result = await service.semanticSearchForChat({
      knowledgeIds: [kbId],
      query: '环境变量 OPENAI_API_KEY 配置',
    });

    expect(result.totalResults).toBe(0);
    expect(result.indexStatus).toEqual({
      embeddedFiles: 0,
      keywordOnlyItems: 0,
      unindexedFiles: 1,
      unindexedFileSamples: [{ id: 'file_upload', name: 'environment-variables.mdx' }],
    });
  });
});
