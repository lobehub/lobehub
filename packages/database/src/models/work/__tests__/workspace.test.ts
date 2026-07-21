// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { topics, workspaces } from '../../../schemas';
import { AgentDocumentModel } from '../../agentDocuments';
import { TaskModel } from '../../task';
import { WorkModel } from '..';
import {
  agentId,
  cleanupWorkTestData,
  expectDocumentSummaryItem,
  expectTaskSummaryItem,
  seedWorkTestData,
  serverDB,
  topicId,
  userId,
  userId2,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

/**
 * Register N task works sequentially so their `works.updatedAt` timestamps
 * differ, giving the keyset cursor a deterministic order to page over. Returns
 * the created works newest-first (registration order reversed) to mirror the
 * `desc(updatedAt)` list ordering.
 */
const seedTaskWorks = async (workModel: WorkModel, taskModel: TaskModel, count: number) => {
  const works = [];
  for (let index = 0; index < count; index += 1) {
    const task = await taskModel.create({
      instruction: `Task ${index}`,
      name: `Task ${index}`,
    });
    const work = await workModel.registerTask({
      changeType: 'created',
      rootOperationId: `op-workspace-${index}`,
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: `tool-call-workspace-${index}`,
      taskId: task.id,
      topicId,
    });
    works.push(work!);
  }
  return works.reverse();
};

describe('WorkModel · listByWorkspace', () => {
  it('lists works across topics and types, newest first', async () => {
    const otherTopicId = 'work-test-other-topic-id';
    await serverDB.insert(topics).values({ id: otherTopicId, userId });

    const taskModel = new TaskModel(serverDB, userId);
    const agentDocumentModel = new AgentDocumentModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);

    const firstTask = await taskModel.create({ instruction: 'First', name: 'First task' });
    const firstWork = await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-cross-1',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-cross-1',
      taskId: firstTask.id,
      topicId,
    });

    const doc = await agentDocumentModel.create(agentId, 'cross.md', 'Cross body', {
      title: 'Cross doc',
    });
    const docWork = await workModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      changeType: 'created',
      rootOperationId: 'op-cross-doc',
      toolName: 'createDocument',
      toolIdentifier: 'lobe-agent-documents',
      toolCallId: 'tool-call-cross-doc',
      // Deliberately on a different topic to prove the query is cross-topic.
      topicId: otherTopicId,
    });

    const { items, nextCursor } = await workModel.listByWorkspace({});

    expect(nextCursor).toBeNull();
    expect(items.map((item) => item.id)).toEqual([docWork!.id, firstWork!.id]);
    expect(expectDocumentSummaryItem(items[0]).title).toBe('Cross doc');
    expect(expectTaskSummaryItem(items[1]).task.name).toBe('First task');
  });

  it('narrows to a single type when `type` is given', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const agentDocumentModel = new AgentDocumentModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);

    const task = await taskModel.create({ instruction: 'Typed', name: 'Typed task' });
    await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-typed-task',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-typed-task',
      taskId: task.id,
      topicId,
    });

    const doc = await agentDocumentModel.create(agentId, 'typed.md', 'Typed body', {
      title: 'Typed doc',
    });
    const docWork = await workModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      changeType: 'created',
      rootOperationId: 'op-typed-doc',
      toolName: 'createDocument',
      toolIdentifier: 'lobe-agent-documents',
      toolCallId: 'tool-call-typed-doc',
      topicId,
    });

    const { items } = await workModel.listByWorkspace({ type: 'document' });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(docWork!.id);
    expect(items[0].type).toBe('document');
  });

  it('pages over the keyset cursor without gaps or overlaps', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const expected = await seedTaskWorks(workModel, taskModel, 5);

    const firstPage = await workModel.listByWorkspace({ limit: 2 });
    expect(firstPage.items.map((item) => item.id)).toEqual(expected.slice(0, 2).map((w) => w.id));
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await workModel.listByWorkspace({ cursor: firstPage.nextCursor, limit: 2 });
    expect(secondPage.items.map((item) => item.id)).toEqual(expected.slice(2, 4).map((w) => w.id));
    expect(secondPage.nextCursor).toBeTruthy();

    const thirdPage = await workModel.listByWorkspace({ cursor: secondPage.nextCursor, limit: 2 });
    expect(thirdPage.items.map((item) => item.id)).toEqual(expected.slice(4).map((w) => w.id));
    // Last page is short (1 of 2), so there is no further cursor.
    expect(thirdPage.nextCursor).toBeNull();
  });

  it('does not expose another owner works', async () => {
    const otherTopicId = 'work-test-other-owner-topic';
    await serverDB.insert(topics).values({ id: otherTopicId, userId: userId2 });

    const otherTaskModel = new TaskModel(serverDB, userId2);
    const otherWorkModel = new WorkModel(serverDB, userId2);
    const workModel = new WorkModel(serverDB, userId);

    const otherTask = await otherTaskModel.create({ instruction: 'Private', name: 'Private task' });
    await otherWorkModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-private',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-private',
      taskId: otherTask.id,
      topicId: otherTopicId,
    });

    const { items } = await workModel.listByWorkspace({});
    expect(items).toEqual([]);
  });

  it('keeps workspace external Works private to their registrant', async () => {
    const workspaceId = 'work-test-external-workspace';
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'External Work Test Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });

    const ownerWorks = new WorkModel(serverDB, userId, workspaceId);
    const memberWorks = new WorkModel(serverDB, userId2, workspaceId);
    const work = await ownerWorks.registerExternal({
      changeType: 'created',
      identifier: 'lobehub/lobehub#42',
      resourceId: 'lobehub/lobehub#42',
      resourceType: 'github_issue',
      toolCallId: 'tool-call-private-external',
      toolIdentifier: 'github',
      toolName: 'create_issue',
    });

    expect(work).toMatchObject({ userId, visibility: 'private' });
    expect((await ownerWorks.listByWorkspace({})).items).toHaveLength(1);
    expect((await memberWorks.listByWorkspace({})).items).toHaveLength(0);
  });

  it('flags an orphaned task work whose task was deleted without the tool', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Orphan', name: 'Orphan task' });

    await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-orphan-workspace',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-orphan-workspace',
      taskId: task.id,
      topicId,
    });

    // UI/CLI delete (no tool dispatch) leaves the Work orphaned; the LEFT JOIN
    // miss must render as `taskDeleted` from the version snapshot, not drop it.
    await taskModel.delete(task.id);

    const { items } = await workModel.listByWorkspace({});
    expect(items).toHaveLength(1);
    const summary = expectTaskSummaryItem(items[0]);
    expect(summary.task.name).toBe('Orphan task');
    expect(summary.taskDeleted).toBe(true);
  });
});
