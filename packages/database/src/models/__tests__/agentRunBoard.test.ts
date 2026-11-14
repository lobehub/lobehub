// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentInterventions,
  agentOperations,
  agents,
  messages,
  tasks,
  taskTopics,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentRunBoardModel } from '../agentRunBoard';

const serverDB: LobeChatDatabase = await getTestDB();

const owner = 'run-board-owner';
const teammate = 'run-board-teammate';
const workspaceId = 'run-board-ws';
const otherWorkspaceId = 'run-board-other-ws';

const now = new Date('2026-11-08T12:00:00Z');
const since = new Date('2026-11-08T06:00:00Z');
const inWindow = new Date('2026-11-08T10:00:00Z');

const insertRun = (id: string, values: Partial<typeof agentOperations.$inferInsert> = {}) =>
  serverDB.insert(agentOperations).values({
    agentId: 'public-agent',
    createdAt: inWindow,
    id,
    startedAt: inWindow,
    status: 'running',
    topicId: 'base-topic',
    updatedAt: inWindow,
    userId: teammate,
    workspaceId,
    ...values,
  });

const ids = async () =>
  (await new AgentRunBoardModel(serverDB, workspaceId).listRuns({ now, since }))
    .map((r) => r.id)
    .sort();

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: owner }, { id: teammate }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'A', primaryOwnerId: owner, slug: workspaceId },
    { id: otherWorkspaceId, name: 'B', primaryOwnerId: owner, slug: otherWorkspaceId },
  ]);
  await serverDB.insert(agents).values([
    {
      id: 'public-agent',
      name: 'Named',
      title: 'Public',
      userId: teammate,
      visibility: 'public',
      workspaceId,
    },
    { id: 'private-agent', title: 'Secret', userId: owner, visibility: 'private', workspaceId },
  ]);
  await serverDB.insert(topics).values({ id: 'base-topic', userId: teammate, workspaceId });
});

