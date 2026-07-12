// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentDocumentModel } from '../../agentDocuments';
import { TaskModel } from '../../task';
import { WorkModel } from '..';
import {
  agentId,
  cleanupWorkTestData,
  seedWorkTestData,
  serverDB,
  topicId,
  userId,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

describe('WorkModel · queries', () => {
  it('groups version events by root operation', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const firstTask = await taskModel.create({
      instruction: 'First tool work',
      name: 'First work',
    });
    const secondTask = await taskModel.create({
      instruction: 'Second tool work',
      name: 'Second work',
    });

    await workModel.registerTask({
      role: 'created',
      rootOperationId: 'op-first',
      source: 'createTask',
      sourceToolCallId: 'tool-call-1',
      taskId: firstTask.id,
      topicId,
    });
    await workModel.registerTask({
      role: 'created',
      rootOperationId: 'op-second',
      source: 'createTask',
      sourceToolCallId: 'tool-call-2',
      taskId: secondTask.id,
      topicId,
    });

    const byOperations = await workModel.listByRootOperations({
      rootOperationIds: ['op-missing', 'op-second', 'op-first', 'op-first'],
    });

    expect(byOperations['op-first']?.map((item) => item.resourceId)).toEqual([firstTask.id]);
    expect(byOperations['op-second']?.map((item) => item.resourceId)).toEqual([secondTask.id]);
    expect(byOperations['op-missing']).toEqual([]);
  });

  it('batches listByRootOperations into one query per work type', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const firstTask = await taskModel.create({ instruction: 'Batch 1', name: 'Batch one' });
    const secondTask = await taskModel.create({ instruction: 'Batch 2', name: 'Batch two' });

    await workModel.registerTask({
      role: 'created',
      rootOperationId: 'op-batch-1',
      source: 'createTask',
      sourceToolCallId: 'tool-call-batch-1',
      taskId: firstTask.id,
      topicId,
    });
    await workModel.registerTask({
      role: 'created',
      rootOperationId: 'op-batch-2',
      source: 'createTask',
      sourceToolCallId: 'tool-call-batch-2',
      taskId: secondTask.id,
      topicId,
    });

    const selectSpy = vi.spyOn(serverDB, 'select');
    try {
      const byOperations = await workModel.listByRootOperations({
        rootOperationIds: ['op-batch-1', 'op-batch-2', 'op-batch-missing'],
      });

      // One query per work type across all ids, not per (id x type).
      expect(selectSpy).toHaveBeenCalledTimes(4);
      expect(byOperations['op-batch-1']?.map((item) => item.resourceId)).toEqual([firstTask.id]);
      expect(byOperations['op-batch-2']?.map((item) => item.resourceId)).toEqual([secondTask.id]);
      expect(byOperations['op-batch-missing']).toEqual([]);
    } finally {
      selectSpy.mockRestore();
    }
  });

  it('clamps the summary over-fetch limit while still returning results for large id batches', async () => {
    const agentDocumentModel = new AgentDocumentModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const doc = await agentDocumentModel.create(agentId, 'clamp.md', 'Clamp body', {
      title: 'Clamp',
    });

    await workModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      role: 'created',
      rootOperationId: 'op-doc-clamp',
      source: 'createDocument',
      sourceToolCallId: 'tool-call-doc-clamp',
      topicId,
    });

    // 601 ids * limit 20 * fanout 4 far exceeds MAX_SUMMARY_ROW_LIMIT, so the
    // query LIMIT is clamped — the real operation's summary must still surface.
    const syntheticIds = Array.from({ length: 600 }, (_, index) => `op-doc-clamp-pad-${index}`);
    const summaries = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-doc-clamp', ...syntheticIds],
    });

    expect(Object.keys(summaries)).toHaveLength(601);
    expect(summaries['op-doc-clamp']).toHaveLength(1);
    expect(summaries['op-doc-clamp'][0]).toMatchObject({
      document: expect.objectContaining({ id: doc.documentId }),
    });
    expect(summaries[syntheticIds[0]]).toEqual([]);
  });
});
