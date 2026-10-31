// @vitest-environment node
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { agents, goalEvents, goals, tasks, topics, users, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';

import { TaskService } from '../../../task';
import { TaskRunnerService } from '../../../taskRunner';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
  it('closes a goal by hand, stops its live runs and stops the coordinator', async () => {
    const cancelSpy = vi.spyOn(TaskService.prototype, 'cancelTopic').mockResolvedValue();
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['First', 'Second'], title: 'Closable' });
    const created = await service.tick(graph.goal.id);
    await new TaskModel(serverDB, userId).update(created.taskId!, { status: 'running' });
    await serverDB.insert(topics).values({ id: 'tpc_close', userId });
    await new TaskTopicModel(serverDB, userId).add(created.taskId!, 'tpc_close', { seq: 1 });
    await new TaskTopicModel(serverDB, userId).updateStatus(
      created.taskId!,
      'tpc_close',
      'running',
    );

    const closed = await service.close(graph.goal.id, 'canceled');

    expect(closed.status).toBe('canceled');
    expect(cancelSpy).toHaveBeenCalledWith('tpc_close');
    // Back to backlog, not parked on a person, so a reopen runs it again.
    expect((await new TaskModel(serverDB, userId).findById(created.taskId!))?.status).toBe(
      'backlog',
    );
    expect(await service.tick(graph.goal.id)).toMatchObject({ outcome: 'failed' });
    const [closeEvent] = await serverDB
      .select()
      .from(goalEvents)
      .where(eq(goalEvents.reason, 'canceled by user'));
    // Filed under the person, not the coordinator.
    expect(closeEvent).toMatchObject({ actorId: userId, eventType: 'rejected' });

    // A closed goal reopens through the ordinary resume.
    expect((await service.resume(graph.goal.id)).status).toBe('running');
    expect((await service.close(graph.goal.id, 'achieved')).status).toBe('achieved');
  });

  it('fences new dispatch before interrupting the runs of a goal being closed', async () => {
    // A tick overlapping the close must not claim another Task while the scan
    // and cancellation are under way, so the goal stops reading `running` first.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Runs'], title: 'Fenced' });
    const created = await service.tick(graph.goal.id);
    await new TaskModel(serverDB, userId).update(created.taskId!, { status: 'running' });
    await serverDB.insert(topics).values({ id: 'tpc_fence', userId });
    await new TaskTopicModel(serverDB, userId).add(created.taskId!, 'tpc_fence', { seq: 1 });
    await new TaskTopicModel(serverDB, userId).updateStatus(
      created.taskId!,
      'tpc_fence',
      'running',
    );
    const statusDuringCancel: string[] = [];
    vi.spyOn(TaskService.prototype, 'cancelTopic').mockImplementation(async () => {
      const goal = await new GoalModel(serverDB, userId).findById(graph.goal.id);
      statusDuringCancel.push(goal!.status);
    });

    await service.close(graph.goal.id, 'canceled');

    expect(statusDuringCancel).toEqual(['paused']);
  });

  it('refuses to close while a claimed run is still starting, so it can be stopped with confirmation', async () => {
    // `dispatchWork` marks the Task running before `runTask` records the topic,
    // so the close scan finds no run to cancel — and a run nobody recorded
    // cannot be interrupted with confirmation. The close waits for it instead.
    const cancelSpy = vi.spyOn(TaskService.prototype, 'cancelTopic').mockResolvedValue();
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Starting'], title: 'Claimed, not recorded' });
    const created = await service.tick(graph.goal.id);
    await new TaskModel(serverDB, userId).update(created.taskId!, { status: 'running' });

    await expect(service.close(graph.goal.id, 'canceled')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });

    expect(cancelSpy).not.toHaveBeenCalled();
    // Fenced, so nothing new starts, and the claim is left for its run to record.
    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe('paused');
    expect((await new TaskModel(serverDB, userId).findById(created.taskId!))?.status).toBe(
      'running',
    );
  });

  it('withdraws a claim whose startup died long ago and closes the goal', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Dead start'], title: 'Stale claim' });
    const created = await service.tick(graph.goal.id);
    await serverDB
      .update(tasks)
      .set({ status: 'running', updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
      .where(eq(tasks.id, created.taskId!));

    expect((await service.close(graph.goal.id, 'canceled')).status).toBe('canceled');
    expect((await new TaskModel(serverDB, userId).findById(created.taskId!))?.status).toBe(
      'backlog',
    );
  });

  it('keeps a closed goal closed when a stale decision is answered', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Risky task'], title: 'Closed with a gate' });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error: 'Verifier rejected output' });
    await service.tick(graph.goal.id);
    const [decision] = (await service.graph(graph.goal.id)).decisions;

    await service.close(graph.goal.id, 'canceled');

    // Another tab still showing the gate answers it.
    await expect(service.decide(graph.goal.id, decision.id, 'retry')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe(
      'canceled',
    );
  });

  it('does not reopen a goal closed while a decision was being answered', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Risky task'], title: 'Closed mid-answer' });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error: 'Verifier rejected output' });
    await service.tick(graph.goal.id);
    const [decision] = (await service.graph(graph.goal.id)).decisions;
    // The close lands after the answer is written, before the status moves.
    const graphModel = (service as unknown as { graphModel: GoalGraphModel }).graphModel;
    const resolve = graphModel.resolveDecision;
    vi.spyOn(graphModel, 'resolveDecision').mockImplementation(async (...args) => {
      const resolved = await resolve(...args);
      await new GoalService(serverDB, userId).close(graph.goal.id, 'canceled');
      return resolved;
    });

    await service.decide(graph.goal.id, decision.id, 'retry');

    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe(
      'canceled',
    );
  });

  it('refuses to end a goal someone resumed while its runs were being interrupted', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Runs'], title: 'Resumed mid-close' });
    const created = await service.tick(graph.goal.id);
    await new TaskModel(serverDB, userId).update(created.taskId!, { status: 'running' });
    await serverDB.insert(topics).values({ id: 'tpc_race', userId });
    await new TaskTopicModel(serverDB, userId).add(created.taskId!, 'tpc_race', { seq: 1 });
    await new TaskTopicModel(serverDB, userId).updateStatus(created.taskId!, 'tpc_race', 'running');
    // Another tab resumes the goal while the interruption pass is running.
    vi.spyOn(TaskService.prototype, 'cancelTopic').mockImplementation(async () => {
      await new GoalService(serverDB, userId).resume(graph.goal.id);
    });

    await expect(service.close(graph.goal.id, 'canceled')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe('running');
  });

  it('does not let a resume that read the goal before a close reopen it afterwards', async () => {
    // The resume read the fenced `paused` goal; the close then committed the
    // terminal status. The stale resume must not write `running` over it.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Runs'], title: 'Resume after close' });
    await service.pause(graph.goal.id);
    const requireGraph = (service as unknown as { requireGraph: GoalService['graph'] })
      .requireGraph;
    vi.spyOn(service as any, 'requireGraph').mockImplementationOnce(async (id) => {
      const snapshot = await requireGraph(id as string);
      await new GoalService(serverDB, userId).close(graph.goal.id, 'canceled');
      return snapshot;
    });

    await expect(service.resume(graph.goal.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe(
      'canceled',
    );
    // An explicit reopen of the ended goal still works.
    expect((await service.resume(graph.goal.id)).status).toBe('running');
  });

  it('keeps runs already stopped reopenable when a later interruption fails', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const topicModel = new TaskTopicModel(serverDB, userId);
    const graph = await service.create({ tasks: ['First', 'Second'], title: 'Partial close' });
    const [first, second] = graph.nodes.filter((node) => node.kind === 'task');
    const taskIds: string[] = [];
    for (const [index, node] of [first, second].entries()) {
      const task = await new TaskService(serverDB, userId).createTask({
        instruction: node.title,
        name: node.title,
      });
      await new GoalGraphModel(serverDB, userId).bindTask(graph.goal.id, node.id, task.id);
      await taskModel.update(task.id, { status: 'running' });
      const topicId = `tpc_partial_${index}`;
      await serverDB.insert(topics).values({ id: topicId, userId });
      await topicModel.add(task.id, topicId, { seq: 1 });
      await topicModel.updateStatus(task.id, topicId, 'running');
      taskIds.push(task.id);
    }
    // The first interruption lands (the task reads `paused`, as cancelTopic
    // leaves it); the second is unreachable.
    let calls = 0;
    vi.spyOn(TaskService.prototype, 'cancelTopic').mockImplementation(async (topicId) => {
      calls += 1;
      if (calls > 1) throw new Error('run unreachable');
      const index = Number(topicId.at(-1));
      await taskModel.update(taskIds[index], { status: 'paused' });
      await topicModel.updateStatus(taskIds[index], topicId, 'canceled');
    });

    await expect(service.close(graph.goal.id, 'canceled')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    const stopped = (await taskModel.findByIds(taskIds)).filter(
      (task) => task.status !== 'running',
    );
    expect(stopped).toHaveLength(1);
    expect(stopped[0].status).toBe('backlog');
  });

  describe('closing a goal with a main Agent turn in flight', () => {
    const managedGoal = async (title: string) => {
      const service = new GoalService(serverDB, userId);
      const graph = await service.create({ tasks: ['Managed'], title });
      await new AgentOperationModel(serverDB, userId).recordStart({
        operationId: `op-manager-${title}`,
      });
      await serverDB
        .update(goals)
        .set({
          config: {
            ...graph.goal.config,
            manager: {},
            managerState: {
              operationId: `op-manager-${title}`,
              startedAt: new Date().toISOString(),
              token: 'turn',
              topicId: 'management-topic',
              turns: 1,
            },
          } as never,
        })
        .where(eq(goals.id, graph.goal.id));
      return { goalId: graph.goal.id, service };
    };

    it('interrupts the main Agent turn before ending the goal', async () => {
      // The coordinator's own operation is not a graph Task topic, so the
      // topic scan alone would leave it spending after the goal ended.
      const { goalId, service } = await managedGoal('interrupted');
      const interrupt = vi
        .spyOn(AiAgentService.prototype, 'interruptTask')
        .mockResolvedValue({ success: true } as never);

      expect((await service.close(goalId, 'achieved')).status).toBe('achieved');
      expect(interrupt).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'op-manager-interrupted' }),
      );
    });

    it('refuses to end the goal when the interruption is not confirmed', async () => {
      const { goalId, service } = await managedGoal('unconfirmed');
      vi.spyOn(AiAgentService.prototype, 'interruptTask').mockResolvedValue({
        deviceCancellationConfirmed: false,
        success: true,
      } as never);

      await expect(service.close(goalId, 'canceled')).rejects.toThrow(/not closed/);
      // Still fenced so nothing new starts, but not claimed as ended.
      expect((await new GoalModel(serverDB, userId).findById(goalId))?.status).toBe('paused');
    });
  });

  it('restarts a split-role goal under a new executor without replacing its supervisor', async () => {
    vi.spyOn(TaskService.prototype, 'cancelTopic').mockResolvedValue();
    await serverDB.insert(agents).values([
      { id: 'agt_lead', slug: 'agt-lead', userId },
      { id: 'agt_first_worker', slug: 'agt-first-worker', userId },
      { id: 'agt_second_worker', slug: 'agt-second-worker', userId },
    ]);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      agentId: 'agt_lead',
      config: { taskAgentId: 'agt_first_worker' },
      tasks: ['Stuck task'],
      title: 'Restart split roles',
    });
    const created = await service.tick(graph.goal.id);

    const result = await service.restart(graph.goal.id, { agentId: 'agt_second_worker' });

    expect(result.goal.agentId).toBe('agt_lead');
    expect(result.goal.config?.taskAgentId).toBe('agt_second_worker');
    expect((await taskModel.findById(created.taskId!))?.assigneeAgentId).toBe('agt_second_worker');
  });

  it('cancels the failure gate a restart supersedes so the goal starts moving again', async () => {
    // A restarted task's pending recovery gate is answered by the restart
    // itself. Left pending, it keeps winning the coordinator's
    // pending-decision branch and the goal sits waiting_human with every task
    // freshly reset.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Risky task'], title: 'Restart clears gate' });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error: 'Verifier rejected output' });
    expect((await service.tick(graph.goal.id)).outcome).toBe('waiting_human');

    const result = await service.restart(graph.goal.id);

    expect(result.restartedTaskIds).toEqual([created.taskId]);
    const after = await service.graph(graph.goal.id);
    expect(after.decisions[0].status).toBe('canceled');
    // The freed coordinator dispatches the reset task instead of re-parking.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const next = await service.tick(graph.goal.id);
    expect(next.outcome).not.toBe('waiting_human');
  });

  it('retires a stray node only together with the unfinished tasks depending on it', async () => {
    // A duplicated plan branch never gets a Task, so nothing else ever closes it
    // and the goal can never reach acceptance.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['First', 'Second', 'Keep'], title: 'Duplicates' });
    const [first, second, keep] = ['First', 'Second', 'Keep'].map((title) =>
      graph.nodes.find((node) => node.kind === 'task' && node.title === title)!,
    );
    await service.addEdge(graph.goal.id, second.id, first.id, 'depends_on');

    await expect(service.retireNodes(graph.goal.id, [first.id])).rejects.toThrow(second.id);

    const result = await service.retireNodes(graph.goal.id, [first.id, second.id], 'duplicate');

    expect(result.retiredNodeIds.sort()).toEqual([first.id, second.id].sort());
    const after = await service.graph(graph.goal.id);
    const status = (id: string) => after.nodes.find((node) => node.id === id)?.status;
    expect(status(first.id)).toBe('retired');
    expect(status(second.id)).toBe('retired');
    expect(status(keep.id)).not.toBe('retired');
  });

  it('retiring a dispatched node cancels its task and the gate parking the goal', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Canceled elsewhere'], title: 'Stray gate' });
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'paused', { error: 'Task canceled' });
    expect((await service.tick(graph.goal.id)).outcome).toBe('waiting_human');

    await service.retireNodes(graph.goal.id, [created.nodeId!]);

    expect((await taskModel.findById(created.taskId!))?.status).toBe('canceled');
    const after = await service.graph(graph.goal.id);
    expect(after.decisions[0].status).toBe('canceled');
    expect(after.goal.status).toBe('running');
  });

  it('retiring a node fences it against a coordinator still creating its task', async () => {
    const service = new GoalService(serverDB, userId);
    const graphModel = new GoalGraphModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Stray', 'Keep'], title: 'Retire race' });
    const stray = graph.nodes.find((node) => node.kind === 'task' && node.title === 'Stray')!;
    // A tick has claimed the node and is creating its Task when retirement lands.
    expect(await graphModel.claimTaskNode(graph.goal.id, stray.id, new Date(0))).toBeDefined();

    await service.retireNodes(graph.goal.id, [stray.id]);

    const lateTask = await new TaskModel(serverDB, userId).create({ instruction: 'Late' });
    expect(await graphModel.bindTask(graph.goal.id, stray.id, lateTask.id)).toBeUndefined();
    const after = await service.graph(graph.goal.id);
    expect(after.nodes.find((node) => node.id === stray.id)?.status).toBe('retired');
  });

  it("stops a colleague's private task when a workspace owner retires its node", async () => {
    // The coordinator runs as the goal's owner, so its Tasks can be private to
    // that colleague. An owner retiring the node must still stop them — reads
    // under the owner's own visibility would silently miss them.
    const workspaceId = 'goal-retire-private-ws';
    const ownerId = 'goal-retire-private-owner';
    await serverDB.insert(users).values({ id: ownerId }).onConflictDoNothing();
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: workspaceId, primaryOwnerId: ownerId, slug: workspaceId })
      .onConflictDoNothing();
    const colleague = new GoalService(serverDB, userId, workspaceId);
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const graph = await colleague.create({ tasks: ['Private', 'Keep'], title: 'Private retire' });
    const created = await colleague.tick(graph.goal.id);
    await serverDB
      .update(tasks)
      .set({ status: 'running', visibility: 'private' })
      .where(eq(tasks.id, created.taskId!));
    expect(
      await new TaskModel(serverDB, ownerId, workspaceId).findById(created.taskId!),
    ).toBeFalsy();

    await new GoalService(serverDB, ownerId, workspaceId).retireNodes(graph.goal.id, [
      created.nodeId!,
    ]);

    const [task] = await serverDB.select().from(tasks).where(eq(tasks.id, created.taskId!));
    expect(task.status).toBe('canceled');
  });

  it('cancels a running task before looking for its runs, fencing a run still being dispatched', async () => {
    // A runner that already flipped the Task to `running` but has not recorded
    // its topic yet is invisible to the run lookup. It checks the Task's status
    // under the row lock before recording, so the cancellation must already be
    // committed by the time retirement looks for runs to stop.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Dispatching', 'Keep'], title: 'Fence runs' });
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'running');
    const statusAtLookup: (string | undefined)[] = [];
    const original = TaskTopicModel.prototype.findRunningByTaskIds;
    vi.spyOn(TaskTopicModel.prototype, 'findRunningByTaskIds').mockImplementation(async function (
      this: TaskTopicModel,
      ids: string[],
    ) {
      statusAtLookup.push((await taskModel.findById(created.taskId!))?.status);
      return original.call(this, ids);
    });

    await service.retireNodes(graph.goal.id, [created.nodeId!]);

    expect(statusAtLookup).toEqual(['canceled']);
    expect((await taskModel.findById(created.taskId!))?.status).toBe('canceled');
  });

  it('lets an interrupted retirement be finished by retrying it', async () => {
    // The fence lands before the run is stopped; when stopping it cannot be
    // confirmed the call fails with the node already retired. A retry must
    // still stop the task instead of rejecting the node as terminal.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ tasks: ['Running', 'Keep'], title: 'Retry retire' });
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const created = await service.tick(graph.goal.id);
    vi.spyOn(TaskTopicModel.prototype, 'findRunningByTaskIds').mockResolvedValue([
      { taskId: created.taskId!, topicId: 'tpc_running' },
    ] as never);
    const cancelTopic = vi
      .spyOn(TaskService.prototype, 'cancelTopic')
      .mockRejectedValueOnce(new Error('interrupt not confirmed'))
      .mockResolvedValue(undefined as never);

    await expect(service.retireNodes(graph.goal.id, [created.nodeId!])).rejects.toThrow(
      'interrupt not confirmed',
    );
    expect(
      (await service.graph(graph.goal.id)).nodes.find((node) => node.id === created.nodeId)?.status,
    ).toBe('retired');

    const retried = await service.retireNodes(graph.goal.id, [created.nodeId!]);

    expect(retried.retiredNodeIds).toEqual([created.nodeId]);
    expect(cancelTopic).toHaveBeenCalledTimes(2);
    expect((await taskModel.findById(created.taskId!))?.status).toBe('canceled');
  });

  it('discards a stale tick outcome for a node retired while it ran', async () => {
    const service = new GoalService(serverDB, userId);
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const graph = await service.create({ tasks: ['Stray', 'Keep'], title: 'Stale tick' });
    const created = await service.tick(graph.goal.id);
    // The coordinator loaded this snapshot before the retirement landed.
    const stale = await service.graph(graph.goal.id);
    await service.retireNodes(graph.goal.id, [created.nodeId!]);

    const result = await (service as any).consumeCompletedTask(
      stale,
      created.nodeId!,
      created.taskId!,
    );

    expect(result.outcome).toBe('no_progress');
    const after = await service.graph(graph.goal.id);
    expect(after.nodes.find((node) => node.id === created.nodeId)?.status).toBe('retired');
    expect(after.nodes.some((node) => node.kind === 'finding')).toBe(false);
  });

  it('reopens a goal parked by no_frontier once the blocking nodes are retired', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['A', 'B', 'Keep'], title: 'Deadlocked branch' });
    const [a, b] = ['A', 'B'].map((title) =>
      graph.nodes.find((node) => node.kind === 'task' && node.title === title)!,
    );
    const graphModel = new GoalGraphModel(serverDB, userId);
    await graphModel.createEdge(graph.goal.id, a.id, b.id, 'depends_on');
    await graphModel.createEdge(graph.goal.id, b.id, a.id, 'depends_on');
    const keep = graph.nodes.find((node) => node.kind === 'task' && node.title === 'Keep')!;
    await graphModel.updateNodeStatus(graph.goal.id, keep.id, 'resolved');
    await service.tick(graph.goal.id); // deadlock → no_frontier → paused
    expect((await service.graph(graph.goal.id)).goal.status).toBe('paused');

    await service.retireNodes(graph.goal.id, [a.id, b.id]);

    expect((await service.graph(graph.goal.id)).goal.status).toBe('running');
  });

  it('leaves a user-paused goal paused when nodes are retired', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['A', 'B'], title: 'Paused by a person' });
    const [a, b] = graph.nodes.filter((node) => node.kind === 'task');
    const graphModel = new GoalGraphModel(serverDB, userId);
    await graphModel.createEdge(graph.goal.id, a.id, b.id, 'depends_on');
    await graphModel.createEdge(graph.goal.id, b.id, a.id, 'depends_on');
    await service.tick(graph.goal.id); // no_frontier park
    await service.pause(graph.goal.id); // the person takes the pause over

    await service.retireNodes(graph.goal.id, [a.id, b.id]);

    expect((await service.graph(graph.goal.id)).goal.status).toBe('paused');
  });

  it('leaves a deliberately paused goal paused when its budget changes', async () => {
    // Nothing distinguishes a user pause from a budget pause on the row, so the
    // reopen is limited to goals whose budget was actually binding.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Wait'], title: 'User paused' });
    await service.pause(graph.goal.id);

    const updated = await service.setBudget(graph.goal.id, { maxTotalCost: 50 });

    expect(updated?.status).toBe('paused');
  });

  it('refuses to delete a goal whose running Task cannot be stopped', async () => {
    // Deleting anyway would remove the only surface that can stop an operation
    // which keeps spending.
    vi.spyOn(TaskRunnerService.prototype, 'runTask').mockResolvedValue({} as never);
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Runs on'], title: 'Unstoppable' });
    const created = await service.tick(graph.goal.id);
    await serverDB.insert(topics).values({ id: 'tpc_stuck', userId });
    await new TaskTopicModel(serverDB, userId).add(created.taskId!, 'tpc_stuck', { seq: 1 });
    await new TaskTopicModel(serverDB, userId).updateStatus(
      created.taskId!,
      'tpc_stuck',
      'running',
    );
    vi.spyOn(TaskService.prototype, 'cancelTopic').mockRejectedValue(new Error('gateway is down'));

    await expect(service.delete(graph.goal.id)).rejects.toThrow(/not deleted/);
    expect(await service.graph(graph.goal.id)).toBeDefined();
  });
});
