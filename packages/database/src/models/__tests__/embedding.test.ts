import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { chunks, embeddings, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { EmbeddingModel } from '../embedding';
import { designThinkingQuery } from './fixtures/embedding';

const userId = 'embedding-user-test';
const otherUserId = 'other-user-test';

const serverDB: LobeChatDatabase = await getTestDB();
const embeddingModel = new EmbeddingModel(serverDB, userId);

describe('EmbeddingModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('create', () => {
    it('should create a new embedding', async () => {
      // Create a chunk first
      const [chunk] = await serverDB
        .insert(chunks)
        .values({ text: 'Test chunk', userId })
        .returning();

      const id = await embeddingModel.create({
        chunkId: chunk.id,
        embeddings: designThinkingQuery,
        model: 'text-embedding-ada-002',
      });

      expect(id).toBeDefined();

      const created = await serverDB.query.embeddings.findFirst({
        where: eq(embeddings.id, id),
      });

      expect(created).toBeDefined();
      expect(created?.chunkId).toBe(chunk.id);
      expect(created?.model).toBe('text-embedding-ada-002');
      expect(created?.userId).toBe(userId);
    });
  });

  describe('bulkCreate', () => {
    it('should create multiple embeddings', async () => {
      // Create chunks first
      const [chunk1, chunk2] = await serverDB
        .insert(chunks)
        .values([
          { text: 'Test chunk 1', userId },
          { text: 'Test chunk 2', userId },
        ])
        .returning();

      await embeddingModel.bulkCreate([
        { chunkId: chunk1.id, embeddings: designThinkingQuery, model: 'text-embedding-ada-002' },
        { chunkId: chunk2.id, embeddings: designThinkingQuery, model: 'text-embedding-ada-002' },
      ]);

      const created = await serverDB.query.embeddings.findMany({
        where: eq(embeddings.userId, userId),
      });

      expect(created).toHaveLength(2);
    });

    it('should handle duplicate chunkId with onConflictDoNothing', async () => {
      // Create a chunk
      const [chunk] = await serverDB
        .insert(chunks)
        .values({ text: 'Test chunk', userId })
        .returning();

      // Create first embedding
      await embeddingModel.create({
        chunkId: chunk.id,
        embeddings: designThinkingQuery,
        model: 'text-embedding-ada-002',
      });

      // Try to create duplicate
      await embeddingModel.bulkCreate([
        { chunkId: chunk.id, embeddings: designThinkingQuery, model: 'text-embedding-3-small' },
      ]);

      const created = await serverDB.query.embeddings.findMany({
        where: eq(embeddings.chunkId, chunk.id),
      });

      // Should still have only 1 embedding due to unique constraint
      expect(created).toHaveLength(1);
      expect(created[0].model).toBe('text-embedding-ada-002');
    });
  });

  describe('delete', () => {
    it('should delete an embedding', async () => {
      const [chunk] = await serverDB
        .insert(chunks)
        .values({ text: 'Test chunk', userId })
        .returning();

      const id = await embeddingModel.create({
        chunkId: chunk.id,
        embeddings: designThinkingQuery,
        model: 'text-embedding-ada-002',
      });

      await embeddingModel.delete(id);

      const deleted = await serverDB.query.embeddings.findFirst({
        where: eq(embeddings.id, id),
      });

      expect(deleted).toBeUndefined();
    });

    it('should not delete embedding belonging to another user', async () => {
      // Create chunk and embedding for other user
      const [chunk] = await serverDB
        .insert(chunks)
        .values({ text: 'Other user chunk', userId: otherUserId })
        .returning();

      const [otherEmbedding] = await serverDB
        .insert(embeddings)
        .values({
          chunkId: chunk.id,
          embeddings: designThinkingQuery,
          model: 'text-embedding-ada-002',
          userId: otherUserId,
        })
        .returning();

      await embeddingModel.delete(otherEmbedding.id);

      const stillExists = await serverDB.query.embeddings.findFirst({
        where: eq(embeddings.id, otherEmbedding.id),
      });

      expect(stillExists).toBeDefined();
    });
  });

  describe('query', () => {
    it('should return all embeddings for the user', async () => {
      const [chunk1, chunk2] = await serverDB
        .insert(chunks)
        .values([
          { text: 'Test chunk 1', userId },
          { text: 'Test chunk 2', userId },
        ])
        .returning();

      await serverDB.insert(embeddings).values([
        { chunkId: chunk1.id, embeddings: designThinkingQuery, userId },
        { chunkId: chunk2.id, embeddings: designThinkingQuery, userId },
      ]);

      const result = await embeddingModel.query();

      expect(result).toHaveLength(2);
    });

    it('should only return embeddings for the current user', async () => {
      const [chunk1] = await serverDB
        .insert(chunks)
        .values([{ text: 'Test chunk 1', userId }])
        .returning();

      const [chunk2] = await serverDB
        .insert(chunks)
        .values([{ text: 'Other user chunk', userId: otherUserId }])
        .returning();

      await serverDB.insert(embeddings).values([
        { chunkId: chunk1.id, embeddings: designThinkingQuery, userId },
        { chunkId: chunk2.id, embeddings: designThinkingQuery, userId: otherUserId },
      ]);

      const result = await embeddingModel.query();

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe(userId);
    });
  });

  describe('findById', () => {
    it('should return an embedding by id', async () => {
      const [chunk] = await serverDB
        .insert(chunks)
        .values({ text: 'Test chunk', userId })
        .returning();

      const id = await embeddingModel.create({
        chunkId: chunk.id,
        embeddings: designThinkingQuery,
        model: 'text-embedding-ada-002',
      });

      const result = await embeddingModel.findById(id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(id);
      expect(result?.chunkId).toBe(chunk.id);
    });

    it('should return undefined for non-existent embedding', async () => {
      // Use a valid UUID format that doesn't exist
      const result = await embeddingModel.findById('00000000-0000-0000-0000-000000000000');

      expect(result).toBeUndefined();
    });

    it('should not return embedding belonging to another user', async () => {
      const [chunk] = await serverDB
        .insert(chunks)
        .values({ text: 'Other user chunk', userId: otherUserId })
        .returning();

      const [otherEmbedding] = await serverDB
        .insert(embeddings)
        .values({
          chunkId: chunk.id,
          embeddings: designThinkingQuery,
          userId: otherUserId,
        })
        .returning();

      const result = await embeddingModel.findById(otherEmbedding.id);

      expect(result).toBeUndefined();
    });
  });

  describe('countUsage', () => {
    it('should return the count of embeddings for the user', async () => {
      const [chunk1, chunk2, chunk3] = await serverDB
        .insert(chunks)
        .values([
          { text: 'Test chunk 1', userId },
          { text: 'Test chunk 2', userId },
          { text: 'Test chunk 3', userId },
        ])
        .returning();

      await serverDB.insert(embeddings).values([
        { chunkId: chunk1.id, embeddings: designThinkingQuery, userId },
        { chunkId: chunk2.id, embeddings: designThinkingQuery, userId },
        { chunkId: chunk3.id, embeddings: designThinkingQuery, userId },
      ]);

      const count = await embeddingModel.countUsage();

      expect(count).toBe(3);
    });

    it('should return 0 when user has no embeddings', async () => {
      const count = await embeddingModel.countUsage();

      expect(count).toBe(0);
    });

    it('should only count embeddings for the current user', async () => {
      const [chunk1] = await serverDB
        .insert(chunks)
        .values([{ text: 'Test chunk 1', userId }])
        .returning();

      const [chunk2] = await serverDB
        .insert(chunks)
        .values([{ text: 'Other user chunk', userId: otherUserId }])
        .returning();

      await serverDB.insert(embeddings).values([
        { chunkId: chunk1.id, embeddings: designThinkingQuery, userId },
        { chunkId: chunk2.id, embeddings: designThinkingQuery, userId: otherUserId },
      ]);

      const count = await embeddingModel.countUsage();

      expect(count).toBe(1);
    });
  });
});
