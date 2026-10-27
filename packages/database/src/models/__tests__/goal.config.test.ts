// @vitest-environment node
import { GOAL_CLARIFICATION_TITLE } from '@lobechat/const/goal';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  goalNodes,
  projects,
  tasks,
  taskTopics,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { GoalGraphModel } from '../goalGraph';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'goal-config-test-user-id';
const otherUserId = 'goal-config-test-user-2';
const goalModel = new GoalModel(serverDB, userId);
const graphModel = new GoalGraphModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('GoalModel coordinator config', () => {
  describe('config patches', () => {
    it('patches only the task agent id, and clears it again with null', async () => {
      const goal = await goalModel.create({
        config: { acceptance: { criteriaIds: ['c1'] } },
        subjectType: 'standalone',
        title: 'Agent bound',
      });

      const bound = await goalModel.updateTaskAgentId(goal.id, 'task-agent-1');
      expect(bound?.config).toMatchObject({
        acceptance: { criteriaIds: ['c1'] },
        taskAgentId: 'task-agent-1',
      });

      const cleared = await goalModel.updateTaskAgentId(goal.id, null);
      expect(cleared?.config?.taskAgentId).toBeUndefined();
      // The clear is a patch, not a whole-config write: the budget survives.
      expect(cleared?.config).toMatchObject({ acceptance: { criteriaIds: ['c1'] } });

      expect(
        await new GoalModel(serverDB, otherUserId).updateTaskAgentId(goal.id, 'stolen'),
      ).toBeUndefined();
    });

    it('arms a quota retry wake only when it is the earliest one', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Quota wake' });
      const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

      // Nothing armed yet, so the first tick takes it.
      expect(await goalModel.armQuotaRetryWake(goal.id, at(60))).toBe(true);
      // A later tick cannot push the wake already queued further out.
      expect(await goalModel.armQuotaRetryWake(goal.id, at(120))).toBe(false);
      // An earlier one takes over — it fires before the callback already queued.
      expect(await goalModel.armQuotaRetryWake(goal.id, at(30))).toBe(true);
      // A wake already in the past is spent, so the next tick may arm again.
      expect(await goalModel.armQuotaRetryWake(goal.id, at(-10))).toBe(true);
      expect(await goalModel.armQuotaRetryWake(goal.id, at(45))).toBe(true);
      // Another scope never arms it.
      expect(await new GoalModel(serverDB, otherUserId).armQuotaRetryWake(goal.id, at(1))).toBe(
        false,
      );
    });

    it('patches understanding and rollout state without touching the rest of config', async () => {
      const goal = await goalModel.create({
        config: { pausedBy: 'user' },
        subjectType: 'standalone',
        title: 'Coordinator-owned config',
      });
      const understanding = {
        assumptions: ['the repository is public'],
        level: 'medium' as const,
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const rolloutState = {
        batchNodeId: 'batch-1',
        phase: 'probe' as const,
        probeNodeIds: ['probe-1'],
        templateRevision: 1,
        waveIndex: 0,
      };

      await goalModel.updateUnderstanding(goal.id, understanding);
      expect((await goalModel.findById(goal.id))?.config).toMatchObject({
        pausedBy: 'user',
        understanding,
      });

      await goalModel.updateRolloutState(goal.id, rolloutState);
      expect((await goalModel.findById(goal.id))?.config?.rolloutState).toEqual(rolloutState);

      // Passing null clears the batch, and nothing else goes with it.
      await goalModel.updateRolloutState(goal.id, null);
      const cleared = (await goalModel.findById(goal.id))?.config;
      expect(cleared?.rolloutState).toBeUndefined();
      expect(cleared).toMatchObject({ pausedBy: 'user', understanding });
    });

    it('opens a manager policy only when none is set, and closes only its own hand-over', async () => {
      const goal = await goalModel.create({
        config: { pausedBy: 'user' },
        subjectType: 'standalone',
        title: 'Hand-over',
      });

      await goalModel.openManagerPolicy(goal.id, { openedForHandoff: 'handoff-1' });
      expect((await goalModel.findById(goal.id))?.config?.manager).toEqual({
        openedForHandoff: 'handoff-1',
      });

      // A policy already there — the person's, or a newer hand-over's — stays.
      await goalModel.openManagerPolicy(goal.id, { instruction: 'take over' });
      expect((await goalModel.findById(goal.id))?.config?.manager).toEqual({
        openedForHandoff: 'handoff-1',
      });

      // A token that did not open it cannot remove it either.
      await goalModel.closeHandoffManagerPolicy(goal.id, 'handoff-2');
      expect((await goalModel.findById(goal.id))?.config?.manager).toEqual({
        openedForHandoff: 'handoff-1',
      });

      await goalModel.closeHandoffManagerPolicy(goal.id, 'handoff-1');
      const closed = (await goalModel.findById(goal.id))?.config;
      expect(closed?.manager).toBeUndefined();
      expect(closed).toMatchObject({ pausedBy: 'user' });
    });

    it('patches one model slot at a time, and clears only that slot with null', async () => {
      const goal = await goalModel.create({
        config: { acceptance: { criteriaIds: ['c1'] } },
        subjectType: 'standalone',
        title: 'Model slots',
      });

      // No slot named: the planning turn is the default.
      await goalModel.updateModelConfig(goal.id, { model: 'gpt-5', provider: 'openai' });
      let config = (await goalModel.findById(goal.id))?.config;
      expect(config).toMatchObject({ model: 'gpt-5', provider: 'openai' });
      expect(config?.taskModel).toBeUndefined();

      // The Task slot is written beside the planning one, not over it.
      await goalModel.updateModelConfig(
        goal.id,
        { model: 'claude', provider: 'anthropic' },
        'task',
      );
      config = (await goalModel.findById(goal.id))?.config;
      expect(config).toMatchObject({
        model: 'gpt-5',
        provider: 'openai',
        taskModel: 'claude',
        taskProvider: 'anthropic',
      });

      // Clearing the planning slot leaves the Task slot and the budget alone.
      await goalModel.updateModelConfig(goal.id, null);
      config = (await goalModel.findById(goal.id))?.config;
      expect(config?.model).toBeUndefined();
      expect(config?.provider).toBeUndefined();
      expect(config?.taskModel).toBe('claude');
      expect(config).toMatchObject({ acceptance: { criteriaIds: ['c1'] } });

      await goalModel.updateModelConfig(goal.id, null, 'task');
      config = (await goalModel.findById(goal.id))?.config;
      expect(config?.taskModel).toBeUndefined();
      expect(config?.taskProvider).toBeUndefined();
      expect(config).toMatchObject({ acceptance: { criteriaIds: ['c1'] } });

      expect(
        await new GoalModel(serverDB, otherUserId).updateModelConfig(goal.id, {
          model: 'stolen',
          provider: 'stolen',
        }),
      ).toBeUndefined();
    });
  });

  describe('node lookups', () => {
    it('resolves the goal that owns a graph node, inside the owner scope', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Node owner' });
      const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'W1' });

      expect((await goalModel.findByNode(node!.id))?.id).toBe(goal.id);
      expect(await new GoalModel(serverDB, otherUserId).findByNode(node!.id)).toBeUndefined();
      expect(await goalModel.findByNode('00000000-0000-0000-0000-000000000000')).toBeUndefined();
    });
  });

  describe('planning lease gating', () => {
    it('refuses a lease once the graph already has a task', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Decomposed' });
      await graphModel.createNode(goal.id, { kind: 'task', title: 'W1' });

      expect(await goalModel.claimPlanning(goal.id)).toBeUndefined();
    });
  });

  describe('pending gates', () => {
    it('lists the clarification rounds a goal is still waiting on', async () => {
      const waiting = await goalModel.create({ subjectType: 'standalone', title: 'Waiting' });
      const round = await graphModel.createNode(waiting.id, {
        kind: 'decision',
        title: GOAL_CLARIFICATION_TITLE,
      });
      await graphModel.createDecision(waiting.id, round!.id, {
        authority: 'user',
        question: 'which one?',
      });

      // A goal the user paused keeps its open questions without nagging.
      const paused = await goalModel.create({ subjectType: 'standalone', title: 'Paused' });
      const pausedRound = await graphModel.createNode(paused.id, {
        kind: 'decision',
        title: GOAL_CLARIFICATION_TITLE,
      });
      await graphModel.createDecision(paused.id, pausedRound!.id, {
        authority: 'user',
        question: 'still asked?',
      });
      await goalModel.updateStatus(paused.id, 'paused');

      const asks = await goalModel.listPendingClarifications();

      expect(asks.map((row) => row.goalId)).toEqual([waiting.id]);
      expect(asks[0]).toMatchObject({ question: 'which one?' });
    });

    it('lists the gates waiting on a person, and leaves clarification to the form', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Gated' });
      const gate = await graphModel.createNode(goal.id, { kind: 'decision', title: 'Ship it?' });
      await graphModel.createDecision(goal.id, gate!.id, {
        authority: 'user',
        question: 'ship?',
      });
      // The Task the gate was opened for is what the question is about.
      const work = await graphModel.createNode(goal.id, { kind: 'task', title: 'W1' });
      await graphModel.createEdge(goal.id, work!.id, gate!.id, 'leads_to');

      const clarification = await graphModel.createNode(goal.id, {
        kind: 'decision',
        title: GOAL_CLARIFICATION_TITLE,
      });
      await graphModel.createDecision(goal.id, clarification!.id, {
        authority: 'user',
        question: 'asked as one form',
      });

      // The coordinator's own gates are not the person's to answer.
      const agentGate = await graphModel.createNode(goal.id, {
        kind: 'decision',
        title: 'Agent asked',
      });
      await graphModel.createDecision(goal.id, agentGate!.id, {
        authority: 'agent',
        question: 'agent?',
      });

      const rows = await goalModel.listPendingDecisions();

      expect(rows.map((row) => row.nodeTitle)).toEqual(['Ship it?']);
      expect(rows[0]).toMatchObject({ goalId: goal.id, sourceTitle: 'W1' });
    });

    it('hides a gate addressed to somebody else', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Shared goal' });
      const mine = await graphModel.createNode(goal.id, { kind: 'decision', title: 'Mine' });
      await graphModel.createDecision(goal.id, mine!.id, { authority: 'user', question: 'yours?' });
      const theirs = await graphModel.createNode(goal.id, { kind: 'decision', title: 'Theirs' });
      await graphModel.createDecision(goal.id, theirs!.id, {
        authority: 'user',
        question: 'theirs?',
        requestedUserId: otherUserId,
      });

      expect((await goalModel.listPendingDecisions()).map((row) => row.nodeTitle)).toEqual([
        'Mine',
      ]);
    });
  });

  describe('list filters and run roll-up', () => {
    it('scopes the list to a project or to the topic a goal came from', async () => {
      const agentId = 'goal-list-project-agent';
      await serverDB.insert(agents).values({ id: agentId, slug: agentId, userId });
      await serverDB.insert(projects).values({
        coordinatorAgentId: agentId,
        id: 'goal-list-project',
        identifier: 'PRJ',
        name: 'Goal project',
        userId,
      });

      const inProject = await goalModel.create({
        projectId: 'goal-list-project',
        subjectType: 'standalone',
        title: 'In a project',
      });
      const fromTopic = await goalModel.create({
        subjectId: 'goal-list-topic-1',
        subjectType: 'topic',
        title: 'From a topic',
      });
      const loose = await goalModel.create({ subjectType: 'standalone', title: 'Loose' });
      for (const created of [inProject, fromTopic, loose]) {
        await graphModel.createNode(created.id, { kind: 'task', title: 'W1' });
      }

      expect(
        (await goalModel.list({ projectId: 'goal-list-project' })).goals.map((row) => row.goal.id),
      ).toEqual([inProject.id]);
      expect(
        (await goalModel.list({ topicId: 'goal-list-topic-1' })).goals.map((row) => row.goal.id),
      ).toEqual([fromTopic.id]);
    });

    it('rolls up the runs of the tasks the graph dispatched, and pages past the end', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Costly' });
      const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'W1' });
      await serverDB.insert(tasks).values({
        createdByUserId: userId,
        id: 'goal-run-task',
        identifier: 'T-RUN',
        instruction: 'do it',
        seq: 1,
      });
      await serverDB
        .update(goalNodes)
        .set({ taskId: 'goal-run-task' })
        .where(eq(goalNodes.id, node!.id));

      await serverDB.insert(topics).values({ id: 'goal-run-topic', userId });
      await serverDB.insert(taskTopics).values({
        createdAt: new Date('2026-01-01T00:00:00Z'),
        seq: 1,
        taskId: 'goal-run-task',
        topicId: 'goal-run-topic',
        userId,
      });
      await serverDB
        .update(topics)
        .set({ completedAt: new Date('2026-01-01T00:01:00Z'), totalCost: 3 })
        .where(eq(topics.id, 'goal-run-topic'));

      const { goals: items } = await goalModel.list();
      expect(items[0]).toMatchObject({ totalRunCost: 3, totalRunDuration: 60_000 });

      // Paging past the end still reports the total, with no rows to roll up.
      const paged = await goalModel.list({ offset: 50 });
      expect(paged.total).toBe(1);
      expect(paged.goals).toEqual([]);
    });

    it('rolls up runs for a workspace-scoped goal too', async () => {
      await serverDB
        .insert(workspaces)
        .values({ id: 'goal-ws', name: 'goal-ws', primaryOwnerId: userId, slug: 'goal-ws' });
      const workspaceModel = new GoalModel(serverDB, userId, 'goal-ws');
      const goal = await workspaceModel.create({ subjectType: 'standalone', title: 'Workspace' });
      const node = await new GoalGraphModel(serverDB, userId, 'goal-ws').createNode(goal.id, {
        kind: 'task',
        title: 'W1',
      });

      // Same shape as the personal roll-up above, but the task only reaches the
      // graph through the workspace branch of the ownership predicate — and a
      // workspace goal that rolled up nothing would still list a row.
      await serverDB.insert(tasks).values({
        createdByUserId: userId,
        id: 'goal-ws-run-task',
        identifier: 'T-WSRUN',
        instruction: 'do it',
        seq: 1,
        workspaceId: 'goal-ws',
      });
      await serverDB
        .update(goalNodes)
        .set({ taskId: 'goal-ws-run-task' })
        .where(eq(goalNodes.id, node!.id));

      await serverDB
        .insert(topics)
        .values({ id: 'goal-ws-run-topic', userId, workspaceId: 'goal-ws' });
      await serverDB.insert(taskTopics).values({
        createdAt: new Date('2026-01-01T00:00:00Z'),
        seq: 1,
        taskId: 'goal-ws-run-task',
        topicId: 'goal-ws-run-topic',
        userId,
        workspaceId: 'goal-ws',
      });
      await serverDB
        .update(topics)
        .set({ completedAt: new Date('2026-01-01T00:01:00Z'), totalCost: 7 })
        .where(eq(topics.id, 'goal-ws-run-topic'));

      const { goals: items } = await workspaceModel.list();

      expect(items.map((row) => row.goal.id)).toEqual([goal.id]);
      expect(items[0]).toMatchObject({ totalRunCost: 7, totalRunDuration: 60_000 });
    });
  });
});
