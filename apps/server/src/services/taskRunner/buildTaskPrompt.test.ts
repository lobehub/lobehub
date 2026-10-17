// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { BriefModel } from '@/database/models/brief';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { VerifyRunModel } from '@/database/models/verifyRun';
import {
  acceptances,
  goalEdges,
  goalEvents,
  goalNodes,
  goals,
  tasks,
  users,
  verifyCheckResults,
  verifyRuns,
} from '@/database/schemas';

import { buildTaskPrompt } from './buildTaskPrompt';

const db = await getTestDB();
const userId = 'goal-work-prompt-test-user';

beforeEach(async () => {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
});

afterEach(async () => {
  await db.delete(acceptances);
  await db.delete(goalEdges);
  await db.delete(goalEvents);
  await db.delete(goalNodes);
  await db.delete(goals);
  await db.delete(tasks);
  await db.delete(users);
});

describe('buildTaskPrompt Goal loop context', () => {
  it('uses the per-Task attempt budget for a Goal Graph Task', async () => {
    const taskModel = new TaskModel(db, userId);
    const task = await taskModel.create({
      instruction: 'Close the remaining acceptance gap.',
    });
    await taskModel.update(task.id, { totalTopics: 1 });
    const goal = await new GoalModel(db, userId).create({
      config: { recovery: { maxAttemptsPerTask: 2 } },
      maxRounds: 20,
      subjectType: 'standalone',
      title: 'Graph-managed work budget',
    });
    const graphModel = new GoalGraphModel(db, userId);
    const taskNode = await graphModel.createNode(goal.id, {
      kind: 'task',
      title: 'Close acceptance gap',
    });
    await graphModel.bindTask(goal.id, taskNode!.id, task.id);
    const acceptance = await new AcceptanceModel(db, userId).create({
      subjectType: 'task',
      subjectId: task.id,
    });
    await new VerifyRunModel(db, userId).create({
      acceptanceId: acceptance.id,
      roundIndex: 1,
      metadata: {
        goalReview: {
          status: 'rejected',
          predictionIds: ['prediction-1'],
          feedback:
            'The exported document is missing its table. Restore the table and submit fresh evidence.',
        },
      },
    });
    const currentTask = await taskModel.findById(task.id);

    const result = await buildTaskPrompt(currentTask!, {
      briefModel: new BriefModel(db, userId),
      db,
      taskModel,
      taskTopicModel: new TaskTopicModel(db, userId),
      userId,
    });

    expect(result.prompt).toContain('Automatic Acceptance review:');
    expect(result.prompt).toContain('Review feedback on the last delivery');
    expect(result.prompt).not.toContain('User feedback on the last delivery');
    expect(result.prompt).toContain('Restore the table and submit fresh evidence.');
    expect(result.prompt).toContain('Goal loop — round 2 of 2');
    expect(result.prompt).not.toContain('round 2 of 20');
  });
});

