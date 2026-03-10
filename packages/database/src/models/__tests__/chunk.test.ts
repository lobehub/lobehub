// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuid } from '@/utils/uuid';

import { getTestDB } from '../../core/getTestDB';
import { chunks, embeddings, fileChunks, files, unstructuredChunks, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ChunkModel } from '../chunk';
import { codeEmbedding, designThinkingQuery, designThinkingQuery2 } from './fixtures/embedding';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'chunk-model-test-user-id';
const chunkModel = new ChunkModel(serverDB, userId);
const sharedFileList = [
  {
    id: '1',
    name: 'document.pdf',
    url: 'https://example.com/document.pdf',
    size: 1000,
    fileType: 'application/pdf',
    userId,
  },
  {
    id: '2',
    name: 'image.jpg',
    url: 'https://example.com/image.jpg',
    size: 500,
    fileType: 'image/jpeg',
    userId,
  },
  {
    id: '3',
    name: 'audio.mp3',
    url: 'https://example.com/audio.mp3',
    size: 2000,
    fileType: 'audio/mpeg',
    userId,
  },
];

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB.insert(files).values(sharedFileList);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('ChunkModel', () => {
  describe('bulkCreate', () => {
    it('should create multiple chunks', async () => {
      const params = [
        { text: 'Chunk 1', userId },
        { text: 'Chunk 2', userId },
      ];

      await chunkModel.bulkCreate(params, '1');

      const createdChunks = await serverDB.query.chunks.findMany({
        where: eq(chunks.userId, userId),
      });
      expect(createdChunks).toHaveLength(2);
      expect(createdChunks[0]).toMatchObject(params[0]);
      expect(createdChunks[1]).toMatchObject(params[1]);
    });

    // 测试空参数场景
    it('should handle empty params array', async () => {
      const result = await chunkModel.bulkCreate([], '1');
      expect(result).toHaveLength(0);
    });

    // 测试事务回滚
    it('should rollback transaction on error', async () => {
      const invalidParams = [
        { text: 'Chunk 1', userId },
        { index: 'abc', userId }, // 这会导致错误
      ] as any;

      await expect(chunkModel.bulkCreate(invalidParams, '1')).rejects.toThrow();

      const createdChunks = await serverDB.query.chunks.findMany({
        where: eq(chunks.userId, userId),
      });
      expect(createdChunks).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('should delete a chunk by id', async () => {
      const { id } = await serverDB
        .insert(chunks)
        .values({ text: 'Test Chunk', userId })
        .returning()
        .then((res) => res[0]);

      await chunkModel.delete(id);

      const chunk = await serverDB.query.chunks.findFirst({
        where: eq(chunks.id, id),
      });
      expect(chunk).toBeUndefined();
    });
  });

  describe('deleteOrphanChunks', () => {
    it('should delete orphaned chunks', async () => {
      // Create orphaned chunks
      await serverDB
        .insert(chunks)
        .values([
          { text: 'Orphan Chunk 1', userId },
          { text: 'Orphan Chunk 2', userId },
        ])
        .returning();

      // Create a non-orphaned chunk
      const [nonOrphanChunk] = await serverDB
        .insert(chunks)
        .values([{ text: 'Non-Orphan Chunk', userId }])
        .returning();

      await serverDB
        .insert(fileChunks)
        .values([{ fileId: '1', chunkId: nonOrphanChunk.id, userId }]);

      // Execute the method
      await chunkModel.deleteOrphanChunks();

      // Check if orphaned chunks are deleted
      const remainingChunks = await serverDB.query.chunks.findMany();
      expect(remainingChunks).toHaveLength(1);
      expect(remainingChunks[0].id).toBe(nonOrphanChunk.id);
    });

    it('should not delete any chunks when there are no orphans', async () => {
      // Create non-orphaned chunks
      const [chunk1, chunk2] = await serverDB
        .insert(chunks)
        .values([
          { text: 'Chunk 1', userId },
          { text: 'Chunk 2', userId },
        ])
        .returning();

      await serverDB.insert(fileChunks).values([
        { fileId: '1', chunkId: chunk1.id, userId },
        { fileId: '2', chunkId: chunk2.id, userId },
      ]);

      // Execute the method
      await chunkModel.deleteOrphanChunks();

      // Check if all chunks are still present
      const remainingChunks = await serverDB.query.chunks.findMany();
      expect(remainingChunks).toHaveLength(2);
    });

    it('should not throw an error when the database is empty', async () => {
      // Ensure the database is empty
      await serverDB.delete(chunks);
      await serverDB.delete(fileChunks);

      // Execute the method and expect it not to throw
      await expect(chunkModel.deleteOrphanChunks()).resolves.not.toThrow();
    });
  });

  describe('semanticSearch', () => {
    it('should perform semantic search and return results', async () => {
      const fileId = '1';
      const [chunk1, chunk2] = await serverDB
        .insert(chunks)
        .values([
          { text: 'Test Chunk 1', userId },
          { text: 'Test Chunk 2', userId },
        ])
        .returning();

      await serverDB.insert(fileChunks).values([
        { fileId, chunkId: chunk1.id, userId },
        { fileId, chunkId: chunk2.id, userId },
      ]);

      await serverDB.insert(embeddings).values([
        { chunkId: chunk1.id, embeddings: designThinkingQuery, userId },
        { chunkId: chunk2.id, embeddings: codeEmbedding, userId },
      ]);

      const result = await chunkModel.semanticSearch({
        embedding: designThinkingQuery2,
        fileIds: [fileId],
        query: 'design thinking',
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(chunk1.id);
      expect(result[1].id).toBe(chunk2.id);
      expect(result[0].similarity).toBeGreaterThan(result[1].similarity);
    });
    // 补充无文件 ID 的搜索场景
    it('should perform semantic search without fileIds', async () => {
      const [chunk1, chunk2] = await serverDB
        .insert(chunks)
        .values([
          { text: 'Test Chunk 1', userId },
          { text: 'Test Chunk 2', userId },
        ])
        .returning();

      await serverDB.insert(embeddings).values([
        { chunkId: chunk1.id, embeddings: designThinkingQuery, userId },
        { chunkId: chunk2.id, embeddings: codeEmbedding, userId },
      ]);

      const result = await chunkModel.semanticSearch({
        embedding: designThinkingQuery2,
        fileIds: undefined,
        query: 'design thinking',
      });

      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
    });

    // 测试空结果场景
    it('should return empty array when no matches found', async () => {
      const result = await chunkModel.semanticSearch({
        embedding: designThinkingQuery,
        fileIds: ['non-existent-file'],
        query: 'no matches',
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('bulkCreateUnstructuredChunks', () => {
    it('should create multiple unstructured chunks', async () => {
      const [chunk] = await serverDB
        .insert(chunks)
        .values([{ text: 'Chunk 1', userId, index: 0 }])
        .returning();

      const params = [
        { text: 'Unstructured Chunk 1', userId, fileId: '1', parentId: '1', compositeId: chunk.id },
        { text: 'Unstructured Chunk 2', userId, fileId: '1', parentId: '1', compositeId: chunk.id },
      ];

      await chunkModel.bulkCreateUnstructuredChunks(params);

      const createdChunks = await serverDB.query.unstructuredChunks.findMany({
        where: eq(unstructuredChunks.userId, userId),
      });
      expect(createdChunks).toHaveLength(2);
      expect(createdChunks[0]).toMatchObject(params[0]);
      expect(createdChunks[1]).toMatchObject(params[1]);
    });
  });

  describe('findByFileId', () => {
    it('should find chunks by file id with pagination', async () => {
      const fileId = '1';
      const [chunk1, chunk2, chunk3] = await serverDB
        .insert(chunks)
        .values([
          { text: 'Chunk 1', userId, index: 0 },
          { text: 'Chunk 2', userId, index: 1 },
          { text: 'Chunk 3', userId, index: 2 },
        ])
        .returning();

      await serverDB.insert(fileChunks).values([
        { fileId, chunkId: chunk1.id, userId },
        { fileId, chunkId: chunk2.id, userId },
        { fileId, chunkId: chunk3.id, userId },
      ]);

      const result = await chunkModel.findByFileId(fileId, 0);

      expect(result).toHaveLength(3);
      expect(result[0].index).toBe(0);
      expect(result[1].index).toBe(1);
      expect(result[2].index).toBe(2);
    });

    it('should handle chunks with null metadata and return undefined pageNumber', async () => {
      const fileId = '1';
      const [chunk] = await serverDB
        .insert(chunks)
        .values([{ text: 'Chunk with null metadata', userId, index: 0, metadata: null }])
        .returning();

      await serverDB.insert(fileChunks).values([{ fileId, chunkId: chunk.id, userId }]);

      const result = await chunkModel.findByFileId(fileId, 0);

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toBeNull();
      expect(result[0].pageNumber).toBeUndefined();
    });

    it('should handle chunks with metadata containing pageNumber', async () => {
      const fileId = '1';
      const [chunk] = await serverDB
        .insert(chunks)
        .values([
          {
            text: 'Chunk with pageNumber',
            userId,
            index: 0,
            metadata: { pageNumber: 5 } as any,
          },
        ])
        .returning();

      await serverDB.insert(fileChunks).values([{ fileId, chunkId: chunk.id, userId }]);

      const result = await chunkModel.findByFileId(fileId, 0);

      expect(result).toHaveLength(1);
      expect(result[0].pageNumber).toBe(5);
    });
  });

  describe('getChunksTextByFileId', () => {
    it('should get chunks text by file id', async () => {
      const fileId = '1';
      const [chunk1, chunk2] = await serverDB
        .insert(chunks)
        .values([
          { text: 'Chunk 1', userId },
          { text: 'Chunk 2', userId },
        ])
        .returning();

      await serverDB.insert(fileChunks).values([
        { fileId, chunkId: chunk1.id, userId },
        { fileId, chunkId: chunk2.id, userId },
      ]);

      const result = await chunkModel.getChunksTextByFileId(fileId);

      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('Chunk 1');
      expect(result[1].text).toBe('Chunk 2');
    });
  });

  describe('countByFileIds', () => {
    it('should count chunks by file ids', async () => {
      const fileIds = ['1', '2'];
      const [chunk1, chunk2, chunk3] = await serverDB
        .insert(chunks)
        .values([
          { text: 'Chunk 1', userId, index: 0 },
          { text: 'Chunk 2', userId, index: 1 },
          { text: 'Chunk 3', userId, index: 2 },
        ])
        .returning();

      await serverDB.insert(fileChunks).values([
        { fileId: '1', chunkId: chunk1.id, userId },
        { fileId: '1', chunkId: chunk2.id, userId },
        { fileId: '2', chunkId: chunk3.id, userId },
      ]);

      const result = await chunkModel.countByFileIds(fileIds);

      expect(result).toHaveLength(2);
      expect(result.find((r) => r.id === '1')?.count).toBe(2);
      expect(result.find((r) => r.id === '2')?.count).toBe(1);
    });

    it('should return empty array for empty file ids', async () => {
      const result = await chunkModel.countByFileIds([]);

      expect(result).toHaveLength(0);
    });
  });

  describe('countByFileId', () => {
    it('should count chunks by file id', async () => {
      const fileId = '1';
      const [chunk1, chunk2, chunk3] = await serverDB
        .insert(chunks)
        .values([
          { text: 'Chunk 1', userId, index: 0 },
          { text: 'Chunk 2', userId, index: 1 },
        ])
        .returning();

      await serverDB.insert(fileChunks).values([
        { fileId, chunkId: chunk1.id, userId },
        { fileId, chunkId: chunk2.id, userId },
      ]);

      const result = await chunkModel.countByFileId(fileId);

      expect(result).toBe(2);
    });

    it('should return 0 for non-existent file id', async () => {
      const result = await chunkModel.countByFileId('non-existent');

      expect(result).toBe(0);
    });
  });

  describe('semanticSearchForChat', () => {
    it('should perform semantic search for chat and return results', async () => {
      const fileId = '1';
      const [chunk1, chunk2] = await serverDB
        .insert(chunks)
        .values([
          { text: 'Test Chunk 1', userId },
          { text: 'Test Chunk 2', userId },
        ])
        .returning();

      await serverDB.insert(fileChunks).values([
        { fileId, chunkId: chunk1.id, userId },
        { fileId, chunkId: chunk2.id, userId },
      ]);

      await serverDB.insert(embeddings).values([
        { chunkId: chunk1.id, embeddings: designThinkingQuery, userId },
        { chunkId: chunk2.id, embeddings: codeEmbedding, userId },
      ]);

      const result = await chunkModel.semanticSearchForChat({
        embedding: designThinkingQuery2,
        fileIds: [fileId],
        query: 'design thinking',
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(chunk1.id);
      expect(result[1].id).toBe(chunk2.id);
      expect(result[0].similarity).toBeGreaterThan(result[1].similarity);
    });
  });

  describe('mapChunkText', () => {
    it('should map chunk text correctly for non-Table type', () => {
      const chunk = {
        text: 'Normal text',
        type: 'Text',
        metadata: {},
      };

      const result = chunkModel['mapChunkText'](chunk);

      expect(result).toBe('Normal text');
    });

    it('should map chunk text correctly for Table type', () => {
      const chunk = {
        text: 'Table text',
        type: 'Table',
        metadata: {
          text_as_html: '<table>...</table>',
        },
      };

      const result = chunkModel['mapChunkText'](chunk);

      expect(result).toBe(`Table text

content in Table html is below:
<table>...</table>
`);
    });

    it('should handle null text', () => {
      const chunk = {
        text: null,
        type: 'Text',
        metadata: {},
      };

      const result = chunkModel['mapChunkText'](chunk);
      expect(result).toBeNull();
    });

    it('should handle missing metadata for Table type', () => {
      const chunk = {
        text: 'Table text',
        type: 'Table',
        metadata: {},
      };

      const result = chunkModel['mapChunkText'](chunk);
      expect(result).toContain('Table text');
      expect(result).toContain('content in Table html is below:');
      expect(result).toContain('undefined'); // metadata.text_as_html is undefined
    });
  });

  describe('findById', () => {
    it('should find a chunk by id', async () => {
      // Create a test chunk
      const [chunk] = await serverDB
        .insert(chunks)
        .values({ text: 'Test Chunk', userId })
        .returning();

      const result = await chunkModel.findById(chunk.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(chunk.id);
      expect(result?.text).toBe('Test Chunk');
    });

    it('should return null for non-existent id', async () => {
      const result = await chunkModel.findById(uuid());
      expect(result).toBeUndefined();
    });
  });

  describe('semanticSearchForChat', () => {
    // 测试空文件 ID 列表场景
    it('should return empty array when fileIds is empty', async () => {
      const result = await chunkModel.semanticSearchForChat({
        embedding: designThinkingQuery,
        fileIds: [],
        query: 'test',
      });

      expect(result).toHaveLength(0);
    });

    // 测试结果限制
    it('should limit results to 15 items', async () => {
      const fileId = '1';
      // Create 24 chunks
      const chunkResult = await serverDB
        .insert(chunks)
        .values(
          Array.from({ length: 24 })
            .fill(0)
            .map((_, i) => ({ text: `Test Chunk ${i}`, userId })),
        )
        .returning();

      await serverDB.insert(fileChunks).values(
        chunkResult.map((chunk) => ({
          fileId,
          chunkId: chunk.id,
          userId,
        })),
      );

      await serverDB.insert(embeddings).values(
        chunkResult.map((chunk) => ({
          chunkId: chunk.id,
          embeddings: designThinkingQuery,
          userId,
        })),
      );

      const result = await chunkModel.semanticSearchForChat({
        embedding: designThinkingQuery2,
        fileIds: [fileId],
        query: 'test',
      });

      expect(result).toHaveLength(15);
    });
  });
});
