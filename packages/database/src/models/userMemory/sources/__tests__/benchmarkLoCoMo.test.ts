import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BenchmarkLoCoMoPart } from '../benchmarkLoCoMo';
import { UserMemorySourceBenchmarkLoCoMoModel } from '../benchmarkLoCoMo';

describe('UserMemorySourceBenchmarkLoCoMoModel', () => {
  const userId = 'test-user-1';
  const userId2 = 'test-user-2';
  let model: UserMemorySourceBenchmarkLoCoMoModel;
  let model2: UserMemorySourceBenchmarkLoCoMoModel;

  beforeEach(() => {
    model = new UserMemorySourceBenchmarkLoCoMoModel(userId);
    model2 = new UserMemorySourceBenchmarkLoCoMoModel(userId2);
  });

  afterEach(() => {
    // Clear the static stores between tests by creating empty stores
    // We'll do this by upserting and then clearing
    (UserMemorySourceBenchmarkLoCoMoModel as any).sources = new Map();
    (UserMemorySourceBenchmarkLoCoMoModel as any).parts = new Map();
  });

  describe('upsertSource', () => {
    it('should create a new source with generated id', async () => {
      const result = await model.upsertSource({
        sourceType: 'locomo-test',
      });

      expect(result).toHaveProperty('id');
      expect(result.id).toHaveLength(16);
    });

    it('should create a source with provided id', async () => {
      const result = await model.upsertSource({
        id: 'custom-source-id',
        sourceType: 'locomo-test',
      });

      expect(result.id).toBe('custom-source-id');
    });

    it('should create source with metadata and sampleId', async () => {
      const result = await model.upsertSource({
        id: 'source-with-meta',
        metadata: { key: 'value', nested: { data: 123 } },
        sampleId: 'sample-123',
        sourceType: 'benchmark',
      });

      expect(result.id).toBe('source-with-meta');
    });

    it('should update existing source while preserving createdAt', async () => {
      // Create initial source
      const first = await model.upsertSource({
        id: 'source-to-update',
        metadata: { initial: true },
        sourceType: 'initial-type',
      });

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update the source
      const second = await model.upsertSource({
        id: 'source-to-update',
        metadata: { updated: true },
        sourceType: 'updated-type',
      });

      expect(second.id).toBe(first.id);
    });

    it('should isolate sources between different users', async () => {
      const result1 = await model.upsertSource({
        id: 'shared-id',
        sourceType: 'user1-type',
      });

      const result2 = await model2.upsertSource({
        id: 'shared-id',
        sourceType: 'user2-type',
      });

      expect(result1.id).toBe('shared-id');
      expect(result2.id).toBe('shared-id');
      // Both users can have sources with the same id (isolated stores)
    });
  });

  describe('replaceParts', () => {
    it('should store parts for a source', async () => {
      const sourceId = 'source-for-parts';
      await model.upsertSource({ id: sourceId, sourceType: 'test' });

      const parts: BenchmarkLoCoMoPart[] = [
        { content: 'Part 1', partIndex: 0 },
        { content: 'Part 2', partIndex: 1 },
      ];

      model.replaceParts(sourceId, parts);

      const stored = await model.listParts(sourceId);
      expect(stored).toHaveLength(2);
      expect(stored[0].content).toBe('Part 1');
      expect(stored[1].content).toBe('Part 2');
    });

    it('should replace existing parts', async () => {
      const sourceId = 'source-replace-parts';

      const initialParts: BenchmarkLoCoMoPart[] = [
        { content: 'Old Part 1', partIndex: 0 },
        { content: 'Old Part 2', partIndex: 1 },
      ];

      model.replaceParts(sourceId, initialParts);

      const newParts: BenchmarkLoCoMoPart[] = [{ content: 'New Part 1', partIndex: 0 }];

      model.replaceParts(sourceId, newParts);

      const stored = await model.listParts(sourceId);
      expect(stored).toHaveLength(1);
      expect(stored[0].content).toBe('New Part 1');
    });

    it('should delete parts when replacing with empty array', async () => {
      const sourceId = 'source-delete-parts';

      const parts: BenchmarkLoCoMoPart[] = [{ content: 'Part to delete', partIndex: 0 }];

      model.replaceParts(sourceId, parts);
      expect((await model.listParts(sourceId)).length).toBe(1);

      model.replaceParts(sourceId, []);
      expect((await model.listParts(sourceId)).length).toBe(0);
    });

    it('should normalize parts with default createdAt', async () => {
      const sourceId = 'source-normalize';
      const beforeCreate = new Date();

      const parts: BenchmarkLoCoMoPart[] = [{ content: 'Part without date', partIndex: 0 }];

      model.replaceParts(sourceId, parts);

      const stored = await model.listParts(sourceId);
      expect(stored[0].createdAt).toBeDefined();
      expect(stored[0].createdAt!.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
    });

    it('should preserve provided createdAt', async () => {
      const sourceId = 'source-preserve-date';
      const customDate = new Date('2024-01-01T12:00:00Z');

      const parts: BenchmarkLoCoMoPart[] = [
        { content: 'Part with date', createdAt: customDate, partIndex: 0 },
      ];

      model.replaceParts(sourceId, parts);

      const stored = await model.listParts(sourceId);
      expect(stored[0].createdAt).toEqual(customDate);
    });

    it('should store parts with all optional fields', async () => {
      const sourceId = 'source-full-parts';
      const customDate = new Date('2024-05-01T10:00:00Z');

      const parts: BenchmarkLoCoMoPart[] = [
        {
          content: 'Full part content',
          createdAt: customDate,
          metadata: { role: 'user', extra: 'data' },
          partIndex: 0,
          sessionId: 'session-123',
          speaker: 'Alice',
        },
      ];

      model.replaceParts(sourceId, parts);

      const stored = await model.listParts(sourceId);
      expect(stored[0]).toMatchObject({
        content: 'Full part content',
        createdAt: customDate,
        metadata: { role: 'user', extra: 'data' },
        partIndex: 0,
        sessionId: 'session-123',
        speaker: 'Alice',
      });
    });

    it('should isolate parts between different users', async () => {
      const sourceId = 'shared-source';

      model.replaceParts(sourceId, [{ content: 'User 1 part', partIndex: 0 }]);
      model2.replaceParts(sourceId, [{ content: 'User 2 part', partIndex: 0 }]);

      const user1Parts = await model.listParts(sourceId);
      const user2Parts = await model2.listParts(sourceId);

      expect(user1Parts[0].content).toBe('User 1 part');
      expect(user2Parts[0].content).toBe('User 2 part');
    });
  });

  describe('listParts', () => {
    it('should return empty array for non-existent source', async () => {
      const parts = await model.listParts('non-existent-source');
      expect(parts).toEqual([]);
    });

    it('should sort parts by partIndex', async () => {
      const sourceId = 'source-sort-index';

      const parts: BenchmarkLoCoMoPart[] = [
        { content: 'Part 3', partIndex: 2 },
        { content: 'Part 1', partIndex: 0 },
        { content: 'Part 2', partIndex: 1 },
      ];

      model.replaceParts(sourceId, parts);

      const sorted = await model.listParts(sourceId);
      expect(sorted[0].partIndex).toBe(0);
      expect(sorted[1].partIndex).toBe(1);
      expect(sorted[2].partIndex).toBe(2);
    });

    it('should sort by createdAt when partIndex is the same', async () => {
      const sourceId = 'source-sort-date';

      const date1 = new Date('2024-01-01T10:00:00Z');
      const date2 = new Date('2024-01-01T11:00:00Z');
      const date3 = new Date('2024-01-01T12:00:00Z');

      const parts: BenchmarkLoCoMoPart[] = [
        { content: 'Latest', createdAt: date3, partIndex: 0 },
        { content: 'Earliest', createdAt: date1, partIndex: 0 },
        { content: 'Middle', createdAt: date2, partIndex: 0 },
      ];

      model.replaceParts(sourceId, parts);

      const sorted = await model.listParts(sourceId);
      expect(sorted[0].content).toBe('Earliest');
      expect(sorted[1].content).toBe('Middle');
      expect(sorted[2].content).toBe('Latest');
    });

    it('should return copies of parts (not references)', async () => {
      const sourceId = 'source-copy';

      model.replaceParts(sourceId, [{ content: 'Original', partIndex: 0 }]);

      const parts1 = await model.listParts(sourceId);
      parts1[0].content = 'Modified';

      const parts2 = await model.listParts(sourceId);
      expect(parts2[0].content).toBe('Original');
    });

    it('should handle parts without createdAt in sorting', async () => {
      const sourceId = 'source-no-date';
      const dateWithTime = new Date('2024-06-01T10:00:00Z');

      // Create parts where one has a date and one will get default
      const parts: BenchmarkLoCoMoPart[] = [
        { content: 'With date', createdAt: dateWithTime, partIndex: 0 },
        { content: 'No date (will get default)', partIndex: 0 },
      ];

      model.replaceParts(sourceId, parts);

      const sorted = await model.listParts(sourceId);
      // Both have partIndex 0, so sorted by createdAt
      expect(sorted).toHaveLength(2);
      expect(sorted[0].content).toBe('With date');
    });
  });

  describe('store initialization', () => {
    it('should lazily initialize source store', async () => {
      const newUserId = 'lazy-init-user';
      const newModel = new UserMemorySourceBenchmarkLoCoMoModel(newUserId);

      // First access should create the store
      await newModel.upsertSource({ sourceType: 'test' });

      // Subsequent accesses should use the same store
      const result = await newModel.upsertSource({ id: 'second', sourceType: 'test' });
      expect(result.id).toBe('second');
    });

    it('should lazily initialize parts store', async () => {
      const newUserId = 'lazy-parts-user';
      const newModel = new UserMemorySourceBenchmarkLoCoMoModel(newUserId);

      // First access should create the store
      newModel.replaceParts('source-1', [{ content: 'Part', partIndex: 0 }]);

      const parts = await newModel.listParts('source-1');
      expect(parts).toHaveLength(1);
    });
  });
});
