import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, tasks, taskTopics, topics, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const owner = 'opened-by-task-owner';
const member = 'opened-by-task-member';
const workspaceId = 'ws-opened-by-task';
const serverDB: LobeChatDatabase = await getTestDB();

const openedBy = { openedBy: { at: '2026-11-18T00:00:00.000Z', topicId: 'parent' } };

describe('TopicModel.listOpenedTopics — task runs follow task visibility', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: owner }, { id: member }]);
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'WS', primaryOwnerId: owner, slug: workspaceId });
    await serverDB.insert(agents).values({ id: 'agent-public', userId: owner, workspaceId });
    await serverDB.insert(topics).values([
      { agentId: 'agent-public', id: 'parent', userId: owner, workspaceId },
      {
        agentId: 'agent-public',
        id: 'run-private',
        metadata: openedBy,
        trigger: 'task',
        userId: owner,
        workspaceId,
      },
      {
        agentId: 'agent-public',
        id: 'run-public',
        metadata: openedBy,
        trigger: 'task',
        userId: owner,
        workspaceId,
      },
    ]);
    await serverDB.insert(tasks).values([
      {
        createdByUserId: owner,
        id: 'task-private',
        identifier: 'T-1',
        instruction: 'private work',
        seq: 1,
        visibility: 'private',
        workspaceId,
      },
      {
        createdByUserId: owner,
        id: 'task-public',
        identifier: 'T-2',
        instruction: 'public work',
        seq: 2,
        workspaceId,
      },
    ] as any);
    await serverDB.insert(taskTopics).values([
      {
        seq: 1,
        taskId: 'task-private',
        topicId: 'run-private',
        userId: owner,
        visibility: 'private',
        workspaceId,
      },
      { seq: 1, taskId: 'task-public', topicId: 'run-public', userId: owner, workspaceId },
    ] as any);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it("hides another member's private task run from the tree, keeps the public one", async () => {
    const rows = await new TopicModel(serverDB, member, workspaceId).listOpenedTopics({
      openerTopicIds: ['parent'],
    });

    expect(rows.map((row) => row.id)).toEqual(['run-public']);
  });

  it("shows the task's creator both runs", async () => {
    const rows = await new TopicModel(serverDB, owner, workspaceId).listOpenedTopics({
      openerTopicIds: ['parent'],
    });

    expect(rows.map((row) => row.id).sort()).toEqual(['run-private', 'run-public']);
  });

  // Regression: `getTopics({ openedByTopicId })` (the CLI's child listing)
  // filtered only by agent, so a member who can use the agent got another
  // member's private task run — id, title and first prompt.
  it("leaves another member's private task run out of the child listing too", async () => {
    const member_ = new TopicModel(serverDB, member, workspaceId);
    const owner_ = new TopicModel(serverDB, owner, workspaceId);

    const asMember = await member_.query({ openedByTopicId: 'parent', withDetails: true });
    expect(asMember.items.map((row: any) => row.id)).toEqual(['run-public']);
    expect(asMember.total).toBe(1);

    const asOwner = await owner_.query({ openedByTopicId: 'parent' });
    expect(asOwner.items.map((row: any) => row.id).sort()).toEqual(['run-private', 'run-public']);
  });
});
