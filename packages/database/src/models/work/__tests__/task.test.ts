// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { messages, topics, works, workspaces, workVersions } from '../../../schemas';
import { TaskModel } from '../../task';
import { WorkModel } from '..';
import {
  agentId,
  cleanupWorkTestData,
  expectTaskListItem,
  expectTaskSummaryItem,
  seedWorkTestData,
  serverDB,
  threadId,
  topicId,
  userId,
  userId2,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

describe('WorkModel · task', () => {
  it('registers a task work with v1 carrying the attribution fields', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({
      instruction: 'Write the MVP plan',
      name: 'Work MVP plan',
      priority: 2,
    });
    await serverDB.insert(messages).values([
      {
        content: '',
        id: 'msg-assistant',
        role: 'assistant',
        topicId,
        userId,
      },
      {
        content: '',
        id: 'msg-tool',
        parentId: 'msg-assistant',
        role: 'tool',
        topicId,
        userId,
      },
    ]);

    const work = await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-root',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      messageId: 'msg-tool',
      toolCallId: 'tool-call-create',
      taskId: task.id,
      threadId,
      topicId,
    });

    expect(work).toBeDefined();
    expect(work?.resourceId).toBe(task.id);
    expect(work?.currentVersionId).toBeTruthy();

    const versions = await workModel.listVersions(work!.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      changeType: 'created',
      content: 'Write the MVP plan',
      description: 'Write the MVP plan',
      identifier: task.identifier,
      rootOperationId: 'op-root',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      messageId: 'msg-tool',
      toolCallId: 'tool-call-create',
      status: 'backlog',
      threadId,
      title: 'Work MVP plan',
      topicId,
      version: 1,
    });
    // Work materializes every current card field from the same version.
    expect(work).toMatchObject({
      description: 'Write the MVP plan',
      identifier: task.identifier,
      originThreadId: threadId,
      originTopicId: topicId,
      status: 'backlog',
      title: 'Work MVP plan',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      visibility: 'public',
    });

    const worksInConversation = await workModel.listByConversation({ threadId, topicId });
    expect(worksInConversation).toHaveLength(1);
    expect(worksInConversation[0]).toMatchObject({
      id: work?.id,
      task: { name: 'Work MVP plan', priority: 2, status: 'backlog' },
      taskDeleted: false,
    });

    const byOperation = await workModel.listByRootOperation({ rootOperationId: 'op-root' });
    expect(byOperation).toHaveLength(1);
    expect(byOperation[0].id).toBe(work?.id);

    const byOperations = await workModel.listByRootOperations({
      rootOperationIds: ['op-missing', 'op-root'],
    });
    expect(byOperations['op-root']).toHaveLength(1);
    expect(byOperations['op-root']?.[0]).toMatchObject({
      id: work?.id,
      version: expect.objectContaining({
        rootOperationId: 'op-root',
        messageId: 'msg-tool',
      }),
    });
    expect(byOperations['op-missing']).toEqual([]);
  });

  it('stamps origin provenance once at identity creation and never updates it', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Origin task', name: 'Origin task' });

    const otherTopicId = 'work-test-topic-id-origin';
    await serverDB.insert(topics).values({ id: otherTopicId, userId });

    const created = await workModel.registerTask({
      agentId,
      changeType: 'created',
      rootOperationId: 'op-origin-create',
      taskId: task.id,
      threadId,
      toolCallId: 'tool-call-origin-1',
      toolIdentifier: 'lobe-task',
      toolName: 'createTask',
      topicId,
    });
    expect(created).toMatchObject({
      originAgentId: agentId,
      originThreadId: threadId,
      originTopicId: topicId,
    });

    // A later registration from another conversation (and no agent) appends a
    // version but must NOT touch the immutable origin columns.
    const updated = await workModel.registerTask({
      changeType: 'updated',
      rootOperationId: 'op-origin-update',
      taskId: task.id,
      toolCallId: 'tool-call-origin-2',
      toolIdentifier: 'lobe-task',
      toolName: 'editTask',
      topicId: otherTopicId,
    });
    expect(updated).toMatchObject({
      originAgentId: agentId,
      originThreadId: threadId,
      originTopicId: topicId,
    });
    // The version itself carries the new conversation's provenance.
    const versions = await workModel.listVersions(created!.id);
    expect(versions[0]).toMatchObject({ topicId: otherTopicId, version: 2 });
  });

  it('keeps conversation provenance on versions and latest card state on Work', async () => {
    const otherTopicId = 'work-test-second-topic-id';
    await serverDB.insert(topics).values({ id: otherTopicId, userId });
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Creator topic', name: 'Creator topic' });

    // Conversation provenance belongs to each immutable mutation version.
    await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-provenance-first',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-provenance-first',
      taskId: task.id,
      threadId,
      topicId,
    });

    await taskModel.update(task.id, { name: 'Latest title' });
    const edited = await workModel.registerTask({
      changeType: 'updated',
      rootOperationId: 'op-provenance-second',
      toolName: 'editTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-provenance-second',
      taskIdentifier: task.identifier,
      topicId: otherTopicId,
    });

    const [row] = await serverDB.select().from(works).where(eq(works.id, edited!.id));
    expect(row).toMatchObject({
      // Origin stays pinned to the first registration's conversation even
      // though the current card state comes from the second one.
      originThreadId: threadId,
      originTopicId: topicId,
      title: 'Latest title',
      toolName: 'editTask',
      toolIdentifier: 'lobe-task',
    });

    const versions = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, edited!.id));
    const byToolCall = new Map(versions.map((version) => [version.toolCallId, version]));
    expect(byToolCall.get('tool-call-provenance-first')).toMatchObject({ threadId, topicId });
    expect(byToolCall.get('tool-call-provenance-second')).toMatchObject({
      threadId: null,
      topicId: otherTopicId,
    });
  });

  it('stores a complete task display snapshot and caches title/description on Work', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    // A long instruction proves `content` keeps the full text while `description`
    // is the ≤120 preview.
    const instruction = 'B'.repeat(300);
    const expectedDescription = `${'B'.repeat(120)}...`;
    const task = await taskModel.create({ instruction, name: 'Fill display task' });

    const work = await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-fill-display',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-fill-display',
      taskId: task.id,
      topicId,
    });

    const [workRow] = await serverDB.select().from(works).where(eq(works.id, work!.id));
    expect(workRow).toMatchObject({
      description: expectedDescription,
      identifier: task.identifier,
      status: 'backlog',
      title: 'Fill display task',
    });

    const [version] = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, work!.id));
    expect(version).toMatchObject({
      content: instruction,
      description: expectedDescription,
      identifier: task.identifier,
      status: 'backlog',
      title: 'Fill display task',
    });
  });

  it('caps workVersions.content at WORK_CONTENT_MAX_LENGTH on write', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    // An instruction past the 65 536-char cap must not land verbatim in the
    // immutable version snapshot.
    const instruction = 'C'.repeat(70_000);
    const task = await taskModel.create({ instruction, name: 'Capped content task' });

    const work = await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-capped-content',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-capped-content',
      taskId: task.id,
      topicId,
    });

    const [version] = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, work!.id));
    expect(version.content).toBe(`${'C'.repeat(65_536)}...`);
  });

  it('rolls back a newly inserted Work when version creation fails', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Atomic write', name: 'Atomic task' });

    await expect(
      workModel.registerTask({
        agentId: 'missing-agent-id',
        changeType: 'created',
        rootOperationId: 'op-atomic-failure',
        taskId: task.id,
        toolCallId: 'tool-call-atomic-failure',
        toolName: 'createTask',
        toolIdentifier: 'lobe-task',
      }),
    ).rejects.toThrow();

    const workRows = await serverDB.select().from(works).where(eq(works.resourceId, task.id));
    expect(workRows).toHaveLength(0);
  });

  it('updates Work tool fields to the latest version while preserving version provenance', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Creator', name: 'Creator task' });

    const created = await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-creator-create',
      toolName: 'createTask',
      toolCallId: 'tool-call-creator-create',
      toolIdentifier: 'lobe-task',
      taskId: task.id,
      topicId,
    });
    expect(created).toMatchObject({ toolIdentifier: 'lobe-task', toolName: 'createTask' });

    await taskModel.update(task.id, { name: 'Creator task edited' });

    const edited = await workModel.registerTask({
      changeType: 'updated',
      rootOperationId: 'op-creator-edit',
      toolName: 'editTask',
      toolCallId: 'tool-call-creator-edit',
      toolIdentifier: 'some-other-tool',
      taskId: task.id,
      topicId,
    });
    expect(edited).toMatchObject({ toolIdentifier: 'some-other-tool', toolName: 'editTask' });

    const [row] = await serverDB.select().from(works).where(eq(works.id, created!.id));
    expect(row).toMatchObject({ toolIdentifier: 'some-other-tool', toolName: 'editTask' });

    // `work_versions.toolIdentifier` is per-version: each version keeps the
    // value passed at that registration.
    const versions = await workModel.listVersions(created!.id);
    const byToolCall = new Map(versions.map((v) => [v.toolCallId, v.toolIdentifier]));
    expect(byToolCall.get('tool-call-creator-create')).toBe('lobe-task');
    expect(byToolCall.get('tool-call-creator-edit')).toBe('some-other-tool');
  });

  it('writes cumulativeCost only on the version that carried it at insert time', async () => {
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

    // The agent runtime stamps each register call with its own tool-call cost,
    // so only the version registered with cost carries it — a sibling version
    // registered cost-less stays null (no shared backfill spills over).
    const firstWork = await workModel.registerTask({
      cumulativeCost: 0.03,
      cumulativeUsage: {
        capturedAt: '2026-06-30T08:00:00.000Z',
        cost: { total: 0.03 },
        usage: { llm: { tokens: { input: 1200, output: 300, total: 1500 } } },
      },
      changeType: 'created',
      rootOperationId: 'op-cumulative',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-first',
      taskId: firstTask.id,
      topicId,
    });
    const secondWork = await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-cumulative',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-second',
      taskId: secondTask.id,
      topicId,
    });

    const [firstVersion] = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, firstWork!.id));
    const [secondVersion] = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, secondWork!.id));

    expect(firstVersion.cumulativeCost).toBe(0.03);
    expect(firstVersion.cumulativeUsage).toMatchObject({
      capturedAt: '2026-06-30T08:00:00.000Z',
      cost: { total: 0.03 },
    });
    expect(secondVersion.cumulativeCost).toBeNull();
    expect(secondVersion.cumulativeUsage).toBeNull();

    const byOperation = await workModel.listByRootOperation({ rootOperationId: 'op-cumulative' });
    const firstOperationWork = byOperation.find((item) => item.id === firstWork!.id);
    expect(firstOperationWork?.version.cumulativeCost).toBe(0.03);
  });

  it('writes cumulativeCost/cumulativeUsage at insert time when registered with cost', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Insert cost', name: 'Insert cost' });

    // The agent runtime now stamps the cumulative cost onto the register call,
    // so the version row lands with its cost instead of being back-filled.
    const work = await workModel.registerTask({
      cumulativeCost: 0.042,
      cumulativeUsage: {
        capturedAt: '2026-07-08T08:00:00.000Z',
        cost: { total: 0.042 },
        usage: { llm: { tokens: { input: 900, output: 100, total: 1000 } } },
      },
      changeType: 'created',
      rootOperationId: 'op-insert-cost',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-insert-cost',
      taskId: task.id,
      topicId,
    });

    const [version] = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, work!.id));

    expect(version.cumulativeCost).toBe(0.042);
    expect(version.cumulativeUsage).toMatchObject({ cost: { total: 0.042 } });
  });

  it('keeps one work row and appends versions for task edits', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Original', name: 'Original title' });
    await serverDB.insert(messages).values({
      content: '',
      id: 'msg-tool-edit',
      role: 'tool',
      topicId,
      userId,
    });

    const first = await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-create',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-create',
      taskId: task.id,
      topicId,
    });

    await taskModel.update(task.id, {
      instruction: 'Updated instruction',
      name: 'Updated title',
    });

    const second = await workModel.registerTask({
      changeType: 'updated',
      rootOperationId: 'op-edit',
      toolName: 'editTask',
      toolIdentifier: 'lobe-task',
      messageId: 'msg-tool-edit',
      toolCallId: 'tool-call-edit',
      taskIdentifier: task.identifier,
      topicId,
    });

    expect(second?.id).toBe(first?.id);

    const workRows = await serverDB.select().from(works).where(eq(works.resourceId, task.id));
    expect(workRows).toHaveLength(1);

    const versions = await workModel.listVersions(first!.id);
    expect(versions.map((item) => item.version)).toEqual([2, 1]);
    expect(versions[0].changeType).toBe('updated');
    expect(versions[0].id).toBeTruthy();
    // Every version preserves the display state captured at that mutation.
    expect(versions[0]).toMatchObject({
      content: 'Updated instruction',
      identifier: task.identifier,
      title: 'Updated title',
    });
    expect(versions[1]).toMatchObject({
      content: 'Original',
      identifier: task.identifier,
      title: 'Original title',
    });
    expect(second).toMatchObject({ description: 'Updated instruction', title: 'Updated title' });

    const [updatedVersion] = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.toolCallId, 'tool-call-edit'));
    expect(updatedVersion.messageId).toBe('msg-tool-edit');
  });

  it('summarizes a task work on its latest operation with total version cost', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({
      description: 'Original description',
      instruction: 'Original',
      name: 'Original title',
    });

    const first = await workModel.registerTask({
      cumulativeCost: 0.000_295,
      changeType: 'created',
      rootOperationId: 'op-summary-create',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-summary-create',
      taskId: task.id,
      topicId,
    });

    await taskModel.update(task.id, {
      description: 'Updated description',
      instruction: 'Updated instruction',
      name: 'Updated title',
    });

    await workModel.registerTask({
      cumulativeCost: 0.000_692,
      changeType: 'updated',
      rootOperationId: 'op-summary-edit',
      toolName: 'editTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-summary-edit',
      taskIdentifier: task.identifier,
      topicId,
    });
    await taskModel.update(task.id, { description: 'Live task description after snapshot' });

    const byOperation = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-summary-create', 'op-summary-edit'],
    });
    expect(byOperation['op-summary-create']).toEqual([]);
    expect(byOperation['op-summary-edit']).toHaveLength(1);
    const summary = expectTaskSummaryItem(byOperation['op-summary-edit']?.[0]);
    expect(summary).toMatchObject({
      event: expect.objectContaining({ changeType: 'updated', rootOperationId: 'op-summary-edit' }),
      id: first?.id,
      task: expect.objectContaining({ name: 'Updated title' }),
      version: expect.objectContaining({ version: 2 }),
    });
    // Cost is written once at insert time and summed across the two operations.
    expect(summary.totalCost).toBeCloseTo(0.000_987, 6);
    // Instruction is the card preview text; like name/status it coalesces the
    // live task row onto the version snapshot.
    expect(summary.task.instruction).toBe('Updated instruction');
  });

  it('surfaces the instruction as the card preview on every list path', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({
      instruction: 'Print the current date with Python',
      name: 'Greeting test',
    });

    await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-instruction-preview',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-instruction-preview',
      taskId: task.id,
      threadId,
      topicId,
    });

    // Conversation list path (live tasks join).
    const byConversation = await workModel.listByConversation({ threadId, topicId });
    expect(byConversation).toHaveLength(1);
    expect(byConversation[0]).toMatchObject({
      task: expect.objectContaining({ instruction: 'Print the current date with Python' }),
    });

    // Summary path (snapshot projection).
    const byOperation = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-instruction-preview'],
    });
    const summary = expectTaskSummaryItem(byOperation['op-instruction-preview']?.[0]);
    expect(summary.task.instruction).toBe('Print the current date with Python');
  });

  it('does not double-count cumulative cost snapshots within the same operation', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Cost', name: 'Cost task' });

    // cumulativeCost is the operation's running total written once at insert
    // time: the edit's 0.016 already contains the create's 0.01 (same
    // operation), so the work's total is 0.016 + 0.005, not the 0.031 sum of
    // all three snapshots.
    await workModel.registerTask({
      cumulativeCost: 0.01,
      changeType: 'created',
      rootOperationId: 'op-cost-same',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-cost-create',
      taskId: task.id,
      topicId,
    });
    await workModel.registerTask({
      cumulativeCost: 0.016,
      changeType: 'updated',
      rootOperationId: 'op-cost-same',
      toolName: 'editTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-cost-edit',
      taskId: task.id,
      topicId,
    });
    await workModel.registerTask({
      cumulativeCost: 0.005,
      changeType: 'updated',
      rootOperationId: 'op-cost-other',
      toolName: 'editTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-cost-other',
      taskId: task.id,
      topicId,
    });

    const summaries = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-cost-other', 'op-cost-same'],
    });
    const summary = expectTaskSummaryItem(summaries['op-cost-other']?.[0]);
    expect(summary.totalCost).toBeCloseTo(0.021, 6);
  });

  it('does not let another user register someone else task', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const otherWorkModel = new WorkModel(serverDB, userId2);
    const task = await taskModel.create({ instruction: 'Private task' });

    const work = await otherWorkModel.registerTask({
      changeType: 'created',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-other-user',
      taskIdentifier: task.identifier,
      topicId,
    });

    expect(work).toBeNull();
    const workRows = await serverDB.select().from(works);
    expect(workRows).toHaveLength(0);
  });

  it('does not expose another user task work summaries', async () => {
    const otherTopicId = 'work-test-other-topic-id';
    await serverDB.insert(topics).values({ id: otherTopicId, userId: userId2 });
    const otherTaskModel = new TaskModel(serverDB, userId2);
    const otherWorkModel = new WorkModel(serverDB, userId2);
    const workModel = new WorkModel(serverDB, userId);
    const otherTask = await otherTaskModel.create({
      instruction: 'Other user summary',
      name: 'Private summary',
    });

    await otherWorkModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-other-summary',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-other-summary',
      taskId: otherTask.id,
      topicId: otherTopicId,
    });

    expect(
      await workModel.listSummariesByRootOperations({ rootOperationIds: ['op-other-summary'] }),
    ).toEqual({ 'op-other-summary': [] });
  });

  it('deletes task work and cascades versions when removed via the tool dispatch path', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Delete task work', name: 'Delete me' });

    const work = await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-delete-task',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-delete-task',
      taskId: task.id,
      threadId,
      topicId,
    });

    // Tool-driven deletion: the task row is removed first, then the dispatch
    // layer drops the Work by its internal id (LOBE-11606).
    await taskModel.delete(task.id);
    await workModel.deleteTaskWork({ taskId: task.id });

    const workRows = await serverDB.select().from(works).where(eq(works.id, work!.id));
    const versionRows = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, work!.id));

    expect(workRows).toHaveLength(0);
    expect(versionRows).toHaveLength(0);
    expect(await workModel.listByRootOperation({ rootOperationId: 'op-delete-task' })).toEqual([]);
    expect(await workModel.listByConversation({ threadId, topicId })).toEqual([]);
  });

  it('leaves the task work orphaned when the task is deleted without the tool', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Non-tool delete', name: 'Keep my Work' });

    const work = await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-orphan-task',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-orphan-task',
      taskId: task.id,
      threadId,
      topicId,
    });

    // UI / CLI delete (no tool dispatch): the Work row + versions survive as
    // orphans so the UI can render "resource deleted" from the snapshot.
    await taskModel.delete(task.id);

    const workRows = await serverDB.select().from(works).where(eq(works.id, work!.id));
    const versionRows = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, work!.id));

    expect(workRows).toHaveLength(1);
    expect(versionRows.length).toBeGreaterThan(0);
    // The task-joined lists now surface the orphan via LEFT JOIN, rendered from
    // its version snapshot and flagged `taskDeleted` so the UI shows "task
    // deleted" instead of dropping the card entirely.
    const orphaned = await workModel.listByConversation({ threadId, topicId });
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]).toMatchObject({
      id: work!.id,
      task: expect.objectContaining({ name: 'Keep my Work' }),
      taskDeleted: true,
    });
  });

  it('scopes deleteTaskWork to the current owner without touching another owner', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const otherTaskModel = new TaskModel(serverDB, userId2);
    const workModel = new WorkModel(serverDB, userId);
    const otherWorkModel = new WorkModel(serverDB, userId2);
    const task = await taskModel.create({ instruction: 'Owner task' });
    const otherTask = await otherTaskModel.create({ instruction: 'Other owner task' });

    const work = await workModel.registerTask({
      changeType: 'created',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-owner-clear',
      taskId: task.id,
    });
    const otherWork = await otherWorkModel.registerTask({
      changeType: 'created',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-other-clear',
      taskId: otherTask.id,
    });

    // Wrong owner cannot delete another owner's Work; the right owner can.
    await otherWorkModel.deleteTaskWork({ taskId: task.id });
    const stillPresent = await serverDB.select().from(works).where(eq(works.id, work!.id));
    expect(stillPresent).toHaveLength(1);

    await workModel.deleteTaskWork({ taskId: task.id });

    const deletedWorkRows = await serverDB.select().from(works).where(eq(works.id, work!.id));
    const remainingOtherWorkRows = await serverDB
      .select()
      .from(works)
      .where(eq(works.id, otherWork!.id));

    expect(deletedWorkRows).toHaveLength(0);
    expect(remainingOtherWorkRows).toHaveLength(1);
  });

  it('preserves work and versions when the topic is deleted', async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const task = await taskModel.create({ instruction: 'Topic scoped task' });

    const work = await workModel.registerTask({
      changeType: 'created',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      toolCallId: 'tool-call-topic-delete',
      taskId: task.id,
      topicId,
    });

    await serverDB.delete(topics).where(eq(topics.id, topicId));

    const workRows = await serverDB.select().from(works).where(eq(works.id, work!.id));
    const versionRows = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, work!.id));

    expect(workRows).toHaveLength(1);
    expect(versionRows).toHaveLength(1);
    // topic FK on work_versions is ON DELETE SET NULL — the event row survives.
    expect(versionRows[0].topicId).toBeNull();
  });
});