describe('buildTaskPrompt unresolved checks', () => {
  const planItem = (id: string) => ({
    id,
    index: 0,
    onFail: 'auto_repair' as const,
    required: true,
    title: `Check ${id}`,
    verifierConfig: {},
    verifierType: 'agent' as const,
  });

  it('carries the last judged failure when the newest round is still unjudged', async () => {
    // A repair round re-plans every check and leaves them pending until the
    // verifier runs. A retry dispatched meanwhile read only that newest round,
    // found nothing failed, and was told to "close the gaps below" with no gaps.
    const taskModel = new TaskModel(db, userId);
    const task = await taskModel.create({ instruction: 'Land the file tree PR.' });
    await taskModel.update(task.id, { totalTopics: 2 });
    const goal = await new GoalModel(db, userId).create({
      subjectType: 'standalone',
      title: 'Unjudged repair round',
    });
    const graphModel = new GoalGraphModel(db, userId);
    const taskNode = await graphModel.createNode(goal.id, { kind: 'task', title: 'Land it' });
    await graphModel.bindTask(goal.id, taskNode!.id, task.id);
    const acceptance = await new AcceptanceModel(db, userId).create({
      subjectId: task.id,
      subjectType: 'task',
    });
    const [judged, unjudged] = await db
      .insert(verifyRuns)
      .values(
        [1, 2].map((roundIndex) => ({
          acceptanceId: acceptance.id,
          plan: [planItem('rebased'), planItem('evidence')],
          roundIndex,
          userId,
        })),
      )
      .returning();
    await db.insert(verifyCheckResults).values(
      [
        { checkItemId: 'rebased', status: 'passed', verdict: 'passed', verifyRunId: judged.id },
        {
          checkItemId: 'evidence',
          status: 'failed',
          suggestion: 'Capture the account switch run and the no-data loading contrast.',
          verdict: 'failed',
          verifyRunId: judged.id,
        },
        { checkItemId: 'rebased', status: 'pending', verifyRunId: unjudged.id },
        { checkItemId: 'evidence', status: 'pending', verifyRunId: unjudged.id },
      ].map((row) => ({ ...row, userId, verifierType: 'agent' as const })),
    );

    const result = await buildTaskPrompt((await taskModel.findById(task.id))!, {
      briefModel: new BriefModel(db, userId),
      db,
      taskModel,
      taskTopicModel: new TaskTopicModel(db, userId),
      userId,
    });

    expect(result.prompt).toContain('Unresolved checks from the last round:');
    expect(result.prompt).toContain(
      '1. Check evidence — Capture the account switch run and the no-data loading contrast.',
    );
    expect(result.prompt).not.toContain('Check rebased');
  });
  it('keeps flow nodes that reuse one criterion as separate checks', async () => {
    // Two flow nodes can point at the same criterion asset; folding them onto
    // the criterion id let one node's failure stand in for the node that passed.
    const taskModel = new TaskModel(db, userId);
    const task = await taskModel.create({ instruction: 'Verify both branches.' });
    await taskModel.update(task.id, { totalTopics: 1 });
    const goal = await new GoalModel(db, userId).create({
      subjectType: 'standalone',
      title: 'Repeated flow asset',
    });
    const graphModel = new GoalGraphModel(db, userId);
    const taskNode = await graphModel.createNode(goal.id, { kind: 'task', title: 'Verify' });
    await graphModel.bindTask(goal.id, taskNode!.id, task.id);
    const acceptance = await new AcceptanceModel(db, userId).create({
      subjectId: task.id,
      subjectType: 'task',
    });
    const flowItem = (id: string, node: string) => ({
      ...planItem(id),
      sourceCriterionId: 'shared-criterion',
      sourceFlowNode: { flowId: 'flow-1', nodeId: node },
      title: `Branch ${node}`,
    });
    const [run] = await db
      .insert(verifyRuns)
      .values({
        acceptanceId: acceptance.id,
        plan: [flowItem('occurrence-a', 'a'), flowItem('occurrence-b', 'b')],
        roundIndex: 1,
        userId,
      } as never)
      .returning();
    await db.insert(verifyCheckResults).values(
      [
        { checkItemId: 'occurrence-a', status: 'passed' as const, verdict: 'passed' as const },
        {
          checkItemId: 'occurrence-b',
          status: 'failed' as const,
          suggestion: 'Branch b never reached the confirmation step.',
          verdict: 'failed' as const,
        },
      ].map((row) => ({ ...row, userId, verifierType: 'agent' as const, verifyRunId: run.id })),
    );

    const result = await buildTaskPrompt((await taskModel.findById(task.id))!, {
      briefModel: new BriefModel(db, userId),
      db,
      taskModel,
      taskTopicModel: new TaskTopicModel(db, userId),
      userId,
    });

    expect(result.prompt).toContain('1. Branch b — Branch b never reached the confirmation step.');
    expect(result.prompt).not.toContain('Branch a');
  });
  it('carries a failed check into the unjudged successor that supersedes it', async () => {
    // A repair round may reword a failed check as a new item that `supersedes`
    // it. Looking up only the successor id lost the failure it inherits.
    const taskModel = new TaskModel(db, userId);
    const task = await taskModel.create({ instruction: 'Reword and retry.' });
    await taskModel.update(task.id, { totalTopics: 2 });
    const goal = await new GoalModel(db, userId).create({
      subjectType: 'standalone',
      title: 'Superseded check',
    });
    const graphModel = new GoalGraphModel(db, userId);
    const taskNode = await graphModel.createNode(goal.id, { kind: 'task', title: 'Retry' });
    await graphModel.bindTask(goal.id, taskNode!.id, task.id);
    const acceptance = await new AcceptanceModel(db, userId).create({
      subjectId: task.id,
      subjectType: 'task',
    });
    const [judged, reworded] = await db
      .insert(verifyRuns)
      .values([
        { acceptanceId: acceptance.id, plan: [planItem('old-wording')], roundIndex: 1, userId },
        {
          acceptanceId: acceptance.id,
          plan: [{ ...planItem('new-wording'), supersedes: ['old-wording'] }],
          roundIndex: 2,
          userId,
        },
      ] as never)
      .returning();
    await db.insert(verifyCheckResults).values([
      {
        checkItemId: 'old-wording',
        status: 'failed' as const,
        suggestion: 'The export still drops the table.',
        userId,
        verdict: 'failed' as const,
        verifierType: 'agent' as const,
        verifyRunId: judged.id,
      },
      {
        checkItemId: 'new-wording',
        status: 'pending' as const,
        userId,
        verifierType: 'agent' as const,
        verifyRunId: reworded.id,
      },
    ]);

    const result = await buildTaskPrompt((await taskModel.findById(task.id))!, {
      briefModel: new BriefModel(db, userId),
      db,
      taskModel,
      taskTopicModel: new TaskTopicModel(db, userId),
      userId,
    });

    expect(result.prompt).toContain('1. Check new-wording — The export still drops the table.');
  });
});

