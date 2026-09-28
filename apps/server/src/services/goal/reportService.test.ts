// @vitest-environment node
import { GOAL_REPORT_TASK_TITLE } from '@lobechat/const/goal';
import type { GoalReportMetadata } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { WorkModel } from '@/database/models/work';
import {
  acceptances,
  agentOperations,
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goalNodeWorkVersions,
  goals,
  tasks,
  taskTopics,
  topics,
  users,
  works,
  workVersions,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { TaskRunnerService } from '../taskRunner';
import { GoalService } from './index';
import { GoalReportStore } from './reportStore';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-report-test-user';

let runTask: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
  let seq = 0;
  runTask = vi
    .spyOn(TaskRunnerService.prototype, 'runTask')
    .mockImplementation(async ({ taskId }) => {
      seq += 1;
      const topicId = `tpc_report_${seq}`;
      await serverDB.insert(topics).values({ id: topicId, userId }).onConflictDoNothing();
      await new TaskModel(serverDB, userId).updateStatus(taskId, 'running');
      await new TaskTopicModel(serverDB, userId).add(taskId, topicId, {
        operationId: `op_report_${seq}`,
        seq,
      });
      return { operationId: `op_report_${seq}`, taskId, topicId } as any;
    });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(goalNodeWorkVersions);
  await serverDB.delete(goalNodeDecisions);
  await serverDB.delete(goalEdges);
  await serverDB.delete(goalEvents);
  await serverDB.delete(goalNodes);
  await serverDB.delete(goals);
  await serverDB.delete(workVersions);
  await serverDB.delete(works);
  await serverDB.delete(acceptances);
  await serverDB.delete(agentOperations);
  await serverDB.delete(taskTopics);
  await serverDB.delete(topics);
  await serverDB.delete(tasks);
  await serverDB.delete(users);
});

/** Drive a one-Task goal to the point where Goal-level acceptance is running. */
const runToAcceptance = async (service: GoalService, config?: object) => {
  const taskModel = new TaskModel(serverDB, userId);
  const graph = await service.create({
    config,
    requirement: 'Deliver a verified report',
    tasks: ['Build the thing'],
    title: 'Report goal',
  });
  const created = await service.tick(graph.goal.id);
  await taskModel.updateStatus(created.taskId!, 'completed');
  await service.tick(graph.goal.id); // consume → finding
  await service.tick(graph.goal.id); // create acceptance node
  const acceptance = await service.tick(graph.goal.id); // bind acceptance task
  return { acceptanceTaskId: acceptance.taskId!, goalId: graph.goal.id, taskModel };
};

const reportTaskRuns = () =>
  runTask.mock.calls.filter(([params]: any) =>
    params.additionalPluginIds?.includes('lobe-goal-report'),
  );

