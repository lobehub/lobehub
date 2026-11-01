// @vitest-environment node
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { TaskModel } from '@/database/models/task';
import { WorkModel } from '@/database/models/work';
import { documents, goals, tasks, taskTopics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { TaskService } from '../../../task';
import { TaskRunnerService } from '../../../taskRunner';
import {
  LEASE_EXPIRED_ERROR,
  VERIFICATION_ERRORED_ERROR,
  VERIFICATION_FAILED_ERROR,
} from '../../decideNextMove';
import { VERIFY_SETTLE_GRACE_MS } from '../../recoveryPolicy';
import { TaskRecoveryCoordinator } from '../../taskRecoveryCoordinator';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
  it.each([
    { action: 'verify', managerEnabled: true },
    { action: 'verify', managerEnabled: false },
    { action: 'tasks', managerEnabled: true },
  ] as const)(
    'scopes the handoff to manager=$managerEnabled action=$action',
    async ({ action, managerEnabled }) => {
      const service = new GoalService(serverDB, userId);
      const taskModel = new TaskModel(serverDB, userId);
      const requirement = 'Deliver the original result with independently inspectable evidence';
      const handoff =
        'Clarify that zero calls means zero additional predictions, not zero LLM use.';
      const graph = await service.create({
        criteria: [{ title: 'Original evidence criterion' }],
        requirement,
        tasks: ['Prepare result'],
        title: 'Handoff',
      });
      const prepared = await service.tick(graph.goal.id);
      await taskModel.updateStatus(prepared.taskId!, 'completed');
      await service.tick(graph.goal.id);
      const originalConfig = (await service.graph(graph.goal.id)).goal.config;
      await serverDB
        .update(goals)
        .set({
          config: {
            ...originalConfig,
            manager: managerEnabled ? {} : undefined,
            managerState: {
              consumed: true,
              readyForAcceptance: true,
              snapshot: 'settled',
              startedAt: new Date().toISOString(),
              submitted: { action, reason: handoff },
              token: 'verified-turn',
              topicId: 'management-topic',
              turns: 1,
            },
          },
        })
        .where(eq(goals.id, graph.goal.id));

      await service.tick(graph.goal.id);
      const finalTask = await service.tick(graph.goal.id);
      const task = await taskModel.findById(finalTask.taskId!);

      if (managerEnabled && action === 'verify') {
        expect(task?.instruction).toContain(handoff);
        expect(task?.instruction).toContain('context only, not acceptance criteria');
      } else {
        expect(task?.instruction).not.toContain(handoff);
      }
      const acceptance = await new AcceptanceModel(serverDB, userId).findBySubject(
        'task',
        finalTask.taskId!,
      );
      expect(acceptance?.requirement).toContain(requirement);
      expect(acceptance?.config?.verifyCriteriaIds).toEqual(
        originalConfig?.acceptance?.criteriaIds,
      );
      expect(acceptance?.config?.verifyCriteriaIds).toHaveLength(1);
      expect((await service.graph(graph.goal.id)).goal.requirement).toBe(requirement);
    },
  );

  it('creates only one responsible task when ticks race on the same task node', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Single owner task'], title: 'Concurrent goal' });

    const results = await Promise.all([service.tick(graph.goal.id), service.tick(graph.goal.id)]);
    const current = await service.graph(graph.goal.id);
    const taskRows = await serverDB.select().from(tasks);

    expect(results.filter((result) => result.outcome === 'advanced')).toHaveLength(1);
    expect(taskRows).toHaveLength(1);
    expect(current.nodes.find((node) => node.kind === 'task')?.taskId).toBe(taskRows[0].id);
    expect(current.workVersions).toHaveLength(1);
  });

  it('starts the bound Task once when advances race on dispatch', async () => {
    // Overlapping advances (an event hook, a manual nudge, the sweep) both read
    // the task as backlog; without an atomic claim both would call runTask and
    // the user would pay for the same Task twice.
    const runSpy = vi
      .spyOn(TaskRunnerService.prototype, 'runTask')
      .mockImplementation(async ({ taskId }) => ({ taskId }) as never);
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Only run once'], title: 'Raced dispatch' });
    await service.tick(graph.goal.id);

    const results = await Promise.all([service.tick(graph.goal.id), service.tick(graph.goal.id)]);

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.message.startsWith('Started task'))).toHaveLength(1);
  });

  it('retries a failed verification once when advances race on recovery', async () => {
    // The dispatch claim only covers starting a backlog Task; the automatic
    // retry path spawns its own run, so without the same claim two overlapping
    // advances would each pay for an attempt.
    const runSpy = vi
      .spyOn(TaskRunnerService.prototype, 'runTask')
      .mockImplementation(async ({ taskId }) => ({ taskId }) as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerTask: 3 } },
      title: 'Raced recovery',
      tasks: ['Retry me once'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Delivery did not pass verification.',
    });
    runSpy.mockClear();

    await Promise.all([service.tick(graph.goal.id), service.tick(graph.goal.id)]);

    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it.each([LEASE_EXPIRED_ERROR, VERIFICATION_FAILED_ERROR])(
    'does not dispatch recovery for an overdue goal with %s',
    async (error) => {
      const runSpy = vi
        .spyOn(TaskRunnerService.prototype, 'runTask')
        .mockResolvedValue({} as never);
      const service = new GoalService(serverDB, userId);
      const taskModel = new TaskModel(serverDB, userId);
      const graph = await service.create({
        config: { schedule: { deadline: new Date(Date.now() - 1000).toISOString() } },
        title: `Overdue recovery ${error}`,
        tasks: ['Do not retry'],
      });
      const created = await service.tick(graph.goal.id);
      await taskModel.updateStatus(created.taskId!, 'paused', { error });
      runSpy.mockClear();

      const stopped = await service.tick(graph.goal.id);

      expect(runSpy).not.toHaveBeenCalled();
      expect(stopped).toMatchObject({ outcome: 'no_progress' });
      expect(stopped.message).toContain('Deadline passed');
    },
  );

  it.each([
    [LEASE_EXPIRED_ERROR, 'completed'],
    [LEASE_EXPIRED_ERROR, 'failed'],
    [VERIFICATION_ERRORED_ERROR, 'completed'],
    [VERIFICATION_ERRORED_ERROR, 'canceled'],
  ])('does not restart a Task settled during recovery (%s → %s)', async (error, settledAs) => {
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      title: `Settled during recovery ${error} ${settledAs}`,
      tasks: ['Do not restart'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error });
    // The advance routed here holding the paused row; a person settled the Task
    // before the claim, which is the row the coordinator now reads.
    const stale = (await taskModel.findById(created.taskId!))!;
    await taskModel.updateStatus(created.taskId!, settledAs, { error: null });
    runSpy.mockClear();

    const recovery = await new TaskRecoveryCoordinator(serverDB, userId).recover({
      goal: (await service.graph(graph.goal.id)).goal,
      task: stale,
    });

    expect(recovery.outcome).toBe('settled');
    expect(runSpy).not.toHaveBeenCalled();
    expect((await taskModel.findById(created.taskId!))?.status).toBe(settledAs);
  });

  it.each([LEASE_EXPIRED_ERROR, VERIFICATION_ERRORED_ERROR])(
    'does not start a recovery run once the goal is fenced for closing (%s)',
    async (error) => {
      const runSpy = vi
        .spyOn(TaskRunnerService.prototype, 'runTask')
        .mockResolvedValue({} as never);
      const service = new GoalService(serverDB, userId);
      const taskModel = new TaskModel(serverDB, userId);
      const graph = await service.create({ title: `Fenced recovery ${error}`, tasks: ['Stop'] });
      const created = await service.tick(graph.goal.id);
      await taskModel.updateStatus(created.taskId!, 'paused', { error });
      // The tick decided on a running goal; `close` then paused it under the
      // goal row lock before scanning live runs.
      const decidedOn = (await service.graph(graph.goal.id)).goal;
      const task = (await taskModel.findById(created.taskId!))!;
      await service.pause(graph.goal.id);
      runSpy.mockClear();

      const recovery = await new TaskRecoveryCoordinator(serverDB, userId).recover({
        goal: decidedOn,
        task,
      });

      expect(recovery.outcome).toBe('goal-stopped');
      expect(runSpy).not.toHaveBeenCalled();
      expect((await taskModel.findById(created.taskId!))?.status).toBe('paused');
      expect((await service.graph(graph.goal.id)).goal.status).toBe('paused');
    },
  );

  it('does not restart a Task a person paused themselves', async () => {
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      title: 'Actor paused during recovery',
      tasks: ['Do not restart'],
    });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error: VERIFICATION_ERRORED_ERROR });
    // A manual round trip keeps the routing error, because the status update replaces
    // it only when a new one is supplied, so the final pause is the person's.
    const taskService = new TaskService(serverDB, userId);
    await taskService.updateStatus({ id: created.taskId!, status: 'failed' }, { userId });
    await taskService.updateStatus({ id: created.taskId!, status: 'paused' }, { userId });
    const stale = (await taskModel.findById(created.taskId!))!;
    runSpy.mockClear();

    const recovery = await new TaskRecoveryCoordinator(serverDB, userId).recover({
      goal: (await service.graph(graph.goal.id)).goal,
      task: stale,
    });

    expect(recovery.outcome).toBe('settled');
    expect(runSpy).not.toHaveBeenCalled();
    expect((await taskModel.findById(created.taskId!))?.status).toBe('paused');
  });

  it('hands back a dispatch claim whose worker died before the run existed', async () => {
    // The claim is taken just before `runTask` creates the topic. If the worker
    // dies in that sliver the task is `running` with no operation to reclaim,
    // and every later advance would report `waiting_external` forever.
    const runSpy = vi
      .spyOn(TaskRunnerService.prototype, 'runTask')
      .mockRejectedValue(new Error('worker died'));
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Start me'], title: 'Orphaned claim' });
    const created = await service.tick(graph.goal.id);

    // The claim survives the crash: put the row back where a dead worker left it.
    await expect(service.tick(graph.goal.id)).rejects.toThrow('worker died');
    await taskModel.updateStatus(created.taskId!, 'running');
    await serverDB
      .update(tasks)
      .set({ updatedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(tasks.id, created.taskId!));

    const released = await service.tick(graph.goal.id);

    expect(released.outcome).toBe('advanced');
    expect((await taskModel.findById(created.taskId!))?.status).toBe('backlog');
    runSpy.mockRestore();
  });

  it('does not re-dispatch a delivered Task while verification is still judging', async () => {
    // A verify-bound Task keeps its task `running` with a completed topic until
    // the verify run settles, and that judgment routinely outlives the
    // operation lease. Treating the window as a dead claim released the task
    // back to backlog, and the next advance paid for a ghost attempt that the
    // verify settle path then canceled.
    const runSpy = vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { operationLeaseTimeoutMs: 60_000 } },
      title: 'Deliveries wait for verification',
      tasks: ['Deliver and wait'],
    });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(taskTopics).values({
      operationId: 'op-delivered',
      seq: 1,
      status: 'completed',
      taskId: created.taskId!,
      userId,
    });
    await taskModel.updateStatus(created.taskId!, 'running');
    await serverDB
      .update(tasks)
      .set({ updatedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(tasks.id, created.taskId!));

    const waiting = await service.tick(graph.goal.id);

    expect(waiting).toMatchObject({
      message: expect.stringContaining('waiting for verification'),
      outcome: 'waiting_external',
      taskId: created.taskId,
    });
    expect((await taskModel.findById(created.taskId!))?.status).toBe('running');
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('reclaims a delivered Task once the verification grace window lapses', async () => {
    // The hold-off above cannot be unconditional: a verify run that died
    // silently would otherwise strand the goal forever, which is exactly the
    // failure mode the sweep exists to break.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { operationLeaseTimeoutMs: 60_000 } },
      title: 'Dead verification is reclaimed',
      tasks: ['Deliver into silence'],
    });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(taskTopics).values({
      createdAt: new Date(Date.now() - VERIFY_SETTLE_GRACE_MS - 60_000),
      operationId: 'op-delivered-stale',
      seq: 1,
      status: 'completed',
      taskId: created.taskId!,
      userId,
    });
    await taskModel.updateStatus(created.taskId!, 'running');
    await serverDB
      .update(tasks)
      .set({ updatedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(tasks.id, created.taskId!));

    const released = await service.tick(graph.goal.id);

    expect(released.outcome).toBe('advanced');
    expect((await taskModel.findById(created.taskId!))?.status).toBe('backlog');
  });

  it('synthesizes the finding from the delivered topic, not a canceled retry', async () => {
    // When verification accepts a delivery, the settle path cancels the ghost
    // retry it superseded — leaving the canceled, handoff-less topic as the
    // newest row. Reading blindly by seq produced findings titled
    // "Completed: <task>" with no description.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Deliver me'], title: 'Consume the delivery' });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(taskTopics).values([
      {
        handoff: {
          content: 'Delivered content with the full run summary.',
          summary: 'Delivered summary',
          title: 'Delivered title',
        },
        operationId: 'op-delivered',
        seq: 1,
        status: 'completed',
        taskId: created.taskId!,
        userId,
      },
      {
        operationId: 'op-ghost-retry',
        seq: 2,
        status: 'canceled',
        taskId: created.taskId!,
        userId,
      },
    ]);
    await taskModel.updateStatus(created.taskId!, 'completed');

    await service.tick(graph.goal.id);

    const finding = (await service.graph(graph.goal.id)).nodes.find(
      (node) => node.kind === 'finding',
    );
    expect(finding).toMatchObject({
      description: 'Delivered content with the full run summary.',
      title: 'Delivered title',
    });
  });

  it('links what the task delivered to its node, and skips the task Work itself', async () => {
    // The deliverable used to survive only as a URL inside the finding's prose:
    // the graph recorded that a task finished but not what came out of it.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Deliver me'], title: 'Harvest deliverables' });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(taskTopics).values({
      handoff: { summary: 'Delivered', title: 'Delivered title' },
      operationId: 'op-delivered',
      seq: 1,
      status: 'completed',
      taskId: created.taskId!,
      userId,
    });
    await workModel.registerExternal({
      changeType: 'created',
      identifier: 'ENG-7',
      resourceId: 'lobehub/lobehub#7',
      resourceType: 'github_issue',
      rootOperationId: 'op-delivered',
      title: 'The delivered issue',
      toolIdentifier: 'lobe-github',
      toolName: 'createIssue',
    });
    await taskModel.updateStatus(created.taskId!, 'completed');

    await service.tick(graph.goal.id);

    const snapshot = await service.graph(graph.goal.id);
    const linked = snapshot.workVersions.filter((link) => link.nodeId === created.nodeId);
    expect(linked.some((link) => link.work?.title === 'The delivered issue')).toBe(true);
    // The responsible task's own Work is still linked — it is the execution
    // container, and the client is what filters it out of the deliverable list.
    expect(linked.some((link) => link.work?.type === 'task')).toBe(true);
  });

  it('re-settling a task does not duplicate its deliverable links', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Deliver me'], title: 'Idempotent harvest' });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(taskTopics).values({
      handoff: { summary: 'Delivered', title: 'Delivered title' },
      operationId: 'op-delivered',
      seq: 1,
      status: 'completed',
      taskId: created.taskId!,
      userId,
    });
    await workModel.registerExternal({
      changeType: 'created',
      resourceId: 'lobehub/lobehub#8',
      resourceType: 'github_issue',
      rootOperationId: 'op-delivered',
      title: 'Delivered once',
      toolIdentifier: 'lobe-github',
      toolName: 'createIssue',
    });
    await taskModel.updateStatus(created.taskId!, 'completed');

    await service.tick(graph.goal.id);
    await service.tick(graph.goal.id);

    const snapshot = await service.graph(graph.goal.id);
    const delivered = snapshot.workVersions.filter(
      (link) => link.nodeId === created.nodeId && link.work?.title === 'Delivered once',
    );
    expect(delivered).toHaveLength(1);
    // The execution container is claimed once per node too, not once per
    // settle: re-linking the completed version added a second identical row for
    // the same task, which is where half of a goal's Work links came from.
    expect(
      snapshot.workVersions.filter(
        (link) => link.nodeId === created.nodeId && link.work?.type === 'task',
      ),
    ).toHaveLength(1);
  });

  it('does not declare a shared document a task only revised', async () => {
    // A backlog document every task appends to used to be declared as the
    // output of every task that touched it, because a Work registered during a
    // run counted as that run's deliverable. Only a Work one of the task's own
    // runs created is one; a revision is not a delivery.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const graph = await service.create({
      tasks: ['Deliver me'],
      title: 'Revisions are not deliveries',
    });
    const created = await service.tick(graph.goal.id);
    const [backlog] = await serverDB
      .insert(documents)
      .values({
        content: 'Shared backlog body',
        fileType: 'markdown',
        filename: 'Shared backlog',
        source: 'notebook',
        sourceType: 'api',
        title: 'Shared backlog',
        totalCharCount: 19,
        totalLineCount: 1,
        userId,
      })
      .returning();
    // Written by an earlier task's run; this task only appends to it.
    await workModel.registerDocument({
      changeType: 'created',
      documentId: backlog.id,
      rootOperationId: 'op-wrote-it-first',
      toolIdentifier: 'lobehub-notebook',
      toolName: 'createDocument',
    });
    await serverDB.insert(taskTopics).values({
      handoff: { summary: 'Delivered', title: 'Delivered title' },
      operationId: 'op-delivered',
      seq: 1,
      status: 'completed',
      taskId: created.taskId!,
      userId,
    });
    await workModel.registerDocument({
      changeType: 'updated',
      documentId: backlog.id,
      rootOperationId: 'op-delivered',
      toolIdentifier: 'lobe-agent-documents',
      toolName: 'modifyNodes',
    });
    await taskModel.updateStatus(created.taskId!, 'completed');

    await service.tick(graph.goal.id);

    const snapshot = await service.graph(graph.goal.id);
    expect(
      snapshot.workVersions.filter(
        (link) => link.nodeId === created.nodeId && link.work?.resourceId === backlog.id,
      ),
    ).toHaveLength(0);
  });

  it('declares a deliverable once, on the node that delivered it', async () => {
    // The flare case behind the reported duplicate deliverables: one document
    // delivered by a node, then written again by another node's run, appeared
    // as a deliverable of both.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const graph = await service.create({
      tasks: ['First delivery', 'Second delivery'],
      title: 'One claim per deliverable',
    });
    const [backlog] = await serverDB
      .insert(documents)
      .values({
        content: 'Shared backlog body',
        fileType: 'markdown',
        filename: 'Shared backlog',
        source: 'notebook',
        sourceType: 'api',
        title: 'Shared backlog',
        totalCharCount: 19,
        totalLineCount: 1,
        userId,
      })
      .returning();

    const first = await service.tick(graph.goal.id);
    await serverDB.insert(taskTopics).values({
      handoff: { summary: 'Delivered', title: 'Delivered title' },
      operationId: 'op-first',
      seq: 1,
      status: 'completed',
      taskId: first.taskId!,
      userId,
    });
    await workModel.registerDocument({
      changeType: 'created',
      documentId: backlog.id,
      rootOperationId: 'op-first',
      toolIdentifier: 'lobe-agent-documents',
      toolName: 'createDocument',
    });
    await taskModel.updateStatus(first.taskId!, 'completed');
    await service.tick(graph.goal.id);

    const second = await service.tick(graph.goal.id);
    expect(second.taskId).toBeTruthy();
    await serverDB.insert(taskTopics).values({
      handoff: { summary: 'Delivered again', title: 'Delivered again' },
      operationId: 'op-second',
      seq: 1,
      status: 'completed',
      taskId: second.taskId!,
      userId,
    });
    // The second node's run writes the same document (a new version of the same
    // Work), which is what a shared backlog looks like from the graph's side.
    await workModel.registerDocument({
      changeType: 'created',
      documentId: backlog.id,
      rootOperationId: 'op-second',
      toolIdentifier: 'lobehub-notebook',
      toolName: 'createDocument',
    });
    await taskModel.updateStatus(second.taskId!, 'completed');
    await service.tick(graph.goal.id);

    const snapshot = await service.graph(graph.goal.id);
    const claims = snapshot.workVersions.filter(
      (link) => link.work?.resourceId === backlog.id && link.relation === 'produced',
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].nodeId).toBe(first.nodeId);
  });

  it('leaves a fresh dispatch claim alone', async () => {
    // The same shape a moment after the claim is just a run about to start.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockRejectedValue(new Error('worker died'));
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Start me'], title: 'Fresh claim' });
    const created = await service.tick(graph.goal.id);
    await expect(service.tick(graph.goal.id)).rejects.toThrow('worker died');
    await taskModel.updateStatus(created.taskId!, 'running');

    const result = await service.tick(graph.goal.id);

    expect(result.outcome).toBe('waiting_external');
    expect((await taskModel.findById(created.taskId!))?.status).toBe('running');
  });

  it('only selects Tasks whose explicit dependencies are resolved', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Dependency-aware goal' });
    const prerequisite = await service.addNode(graph.goal.id, {
      kind: 'task',
      priority: 0,
      title: 'Collect evidence',
    });
    const dependent = await service.addNode(graph.goal.id, {
      kind: 'task',
      priority: 10,
      title: 'Train from evidence',
    });
    await service.addEdge(graph.goal.id, dependent.id, prerequisite.id, 'depends_on');

    const first = await service.tick(graph.goal.id);
    expect(first).toMatchObject({ nodeId: prerequisite.id, outcome: 'advanced' });

    const taskModel = new TaskModel(serverDB, userId);
    await taskModel.updateStatus(first.taskId!, 'completed');
    await service.tick(graph.goal.id);

    const next = await service.tick(graph.goal.id);
    expect(next).toMatchObject({ nodeId: dependent.id, outcome: 'advanced' });
  });
});
