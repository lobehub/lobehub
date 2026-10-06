// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { GOAL_BRIEF_TRIGGER } from '@lobechat/const/goal';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { TaskModel } from '@/database/models/task';
import {
  acceptances,
  agents,
  briefs,
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goals,
  tasks,
  taskTopics,
  users,
  userSettings,
  workspaces,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { applyGoalBriefAction } from '@/server/routers/lambda/_helpers/goalBriefAction';

import { GoalBriefService } from './goalBriefs';
import { GoalService } from './index';
import * as scheduler from './scheduler';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-brief-test-user';
const agentId = 'goal-brief-test-agent';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
  await serverDB.insert(agents).values({ id: agentId, userId }).onConflictDoNothing();
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(briefs);
  await serverDB.delete(acceptances);
  await serverDB.delete(goalNodeDecisions);
  await serverDB.delete(goalEdges);
  await serverDB.delete(goalEvents);
  await serverDB.delete(goalNodes);
  await serverDB.delete(goals);
  await serverDB.delete(taskTopics);
  await serverDB.delete(tasks);
  await serverDB.delete(agents);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

const goalBriefs = () =>
  serverDB.select().from(briefs).where(eq(briefs.trigger, GOAL_BRIEF_TRIGGER));

/** A goal parked on the coordinator's gate for its one failed Task. */
const gatedGoal = async () => {
  const service = new GoalService(serverDB, userId);
  const taskModel = new TaskModel(serverDB, userId);
  const graph = await service.create({ tasks: ['Risky task'], title: 'Gate goal' });
  const created = await service.tick(graph.goal.id);
  await taskModel.updateStatus(created.taskId!, 'paused', { error: 'Verifier rejected output' });
  expect((await service.tick(graph.goal.id)).outcome).toBe('waiting_human');
  const [decision] = (await service.graph(graph.goal.id)).decisions;
  return { decision, goalId: graph.goal.id, service, taskId: created.taskId!, taskModel };
};

describe('goal decision briefs', () => {
  it('tells the inbox when a gate opens, and stops once the goal page answers it', async () => {
    const { decision, goalId, service } = await gatedGoal();

    const [brief] = await goalBriefs();
    expect(brief).toMatchObject({
      priority: 'urgent',
      resolvedAt: null,
      type: 'decision',
      metadata: {
        goal: {
          decisionId: decision.id,
          goalId,
          goalTitle: 'Gate goal',
          kind: 'decision',
          // The inbox draws the advised answer as its primary button.
          recommendedAction: 'retry',
        },
      },
    });
    // The advised answer leads, so the obvious click is the recommended one.
    expect(brief.actions!.map((action: { key: string }) => action.key)).toEqual([
      'retry',
      'retire',
      'openGoal',
    ]);

    await service.decide(goalId, decision.id, 'retire', 'Not worth it');

    const [settled] = await goalBriefs();
    expect(settled).toMatchObject({ resolvedAction: 'retire', resolvedComment: 'Not worth it' });
    expect(settled.resolvedAt).not.toBeNull();
  });

  it('answers the gate from the inbox and carries the note into the next attempt', async () => {
    const { decision, goalId, service, taskId, taskModel } = await gatedGoal();
    const [brief] = await goalBriefs();

    const applied = await applyGoalBriefAction(
      { serverDB, userId } as never,
      brief,
      'retry',
      'Use the staging database this time',
    );

    expect(applied).toBe(true);
    const after = await service.graph(goalId);
    expect(after.decisions.find((d) => d.id === decision.id)).toMatchObject({
      resolvedOptionId: 'retry',
      status: 'resolved',
    });
    expect((await taskModel.findById(taskId))!.status).toBe('backlog');
    const comments = await taskModel.getComments(taskId);
    expect(comments.at(-1)!.content).toContain('Guidance: Use the staging database this time');
    expect(scheduler.scheduleGoalAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ goalId, trigger: 'decide' }),
    );
    expect((await goalBriefs())[0].resolvedAt).not.toBeNull();
  });

  it('adds nothing to the next attempt for a bare retry', async () => {
    const { decision, goalId, service, taskId, taskModel } = await gatedGoal();
    await service.decide(goalId, decision.id, 'retry');
    expect(await taskModel.getComments(taskId)).toHaveLength(0);
  });

  it('leaves an inbox-only action to the brief', async () => {
    await gatedGoal();
    const [brief] = await goalBriefs();
    expect(await applyGoalBriefAction({ serverDB, userId } as never, brief, 'openGoal')).toBe(
      false,
    );
  });
});

