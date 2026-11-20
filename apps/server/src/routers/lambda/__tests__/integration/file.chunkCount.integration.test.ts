// @vitest-environment node
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPGlite, readPGliteSnapshot } from '@/database/core/pgliteSnapshot';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { FileModel } from '@/database/models/file';
import { KnowledgeRepo } from '@/database/repositories/knowledge';
import * as schema from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { getKnowledgeItemStatusMap } from '../../file/procedures';
import { queriesRouter } from '../../file/queries';

const boundary = vi.hoisted(() => ({ db: undefined as LobeChatDatabase | undefined }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => boundary.db }));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return { getFileAccessUrl: async () => 'https://storage.example/file' };
  }),
}));

const userId = 'chunk-status-user';
const physicalFileId = 'file_chunk_status_mirrored';
const logicalItemId = 'docs_chunk_status_mirrored';
const rawFileId = 'file_chunk_status_raw';
const emptyFileId = 'file_chunk_status_empty';
const chunkTaskId = '11111111-1111-4111-8111-111111111111';
const embeddingTaskId = '22222222-2222-4222-8222-222222222222';
const embeddingError = { name: 'EmbeddingError', message: 'Embedding provider unavailable' };
let client: ReturnType<typeof createPGlite>;
let db: LobeChatDatabase;

beforeAll(async () => {
  client = createPGlite(readPGliteSnapshot());
  db = drizzle({ client, schema }) as unknown as LobeChatDatabase;
  boundary.db = db;
  await db.insert(schema.users).values({ id: userId });
  await db.insert(schema.asyncTasks).values([
    { id: chunkTaskId, userId, type: AsyncTaskType.Chunking, status: AsyncTaskStatus.Success },
    {
      id: embeddingTaskId,
      userId,
      type: AsyncTaskType.Embedding,
      status: AsyncTaskStatus.Error,
      error: embeddingError,
    },
  ]);
  await db.insert(schema.files).values(
    [
      { id: physicalFileId, chunkTaskId, embeddingTaskId },
      { id: rawFileId },
      { id: emptyFileId },
    ].map((file) => ({
      ...file,
      userId,
      name: `${file.id}.txt`,
      fileType: 'text/plain',
      size: 10,
      url: `test/${file.id}`,
    })),
  );
  await db.insert(schema.documents).values({
    id: logicalItemId,
    fileId: physicalFileId,
    userId,
    content: 'Parsed file text',
    fileType: 'text/plain',
    source: 'test',
    sourceType: 'file',
    totalCharCount: 16,
    totalLineCount: 1,
  });
  const chunkIds = [
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
  ];
  await db.insert(schema.chunks).values(chunkIds.map((id) => ({ id, userId, text: 'Chunk text' })));
  await db.insert(schema.fileChunks).values(
    chunkIds.map((chunkId, index) => ({
      chunkId,
      userId,
      fileId: index === 0 ? physicalFileId : rawFileId,
    })),
  );
}, 30000);

afterAll(async () => {
  await client?.close();
});

const context = () => ({
  asyncTaskModel: new AsyncTaskModel(db, userId),
  chunkModel: new ChunkModel(db, userId),
});

describe('knowledge item physical chunk counts', () => {
  it('counts the same physical chunks for the recent-files endpoint without changing its zero default', async () => {
    const rows = await queriesRouter.createCaller({ userId }).recentFiles();
    expect(rows.find((row) => row.id === logicalItemId)?.chunkCount).toBe(1);
    expect(rows.find((row) => row.id === rawFileId)?.chunkCount).toBe(2);
    expect(rows.find((row) => row.id === emptyFileId)?.chunkCount).toBe(0);
  });

  it('counts real physical file chunks for a derived page while returning logical status keys and task fields', async () => {
    const items = await new KnowledgeRepo(db, userId).query({});
    const item = items.find((row) => row.id === logicalItemId)!;
    expect(item).toMatchObject({ id: logicalItemId, fileId: physicalFileId, sourceType: 'file' });
    const statusMap = await getKnowledgeItemStatusMap(context(), [item]);
    expect([...statusMap.keys()]).toEqual([logicalItemId]);
    expect(statusMap.get(logicalItemId)).toEqual({
      id: logicalItemId,
      chunkCount: 1,
      chunkingError: null,
      chunkingStatus: AsyncTaskStatus.Success,
      embeddingError,
      embeddingStatus: AsyncTaskStatus.Error,
      finishEmbedding: false,
    });
  });

  it('preserves raw file counts and null counts for files with no chunks', async () => {
    const items = await new KnowledgeRepo(db, userId).query({});
    const rawItems = items.filter((row) => row.id === rawFileId || row.id === emptyFileId);
    expect(rawItems).toHaveLength(2);
    const statusMap = await getKnowledgeItemStatusMap(context(), rawItems);
    expect(statusMap.get(rawFileId)?.chunkCount).toBe(2);
    expect(statusMap.get(emptyFileId)).toEqual({
      id: emptyFileId,
      chunkCount: null,
      chunkingError: null,
      chunkingStatus: null,
      embeddingError: null,
      embeddingStatus: null,
      finishEmbedding: false,
    });
  });

  it.each([undefined, null])('uses the original file id when fileId is %s', async (fileId) => {
    const [file] = await new FileModel(db, userId).findByIds([rawFileId]);
    const statusMap = await getKnowledgeItemStatusMap(context(), [{ ...file, fileId }]);
    expect([...statusMap.keys()]).toEqual([rawFileId]);
    expect(statusMap.get(rawFileId)?.chunkCount).toBe(2);
  });
});