describe('buildTaskPrompt owner change request', () => {
  it('keeps the owner reject comment when the rework already opened a new round', async () => {
    const taskModel = new TaskModel(db, userId);
    const task = await taskModel.create({ instruction: 'Complete full Goal acceptance' });
    await taskModel.update(task.id, { totalTopics: 2 });
    const goal = await new GoalModel(db, userId).create({
      subjectType: 'standalone',
      title: 'Reworked delivery',
    });
    const graphModel = new GoalGraphModel(db, userId);
    const taskNode = await graphModel.createNode(goal.id, {
      kind: 'task',
      title: 'Complete full Goal acceptance',
    });
    await graphModel.bindTask(goal.id, taskNode!.id, task.id);
    const acceptance = await new AcceptanceModel(db, userId).create({
      subjectId: task.id,
      subjectType: 'task',
    });
    const runModel = new VerifyRunModel(db, userId);
    const rejected = await runModel.create({ acceptanceId: acceptance.id, roundIndex: 1 });
    await runModel.setDecision(rejected.id, 'reject', {
      comment: 'Add a day-one agenda',
      decidedAt: new Date().toISOString(),
      decidedBy: userId,
    });
    // The rework's first attempt planned its own round, then failed to run.
    await runModel.create({ acceptanceId: acceptance.id, roundIndex: 2 });

    const result = await buildTaskPrompt((await taskModel.findById(task.id))!, {
      briefModel: new BriefModel(db, userId),
      db,
      taskModel,
      taskTopicModel: new TaskTopicModel(db, userId),
      userId,
    });

    expect(result.prompt).toContain('Review feedback on the last delivery');
    expect(result.prompt).toContain('"Add a day-one agenda"');
  });
});

describe('buildTaskPrompt delivery acceptance', () => {
  const buildFor = async (taskId: string) => {
    const taskModel = new TaskModel(db, userId);
    const currentTask = await taskModel.findById(taskId);
    return buildTaskPrompt(currentTask!, {
      briefModel: new BriefModel(db, userId),
      db,
      taskModel,
      taskTopicModel: new TaskTopicModel(db, userId),
      userId,
    });
  };

  it('renders the acceptance section for a plain task with a verify config', async () => {
    const task = await new TaskModel(db, userId).create({
      config: { verify: { enabled: true, requirement: 'The report is delivered as a document.' } },
      instruction: 'Write the report.',
    });

    const result = await buildFor(task.id);

    expect(result.prompt).toContain('Verify — delivery acceptance');
  });

  it('omits the acceptance section for a recurring task', async () => {
    // A recurring task never gets a verify plan instantiated, so its per-tick
    // prompt must not ask the builder to self-evidence acceptance criteria.
    const task = await new TaskModel(db, userId).create({
      automationMode: 'schedule',
      config: { verify: { enabled: true, requirement: 'The report is delivered as a document.' } },
      instruction: 'Send the daily report.',
      schedulePattern: '0 9 * * *',
    });

    const result = await buildFor(task.id);

    expect(result.prompt).not.toContain('Verify — delivery acceptance');
  });
});