describe('GoalService wrap-up branch', () => {
  it('does not dispatch before Goal-level acceptance has ended', async () => {
    const service = new GoalService(serverDB, userId);
    const { goalId } = await runToAcceptance(service);

    // Acceptance Task exists but has not finished: tick a few more times.
    await service.tick(goalId);
    await service.tick(goalId);

    const graph = await service.graph(goalId);
    expect(graph.nodes.some((node) => node.title === GOAL_REPORT_TASK_TITLE)).toBe(false);
    expect(graph.report).toBeUndefined();
    expect(reportTaskRuns()).toHaveLength(0);
  });

  it('dispatches once after acceptance passes, and shows it as running', async () => {
    const service = new GoalService(serverDB, userId);
    const { acceptanceTaskId, goalId, taskModel } = await runToAcceptance(service);
    await taskModel.updateStatus(acceptanceTaskId, 'completed');
    await service.tick(goalId); // consume acceptance
    expect(await service.tick(goalId)).toMatchObject({ outcome: 'achieved' });

    // Re-ticking the achieved goal must not dispatch again.
    await service.tick(goalId);
    await service.tick(goalId);

    expect(reportTaskRuns()).toHaveLength(1);
    const graph = await service.graph(goalId);
    expect(graph.goal.status).toBe('achieved');
    const reportNode = graph.nodes.find((node) => node.title === GOAL_REPORT_TASK_TITLE)!;
    expect(reportNode).toMatchObject({ kind: 'task', status: 'active' });
    expect(graph.report).toMatchObject({
      dispatch: { nodeId: reportNode.id, taskId: reportNode.taskId, trigger: 'accepted' },
      status: 'running',
    });
    const reportTask = await taskModel.findById(reportNode.taskId!);
    expect(reportTask?.instruction).toContain('Candidate main path');
    expect(reportTask?.instruction).toContain('Goal-level acceptance passed');
  });

  it('dispatches once when acceptance failed with its attempts spent, not again on fail', async () => {
    const service = new GoalService(serverDB, userId);
    const { acceptanceTaskId, goalId, taskModel } = await runToAcceptance(service, {
      recovery: { maxAttemptsPerTask: 1 },
    });
    await taskModel.update(acceptanceTaskId, { totalTopics: 1 });
    await taskModel.updateStatus(acceptanceTaskId, 'paused', {
      error: 'Delivery did not pass verification.',
    });
    expect(await service.tick(goalId)).toMatchObject({ outcome: 'waiting_human' });
    await service.tick(goalId);
    expect(reportTaskRuns()).toHaveLength(1);
    expect((await service.graph(goalId)).report?.dispatch.trigger).toBe('acceptance_failed');

    const gate = (await service.graph(goalId)).decisions.find((d) => d.status === 'pending')!;
    await service.decide(goalId, gate.id, 'fail', 'Out of attempts');
    expect(await service.tick(goalId)).toMatchObject({ outcome: 'failed' });
    expect(reportTaskRuns()).toHaveLength(1);
  });

  it('dispatches once when the Goal is canceled', async () => {
    const service = new GoalService(serverDB, userId);
    const { goalId } = await runToAcceptance(service);
    await serverDB.update(goals).set({ status: 'canceled' }).where(eq(goals.id, goalId));

    await service.tick(goalId);
    await service.tick(goalId);

    expect(reportTaskRuns()).toHaveLength(1);
    const graph = await service.graph(goalId);
    expect(graph.goal.status).toBe('canceled');
    expect(graph.report?.dispatch.trigger).toBe('goal_canceled');
  });

  it('re-dispatches the same wrap-up Task when acceptance ends again after changes', async () => {
    const service = new GoalService(serverDB, userId);
    const { acceptanceTaskId, goalId, taskModel } = await runToAcceptance(service);
    await taskModel.updateStatus(acceptanceTaskId, 'completed');
    await service.tick(goalId);
    await service.tick(goalId);
    const first = (await service.graph(goalId)).report!.dispatch;

    // "Request changes": acceptance reopened, fixed, and accepted again.
    const acceptanceNode = (await service.graph(goalId)).nodes.find(
      (node) => node.taskId === acceptanceTaskId,
    )!;
    await serverDB
      .update(goalNodes)
      .set({ resolvedAt: new Date(Date.now() + 60_000), status: 'resolved' })
      .where(eq(goalNodes.id, acceptanceNode.id));
    await service.tick(goalId);

    const second = (await service.graph(goalId)).report!.dispatch;
    expect(reportTaskRuns()).toHaveLength(2);
    expect(second.acceptanceKey).not.toBe(first.acceptanceKey);
    expect(second.taskId).toBe(first.taskId);
  });

  it('a failed wrap-up leaves the Goal status alone and reads as failed', async () => {
    runTask.mockRejectedValue(new Error('agent unavailable'));
    const service = new GoalService(serverDB, userId);
    const { acceptanceTaskId, goalId, taskModel } = await runToAcceptance(service);
    await taskModel.updateStatus(acceptanceTaskId, 'completed');
    await service.tick(goalId);
    expect(await service.tick(goalId)).toMatchObject({ outcome: 'achieved' });

    const graph = await service.graph(goalId);
    expect(graph.goal.status).toBe('achieved');
    expect(graph.report).toMatchObject({
      dispatch: { error: 'agent unavailable' },
      status: 'failed',
    });
    // The receipt still names the bound Task, so the page can point at it.
    expect(graph.report?.dispatch.taskId).toBe(
      graph.nodes.find((node) => node.title === GOAL_REPORT_TASK_TITLE)?.taskId,
    );
    expect(graph.report?.dispatch.taskId).toBeTruthy();
  });
});

