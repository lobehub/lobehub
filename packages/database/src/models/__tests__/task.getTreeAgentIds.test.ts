// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'tree-agent-test-user-id';
const userId2 = 'tree-agent-test-user-id-2';

const createAgent = async (id: string, uid = userId) => {
  await serverDB.insert(agents).values({ id, slug: id, userId: uid }).onConflictDoNothing();
  return id;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TaskModel.getTreeAgentIdsForTaskIds', () => {
  it('should return empty object for empty input', async () => {
    const model = new TaskModel(serverDB, userId);
    const result = await model.getTreeAgentIdsForTaskIds([]);
    expect(result).toEqual({});
  });

  it('should return empty object when task has no agents', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'No agents task' });

    const result = await model.getTreeAgentIdsForTaskIds([task.id]);
    expect(result).toEqual({});
  });

  it('should collect assignee agent from a single task', async () => {
    const agentId = await createAgent('agent-assignee-1');
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({
      assigneeAgentId: agentId,
      instruction: 'Single task',
    });

    const result = await model.getTreeAgentIdsForTaskIds([task.id]);
    expect(result[task.id]).toEqual([agentId]);
  });

  it('should collect creator agent from a single task', async () => {
    const agentId = await createAgent('agent-creator-1');
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({
      createdByAgentId: agentId,
      instruction: 'Created by agent',
    });

    const result = await model.getTreeAgentIdsForTaskIds([task.id]);
    expect(result[task.id]).toEqual([agentId]);
  });

  it('should collect both assignee and creator agents', async () => {
    const assigneeId = await createAgent('agent-both-assignee');
    const creatorId = await createAgent('agent-both-creator');
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({
      assigneeAgentId: assigneeId,
      createdByAgentId: creatorId,
      instruction: 'Both agents',
    });

    const result = await model.getTreeAgentIdsForTaskIds([task.id]);
    expect(result[task.id]).toHaveLength(2);
    expect(result[task.id]).toContain(assigneeId);
    expect(result[task.id]).toContain(creatorId);
  });

  it('should collect agents from full task tree (child input → root → all descendants)', async () => {
    const agentA = await createAgent('agent-tree-a');
    const agentB = await createAgent('agent-tree-b');
    const agentC = await createAgent('agent-tree-c');
    const model = new TaskModel(serverDB, userId);

    const root = await model.create({
      assigneeAgentId: agentA,
      instruction: 'Root',
    });
    const child = await model.create({
      assigneeAgentId: agentB,
      instruction: 'Child',
      parentTaskId: root.id,
    });
    await model.create({
      assigneeAgentId: agentC,
      instruction: 'Grandchild',
      parentTaskId: child.id,
    });

    // Query from child — should walk UP to root, then DOWN to get all agents
    const result = await model.getTreeAgentIdsForTaskIds([child.id]);
    expect(result[child.id]).toHaveLength(3);
    expect(result[child.id]).toContain(agentA);
    expect(result[child.id]).toContain(agentB);
    expect(result[child.id]).toContain(agentC);
  });

  it('should deduplicate agents across tree', async () => {
    const agentId = await createAgent('agent-dedup');
    const model = new TaskModel(serverDB, userId);

    const root = await model.create({
      assigneeAgentId: agentId,
      instruction: 'Root',
    });
    await model.create({
      assigneeAgentId: agentId,
      instruction: 'Child with same agent',
      parentTaskId: root.id,
    });

    const result = await model.getTreeAgentIdsForTaskIds([root.id]);
    expect(result[root.id]).toEqual([agentId]);
  });

  it('should handle multiple task IDs from different trees', async () => {
    const agentA = await createAgent('agent-multi-a');
    const agentB = await createAgent('agent-multi-b');
    const model = new TaskModel(serverDB, userId);

    const tree1Root = await model.create({
      assigneeAgentId: agentA,
      instruction: 'Tree 1',
    });
    const tree2Root = await model.create({
      assigneeAgentId: agentB,
      instruction: 'Tree 2',
    });

    const result = await model.getTreeAgentIdsForTaskIds([tree1Root.id, tree2Root.id]);
    expect(result[tree1Root.id]).toEqual([agentA]);
    expect(result[tree2Root.id]).toEqual([agentB]);
  });

  it('should not return agents from tasks owned by another user', async () => {
    const agentId = await createAgent('agent-isolation', userId2);
    const model1 = new TaskModel(serverDB, userId);
    const model2 = new TaskModel(serverDB, userId2);

    const task = await model2.create({
      assigneeAgentId: agentId,
      instruction: 'User 2 task',
    });

    // User 1 should not see user 2's task tree agents
    const result = await model1.getTreeAgentIdsForTaskIds([task.id]);
    expect(result).toEqual({});
  });
});