describe('machine gate briefs', () => {
  it("says the retry follows a fix, in the reader's words", async () => {
    await serverDB
      .insert(userSettings)
      .values({ general: { responseLanguage: 'zh-CN' }, id: userId })
      .onConflictDoNothing();
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Machine goal' });
    const goal = (await serverDB.query.goals.findFirst({ where: eq(goals.id, graph.goal.id) }))!;

    await new GoalBriefService(serverDB, userId).openDecision(goal, {
      decisionId: '00000000-0000-4000-8000-000000000001',
      options: [
        { id: 'retry', label: 'I fixed it — retry' },
        { id: 'retire', label: 'Retire task' },
      ],
      question:
        'Setup problem: Working directory does not exist: /tmp/x. Create /tmp/x on the device the agent runs on, or point the agent at a working directory that exists there. Fix it, then retry or retire this task node?',
      recommendedOptionId: 'retry',
    });

    const [brief] = await goalBriefs();
    expect(brief.actions![0]).toMatchObject({ key: 'retry', label: '已修好，重试' });
    expect(brief.summary).toContain('工作目录 /tmp/x');
    expect(brief.summary).toContain('推荐：已修好，重试');
  });
});

describe('goal progress', () => {
  it('records the finding as the agent that did the work, without an inbox brief', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Survey the market'], title: 'Office goal' });
    const created = await service.tick(graph.goal.id);
    await taskModel.update(created.taskId!, { assigneeAgentId: agentId });
    await serverDB.insert(taskTopics).values({
      handoff: {
        content: 'I surveyed nine products and wrote the doc.',
        keyFindings: ['九款产品里七款走 OOXML 直写', '协作编辑都靠 CRDT'],
        nextAction: '对比两种编辑内核的成本',
        summary: '市面方案分成直写文件和在线内核两类。',
        title: '办公套件实现路线有两类',
      },
      operationId: 'op-delivered',
      seq: 1,
      status: 'completed',
      taskId: created.taskId!,
      userId,
    });
    await taskModel.updateStatus(created.taskId!, 'completed');

    await service.tick(graph.goal.id);

    const finding = (await service.graph(graph.goal.id)).nodes.find((n) => n.kind === 'finding');
    expect(finding).toMatchObject({
      createdByAgentId: agentId,
      createdByUserId: null,
      description: 'I surveyed nine products and wrote the doc.',
      title: '办公套件实现路线有两类',
    });
    // A finding is read on the goal page; it does not become an inbox brief.
    expect(await goalBriefs()).toHaveLength(0);
  });
});

const acceptanceRow = async (
  values: { status?: 'accepted' | 'pending' | 'rejected'; workspaceId?: string } = {},
) => {
  const [row] = await serverDB
    .insert(acceptances)
    .values({ subjectId: randomUUID(), subjectType: 'standalone', userId, ...values })
    .returning();
  return row.id;
};

describe('goal sign-off briefs', () => {
  it('asks once per acceptance and stops once it is signed elsewhere', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Signed goal' });
    const goal = (await serverDB.query.goals.findFirst({ where: eq(goals.id, graph.goal.id) }))!;
    const goalBriefService = new GoalBriefService(serverDB, userId);
    const acceptanceId = await acceptanceRow();

    await goalBriefService.openSignOff(goal, acceptanceId);
    await goalBriefService.openSignOff(goal, acceptanceId);

    expect(await goalBriefService.listOpenSignOffs()).toEqual([
      expect.objectContaining({ acceptanceId, goalId: goal.id, goalTitle: 'Signed goal' }),
    ]);

    await goalBriefService.settleSignOff(acceptanceId, 'signOff');

    expect(await goalBriefService.listOpenSignOffs()).toEqual([]);
    const [brief] = await serverDB
      .select()
      .from(briefs)
      .where(and(eq(briefs.trigger, GOAL_BRIEF_TRIGGER), eq(briefs.userId, userId)));
    expect(brief.resolvedAction).toBe('signOff');
  });

  it('asks nothing for an acceptance the owner has already decided', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Signed early' });
    const goal = (await serverDB.query.goals.findFirst({ where: eq(goals.id, graph.goal.id) }))!;
    const goalBriefService = new GoalBriefService(serverDB, userId);

    await goalBriefService.openSignOff(goal, await acceptanceRow({ status: 'accepted' }));
    await goalBriefService.openSignOff(goal, await acceptanceRow({ status: 'rejected' }));

    expect(await goalBriefs()).toHaveLength(0);
  });

  it('keeps a workspace sign-off in that workspace', async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'ws', primaryOwnerId: userId, slug: 'goal-brief-ws' })
      .returning();
    const service = new GoalService(serverDB, userId, workspace.id);
    const graph = await service.create({ title: 'Workspace goal' });
    const goal = (await serverDB.query.goals.findFirst({ where: eq(goals.id, graph.goal.id) }))!;
    const acceptanceId = await acceptanceRow({ workspaceId: workspace.id });
    const inWorkspace = new GoalBriefService(serverDB, userId, workspace.id);
    const personal = new GoalBriefService(serverDB, userId);

    await inWorkspace.openSignOff(goal, acceptanceId);

    expect(await personal.listOpenSignOffs()).toEqual([]);
    await personal.settleSignOff(acceptanceId, 'signOff');
    expect(await inWorkspace.listOpenSignOffs()).toEqual([
      expect.objectContaining({ acceptanceId, goalTitle: 'Workspace goal' }),
    ]);

    await inWorkspace.settleSignOff(acceptanceId, 'signOff');
    expect(await inWorkspace.listOpenSignOffs()).toEqual([]);
  });
});