describe('GoalReportStore.submit', () => {
  const setup = async () => {
    const service = new GoalService(serverDB, userId);
    const { acceptanceTaskId, goalId, taskModel } = await runToAcceptance(service);
    await taskModel.updateStatus(acceptanceTaskId, 'completed');
    await service.tick(goalId);
    await service.tick(goalId);
    const graph = await service.graph(goalId);
    const reportNode = graph.nodes.find((node) => node.title === GOAL_REPORT_TASK_TITLE)!;
    const buildNode = graph.nodes.find((node) => node.title === 'Build the thing')!;
    const finding = graph.nodes.find((node) => node.kind === 'finding')!;
    const topic = (await new TaskTopicModel(serverDB, userId).findByTaskId(reportNode.taskId!))[0];
    const metadata: GoalReportMetadata = {
      chapters: [
        {
          detours: [],
          findingIds: [finding.id],
          narrative: 'Built it and it held up under acceptance.',
          nodeIds: [buildNode.id],
          title: 'Building',
          workVersionIds: [],
        },
      ],
      graphCursor: graph.events[0].id,
      headline: 'Delivered a verified report',
      mainline: { edgeIds: [], nodeIds: [buildNode.id] },
      nextSteps: [{ reason: 'Nothing blocks it', title: 'Ship' }],
    };
    return { buildNode, goalId, metadata, reportNode, service, topicId: topic.topicId! };
  };

  it('rejects references that do not belong to the Goal and stores nothing', async () => {
    const { goalId, metadata, reportNode, service, topicId } = await setup();
    const reports = new GoalReportStore(serverDB, userId);

    await expect(
      reports.submit(
        goalId,
        {
          content: '# Report',
          metadata: {
            ...metadata,
            chapters: [{ ...metadata.chapters[0], nodeIds: ['gnode_elsewhere'] }],
          },
        },
        { topicId },
      ),
    ).rejects.toThrow('chapters[0].nodeIds: gnode_elsewhere is not a node of this Goal');

    // The wrap-up node is hidden from the story, so it can never be on the mainline.
    await expect(
      reports.submit(
        goalId,
        {
          content: '# Report',
          metadata: {
            ...metadata,
            mainline: { edgeIds: ['gedge_elsewhere'], nodeIds: [reportNode.id] },
          },
        },
        { topicId },
      ),
    ).rejects.toThrow('mainline.edgeIds: gedge_elsewhere is not an edge of this Goal');

    await expect(
      reports.submit(
        goalId,
        { content: '# Report', metadata: { ...metadata, mainline: undefined } },
        { topicId },
      ),
    ).rejects.toThrow('mainline: required');

    await expect(
      reports.submit(goalId, { content: '# Report', metadata }, { topicId: 'tpc_other' }),
    ).rejects.toThrow('not the wrap-up run');

    expect(await new WorkModel(serverDB, userId).findLatestGoalReport(goalId)).toBeUndefined();
    expect((await service.graph(goalId)).report?.status).toBe('running');
  });

  it('stores metadata and content separately, appending a version per submission', async () => {
    const { goalId, metadata, reportNode, service, topicId } = await setup();
    const reports = new GoalReportStore(serverDB, userId);

    const first = await reports.submit(
      goalId,
      { content: '# Report v1\n\nBuilt it.', metadata },
      { operationId: 'op_report_1', topicId },
    );
    const second = await reports.submit(
      goalId,
      { content: '# Report v2', metadata: { ...metadata, headline: 'Second pass' } },
      { operationId: 'op_report_1', topicId },
    );
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second.workId).toBe(first.workId);

    const [work] = await serverDB.select().from(works).where(eq(works.id, first.workId));
    expect(work).toMatchObject({
      resourceId: goalId,
      resourceType: 'goal_report',
      type: 'goal_report',
    });
    const rows = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, first.workId))
      .orderBy(workVersions.version);
    expect(rows.map((row) => row.content)).toEqual(['# Report v1\n\nBuilt it.', '# Report v2']);
    expect(rows[0].metadata).toEqual({ goalReport: metadata });
    expect(rows[1].metadata?.goalReport?.headline).toBe('Second pass');
    expect(rows[1].metadata?.goalReport?.mainline).toEqual(metadata.mainline);

    const graph = await service.graph(goalId);
    expect(graph.report).toMatchObject({
      latest: { content: '# Report v2', metadata: { headline: 'Second pass' }, version: 2 },
      status: 'completed',
    });
    expect(graph.nodes.find((node) => node.id === reportNode.id)?.status).toBe('resolved');
    expect(graph.workVersions).toContainEqual(
      expect.objectContaining({
        nodeId: reportNode.id,
        relation: 'produced',
        workVersionId: second.workVersionId,
      }),
    );
    // Report links are invisible to the generic Work lists.
    expect(
      await new WorkModel(serverDB, userId).listByWorkspace({ includeFileWorks: true }),
    ).toMatchObject({
      items: expect.not.arrayContaining([expect.objectContaining({ type: 'goal_report' })]),
    });
  });
});
