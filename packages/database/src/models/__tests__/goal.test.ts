// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, goalEdges, goalNodeDecisions, goalNodes, goals, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GoalModel } from '../goal';
import { GoalGraphModel } from '../goalGraph';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'goal-model-test-user-id';
const otherUserId = 'goal-model-test-user-2';
const goalModel = new GoalModel(serverDB, userId);
const graphModel = new GoalGraphModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('GoalModel', () => {
  describe('supervisor state', () => {
    it('claims an incident once and preserves other configuration under concurrent writes', async () => {
      const goal = await goalModel.create({
        config: { supervision: { enabled: true }, recovery: { maxAttemptsPerTask: 4 } },
        title: 'Supervised',
      });
      const state = { agentId: 'agent', incidents: [], topicId: 'topic' };
      const claims = await Promise.all([
        goalModel.updateSupervisorState(goal.id, 0, state),
        goalModel.updateSupervisorState(goal.id, 0, state),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      await goalModel.updatePauseReason(goal.id, 'user');
      await goalModel.updateSupervisorState(goal.id, 1, state);
      expect((await goalModel.findById(goal.id))?.config).toMatchObject({
        pausedBy: 'user',
        recovery: { maxAttemptsPerTask: 4 },
        supervisorState: { revision: 2 },
      });
      expect(await goalModel.updateSupervisorState(goal.id, 1, state)).toBeUndefined();
      await goalModel.update(goal.id, { config: { supervision: { enabled: false } } });
      expect((await goalModel.findById(goal.id))?.config?.supervisorState?.revision).toBe(2);
    });

    it('cannot read-lock or mutate another user supervisor state', async () => {
      const goal = await goalModel.create({ title: 'Private supervision' });
      const other = new GoalModel(serverDB, otherUserId);
      expect(await other.lockById(goal.id)).toBeUndefined();
      expect(
        await other.updateSupervisorState(goal.id, 0, {
          agentId: 'agent',
          incidents: [],
          topicId: 'topic',
        }),
      ).toBeUndefined();
      expect((await goalModel.findById(goal.id))?.config?.supervisorState).toBeUndefined();
    });
  });

  describe('create', () => {
    it('creates a goal with defaults', async () => {
      const result = await goalModel.create({
        subjectType: 'standalone',
        title: 'Ship the goals table',
      });

      expect(result.id).toMatch(/^goal_/);
      expect(result).toMatchObject({
        status: 'planning',
        subjectType: 'standalone',
        title: 'Ship the goals table',
        userId,
      });
    });

    it('persists budget and requirement', async () => {
      const result = await goalModel.create({
        maxRounds: 5,
        maxTotalCost: 12.5,
        requirement: 'All tests pass',
        subjectType: 'standalone',
        title: 'Budgeted goal',
      });

      expect(result.maxRounds).toBe(5);
      expect(result.maxTotalCost).toBe(12.5);
      expect(result.requirement).toBe('All tests pass');
    });
  });

  describe('updatePauseReason', () => {
    it('patches only the marker, leaving a concurrent config edit intact', async () => {
      // The coordinator writes this from a tick while the user edits budget and
      // acceptance criteria on the same JSONB column from the goal page. A
      // read-modify-write of the whole config would let whichever landed second
      // discard the other's work.
      const goal = await goalModel.create({
        config: { acceptance: { metrics: [{ key: 'followers', target: 1000 }] } },
        subjectType: 'standalone',
        title: 'Concurrent config writers',
      });

      await goalModel.updatePauseReason(goal.id, 'measured_acceptance');

      const parked = await goalModel.findById(goal.id);
      expect(parked?.config).toMatchObject({
        acceptance: { metrics: [{ key: 'followers', target: 1000 }] },
        pausedBy: 'measured_acceptance',
      });

      await goalModel.updatePauseReason(goal.id, undefined);

      const cleared = await goalModel.findById(goal.id);
      expect(cleared?.config?.pausedBy).toBeUndefined();
      expect(cleared?.config?.acceptance?.metrics).toEqual([{ key: 'followers', target: 1000 }]);
    });

    it('starts from an empty object when the goal has no config yet', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'No config' });

      await goalModel.updatePauseReason(goal.id, 'measured_acceptance');

      expect((await goalModel.findById(goal.id))?.config?.pausedBy).toBe('measured_acceptance');
    });

    it('does not reach a goal owned by somebody else', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Owned' });

      await new GoalModel(serverDB, otherUserId).updatePauseReason(goal.id, 'measured_acceptance');

      expect((await goalModel.findById(goal.id))?.config?.pausedBy).toBeUndefined();
    });
  });

  describe('findByGraphTask', () => {
    it('finds the goal whose graph owns a Task', async () => {
      const task = await new TaskModel(serverDB, userId).create({ instruction: 'do the work' });
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Owner' });
      const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'W1' });
      await serverDB.update(goalNodes).set({ taskId: task.id }).where(eq(goalNodes.id, node!.id));

      expect((await goalModel.findByGraphTask(task.id))?.id).toBe(goal.id);
    });

    it('does not cross user boundaries', async () => {
      const otherGoals = new GoalModel(serverDB, otherUserId);
      const otherGraph = new GoalGraphModel(serverDB, otherUserId);
      const task = await new TaskModel(serverDB, otherUserId).create({ instruction: 'theirs' });
      const goal = await otherGoals.create({ subjectType: 'standalone', title: 'Theirs' });
      const node = await otherGraph.createNode(goal.id, { kind: 'task', title: 'W1' });
      await serverDB.update(goalNodes).set({ taskId: task.id }).where(eq(goalNodes.id, node!.id));

      expect(await goalModel.findByGraphTask(task.id)).toBeUndefined();
    });
  });

  describe('list', () => {
    it('lists goals the caller owns, newest first, with the graph roll-up', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Reproduce it' });
      const problem = await graphModel.createNode(goal.id, { kind: 'problem', title: 'P1' });
      const done = await graphModel.createNode(goal.id, { kind: 'task', title: 'W1' });
      await graphModel.createNode(goal.id, { kind: 'task', title: 'W2' });
      await graphModel.createNode(goal.id, { kind: 'finding', title: 'F1' });
      await graphModel.createEdge(goal.id, problem!.id, done!.id, 'decomposes');
      await graphModel.updateNodeStatus(goal.id, done!.id, 'resolved');

      const { goals, total } = await goalModel.list();

      expect(total).toBe(1);
      expect(goals[0]).toMatchObject({
        findingCount: 1,
        pendingDecisions: 0,
        taskDone: 1,
        taskTotal: 2,
      });
      expect(goals[0].goal.id).toBe(goal.id);
    });

    it('counts only the decision gates still waiting on a human', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Gated' });
      const open = await graphModel.createNode(goal.id, { kind: 'decision', title: 'D1' });
      const closed = await graphModel.createNode(goal.id, { kind: 'decision', title: 'D2' });
      await graphModel.createDecision(goal.id, open!.id, {
        authority: 'user',
        question: 'retry?',
      });
      await graphModel.createDecision(goal.id, closed!.id, {
        authority: 'user',
        question: 'retire?',
      });
      await serverDB
        .update(goalNodeDecisions)
        .set({ status: 'resolved' })
        .where(eq(goalNodeDecisions.nodeId, closed!.id));

      expect((await goalModel.list()).goals[0].pendingDecisions).toBe(1);
    });

    it('does not leak another user’s goals', async () => {
      await new GoalModel(serverDB, otherUserId).create({
        subjectType: 'standalone',
        title: 'Not mine',
      });

      expect((await goalModel.list()).total).toBe(0);
    });

    it('scopes by the goal’s responsible agent', async () => {
      const mine = 'goal-list-agent-a';
      const theirs = 'goal-list-agent-b';
      await serverDB.insert(agents).values([
        { id: mine, slug: mine, userId },
        { id: theirs, slug: theirs, userId },
      ]);
      const ours = await goalModel.create({
        agentId: mine,
        subjectType: 'standalone',
        title: 'Mine',
      });
      const others = await goalModel.create({
        agentId: theirs,
        subjectType: 'standalone',
        title: 'Theirs',
      });
      await graphModel.createNode(ours.id, { kind: 'task', title: 'W1' });
      await graphModel.createNode(others.id, { kind: 'task', title: 'W1' });

      const scoped = await goalModel.list({ agentId: mine });
      expect(scoped.total).toBe(1);
      expect(scoped.goals[0].goal.title).toBe('Mine');
    });

    it('leaves out a goal that never got a graph', async () => {
      // Rows from the earlier task-carried flow have no `goal_nodes`. Listing
      // them renders a goal page with no tasks, no frontier and no way forward.
      const legacy = await goalModel.create({ subjectType: 'task', title: 'Carrier-bound' });
      const graphed = await goalModel.create({ subjectType: 'standalone', title: 'Has a graph' });
      await graphModel.createNode(graphed.id, { kind: 'task', title: 'W1' });

      const { goals, total } = await goalModel.list();

      expect(total).toBe(1);
      expect(goals.map(({ goal }) => goal.id)).toEqual([graphed.id]);
      expect(goals.map(({ goal }) => goal.id)).not.toContain(legacy.id);
    });

    it('filters by lifecycle status', async () => {
      const running = await goalModel.create({ subjectType: 'standalone', title: 'Running' });
      const achieved = await goalModel.create({ subjectType: 'standalone', title: 'Achieved' });
      await graphModel.createNode(running.id, { kind: 'task', title: 'W1' });
      await graphModel.createNode(achieved.id, { kind: 'task', title: 'W1' });
      await goalModel.updateStatus(running.id, 'running');
      await goalModel.updateStatus(achieved.id, 'achieved');

      const open = await goalModel.list({ statuses: ['running'] });
      expect(open.goals.map(({ goal }) => goal.title)).toEqual(['Running']);
    });
  });

  describe('listStalled', () => {
    const staleBefore = () => new Date(Date.now() - 15 * 60 * 1000);

    it('picks up an open goal with nothing running', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Never started' });
      await goalModel.updateStatus(goal.id, 'running');
      await graphModel.createNode(goal.id, { kind: 'task', title: 'W1' });

      const stalled = await GoalModel.listStalled(serverDB, { staleBefore: staleBefore() });
      expect(stalled.map(({ id }) => id)).toContain(goal.id);
    });

    it('leaves out a goal that never got a graph', async () => {
      // No graph means no frontier, so every sweep would tick it only to hear
      // `no_progress` back.
      const goal = await goalModel.create({ subjectType: 'task', title: 'Carrier-bound' });
      await goalModel.updateStatus(goal.id, 'running');

      const stalled = await GoalModel.listStalled(serverDB, { staleBefore: staleBefore() });
      expect(stalled.map(({ id }) => id)).not.toContain(goal.id);
    });

    it('leaves a goal alone while one of its Tasks is freshly active', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Working' });
      await goalModel.updateStatus(goal.id, 'running');
      const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'W1' });
      await graphModel.updateNodeStatus(goal.id, node!.id, 'active');

      const stalled = await GoalModel.listStalled(serverDB, { staleBefore: staleBefore() });
      expect(stalled.map(({ id }) => id)).not.toContain(goal.id);
    });

    it('reclaims a Task that outlived its operation lease', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Lost' });
      await goalModel.updateStatus(goal.id, 'running');
      const node = await graphModel.createNode(goal.id, { kind: 'task', title: 'W1' });
      await graphModel.updateNodeStatus(goal.id, node!.id, 'active');
      await serverDB
        .update(goalNodes)
        .set({ updatedAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(goalNodes.id, node!.id));

      const stalled = await GoalModel.listStalled(serverDB, { staleBefore: staleBefore() });
      expect(stalled.map(({ id }) => id)).toContain(goal.id);
    });

    it('skips a goal whose next move belongs to a human', async () => {
      // Ticking a goal parked on a decision gate only re-reports `waiting_human`
      // on every sweep; only the user can move it.
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Gated' });
      await goalModel.updateStatus(goal.id, 'running');
      const gate = await graphModel.createNode(goal.id, { kind: 'decision', title: 'D1' });
      await graphModel.createDecision(goal.id, gate!.id, {
        authority: 'user',
        question: 'retry?',
      });

      const stalled = await GoalModel.listStalled(serverDB, { staleBefore: staleBefore() });
      expect(stalled.map(({ id }) => id)).not.toContain(goal.id);
    });

    it.each(['achieved', 'failed', 'canceled', 'paused'] as const)(
      'never sweeps a %s goal',
      async (status) => {
        const goal = await goalModel.create({ subjectType: 'standalone', title: status });
        await goalModel.updateStatus(goal.id, status);
        await graphModel.createNode(goal.id, { kind: 'task', title: 'W1' });

        const stalled = await GoalModel.listStalled(serverDB, { staleBefore: staleBefore() });
        expect(stalled.map(({ id }) => id)).not.toContain(goal.id);
      },
    );
  });

  describe('updateStatus', () => {
    it('stamps startedAt on first entry into running', async () => {
      const { id } = await goalModel.create({
        subjectType: 'standalone',
        title: 'Lifecycle goal',
      });

      const running = await goalModel.updateStatus(id, 'running');
      expect(running?.status).toBe('running');
      expect(running?.startedAt).toBeInstanceOf(Date);

      // A later transition keeps the original startedAt.
      const verifying = await goalModel.updateStatus(id, 'verifying');
      expect(verifying?.startedAt).toEqual(running?.startedAt);
    });

    it('stamps completedAt on terminal states and clears it on re-open', async () => {
      const { id } = await goalModel.create({
        subjectType: 'standalone',
        title: 'Terminal goal',
      });

      const achieved = await goalModel.updateStatus(id, 'achieved');
      expect(achieved?.completedAt).toBeInstanceOf(Date);

      const reopened = await goalModel.updateStatus(id, 'running');
      expect(reopened?.completedAt).toBeNull();
    });

    it('returns undefined for a goal outside the scope', async () => {
      const otherModel = new GoalModel(serverDB, otherUserId);
      const { id } = await otherModel.create({ subjectType: 'standalone', title: 'Not mine' });

      expect(await goalModel.updateStatus(id, 'running')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('cascades the whole graph away with the goal', async () => {
      const goal = await goalModel.create({ subjectType: 'standalone', title: 'Doomed' });
      const problem = await graphModel.createNode(goal.id, { kind: 'problem', title: 'P1' });
      const work = await graphModel.createNode(goal.id, { kind: 'task', title: 'W1' });
      await graphModel.createEdge(goal.id, problem!.id, work!.id, 'decomposes');

      await goalModel.delete(goal.id);

      expect(
        await serverDB.query.goalNodes.findMany({ where: eq(goalNodes.goalId, goal.id) }),
      ).toHaveLength(0);
      expect(
        await serverDB.query.goalEdges.findMany({ where: eq(goalEdges.goalId, goal.id) }),
      ).toHaveLength(0);
    });
  });
});

describe('planning leases', () => {
  it('does not take over a running goal claimed by a legacy worker', async () => {
    const goal = await goalModel.create({ title: 'Legacy planner', status: 'running' });
    expect(await goalModel.claimPlanning(goal.id)).toBeUndefined();
    expect((await goalModel.findById(goal.id))?.config?.planningCheckpoint).toBeUndefined();
  });

  it.each([
    null,
    { acceptance: { criteriaIds: ['updated-criterion'] } },
    { acceptance: { metrics: [{ key: 'followers', target: 1000 }] } },
    { schedule: { deadline: null } },
  ])(
    'preserves the lease across a stale config replacement (%j) without resurrecting a released token',
    async (config) => {
      const goal = await goalModel.create({ title: 'Config race', config: { pausedBy: 'user' } });
      const claim = await goalModel.claimPlanning(goal.id);
      const claimed = await goalModel.findById(goal.id);
      await goalModel.update(goal.id, { config });
      expect((await goalModel.findById(goal.id))?.config?.planningCheckpoint?.token).toBe(
        claim!.token,
      );
      expect(await goalModel.claimPlanning(goal.id)).toBeUndefined();

      await goalModel.releasePlanning(goal.id, claim!.token);
      await goalModel.update(goal.id, { config: claimed!.config });
      expect((await goalModel.findById(goal.id))?.config?.planningCheckpoint).toBeUndefined();
      // A lease-aware goal can retry; a legacy running goal cannot.
      expect(await goalModel.claimPlanning(goal.id)).toBeDefined();
    },
  );

  it('allows one owner, fences expired owners, and preserves unrelated config on release', async () => {
    const goal = await goalModel.create({ title: 'Planning lease', config: { pausedBy: 'user' } });
    const first = await goalModel.claimPlanning(goal.id);
    expect(first).toBeDefined();
    expect(await goalModel.claimPlanning(goal.id)).toBeUndefined();
    expect(await new GoalModel(serverDB, otherUserId).claimPlanning(goal.id)).toBeUndefined();
    await new GoalModel(serverDB, otherUserId).releasePlanning(goal.id, first!.token);
    expect((await goalModel.findById(goal.id))?.config?.planningCheckpoint?.token).toBe(
      first!.token,
    );
    await serverDB
      .update(goals)
      .set({
        config: {
          pausedBy: 'user',
          planningProtocol: 'lease-v1',
          planningCheckpoint: { token: first!.token, expiresAt: '2000-01-01T00:00:00.000Z' },
        },
      })
      .where(eq(goals.id, goal.id));
    const second = await goalModel.claimPlanning(goal.id);
    expect(second?.token).not.toBe(first!.token);
    await goalModel.releasePlanning(goal.id, first!.token);
    expect((await goalModel.findById(goal.id))?.config?.planningCheckpoint?.token).toBe(
      second!.token,
    );
    await goalModel.releasePlanning(goal.id, second!.token);
    expect((await goalModel.findById(goal.id))?.config).toEqual({
      pausedBy: 'user',
      planningProtocol: 'lease-v1',
    });
  });
});