afterEach(async () => {
  await serverDB.delete(agentOperations);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('AgentRunBoardModel.listRuns', () => {
  it('returns teammates runs with the task title and error message but no stack', async () => {
    await serverDB.insert(tasks).values({
      createdByUserId: teammate,
      id: 'task-1',
      identifier: 'T-1',
      instruction: 'Do it',
      name: 'Ship it',
      seq: 1,
      workspaceId,
    });
    await insertRun('failed-run', {
      completedAt: inWindow,
      error: { message: 'boom', stack: 'secret stack', type: 'ToolError' },
      status: 'error',
      taskId: 'task-1',
    });

    const [row] = await new AgentRunBoardModel(serverDB, workspaceId).listRuns({ now, since });

    expect(row).toMatchObject({
      agentName: 'Named',
      agentOwnerId: teammate,
      agentTitle: 'Public',
      errorMessage: 'boom',
      errorType: 'ToolError',
      taskName: 'Ship it',
      userId: teammate,
    });
    expect(JSON.stringify(row)).not.toContain('secret stack');
  });

  it('excludes other workspaces, private agents, sub-agent runs and idle rows', async () => {
    await serverDB.insert(agents).values({
      id: 'other-agent',
      userId: owner,
      visibility: 'public',
      workspaceId: otherWorkspaceId,
    });
    await insertRun('visible');
    await insertRun('private', { agentId: 'private-agent', userId: owner });
    await insertRun('child', { parentOperationId: 'visible' });
    await insertRun('reserved', { status: 'idle' });
    await insertRun('elsewhere', { agentId: 'other-agent', workspaceId: otherWorkspaceId });

    expect(await ids()).toEqual(['visible']);
  });

  it('excludes share-visitor, trashed and channel topics', async () => {
    await serverDB
      .insert(topics)
      .values([
        { id: 'visitor-topic', senderId: 'guest', userId: teammate, workspaceId },
        { id: 'trashed-topic', isDeleted: true, userId: teammate, workspaceId } as never,
        { id: 'channel-topic', trigger: 'channel', userId: teammate, workspaceId },
        { id: 'ok-topic', userId: teammate, workspaceId },
      ]);
    await insertRun('visitor', { topicId: 'visitor-topic' });
    await insertRun('trashed', { topicId: 'trashed-topic' });
    await insertRun('channel', { topicId: 'channel-topic' });
    await insertRun('ok', { topicId: 'ok-topic' });

    expect(await ids()).toEqual(['ok']);
  });

  it('excludes a run whose topic was purged', async () => {
    await insertRun('purged', { taskId: null, topicId: null });

    expect(await ids()).toEqual([]);
  });

  it('excludes a run whose task-run snapshot was private', async () => {
    await serverDB.insert(tasks).values({
      createdByUserId: teammate,
      id: 'task-2',
      identifier: 'T-2',
      instruction: 'Do it',
      name: 'Now public',
      seq: 2,
      workspaceId,
    });
    await serverDB.insert(topics).values({ id: 'snap-topic', userId: teammate, workspaceId });
    await serverDB.insert(taskTopics).values({
      seq: 1,
      taskId: 'task-2',
      topicId: 'snap-topic',
      userId: teammate,
      visibility: 'private',
      workspaceId,
    });
    await insertRun('snapshot-private', { taskId: 'task-2', topicId: 'snap-topic' });

    expect(await ids()).toEqual([]);
  });

  it('drops runs that ended before the window but keeps long waiting asks', async () => {
    const old = new Date('2026-11-08T05:00:00Z');
    await insertRun('ended-before', { completedAt: old, createdAt: old, status: 'done' });
    await insertRun('spanning', {
      completedAt: inWindow,
      createdAt: old,
      status: 'done',
    });
    await insertRun('old-ask', {
      createdAt: new Date('2026-11-05T05:00:00Z'),
      status: 'waiting_for_human',
    });
    await insertRun('ancient-ask', {
      createdAt: new Date('2026-10-20T05:00:00Z'),
      status: 'waiting_for_human',
    });

    expect(await ids()).toEqual(['old-ask', 'spanning']);
  });

  it('attaches intervention rows to waiting runs', async () => {
    await insertRun('asking', { status: 'waiting_for_human' });
    await serverDB.insert(agentInterventions).values({
      activityKey: 'activity',
      allowedActions: [],
      batchId: 'batch',
      canonicalToolKey: 'stripe.refund',
      deadline: new Date('2026-11-08T13:00:00Z'),
      interactionKind: 'approval',
      itemCount: 1,
      itemIndex: 0,
      operationId: 'asking',
      requestRevisionHash: 'a'.repeat(64),
      reviewContext: {},
      reviewTokenHash: 'b'.repeat(64),
      sanitizedRequest: {},
      source: 'server',
      stepIndex: 0,
      surface: 'chat',
      systemActionEligibility: 'none',
      toolCallId: 'call',
      userId: teammate,
      workspaceId,
    } as never);

    const [row] = await new AgentRunBoardModel(serverDB, workspaceId).listRuns({ now, since });

    expect(row.interventions).toHaveLength(1);
    expect(row.interventions[0]).toMatchObject({
      status: 'pending',
      userId: teammate,
    });
  });
});

describe('AgentRunBoardModel.listRuns involved scope', () => {
  it('keeps the viewer’s own runs, topics they wrote in and asks addressed to them', async () => {
    await serverDB.insert(topics).values({ id: 'spoken-topic', userId: teammate, workspaceId });
    await serverDB.insert(messages).values([
      {
        content: 'hi',
        id: 'm-user',
        role: 'user',
        topicId: 'spoken-topic',
        userId: owner,
        workspaceId,
      },
      {
        content: 'reply',
        id: 'm-assistant',
        role: 'assistant',
        topicId: 'base-topic',
        userId: owner,
        workspaceId,
      },
    ]);
    await insertRun('own-run', { userId: owner });
    await insertRun('spoken-run', { topicId: 'spoken-topic' });
    await insertRun('assistant-only-run');
    await insertRun('asked-run', { status: 'waiting_for_human' });
    await serverDB.insert(agentInterventions).values({
      activityKey: 'activity',
      allowedActions: [],
      batchId: 'batch',
      canonicalToolKey: 'stripe.refund',
      deadline: new Date('2026-11-08T13:00:00Z'),
      interactionKind: 'approval',
      itemCount: 1,
      itemIndex: 0,
      operationId: 'asked-run',
      requestRevisionHash: 'a'.repeat(64),
      reviewContext: {},
      reviewTokenHash: 'b'.repeat(64),
      sanitizedRequest: {},
      source: 'server',
      stepIndex: 0,
      surface: 'chat',
      systemActionEligibility: 'none',
      toolCallId: 'call',
      userId: owner,
      workspaceId,
    } as never);

    const rows = await new AgentRunBoardModel(serverDB, workspaceId).listRuns({
      involvedUserId: owner,
      now,
      since,
    });

    expect(rows.map((r) => r.id).sort()).toEqual(['asked-run', 'own-run', 'spoken-run']);
  });
});
