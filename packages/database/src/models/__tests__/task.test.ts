// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, briefs, documents, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-test-user-id';
const userId2 = 'task-test-user-id-2';

const createAgent = async (id: string, uid = userId) => {
  await serverDB.insert(agents).values({ id, slug: id, userId: uid }).onConflictDoNothing();
  return id;
};

const createTopic = async (id: string, uid = userId) => {
  await serverDB.insert(topics).values({ id, userId: uid }).onConflictDoNothing();
  return id;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TaskModel', () => {
  describe('constructor', () => {
    it('should create model with db and userId', () => {
      const model = new TaskModel(serverDB, userId);
      expect(model).toBeInstanceOf(TaskModel);
    });
  });

  describe('create', () => {
    it('should create a task with auto-generated identifier', async () => {
      const model = new TaskModel(serverDB, userId);
      const result = await model.create({
        instruction: 'Write a book about AI agents',
        name: 'Write AI Book',
      });

      expect(result).toBeDefined();
      expect(result.identifier).toBe('T-1');
      expect(result.seq).toBe(1);
      expect(result.name).toBe('Write AI Book');
      expect(result.instruction).toBe('Write a book about AI agents');
      expect(result.status).toBe('backlog');
      expect(result.createdByUserId).toBe(userId);
    });

    it('should auto-increment seq for same user', async () => {
      const model = new TaskModel(serverDB, userId);

      const task1 = await model.create({ instruction: 'Task 1' });
      const task2 = await model.create({ instruction: 'Task 2' });
      const task3 = await model.create({ instruction: 'Task 3' });

      expect(task1.seq).toBe(1);
      expect(task2.seq).toBe(2);
      expect(task3.seq).toBe(3);
      expect(task1.identifier).toBe('T-1');
      expect(task2.identifier).toBe('T-2');
      expect(task3.identifier).toBe('T-3');
    });

    it('should support custom identifier prefix', async () => {
      const model = new TaskModel(serverDB, userId);
      const result = await model.create({
        identifierPrefix: 'PROJ',
        instruction: 'Build WAKE system',
      });

      expect(result.identifier).toBe('PROJ-1');
    });

    it('should create task with all optional fields', async () => {
      const model = new TaskModel(serverDB, userId);
      await createAgent('agent-1');
      const result = await model.create({
        assigneeAgentId: 'agent-1',
        assigneeUserId: userId,
        description: 'A detailed description',
        instruction: 'Do something',
        name: 'Full Task',
        priority: 2,
      });

      expect(result.assigneeAgentId).toBe('agent-1');
      expect(result.assigneeUserId).toBe(userId);
      expect(result.priority).toBe(2);
    });

    it('should create subtask with parentTaskId', async () => {
      const model = new TaskModel(serverDB, userId);
      const parent = await model.create({ instruction: 'Parent task' });
      const child = await model.create({
        instruction: 'Child task',
        parentTaskId: parent.id,
      });

      expect(child.parentTaskId).toBe(parent.id);
    });

    it('should isolate seq between users', async () => {
      const model1 = new TaskModel(serverDB, userId);
      const model2 = new TaskModel(serverDB, userId2);

      const task1 = await model1.create({ instruction: 'User 1 task' });
      const task2 = await model2.create({ instruction: 'User 2 task' });

      expect(task1.seq).toBe(1);
      expect(task2.seq).toBe(1);
    });

    it('should persist createdByAgentId when provided', async () => {
      const model = new TaskModel(serverDB, userId);
      await createAgent('agent-creator');
      const result = await model.create({
        createdByAgentId: 'agent-creator',
        instruction: 'Created via agent tool',
      });

      expect(result.createdByAgentId).toBe('agent-creator');
      expect(result.createdByUserId).toBe(userId);
    });

    it('should default createdByAgentId to null when omitted', async () => {
      const model = new TaskModel(serverDB, userId);
      const result = await model.create({ instruction: 'Created via UI' });

      expect(result.createdByAgentId).toBeNull();
      expect(result.createdByUserId).toBe(userId);
    });

    it('should handle concurrent creates without seq collision', async () => {
      const model = new TaskModel(serverDB, userId);

      // Create 5 tasks concurrently (simulates parallel tool calls)
      const results = await Promise.all([
        model.create({ instruction: 'Concurrent 1' }),
        model.create({ instruction: 'Concurrent 2' }),
        model.create({ instruction: 'Concurrent 3' }),
        model.create({ instruction: 'Concurrent 4' }),
        model.create({ instruction: 'Concurrent 5' }),
      ]);

      // All should succeed with unique seqs
      const seqs = results.map((r) => r.seq);
      const uniqueSeqs = new Set(seqs);
      expect(uniqueSeqs.size).toBe(5);

      // All identifiers should be unique
      const identifiers = results.map((r) => r.identifier);
      const uniqueIdentifiers = new Set(identifiers);
      expect(uniqueIdentifiers.size).toBe(5);
    });
  });

  describe('findById', () => {
    it('should find task by id', async () => {
      const model = new TaskModel(serverDB, userId);
      const created = await model.create({ instruction: 'Test task' });

      const found = await model.findById(created.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it('should not find task owned by another user', async () => {
      const model1 = new TaskModel(serverDB, userId);
      const model2 = new TaskModel(serverDB, userId2);

      const task = await model1.create({ instruction: 'User 1 task' });
      const found = await model2.findById(task.id);
      expect(found).toBeNull();
    });
  });

  describe('findByIdentifier', () => {
    it('should find task by identifier', async () => {
      const model = new TaskModel(serverDB, userId);
      await model.create({ instruction: 'Test task' });

      const found = await model.findByIdentifier('T-1');
      expect(found).toBeDefined();
      expect(found!.identifier).toBe('T-1');
    });
  });

  describe('update', () => {
    it('should update task fields', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Original' });

      const updated = await model.update(task.id, {
        instruction: 'Updated instruction',
        name: 'Updated name',
      });

      expect(updated!.instruction).toBe('Updated instruction');
      expect(updated!.name).toBe('Updated name');
    });

    it('should not update task owned by another user', async () => {
      const model1 = new TaskModel(serverDB, userId);
      const model2 = new TaskModel(serverDB, userId2);

      const task = await model1.create({ instruction: 'User 1 task' });
      const result = await model2.update(task.id, { name: 'Hacked' });
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete task', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'To be deleted' });

      const deleted = await model.delete(task.id);
      expect(deleted).toBe(true);

      const found = await model.findById(task.id);
      expect(found).toBeNull();
    });

    it('should not delete task owned by another user', async () => {
      const model1 = new TaskModel(serverDB, userId);
      const model2 = new TaskModel(serverDB, userId2);

      const task = await model1.create({ instruction: 'User 1 task' });
      const deleted = await model2.delete(task.id);
      expect(deleted).toBe(false);
    });
  });

  describe('list', () => {
    it('should list tasks for user', async () => {
      const model = new TaskModel(serverDB, userId);
      await model.create({ instruction: 'Task 1' });
      await model.create({ instruction: 'Task 2' });

      const { tasks, total } = await model.list();
      expect(total).toBe(2);
      expect(tasks).toHaveLength(2);
    });

    it('should filter by statuses', async () => {
      const model = new TaskModel(serverDB, userId);
      const t1 = await model.create({ instruction: 'Task 1' });
      await model.updateStatus(t1.id, 'running', { startedAt: new Date() });
      const t2 = await model.create({ instruction: 'Task 2' });
      await model.updateStatus(t2.id, 'paused');
      await model.create({ instruction: 'Task 3' }); // backlog

      const { tasks } = await model.list({ statuses: ['running', 'paused'] });
      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.status).sort()).toEqual(['paused', 'running']);
    });

    it('should filter by priorities', async () => {
      const model = new TaskModel(serverDB, userId);
      await model.create({ instruction: 'Urgent task', priority: 1 });
      await model.create({ instruction: 'High task', priority: 2 });
      await model.create({ instruction: 'Low task', priority: 4 });

      const { tasks } = await model.list({ priorities: [1, 2] });
      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.priority).sort()).toEqual([1, 2]);
    });

    it('should filter root tasks only', async () => {
      const model = new TaskModel(serverDB, userId);
      const parent = await model.create({ instruction: 'Parent' });
      await model.create({ instruction: 'Child', parentTaskId: parent.id });

      const { tasks } = await model.list({ parentTaskId: null });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].parentTaskId).toBeNull();
    });

    it('should paginate results', async () => {
      const model = new TaskModel(serverDB, userId);
      for (let i = 0; i < 5; i++) {
        await model.create({ instruction: `Task ${i}` });
      }

      const { tasks, total } = await model.list({ limit: 2, offset: 0 });
      expect(total).toBe(5);
      expect(tasks).toHaveLength(2);
    });
  });

  describe('groupList', () => {
    it('should return grouped tasks by status', async () => {
      const model = new TaskModel(serverDB, userId);

      // Create tasks with different statuses
      const t1 = await model.create({ instruction: 'Backlog task' });
      const t2 = await model.create({ instruction: 'Running task' });
      await model.updateStatus(t2.id, 'running', { startedAt: new Date() });
      const t3 = await model.create({ instruction: 'Paused task' });
      await model.updateStatus(t3.id, 'paused');
      const t4 = await model.create({ instruction: 'Failed task' });
      await model.updateStatus(t4.id, 'failed', { error: 'err' });
      const t5 = await model.create({ instruction: 'Completed task' });
      await model.updateStatus(t5.id, 'completed', { completedAt: new Date() });

      const result = await model.groupList({
        groups: [
          { key: 'backlog', statuses: ['backlog'] },
          { key: 'running', statuses: ['running'] },
          { key: 'needsInput', statuses: ['paused', 'failed'] },
          { key: 'done', statuses: ['completed'] },
        ],
      });

      expect(result).toHaveLength(4);

      const backlog = result.find((g) => g.key === 'backlog')!;
      expect(backlog.total).toBe(1);
      expect(backlog.tasks).toHaveLength(1);
      expect(backlog.hasMore).toBe(false);

      const running = result.find((g) => g.key === 'running')!;
      expect(running.total).toBe(1);
      expect(running.tasks).toHaveLength(1);

      const needsInput = result.find((g) => g.key === 'needsInput')!;
      expect(needsInput.total).toBe(2);
      expect(needsInput.tasks).toHaveLength(2);

      const done = result.find((g) => g.key === 'done')!;
      expect(done.total).toBe(1);
      expect(done.tasks).toHaveLength(1);
    });

    it('should support per-group pagination', async () => {
      const model = new TaskModel(serverDB, userId);

      // Create 3 backlog tasks
      await model.create({ instruction: 'Backlog 1' });
      await model.create({ instruction: 'Backlog 2' });
      await model.create({ instruction: 'Backlog 3' });

      const result = await model.groupList({
        groups: [{ key: 'backlog', limit: 2, offset: 0, statuses: ['backlog'] }],
      });

      const backlog = result[0];
      expect(backlog.total).toBe(3);
      expect(backlog.tasks).toHaveLength(2);
      expect(backlog.hasMore).toBe(true);
      expect(backlog.limit).toBe(2);
      expect(backlog.offset).toBe(0);

      // Fetch next page
      const page2 = await model.groupList({
        groups: [{ key: 'backlog', limit: 2, offset: 2, statuses: ['backlog'] }],
      });

      const backlogP2 = page2[0];
      expect(backlogP2.tasks).toHaveLength(1);
      expect(backlogP2.hasMore).toBe(false);
      expect(backlogP2.offset).toBe(2);
    });

    it('should filter by assigneeAgentId', async () => {
      const agentId = await createAgent('group-list-agent');
      const model = new TaskModel(serverDB, userId);

      await model.create({ assigneeAgentId: agentId, instruction: 'Assigned' });
      await model.create({ instruction: 'Unassigned' });

      const result = await model.groupList({
        assigneeAgentId: agentId,
        groups: [{ key: 'backlog', statuses: ['backlog'] }],
      });

      expect(result[0].total).toBe(1);
      expect(result[0].tasks).toHaveLength(1);
    });
  });

  describe('findSubtasks', () => {
    it('should find direct subtasks', async () => {
      const model = new TaskModel(serverDB, userId);
      const parent = await model.create({ instruction: 'Parent' });
      await model.create({ instruction: 'Child 1', parentTaskId: parent.id });
      await model.create({ instruction: 'Child 2', parentTaskId: parent.id });

      const subtasks = await model.findSubtasks(parent.id);
      expect(subtasks).toHaveLength(2);
    });
  });

  describe('getTaskTree', () => {
    it('should return full task tree recursively', async () => {
      const model = new TaskModel(serverDB, userId);
      const root = await model.create({ instruction: 'Root' });
      const child = await model.create({ instruction: 'Child', parentTaskId: root.id });
      await model.create({ instruction: 'Grandchild', parentTaskId: child.id });

      const tree = await model.getTaskTree(root.id);
      expect(tree).toHaveLength(3);
    });
  });

  describe('updateStatus', () => {
    it('should update status with timestamps', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      const startedAt = new Date();
      const updated = await model.updateStatus(task.id, 'running', { startedAt });
      expect(updated!.status).toBe('running');
      expect(updated!.startedAt).toBeDefined();
    });
  });

  describe('heartbeat', () => {
    it('should update heartbeat timestamp', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      await model.updateHeartbeat(task.id);
      const found = await model.findById(task.id);
      expect(found!.lastHeartbeatAt).toBeDefined();
    });
  });

  describe('dependencies', () => {
    it('should add and query dependencies', async () => {
      const model = new TaskModel(serverDB, userId);
      const taskA = await model.create({ instruction: 'Task A' });
      const taskB = await model.create({ instruction: 'Task B' });

      await model.addDependency(taskB.id, taskA.id);

      const deps = await model.getDependencies(taskB.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].dependsOnId).toBe(taskA.id);
    });

    it('should check all dependencies completed', async () => {
      const model = new TaskModel(serverDB, userId);
      const taskA = await model.create({ instruction: 'Task A' });
      const taskB = await model.create({ instruction: 'Task B' });
      const taskC = await model.create({ instruction: 'Task C' });

      await model.addDependency(taskC.id, taskA.id);
      await model.addDependency(taskC.id, taskB.id);

      // Neither completed
      let allDone = await model.areAllDependenciesCompleted(taskC.id);
      expect(allDone).toBe(false);

      // Complete A only
      await model.updateStatus(taskA.id, 'completed');
      allDone = await model.areAllDependenciesCompleted(taskC.id);
      expect(allDone).toBe(false);

      // Complete B too
      await model.updateStatus(taskB.id, 'completed');
      allDone = await model.areAllDependenciesCompleted(taskC.id);
      expect(allDone).toBe(true);
    });

    it('should remove dependency', async () => {
      const model = new TaskModel(serverDB, userId);
      const taskA = await model.create({ instruction: 'Task A' });
      const taskB = await model.create({ instruction: 'Task B' });

      await model.addDependency(taskB.id, taskA.id);
      await model.removeDependency(taskB.id, taskA.id);

      const deps = await model.getDependencies(taskB.id);
      expect(deps).toHaveLength(0);
    });

    it('should get dependents (reverse lookup)', async () => {
      const model = new TaskModel(serverDB, userId);
      const taskA = await model.create({ instruction: 'Task A' });
      const taskB = await model.create({ instruction: 'Task B' });
      const taskC = await model.create({ instruction: 'Task C' });

      await model.addDependency(taskB.id, taskA.id);
      await model.addDependency(taskC.id, taskA.id);

      const dependents = await model.getDependents(taskA.id);
      expect(dependents).toHaveLength(2);
    });

    it('should find unlocked tasks after dependency completes', async () => {
      const model = new TaskModel(serverDB, userId);
      const taskA = await model.create({ instruction: 'Task A' });
      const taskB = await model.create({ instruction: 'Task B' });
      const taskC = await model.create({ instruction: 'Task C' });

      // C blocks on A and B
      await model.addDependency(taskC.id, taskA.id);
      await model.addDependency(taskC.id, taskB.id);

      // Complete A — C still blocked by B
      await model.updateStatus(taskA.id, 'completed');
      let unlocked = await model.getUnlockedTasks(taskA.id);
      expect(unlocked).toHaveLength(0);

      // Complete B — C now unlocked
      await model.updateStatus(taskB.id, 'completed');
      unlocked = await model.getUnlockedTasks(taskB.id);
      expect(unlocked).toHaveLength(1);
      expect(unlocked[0].id).toBe(taskC.id);
    });

    it('should not unlock tasks that are not in backlog', async () => {
      const model = new TaskModel(serverDB, userId);
      const taskA = await model.create({ instruction: 'Task A' });
      const taskB = await model.create({ instruction: 'Task B' });

      await model.addDependency(taskB.id, taskA.id);
      // Move B to running manually (not backlog)
      await model.updateStatus(taskB.id, 'running', { startedAt: new Date() });

      await model.updateStatus(taskA.id, 'completed');
      const unlocked = await model.getUnlockedTasks(taskA.id);
      expect(unlocked).toHaveLength(0); // B is already running, not unlocked
    });

    it('should check all subtasks completed', async () => {
      const model = new TaskModel(serverDB, userId);
      const parent = await model.create({ instruction: 'Parent' });
      const child1 = await model.create({ instruction: 'Child 1', parentTaskId: parent.id });
      const child2 = await model.create({ instruction: 'Child 2', parentTaskId: parent.id });

      expect(await model.areAllSubtasksCompleted(parent.id)).toBe(false);

      await model.updateStatus(child1.id, 'completed');
      expect(await model.areAllSubtasksCompleted(parent.id)).toBe(false);

      await model.updateStatus(child2.id, 'completed');
      expect(await model.areAllSubtasksCompleted(parent.id)).toBe(true);
    });
  });

  describe('documents', () => {
    it('should pin and get documents', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      // Create a test document
      const [doc] = await serverDB
        .insert(documents)
        .values({
          content: '',
          fileType: 'text/plain',
          source: 'test',
          sourceType: 'file',
          title: 'Test Doc',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
        })
        .returning();

      await model.pinDocument(task.id, doc.id);

      const pinned = await model.getPinnedDocuments(task.id);
      expect(pinned).toHaveLength(1);
      expect(pinned[0].documentId).toBe(doc.id);
    });

    it('should unpin document', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      const [doc] = await serverDB
        .insert(documents)
        .values({
          content: '',
          fileType: 'text/plain',
          source: 'test',
          sourceType: 'file',
          title: 'Test Doc',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
        })
        .returning();

      await model.pinDocument(task.id, doc.id);
      await model.unpinDocument(task.id, doc.id);

      const pinned = await model.getPinnedDocuments(task.id);
      expect(pinned).toHaveLength(0);
    });

    it('should not duplicate pin', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      const [doc] = await serverDB
        .insert(documents)
        .values({
          content: '',
          fileType: 'text/plain',
          source: 'test',
          sourceType: 'file',
          title: 'Test Doc',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
        })
        .returning();

      await model.pinDocument(task.id, doc.id);
      await model.pinDocument(task.id, doc.id); // duplicate

      const pinned = await model.getPinnedDocuments(task.id);
      expect(pinned).toHaveLength(1);
    });
  });

  describe('checkpoint', () => {
    it('should get and update checkpoint config', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      // Initially empty
      const empty = model.getCheckpointConfig(task);
      expect(empty).toEqual({});

      // Set checkpoint
      const updated = await model.updateCheckpointConfig(task.id, {
        onAgentRequest: true,
        tasks: { afterIds: ['T-2'], beforeIds: ['T-3'] },
        topic: { after: true },
      });

      const config = model.getCheckpointConfig(updated!);
      expect(config.onAgentRequest).toBe(true);
      expect(config.topic?.after).toBe(true);
      expect(config.tasks?.beforeIds).toEqual(['T-3']);
      expect(config.tasks?.afterIds).toEqual(['T-2']);
    });

    it('should check shouldPauseBeforeStart', async () => {
      const model = new TaskModel(serverDB, userId);
      const parent = await model.create({ instruction: 'Parent' });

      await model.updateCheckpointConfig(parent.id, {
        tasks: { beforeIds: ['T-5'] },
      });

      const parentUpdated = (await model.findById(parent.id))!;
      expect(model.shouldPauseBeforeStart(parentUpdated, 'T-5')).toBe(true);
      expect(model.shouldPauseBeforeStart(parentUpdated, 'T-6')).toBe(false);
    });

    it('should pause on topic complete by default (no config)', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      // No checkpoint configured → should pause (default behavior)
      expect(model.shouldPauseOnTopicComplete(task)).toBe(true);
    });

    it('should pause on topic complete when topic.after is true', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      await model.updateCheckpointConfig(task.id, {
        topic: { after: true },
      });

      const updated = (await model.findById(task.id))!;
      expect(model.shouldPauseOnTopicComplete(updated)).toBe(true);
    });

    it('should not pause on topic complete when only onAgentRequest is set', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      await model.updateCheckpointConfig(task.id, {
        onAgentRequest: true,
      });

      const updated = (await model.findById(task.id))!;
      // Has explicit config but topic.after is not true → don't auto-pause
      expect(model.shouldPauseOnTopicComplete(updated)).toBe(false);
    });

    it('should not pause on topic complete when topic.after is false', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      await model.updateCheckpointConfig(task.id, {
        topic: { after: false },
      });

      const updated = (await model.findById(task.id))!;
      expect(model.shouldPauseOnTopicComplete(updated)).toBe(false);
    });

    it('should check shouldPauseAfterComplete', async () => {
      const model = new TaskModel(serverDB, userId);
      const parent = await model.create({ instruction: 'Parent' });

      await model.updateCheckpointConfig(parent.id, {
        tasks: { afterIds: ['T-2', 'T-3'] },
      });

      const parentUpdated = (await model.findById(parent.id))!;
      expect(model.shouldPauseAfterComplete(parentUpdated, 'T-2')).toBe(true);
      expect(model.shouldPauseAfterComplete(parentUpdated, 'T-3')).toBe(true);
      expect(model.shouldPauseAfterComplete(parentUpdated, 'T-4')).toBe(false);
    });
  });

  describe('updateTaskConfig', () => {
    it('should merge partial config into empty config', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      const updated = await model.updateTaskConfig(task.id, { model: 'gpt-4', provider: 'openai' });
      expect(updated).not.toBeNull();
      expect((updated!.config as Record<string, unknown>).model).toBe('gpt-4');
      expect((updated!.config as Record<string, unknown>).provider).toBe('openai');
    });

    it('should deep merge into existing config', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      // Set initial config with checkpoint
      await model.updateTaskConfig(task.id, {
        checkpoint: { onAgentRequest: true, topic: { after: true } },
      });

      // Merge review config — checkpoint should be preserved
      const updated = await model.updateTaskConfig(task.id, {
        review: { enabled: true },
      });

      const config = updated!.config as Record<string, any>;
      expect(config.checkpoint).toEqual({ onAgentRequest: true, topic: { after: true } });
      expect(config.review).toEqual({ enabled: true });
    });

    it('should deep merge nested fields within a config key', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      // Set initial checkpoint config
      await model.updateTaskConfig(task.id, {
        checkpoint: { onAgentRequest: true, topic: { after: true } },
      });

      // Update checkpoint with additional nested field — deep merge should preserve existing fields
      const updated = await model.updateTaskConfig(task.id, {
        checkpoint: { topic: { before: true } },
      });

      const config = updated!.config as Record<string, any>;
      expect(config.checkpoint.onAgentRequest).toBe(true);
      expect(config.checkpoint.topic.after).toBe(true);
      expect(config.checkpoint.topic.before).toBe(true);
    });

    it('should return null for non-existent task', async () => {
      const model = new TaskModel(serverDB, userId);
      const result = await model.updateTaskConfig('non-existent-id', { model: 'gpt-4' });
      expect(result).toBeNull();
    });

    it('should work with updateCheckpointConfig delegating to updateTaskConfig', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      // Set some initial non-checkpoint config
      await model.updateTaskConfig(task.id, { model: 'gpt-4' });

      // Use updateCheckpointConfig — should preserve other config keys
      await model.updateCheckpointConfig(task.id, { onAgentRequest: true });

      const updated = (await model.findById(task.id))!;
      const config = updated.config as Record<string, any>;
      expect(config.model).toBe('gpt-4');
      expect(config.checkpoint).toEqual({ onAgentRequest: true });
    });

    it('should work with updateReviewConfig delegating to updateTaskConfig', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      // Set some initial non-review config
      await model.updateTaskConfig(task.id, { provider: 'anthropic' });

      // Use updateReviewConfig — should preserve other config keys
      await model.updateReviewConfig(task.id, { enabled: true, maxIterations: 3 });

      const updated = (await model.findById(task.id))!;
      const config = updated.config as Record<string, any>;
      expect(config.provider).toBe('anthropic');
      expect(config.review).toEqual({ enabled: true, maxIterations: 3 });
    });
  });

  describe('topic management', () => {
    it('should increment topic count', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      await model.incrementTopicCount(task.id);
      await model.incrementTopicCount(task.id);

      const found = await model.findById(task.id);
      expect(found!.totalTopics).toBe(2);
    });

    it('should update current topic', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });
      await createTopic('topic-123');

      await model.updateCurrentTopic(task.id, 'topic-123');

      const found = await model.findById(task.id);
      expect(found!.currentTopicId).toBe('topic-123');
    });
  });

  describe('deleteAll', () => {
    it('should delete all tasks for user', async () => {
      const model = new TaskModel(serverDB, userId);
      await model.create({ instruction: 'Task 1' });
      await model.create({ instruction: 'Task 2' });
      await model.create({ instruction: 'Task 3' });

      const count = await model.deleteAll();
      expect(count).toBe(3);

      const { total } = await model.list();
      expect(total).toBe(0);
    });

    it('should not delete tasks of other users', async () => {
      const model1 = new TaskModel(serverDB, userId);
      const model2 = new TaskModel(serverDB, userId2);

      await model1.create({ instruction: 'User 1 task' });
      await model2.create({ instruction: 'User 2 task' });

      await model1.deleteAll();

      const { total: total1 } = await model1.list();
      const { total: total2 } = await model2.list();
      expect(total1).toBe(0);
      expect(total2).toBe(1);
    });
  });

  describe('getDependenciesByTaskIds', () => {
    it('should get dependencies for multiple tasks', async () => {
      const model = new TaskModel(serverDB, userId);
      const taskA = await model.create({ instruction: 'A' });
      const taskB = await model.create({ instruction: 'B' });
      const taskC = await model.create({ instruction: 'C' });

      await model.addDependency(taskB.id, taskA.id);
      await model.addDependency(taskC.id, taskB.id);

      const deps = await model.getDependenciesByTaskIds([taskB.id, taskC.id]);
      expect(deps).toHaveLength(2);
    });

    it('should return empty for empty input', async () => {
      const model = new TaskModel(serverDB, userId);
      const deps = await model.getDependenciesByTaskIds([]);
      expect(deps).toHaveLength(0);
    });
  });

  describe('comments', () => {
    it('should add and get comments', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      await model.addComment({
        authorUserId: userId,
        content: 'First comment',
        taskId: task.id,
        userId,
      });
      await model.addComment({
        authorUserId: userId,
        content: 'Second comment',
        taskId: task.id,
        userId,
      });

      const comments = await model.getComments(task.id);
      expect(comments).toHaveLength(2);
      expect(comments[0].content).toBe('First comment');
      expect(comments[1].content).toBe('Second comment');
    });

    it('should add comment with briefId and topicId', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });
      await createTopic('tpc_abc');
      const [brief] = await serverDB
        .insert(briefs)
        .values({ id: 'brf_test1', summary: 'test', title: 'test', type: 'decision', userId })
        .returning();

      const comment = await model.addComment({
        authorUserId: userId,
        briefId: brief.id,
        content: 'Reply to brief',
        taskId: task.id,
        topicId: 'tpc_abc',
        userId,
      });

      expect(comment.briefId).toBe(brief.id);
      expect(comment.topicId).toBe('tpc_abc');
    });

    it('should add comment from agent', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });
      await createAgent('agt_xxx');

      const comment = await model.addComment({
        authorAgentId: 'agt_xxx',
        content: 'Agent observation',
        taskId: task.id,
        userId,
      });

      expect(comment.authorAgentId).toBe('agt_xxx');
      expect(comment.authorUserId).toBeNull();
    });

    it('should delete own comment', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      const comment = await model.addComment({
        authorUserId: userId,
        content: 'To be deleted',
        taskId: task.id,
        userId,
      });

      const deleted = await model.deleteComment(comment.id);
      expect(deleted).toBe(true);

      const comments = await model.getComments(task.id);
      expect(comments).toHaveLength(0);
    });

    it('should not delete comment from another user', async () => {
      const model1 = new TaskModel(serverDB, userId);
      const model2 = new TaskModel(serverDB, userId2);
      const task = await model1.create({ instruction: 'Test' });

      const comment = await model1.addComment({
        authorUserId: userId,
        content: 'User 1 comment',
        taskId: task.id,
        userId,
      });

      const deleted = await model2.deleteComment(comment.id);
      expect(deleted).toBe(false);
    });

    it('should return comments ordered by createdAt', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({ instruction: 'Test' });

      await model.addComment({ authorUserId: userId, content: 'First', taskId: task.id, userId });
      await model.addComment({ authorUserId: userId, content: 'Second', taskId: task.id, userId });
      await model.addComment({ authorUserId: userId, content: 'Third', taskId: task.id, userId });

      const comments = await model.getComments(task.id);
      expect(comments).toHaveLength(3);
      expect(comments[0].content).toBe('First');
      expect(comments[2].content).toBe('Third');
    });
  });

  describe('review rubrics', () => {
    it('should store EvalBenchmarkRubric format in config', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await model.create({
        config: {
          review: {
            enabled: true,
            maxIterations: 3,
            rubrics: [
              {
                config: { criteria: '技术概念是否准确' },
                id: 'r1',
                name: '内容准确性',
                threshold: 0.8,
                type: 'llm-rubric',
                weight: 1,
              },
              {
                config: { value: '```' },
                id: 'r2',
                name: '包含代码示例',
                type: 'contains',
                weight: 1,
              },
            ],
          },
        },
        instruction: 'Test with rubrics',
      });

      const review = model.getReviewConfig(task);
      expect(review).toBeDefined();
      expect(review!.enabled).toBe(true);
      expect(review!.rubrics).toHaveLength(2);
      expect(review!.rubrics[0].type).toBe('llm-rubric');
      expect(review!.rubrics[0].threshold).toBe(0.8);
      expect(review!.rubrics[1].type).toBe('contains');
      expect(review!.rubrics[1].config.value).toBe('```');
    });

    it('should inherit rubrics from parent when creating subtask', async () => {
      const model = new TaskModel(serverDB, userId);
      const rubrics = [
        {
          config: { criteria: '准确性检查' },
          id: 'r1',
          name: '准确性',
          threshold: 0.8,
          type: 'llm-rubric',
          weight: 1,
        },
      ];

      const parent = await model.create({
        config: { review: { enabled: true, rubrics } },
        instruction: 'Parent with rubrics',
      });

      const parentConfig = parent.config as Record<string, any>;
      const child = await model.create({
        config: parentConfig?.review ? { review: parentConfig.review } : undefined,
        instruction: 'Child task',
        parentTaskId: parent.id,
      });

      const childReview = model.getReviewConfig(child);
      expect(childReview).toBeDefined();
      expect(childReview!.rubrics).toHaveLength(1);
      expect(childReview!.rubrics[0].type).toBe('llm-rubric');
    });
  });
});
