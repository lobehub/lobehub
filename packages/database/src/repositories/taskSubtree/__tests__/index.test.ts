// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { TaskModel } from '../../../models/task';
import { TaskTopicModel } from '../../../models/taskTopic';
import { WorkModel } from '../../../models/work';
import { acceptances, documents, topics, users, works, workspaces } from '../../../schemas';
import { taskTopics } from '../../../schemas/task';
import type { LobeChatDatabase } from '../../../type';
import { TaskSubtreeRepository } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-subtree-repo-user';
const userId2 = 'task-subtree-repo-user-2';
const userId3 = 'task-subtree-repo-user-3';

const subtreeRepo = (uid: string, workspaceId?: string) =>
  new TaskSubtreeRepository(serverDB, uid, workspaceId);

const createTopic = async (id: string, uid = userId) => {
  await serverDB.insert(topics).values({ id, userId: uid }).onConflictDoNothing();
  return id;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }, { id: userId3 }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TaskSubtreeRepository', () => {
  describe('deleteSubtree', () => {
    it('should delete the root and all descendants without leaving orphan tasks', async () => {
      const model = new TaskModel(serverDB, userId);
      const root = await model.create({ instruction: 'Root goal' });
      const child = await model.create({ instruction: 'Child', parentTaskId: root.id });
      const grandchild = await model.create({ instruction: 'Grandchild', parentTaskId: child.id });
      await serverDB.insert(acceptances).values({
        subjectId: grandchild.id,
        subjectType: 'task',
        userId,
      });

      await expect(subtreeRepo(userId).deleteSubtree(root.id)).resolves.toBe(3);
      await expect(model.findAllDescendants(root.id)).resolves.toEqual([]);
      await expect(model.findById(root.id)).resolves.toBeNull();
      const remainingAcceptances = await serverDB
        .select()
        .from(acceptances)
        .where(eq(acceptances.subjectId, grandchild.id));
      expect(remainingAcceptances).toEqual([]);
    });
  });

  describe('updateVisibility', () => {
    const wsId = 'task-subtree-visibility-ws';

    beforeEach(async () => {
      await serverDB
        .insert(workspaces)
        .values({
          id: wsId,
          name: 'Visibility WS',
          primaryOwnerId: userId,
          slug: wsId,
        })
        .onConflictDoNothing();
    });

    it('should cascade updateVisibility to descendants and child tables', async () => {
      const alice = new TaskModel(serverDB, userId, wsId);
      const bob = new TaskModel(serverDB, userId2, wsId);

      const root = await alice.create({
        instruction: 'Root',
        visibility: 'private',
      });
      const child = await alice.create({
        instruction: 'Child',
        parentTaskId: root.id,
        visibility: 'private',
      });
      await alice.addDependency(root.id, child.id, 'blocks');

      // Sanity check: Bob can't see the private subtree
      expect((await bob.list()).total).toBe(0);

      const promoted = await subtreeRepo(userId, wsId).updateVisibility(root.id, 'public');
      expect(promoted?.visibility).toBe('public');

      const aliceChild = await alice.findById(child.id);
      expect(aliceChild?.visibility).toBe('public');

      // Bob now sees both
      const bobList = await bob.list();
      expect(bobList.tasks.map((t) => t.id).sort()).toEqual([root.id, child.id].sort());

      // Dependency row also flipped to public
      const deps = await alice.getDependencies(root.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].visibility).toBe('public');
    });

    it('should reject updateVisibility for tasks not visible to the caller', async () => {
      const alice = new TaskModel(serverDB, userId, wsId);
      const bob = subtreeRepo(userId2, wsId);

      const aliceTask = await alice.create({
        instruction: 'Alice secret',
        visibility: 'private',
      });

      const result = await bob.updateVisibility(aliceTask.id, 'public');
      expect(result).toBeNull();
      const reload = await alice.findById(aliceTask.id);
      expect(reload?.visibility).toBe('private');
    });

    it('should return the row when demoting another member’s public task to private', async () => {
      // Regression: the post-update SELECT used to filter by `ownership()`,
      // which evaluates against the new row state. Bob (acting as workspace
      // owner after the TRPC-layer override) demoting Alice's public task to
      // private would write the row but then fail to read it back (new state:
      // visibility=private, createdBy=Alice), so the model returned null and
      // the TRPC procedure surfaced a spurious NOT_FOUND while the DB row had
      // actually been mutated.
      const alice = new TaskModel(serverDB, userId, wsId);
      const bob = subtreeRepo(userId2, wsId);

      const aliceTask = await alice.create({
        instruction: 'Alice public',
        visibility: 'public',
      });

      const result = await bob.updateVisibility(aliceTask.id, 'private');
      expect(result).not.toBeNull();
      expect(result?.visibility).toBe('private');
      expect(result?.createdByUserId).toBe(userId);

      // DB state matches the returned row (no silent mutation drift).
      const reload = await alice.findById(aliceTask.id);
      expect(reload?.visibility).toBe('private');
    });

    it('should unassign other members across the subtree when demoting to private', async () => {
      // A private task is creator-only: a member assignee could no longer open
      // it, so demotion clears them. The creator's own assignment stays.
      const alice = new TaskModel(serverDB, userId, wsId);

      const root = await alice.create({
        assigneeUserId: userId2,
        instruction: 'Root assigned to Bob',
        visibility: 'public',
      });
      const childForBob = await alice.create({
        assigneeUserId: userId2,
        instruction: 'Child assigned to Bob',
        parentTaskId: root.id,
        visibility: 'public',
      });
      const childForAlice = await alice.create({
        assigneeUserId: userId,
        instruction: 'Child assigned to Alice',
        parentTaskId: root.id,
        visibility: 'public',
      });

      const demoted = await subtreeRepo(userId, wsId).updateVisibility(root.id, 'private');
      expect(demoted?.assigneeUserId).toBeNull();

      expect((await alice.findById(childForBob.id))?.assigneeUserId).toBeNull();
      expect((await alice.findById(childForAlice.id))?.assigneeUserId).toBe(userId);
    });

    it('should hand the subtree to the caller when taking it over as private', async () => {
      const alice = new TaskModel(serverDB, userId, wsId);
      const bob = new TaskModel(serverDB, userId2, wsId);

      const root = await alice.create({
        automationMode: 'schedule',
        instruction: 'Alice root',
        schedulePattern: '0 9 * * *',
        visibility: 'public',
      });
      await alice.update(root.id, { status: 'scheduled' });
      const child = await alice.create({ instruction: 'Alice child', parentTaskId: root.id });
      await alice.addComment({
        authorUserId: userId,
        content: 'alice context',
        taskId: root.id,
        userId,
      });

      const taken = await subtreeRepo(userId2, wsId).updateVisibility(root.id, 'private', {
        takeOwnership: true,
      });
      expect(taken).toMatchObject({
        automationMode: null,
        createdByUserId: userId2,
        status: 'paused',
        visibility: 'private',
      });
      expect((await bob.findById(child.id))?.createdByUserId).toBe(userId2);

      // Bob keeps Alice's comment (author unchanged); Alice loses the task.
      const comments = await bob.getComments(root.id);
      expect(comments.map((c) => [c.content, c.authorUserId])).toEqual([['alice context', userId]]);
      expect(await alice.findById(root.id)).toBeNull();
    });

    it('should refuse a takeover that would leave the creator’s private subtasks behind', async () => {
      const alice = new TaskModel(serverDB, userId, wsId);
      const root = await alice.create({ instruction: 'Public root', visibility: 'public' });
      await alice.create({
        instruction: 'Alice private child',
        parentTaskId: root.id,
        visibility: 'private',
      });

      await expect(
        subtreeRepo(userId2, wsId).updateVisibility(root.id, 'private', { takeOwnership: true }),
      ).rejects.toThrow('private subtasks you cannot see');
      expect(await alice.findById(root.id)).toMatchObject({
        createdByUserId: userId,
        visibility: 'public',
      });
    });

    it('should refuse a takeover while a subtask is running', async () => {
      const alice = new TaskModel(serverDB, userId, wsId);
      const root = await alice.create({ instruction: 'Public root', visibility: 'public' });
      const child = await alice.create({ instruction: 'Busy child', parentTaskId: root.id });
      await alice.update(child.id, { status: 'running' });

      await expect(
        subtreeRepo(userId2, wsId).updateVisibility(root.id, 'private', { takeOwnership: true }),
      ).rejects.toThrow('while it or a subtask is running');
      expect((await alice.findById(root.id))?.createdByUserId).toBe(userId);
    });

    it('should move the task’s Work to the member taking it over', async () => {
      const alice = new TaskModel(serverDB, userId, wsId);
      const root = await alice.create({ instruction: 'Registered task', visibility: 'public' });
      const work = await new WorkModel(serverDB, userId, wsId).registerTask({
        changeType: 'created',
        taskId: root.id,
        toolIdentifier: 'lobe-task',
        toolName: 'createTask',
      });
      expect(work?.userId).toBe(userId);

      await subtreeRepo(userId2, wsId).updateVisibility(root.id, 'private', {
        takeOwnership: true,
      });

      const [row] = await serverDB
        .select({ userId: works.userId, visibility: works.visibility })
        .from(works)
        .where(eq(works.resourceId, root.id));
      expect(row).toEqual({ userId: userId2, visibility: 'private' });
    });

    it('should keep member assignees when promoting to public', async () => {
      const alice = new TaskModel(serverDB, userId, wsId);
      const task = await alice.create({ instruction: 'Private', visibility: 'private' });
      await alice.update(task.id, { assigneeUserId: userId2 });

      const promoted = await subtreeRepo(userId, wsId).updateVisibility(task.id, 'public');
      expect(promoted?.assigneeUserId).toBe(userId2);
    });

    it('should NOT cascade updateVisibility into historical task_comments', async () => {
      // Comments are event-shaped historical rows whose visibility is fixed at
      // write time. Promoting the parent task to public must not retroactively
      // expose discussions that took place while the task was private — that
      // would let other workspace members read messages the commenter intended
      // for the private context. Comments written *after* promotion inherit
      // 'public' through their own create path and surface normally.
      const alice = new TaskModel(serverDB, userId, wsId);
      const bob = new TaskModel(serverDB, userId2, wsId);

      const task = await alice.create({
        instruction: 'will be promoted',
        visibility: 'private',
      });
      await alice.addComment({
        authorUserId: userId,
        content: 'private-era thoughts',
        taskId: task.id,
        userId,
      });

      // Bob can't see the private task or its comments
      expect(await bob.getComments(task.id)).toHaveLength(0);

      await subtreeRepo(userId, wsId).updateVisibility(task.id, 'public');

      // Task is public now (Bob sees it), but the historical comment stays
      // hidden — its row still has visibility='private'.
      expect((await bob.list()).tasks.map((t) => t.id)).toContain(task.id);
      expect(await bob.getComments(task.id)).toHaveLength(0);
      // Owner (Alice) of course still sees her own comment.
      expect(await alice.getComments(task.id)).toHaveLength(1);

      // A new comment written after promotion inherits 'public' and is
      // visible to Bob — the non-cascade only protects the past, not the
      // future.
      await alice.addComment({
        authorUserId: userId,
        content: 'post-promotion ping',
        taskId: task.id,
        userId,
      });
      expect(await bob.getComments(task.id)).toHaveLength(1);
    });

    it('should NOT cascade updateVisibility into historical task_topics', async () => {
      // Same rationale as comments: a task_topics row records one run of the
      // task. Its visibility is fixed at write time; promoting the task to
      // public must not retroactively expose runs (transcripts, handoffs,
      // review scores) created while the task was private.
      const alice = new TaskModel(serverDB, userId, wsId);

      const task = await alice.create({
        instruction: 'will be promoted',
        visibility: 'private',
      });

      // Seed a historical run row directly — no model API for taskTopics
      // outside the runtime path, and inserting raw is precise enough for
      // asserting the non-cascade invariant.
      const historicalTopicId = await createTopic('historical-run-topic-id');
      await serverDB.insert(taskTopics).values({
        seq: 1,
        status: 'completed',
        taskId: task.id,
        topicId: historicalTopicId,
        userId,
        visibility: 'private',
        workspaceId: wsId,
      });

      await subtreeRepo(userId, wsId).updateVisibility(task.id, 'public');

      // Task itself is public now.
      expect((await alice.findById(task.id))?.visibility).toBe('public');

      // But the historical run row keeps its private visibility — it was
      // recorded during the private phase and stays there.
      const [historical] = await serverDB
        .select({ visibility: taskTopics.visibility })
        .from(taskTopics)
        .where(eq(taskTopics.taskId, task.id));
      expect(historical.visibility).toBe('private');
    });

    it('should keep other members’ comments, runs and activity visible to the creator after demotion', async () => {
      // Bob commented on and ran Alice's public task. Demotion pulls those
      // rows private with the task; Alice still owns the task and must keep
      // seeing them, while Bob and other members no longer can.
      const alice = new TaskModel(serverDB, userId, wsId);
      const bob = new TaskModel(serverDB, userId2, wsId);
      const carol = new TaskModel(serverDB, userId3, wsId);

      const task = await alice.create({ instruction: 'shared then private', visibility: 'public' });
      await bob.addComment({
        authorUserId: userId2,
        content: 'bob was here',
        taskId: task.id,
        userId: userId2,
      });
      const bobTopicId = await createTopic('bob-run-topic-id', userId2);
      await new TaskTopicModel(serverDB, userId2, wsId).add(task.id, bobTopicId, { seq: 1 });
      await bob.addActivity({
        actorUserId: userId2,
        payload: { fromId: null, toId: userId2 },
        taskId: task.id,
        type: 'assignee_user',
      });
      const [bobDoc] = await serverDB
        .insert(documents)
        .values({
          fileType: 'markdown',
          source: 'test',
          sourceType: 'api',
          title: 'bob notes',
          totalCharCount: 0,
          totalLineCount: 0,
          userId: userId2,
          workspaceId: wsId,
        })
        .returning();
      await bob.pinDocument(task.id, bobDoc.id);

      await subtreeRepo(userId, wsId).updateVisibility(task.id, 'private');

      const aliceComments = await alice.getComments(task.id);
      expect(aliceComments.map((c) => c.content)).toEqual(['bob was here']);
      const aliceTopics = await new TaskTopicModel(serverDB, userId, wsId).findByTaskId(task.id);
      expect(aliceTopics.map((t) => t.topicId)).toEqual([bobTopicId]);
      expect(await alice.getActivities(task.id)).toHaveLength(1);
      expect(Object.keys((await alice.getTreePinnedDocuments(task.id)).nodeMap)).toEqual([
        bobDoc.id,
      ]);

      // Alice can also edit and delete them, as any member could while public.
      await expect(alice.updateComment(aliceComments[0].id, 'edited')).resolves.toBeTruthy();

      // Carol, another member, sees none of it.
      expect(await carol.getComments(task.id)).toHaveLength(0);
      expect(await new TaskTopicModel(serverDB, userId3, wsId).findByTaskId(task.id)).toHaveLength(
        0,
      );
      expect(await carol.getActivities(task.id)).toHaveLength(0);
    });

    it('should keep private-era rows hidden from other members after promotion', async () => {
      const alice = new TaskModel(serverDB, userId, wsId);
      const bob = new TaskModel(serverDB, userId2, wsId);
      const carol = new TaskModel(serverDB, userId3, wsId);

      const task = await alice.create({ instruction: 'round trip', visibility: 'public' });
      await bob.addComment({
        authorUserId: userId2,
        content: 'public-era note from bob',
        taskId: task.id,
        userId: userId2,
      });
      await subtreeRepo(userId, wsId).updateVisibility(task.id, 'private');
      await subtreeRepo(userId, wsId).updateVisibility(task.id, 'public');

      // The creator keeps seeing it; a member who was never let in does not.
      expect(await alice.getComments(task.id)).toHaveLength(1);
      expect(await carol.getComments(task.id)).toHaveLength(0);
    });

    it('should cascade public→private demotion into task_comments and task_topics', async () => {
      // Inverse of the two non-cascade tests above: comment/topic visibility
      // is a write-time mirror of the task used as a JOIN-free authorization
      // proxy. When the task is pulled back to private, public-era rows must
      // follow — otherwise members who saved a comment/topic id while the
      // task was public could keep reading/operating those historical rows.
      const alice = new TaskModel(serverDB, userId, wsId);
      const bob = new TaskModel(serverDB, userId2, wsId);

      const task = await alice.create({
        instruction: 'will be demoted',
        visibility: 'public',
      });
      await alice.addComment({
        authorUserId: userId,
        content: 'public-era comment',
        taskId: task.id,
        userId,
      });

      const publicTopicId = await createTopic('public-era-run-topic-id');
      await serverDB.insert(taskTopics).values({
        seq: 1,
        status: 'completed',
        taskId: task.id,
        topicId: publicTopicId,
        userId,
        visibility: 'public',
        workspaceId: wsId,
      });

      // Sanity: Bob sees the public-era comment while the task is public.
      expect(await bob.getComments(task.id)).toHaveLength(1);

      await subtreeRepo(userId, wsId).updateVisibility(task.id, 'private');

      // Task and both child rows are private now — gone from Bob's scope.
      expect(await bob.findById(task.id)).toBeNull();
      expect(await bob.getComments(task.id)).toHaveLength(0);
      const [demotedTopic] = await serverDB
        .select({ visibility: taskTopics.visibility })
        .from(taskTopics)
        .where(eq(taskTopics.taskId, task.id));
      expect(demotedTopic.visibility).toBe('private');

      // Alice (creator) keeps access to her own rows.
      expect(await alice.getComments(task.id)).toHaveLength(1);
    });

    it('pulls public-era activities back to private when the task is demoted', async () => {
      await serverDB
        .insert(workspaces)
        .values({
          id: 'ws_activity_demote',
          name: 'WS',
          primaryOwnerId: userId,
          slug: 'ws-activity-demote',
        })
        .onConflictDoNothing();
      const model = new TaskModel(serverDB, userId, 'ws_activity_demote');
      const task = await model.create({ instruction: 'Test', visibility: 'public' });

      await model.addActivity({
        actorUserId: userId,
        payload: { fromId: null, toId: userId2 },
        taskId: task.id,
        type: 'assignee_user',
      });

      await subtreeRepo(userId, 'ws_activity_demote').updateVisibility(task.id, 'private');

      const activities = await model.getActivities(task.id);
      expect(activities).toHaveLength(1);
      expect(activities[0].visibility).toBe('private');
    });
  });
});
