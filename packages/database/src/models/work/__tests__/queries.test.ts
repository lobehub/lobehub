// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { topics, works } from '../../../schemas';
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
      changeType: 'created',
      rootOperationId: 'op-first',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-1',
      taskId: firstTask.id,
      topicId,
    });
    await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-second',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-2',
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
      changeType: 'created',
      rootOperationId: 'op-batch-1',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-batch-1',
      taskId: firstTask.id,
      topicId,
    });
    await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-batch-2',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-batch-2',
      taskId: secondTask.id,
      topicId,
    });

    const selectSpy = vi.spyOn(serverDB, 'select');
    try {
      // Opt in so the fan-out covers every registered type (default excludes the
      // gated `file` type — see the includeFileWorks gating test below).
      const byOperations = await workModel.listByRootOperations({
        includeFileWorks: true,
        rootOperationIds: ['op-batch-1', 'op-batch-2', 'op-batch-missing'],
      });

      // One query per work type across all ids, not per (id x type). Four
      // registered types now: document / external / file / task.
      expect(selectSpy).toHaveBeenCalledTimes(4);
      expect(byOperations['op-batch-1']?.map((item) => item.resourceId)).toEqual([firstTask.id]);
      expect(byOperations['op-batch-2']?.map((item) => item.resourceId)).toEqual([secondTask.id]);
      expect(byOperations['op-batch-missing']).toEqual([]);
    } finally {
      selectSpy.mockRestore();
    }
  });

  it('surfaces a shared work only on the latest operation touching it', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Shared work', name: 'Shared work' });

    // Turn A creates the task, turn B updates the same task: only the last
    // touching round's anchor card surfaces the Work — earlier rounds drop the
    // chip instead of repeating the same artifact every turn.
    await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-shared-create',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-shared-1',
      taskId: task.id,
      topicId,
    });
    await workModel.registerTask({
      changeType: 'updated',
      rootOperationId: 'op-shared-update',
      toolName: 'updateTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-shared-2',
      taskId: task.id,
      topicId,
    });

    const summaries = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-shared-create', 'op-shared-update'],
    });

    expect(summaries['op-shared-create']).toEqual([]);
    expect(summaries['op-shared-update']).toHaveLength(1);
    expect(summaries['op-shared-update'][0].event).toMatchObject({
      changeType: 'updated',
      rootOperationId: 'op-shared-update',
    });
  });

  it('keeps the summary card in this conversation when a later edit happens in a foreign operation', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Cross-topic work', name: 'Cross-topic' });

    await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-home-round',
      taskId: task.id,
      toolCallId: 'tool-call-home-1',
      toolIdentifier: 'lobe-task',
      toolName: 'createTask',
      topicId,
    });
    // Same task edited later by an operation from ANOTHER conversation. That
    // operation is not in this conversation's anchor set, so it must not steal
    // the card: anchoring is latest-wins WITHIN the requested ids only.
    await workModel.registerTask({
      changeType: 'updated',
      rootOperationId: 'op-foreign-round',
      taskId: task.id,
      toolCallId: 'tool-call-foreign-1',
      toolIdentifier: 'lobe-task',
      toolName: 'editTask',
      topicId,
    });

    const summaries = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-home-round'],
    });

    expect(summaries['op-home-round']).toHaveLength(1);
    // The card still shows the Work's CURRENT snapshot (the foreign edit).
    expect(summaries['op-home-round'][0].event).toMatchObject({
      changeType: 'updated',
      rootOperationId: 'op-foreign-round',
      version: 2,
    });
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
      changeType: 'created',
      rootOperationId: 'op-doc-clamp',
      toolName: 'createDocument',
      toolIdentifier: 'lobe-agent-documents',
      toolCallId: 'tool-call-doc-clamp',
      topicId,
    });

    // 601 ids * limit 20 far exceeds MAX_SUMMARY_ROW_LIMIT, so the
    // query LIMIT is clamped — the real operation's summary must still surface.
    const syntheticIds = Array.from({ length: 600 }, (_, index) => `op-doc-clamp-pad-${index}`);
    const summaries = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-doc-clamp', ...syntheticIds],
    });

    expect(Object.keys(summaries)).toHaveLength(601);
    expect(summaries['op-doc-clamp']).toHaveLength(1);
    expect(summaries['op-doc-clamp'][0]).toMatchObject({
      identifier: 'clamp.md',
      resourceId: doc.documentId,
    });
    expect(summaries[syntheticIds[0]]).toEqual([]);
  });

  it('filters the workspace list to one skill provider by its resource types', async () => {
    const workModel = new WorkModel(serverDB, userId);

    await workModel.registerExternal({
      changeType: 'created',
      identifier: 'ENG-1',
      patchFields: ['identifier', 'title'],
      resourceId: 'linear-issue-1',
      resourceType: 'linear_issue',
      toolCallId: 'tool-call-linear-issue-1',
      toolIdentifier: 'linear',
      toolName: 'save_issue',
      title: 'Linear issue',
      topicId,
    });
    await workModel.registerExternal({
      changeType: 'created',
      identifier: 'lobehub/lobehub#1',
      patchFields: ['identifier', 'title'],
      resourceId: 'lobehub/lobehub#1',
      resourceType: 'github_issue',
      toolCallId: 'tool-call-github-issue-1',
      toolIdentifier: 'github',
      toolName: 'create_issue',
      title: 'GitHub issue',
      topicId,
    });

    // provider: 'linear' narrows the unified `external` type to linear_* rows,
    // excluding the github row.
    const linearOnly = await workModel.listByWorkspace({ provider: 'linear' });
    expect(linearOnly.items).toHaveLength(1);
    expect(linearOnly.items[0]).toMatchObject({
      resourceId: 'linear-issue-1',
      resourceType: 'linear_issue',
      type: 'external',
    });

    // The unified `external` type still spans both providers.
    const allExternal = await workModel.listByWorkspace({ type: 'external' });
    expect(allExternal.items.map((item) => item.resourceType).sort()).toEqual([
      'github_issue',
      'linear_issue',
    ]);
  });

  it('joins the origin topic title onto workspace list rows for grouping', async () => {
    const titledTopicId = 'work-origin-titled-topic';
    await serverDB.insert(topics).values({ id: titledTopicId, title: 'Origin topic', userId });
    const workModel = new WorkModel(serverDB, userId);

    await workModel.registerExternal({
      changeType: 'created',
      identifier: 'lobehub/lobehub#7',
      patchFields: ['identifier', 'title'],
      resourceId: 'lobehub/lobehub#7',
      resourceType: 'github_issue',
      toolCallId: 'tool-call-origin-titled',
      toolIdentifier: 'github',
      toolName: 'create_issue',
      title: 'Titled origin',
      topicId: titledTopicId,
    });
    // No topicId: origin is never stamped, so the gallery's "other" bucket case.
    await workModel.registerExternal({
      changeType: 'created',
      identifier: 'lobehub/lobehub#8',
      patchFields: ['identifier', 'title'],
      resourceId: 'lobehub/lobehub#8',
      resourceType: 'github_issue',
      toolCallId: 'tool-call-origin-none',
      toolIdentifier: 'github',
      toolName: 'create_issue',
      title: 'No origin',
    });

    const workspace = await workModel.listByWorkspace({});
    const byResource = new Map(workspace.items.map((item) => [item.resourceId, item]));

    expect(byResource.get('lobehub/lobehub#7')).toMatchObject({
      originTopicId: titledTopicId,
      originTopicTitle: 'Origin topic',
    });
    expect(byResource.get('lobehub/lobehub#8')).toMatchObject({
      originTopicId: null,
      originTopicTitle: null,
    });
  });

  it('omits full content from every card-facing query payload', async () => {
    const workModel = new WorkModel(serverDB, userId);
    const content = 'Full external body that must stay off card payloads';

    const work = await workModel.registerExternal({
      changeType: 'created',
      content,
      description: 'Bounded preview',
      identifier: 'lobehub/lobehub#42',
      patchFields: ['content', 'description', 'identifier', 'title'],
      resourceId: 'lobehub/lobehub#42',
      resourceType: 'github_issue',
      rootOperationId: 'op-card-projection',
      toolCallId: 'tool-call-card-projection',
      toolIdentifier: 'github',
      toolName: 'create_issue',
      title: 'Card projection',
      topicId,
    });

    // The immutable version retains layer-3 content for a future detail read.
    const [version] = await workModel.listVersions(work!.id);
    expect(version.content).toBe(content);

    const events = await workModel.listByRootOperation({
      rootOperationId: 'op-card-projection',
    });
    const summaries = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-card-projection'],
    });
    const conversation = await workModel.listByConversation({ topicId });
    const workspace = await workModel.listByWorkspace({});
    const cardItems = [
      ...events,
      ...summaries['op-card-projection'],
      ...conversation,
      ...workspace.items,
    ];

    expect(cardItems).toHaveLength(4);
    for (const item of cardItems) {
      expect(item).not.toHaveProperty('content');
      expect(item.description).toBe('Bounded preview');
    }
  });

  it('accepts a works row with a null resourceId', async () => {
    // `works.resourceId` is nullable now: rows with no stable backing resource
    // bypass the partial unique indexes (Postgres treats NULLs as distinct).
    const [row] = await serverDB
      .insert(works)
      .values({
        resourceType: 'document',
        toolIdentifier: 'manual-test',
        toolName: 'manual-test',
        type: 'document',
        userId,
        visibility: 'private',
      })
      .returning();

    expect(row.resourceId).toBeNull();

    const [stored] = await serverDB.select().from(works).where(eq(works.id, row.id));
    expect(stored.resourceId).toBeNull();
  });

  it('gates the file work type behind the includeFileWorks opt-in', async () => {
    // Regression for the deployed-client skew: requests WITHOUT the opt-in must
    // never see `file` works (old clients whose descriptor table lacks `file`
    // crash on them); opted-in requests receive every type.
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);

    const task = await taskModel.create({ instruction: 'Legacy task', name: 'Legacy task' });
    await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-gate',
      taskId: task.id,
      toolCallId: 'gate-task-call',
      toolIdentifier: 'lobe-task',
      toolName: 'createTask',
      topicId,
    });
    // No threadId: the version's threadId stays null so the default (no-thread)
    // conversation query surfaces it alongside the task work.
    await workModel.registerFile({
      agentId,
      filePath: '/mnt/data/report.pptx',
      metadata: {
        fileId: 'file-gate',
        filePath: '/mnt/data/report.pptx',
        fileUrl: 'https://cdn.example.com/report.pptx',
      },
      rootOperationId: 'op-gate',
      title: 'report.pptx',
      toolCallId: 'op:op-gate',
      toolIdentifier: 'lobe-cloud-sandbox',
      toolName: 'writeFile',
      topicId,
      userId,
    });

    const types = (items: { type: string }[]) => items.map((item) => item.type).sort();

    // Default request → legacy set only.
    const defaultEvents = await workModel.listByRootOperations({ rootOperationIds: ['op-gate'] });
    expect(types(defaultEvents['op-gate'])).toEqual(['task']);
    const defaultSummaries = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-gate'],
    });
    expect(types(defaultSummaries['op-gate'])).toEqual(['task']);
    const defaultConversation = await workModel.listByConversation({ topicId });
    expect(types(defaultConversation)).toEqual(['task']);
    const defaultWorkspace = await workModel.listByWorkspace({});
    expect(types(defaultWorkspace.items)).toEqual(['task']);

    // Opted-in request → both types surface.
    const optedEvents = await workModel.listByRootOperations({
      includeFileWorks: true,
      rootOperationIds: ['op-gate'],
    });
    expect(types(optedEvents['op-gate'])).toEqual(['file', 'task']);
    const optedSummaries = await workModel.listSummariesByRootOperations({
      includeFileWorks: true,
      rootOperationIds: ['op-gate'],
    });
    expect(types(optedSummaries['op-gate'])).toEqual(['file', 'task']);
    const optedConversation = await workModel.listByConversation({
      includeFileWorks: true,
      topicId,
    });
    expect(types(optedConversation)).toEqual(['file', 'task']);
    const optedWorkspace = await workModel.listByWorkspace({ includeFileWorks: true });
    expect(types(optedWorkspace.items)).toEqual(['file', 'task']);
  });
});
