// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import * as taskModule from '../task';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-surface-user';
const userId2 = 'task-surface-user-2';
const workspaceId = 'task-surface-ws';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

const createWorkspace = () =>
  serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: workspaceId })
    .onConflictDoNothing();

/**
 * Pins the public surface of `TaskModel` so a split into helper modules keeps
 * every caller-visible name, and keeps instance methods on the prototype
 * (server tests `vi.spyOn(TaskModel.prototype, …)`).
 */
describe('TaskModel public surface', () => {
  it('keeps the module exports', () => {
    expect(Object.keys(taskModule).sort()).toEqual([
      'TaskModel',
      'isTaskIdentifierUniqueViolation',
      'taskActivityActor',
    ]);
  });

  it('keeps every instance method on the prototype', () => {
    const publicMethods = [
      'addActivities',
      'addActivity',
      'addComment',
      'addDependency',
      'areAllDependenciesCompleted',
      'areAllSubtasksCompleted',
      'batchUpdateStatus',
      'copyToWorkspace',
      'countTasksBlockingAgentDemotion',
      'create',
      'delete',
      'deleteAll',
      'deleteComment',
      'deleteIfStatus',
      'deleteByIds',
      'findAllDescendants',
      'findAssigneesByIds',
      'findById',
      'findByIds',
      'findCommentById',
      'findSubtasks',
      'getActivities',
      'getCheckpointConfig',
      'getComments',
      'getDependencies',
      'getDependenciesByTaskIds',
      'getDependents',
      'getDocumentsPinnedSince',
      'getPinnedDocuments',
      'getReviewConfig',
      'getTaskTree',
      'getTreeAgentIdsForTaskIds',
      'getTreePinnedDocuments',
      'getUnlockedTasks',
      'getUnlockedTasksForMany',
      'getVerifyConfig',
      'groupList',
      'incrementTopicCount',
      'list',
      'lockForStatusChange',
      'lockForUpdate',
      'pinDocument',
      'removeDependency',
      'reorder',
      'resolve',
      'resolveRefs',
      'resolveVerifyConfig',
      'shouldPauseAfterComplete',
      'shouldPauseBeforeStart',
      'setSubtreeVisibility',
      'shouldPauseOnTopicComplete',
      'subtreeHasForeignRows',
      'subtreeHasOtherCreators',
      'transferTo',
      'unpinDocument',
      'updateCheckpointConfig',
      'updateComment',
      'updateContext',
      'updateCurrentTopic',
      'updateHeartbeat',
      'updateReviewConfig',
      'updateStatus',
      'updateStatusForIds',
      'updateStatusIfCurrent',
      'updateTaskConfig',
      'updateVerifyConfig',
      'updateWithLog',
      'update',
    ];
    const proto = TaskModel.prototype as unknown as Record<string, unknown>;
    const missing = publicMethods.filter(
      (name) => !Object.hasOwn(proto, name) || typeof proto[name] !== 'function',
    );

    expect(missing).toEqual([]);
  });

  it('keeps the static methods', () => {
    expect(
      [
        'findOrphanedRunningTopics',
        'findStuckTasks',
        'getScheduledTasks',
        'swapDispatchedScheduleOccurrence',
      ]
        .map((name) => typeof (TaskModel as unknown as Record<string, unknown>)[name])
        .every((type) => type === 'function'),
    ).toBe(true);
  });
});

// Methods with no other direct test before the split.
describe('TaskModel previously uncovered reads', () => {
  it('findCommentById returns only comments in scope', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'commented' });
    const comment = await model.addComment({ content: 'hi', taskId: task.id, userId });

    expect((await model.findCommentById(comment.id))?.content).toBe('hi');
    expect(await new TaskModel(serverDB, userId2).findCommentById(comment.id)).toBeUndefined();
    expect(await model.findCommentById('missing')).toBeUndefined();
  });

  it('lockForUpdate reports whether the task is visible', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'lock' });

    expect(await model.lockForUpdate(task.id)).toBe(true);
    expect(await new TaskModel(serverDB, userId2).lockForUpdate(task.id)).toBe(false);
  });

  it('subtreeHasForeignRows detects a teammate subtask', async () => {
    await createWorkspace();
    const owner = new TaskModel(serverDB, userId, workspaceId);
    const member = new TaskModel(serverDB, userId2, workspaceId);
    const root = await owner.create({ instruction: 'root', visibility: 'public' });
    await owner.create({ instruction: 'own child', parentTaskId: root.id, visibility: 'public' });

    expect(await owner.subtreeHasForeignRows(root.id)).toBe(false);

    await member.create({
      instruction: 'member child',
      parentTaskId: root.id,
      visibility: 'public',
    });
    expect(await owner.subtreeHasForeignRows(root.id)).toBe(true);
    expect(await owner.subtreeHasForeignRows('missing')).toBe(false);
  });
});