describe('WorkModel · workspace task visibility', () => {
  const workspaceId = 'work-test-workspace-id';

  const seedWorkspace = async () => {
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Work Test Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
  };

  it('hides another member private-task Work from every list path', async () => {
    await seedWorkspace();
    const ownerTasks = new TaskModel(serverDB, userId, workspaceId);
    const ownerWorks = new WorkModel(serverDB, userId, workspaceId);
    const memberWorks = new WorkModel(serverDB, userId2, workspaceId);

    const task = await ownerTasks.create({
      instruction: 'Secret instruction',
      name: 'Secret task',
      visibility: 'private',
    });
    const work = await ownerWorks.registerTask({
      changeType: 'created',
      rootOperationId: 'op-private-visibility',
      toolCallId: 'tool-call-private-visibility',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      taskId: task.id,
      topicId,
    });

    // The registrant keeps full access.
    expect(await ownerWorks.listByConversation({ topicId })).toHaveLength(1);

    // The other member sees nothing on any list path.
    expect(await memberWorks.listByConversation({ topicId })).toHaveLength(0);
    expect((await memberWorks.listByWorkspace({})).items).toHaveLength(0);
    expect(
      await memberWorks.listSummariesByRootOperations({
        rootOperationIds: ['op-private-visibility'],
      }),
    ).toEqual({ 'op-private-visibility': [] });
    expect(await memberWorks.listVersions(work!.id)).toHaveLength(0);
  });

  it('keeps public-task Works member-visible until the task flips private', async () => {
    await seedWorkspace();
    const ownerTasks = new TaskModel(serverDB, userId, workspaceId);
    const ownerWorks = new WorkModel(serverDB, userId, workspaceId);
    const memberWorks = new WorkModel(serverDB, userId2, workspaceId);

    const task = await ownerTasks.create({
      instruction: 'Shared instruction',
      name: 'Shared task',
      visibility: 'public',
    });
    await ownerWorks.registerTask({
      changeType: 'created',
      rootOperationId: 'op-public-visibility',
      toolCallId: 'tool-call-public-visibility',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      taskId: task.id,
      topicId,
    });

    const memberView = await memberWorks.listByConversation({ topicId });
    expect(memberView).toHaveLength(1);
    expect(expectTaskListItem(memberView[0]).task.name).toBe('Shared task');

    // The task transition mirrors visibility onto Work in the same transaction.
    await ownerTasks.updateVisibility(task.id, 'private');

    const [mirrored] = await serverDB
      .select({ visibility: works.visibility })
      .from(works)
      .where(eq(works.resourceId, task.id));
    expect(mirrored.visibility).toBe('private');

    expect(await memberWorks.listByConversation({ topicId })).toHaveLength(0);
    expect(await ownerWorks.listByConversation({ topicId })).toHaveLength(1);
  });

  it('does not let a member register a Work against another member private task', async () => {
    await seedWorkspace();
    const ownerTasks = new TaskModel(serverDB, userId, workspaceId);
    const memberWorks = new WorkModel(serverDB, userId2, workspaceId);

    const privateTask = await ownerTasks.create({
      instruction: 'Private register target',
      visibility: 'private',
    });
    const publicTask = await ownerTasks.create({
      instruction: 'Public register target',
      visibility: 'public',
    });

    expect(
      await memberWorks.registerTask({
        changeType: 'updated',
        toolCallId: 'tool-call-member-private',
        toolName: 'updateTask',
        toolIdentifier: 'lobe-task',
        taskId: privateTask.id,
        topicId,
      }),
    ).toBeNull();

    const memberRegisteredPublicWork = await memberWorks.registerTask({
      changeType: 'updated',
      toolCallId: 'tool-call-member-public',
      toolName: 'updateTask',
      toolIdentifier: 'lobe-task',
      taskId: publicTask.id,
      topicId,
    });
    expect(memberRegisteredPublicWork).toMatchObject({
      userId,
      visibility: 'public',
    });
  });

  it('hides an orphaned private-task Work from other members but keeps it for the registrant', async () => {
    await seedWorkspace();
    const ownerTasks = new TaskModel(serverDB, userId, workspaceId);
    const ownerWorks = new WorkModel(serverDB, userId, workspaceId);
    const memberWorks = new WorkModel(serverDB, userId2, workspaceId);

    const task = await ownerTasks.create({
      instruction: 'Orphan candidate',
      name: 'Orphan task',
      visibility: 'private',
    });
    await ownerWorks.registerTask({
      changeType: 'created',
      rootOperationId: 'op-orphan-visibility',
      toolCallId: 'tool-call-orphan-visibility',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      taskId: task.id,
      topicId,
    });

    // Hard-delete outside the tool path: the Work survives as an orphan. The
    // deleted row no longer carries visibility, so only the registrant keeps
    // the orphan card — its snapshot title must not leak to other members.
    await ownerTasks.delete(task.id);

    const ownerView = await ownerWorks.listByConversation({ topicId });
    expect(ownerView).toHaveLength(1);
    expect(expectTaskListItem(ownerView[0]).taskDeleted).toBe(true);

    expect(await memberWorks.listByConversation({ topicId })).toHaveLength(0);
  });
});
