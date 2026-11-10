// @vitest-environment node
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { goalNodes, goals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { VerifyPlanGeneratorService } from '../../../verify/planGenerator';
import { GoalExplorationPlanner } from '../../explorationPlanner';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

describe('GoalService', () => {
  it('supervises every Goal it creates, even when the caller omits the policy', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Supervised by default' });
    expect(graph.goal.config?.supervision).toMatchObject({ enabled: true });
  });

  it('keeps the caller incident cap while forcing supervision on', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      config: { supervision: { enabled: true, maxIncidents: 4 } },
      title: 'Capped supervision',
    });
    expect(graph.goal.config?.supervision).toEqual({ enabled: true, maxIncidents: 4 });
  });

  it('rejects a caller that tries to create an unsupervised Goal', async () => {
    const service = new GoalService(serverDB, userId);
    await expect(
      service.create({ config: { supervision: { enabled: false } }, title: 'No supervision' }),
    ).rejects.toThrow('Supervision is required for every goal and cannot be disabled');
  });

  it('explores after result settlement and dispatches the new graph node through the ordinary Task path', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      title: 'Explore',
      config: { exploration: { instruction: 'Compare evidence', maxExperiments: 3 } },
    });
    const parent = graph.nodes.find((node) => node.kind === 'task')!;
    await serverDB.update(goals).set({ status: 'running' }).where(eq(goals.id, graph.goal.id));
    await serverDB.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, parent.id));
    const planner = vi.spyOn(GoalExplorationPlanner.prototype, 'plan').mockResolvedValue({
      action: 'expand',
      parentNodeId: graph.nodes.find((node) => node.kind === 'experiment')!.id,
      title: 'Alternative',
      instruction: 'Improve baseline',
      reason: 'Try a new direction',
    });
    const expanded = await service.tick(graph.goal.id);
    expect(expanded).toMatchObject({ outcome: 'advanced', message: 'Try a new direction' });
    expect(planner).toHaveBeenCalledOnce();
    const created = await service.tick(graph.goal.id);
    expect(created.outcome).toBe('advanced');
    expect(created.nodeId).not.toBe(expanded.nodeId);
    expect((await service.graph(graph.goal.id)).edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: expanded.nodeId,
        targetNodeId: created.nodeId,
        kind: 'contains',
      }),
    );
    expect(created.taskId).toBeTruthy();
  });

  it('pauses a failed exploration planner without creating a phantom experiment', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      title: 'Explore',
      config: { exploration: { instruction: 'Compare evidence', maxExperiments: 3 } },
    });
    const parent = graph.nodes.find((node) => node.kind === 'task')!;
    await serverDB.update(goals).set({ status: 'running' }).where(eq(goals.id, graph.goal.id));
    await serverDB.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, parent.id));
    vi.spyOn(GoalExplorationPlanner.prototype, 'plan').mockRejectedValue(
      new Error('provider unavailable'),
    );
    expect(await service.tick(graph.goal.id)).toMatchObject({ outcome: 'no_progress' });
    const after = await service.graph(graph.goal.id);
    expect(after.goal.status).toBe('paused');
    expect(after.nodes.filter((node) => node.kind === 'task')).toHaveLength(1);
  });

  it('resumes an exhausted exploration only after increasing its cap, preserving explicit user pause', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      title: 'Explore',
      config: { exploration: { instruction: 'Compare evidence', maxExperiments: 1 } },
    });
    const parent = graph.nodes.find((node) => node.kind === 'task')!;
    await serverDB.update(goals).set({ status: 'running' }).where(eq(goals.id, graph.goal.id));
    await serverDB.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, parent.id));
    vi.spyOn(GoalExplorationPlanner.prototype, 'plan').mockResolvedValue({
      action: 'expand',
      parentNodeId: parent.id,
      title: 'Alternative',
      instruction: 'Improve baseline',
      reason: 'Still insufficient',
    });
    await service.tick(graph.goal.id);
    expect((await service.setBudget(graph.goal.id, { maxExperiments: 1 })).status).toBe('paused');
    expect((await service.setBudget(graph.goal.id, { maxExperiments: 2 })).status).toBe('running');
    await service.pause(graph.goal.id);
    expect((await service.setBudget(graph.goal.id, { maxExperiments: 3 })).status).toBe('paused');
  });

  it('passes the selected older experiment result into the actual child Task instruction', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      title: 'Text exploration',
      config: { exploration: { instruction: 'Compare alternatives', maxExperiments: 3 } },
    });
    const graphModel = new GoalGraphModel(serverDB, userId);
    const parent = graph.nodes.find((node) => node.kind === 'task')!;
    await serverDB.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, parent.id));
    const finding = await graphModel.createNode(graph.goal.id, {
      kind: 'finding',
      title: 'Baseline result',
      description: 'HISTORICAL_EVIDENCE_731: candidate A scored 7.',
    });
    await graphModel.createEdge(graph.goal.id, parent.id, finding!.id, 'produces');
    await graphModel.createNode(graph.goal.id, {
      kind: 'task',
      title: 'Newer alternative',
      status: 'resolved',
    });
    const child = await graphModel.createNode(graph.goal.id, {
      kind: 'task',
      title: 'Revisit baseline',
      description: 'Try changing A',
    });
    await graphModel.createEdge(graph.goal.id, child!.id, parent.id, 'derived_from');
    const created = await service.tick(graph.goal.id);
    const dispatched = await new TaskModel(serverDB, userId).findById(created.taskId!);
    expect(dispatched?.instruction).toContain(parent.id);
    expect(dispatched?.instruction).toContain('HISTORICAL_EVIDENCE_731: candidate A scored 7.');
    expect(dispatched?.instruction).toContain('Try changing A');
  });

  it('persists structured criteria on create and records their ids on the goal config', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({
      criteria: [
        { description: 'Runs end to end locally', title: 'Local run works' },
        { instruction: 'Check README covers install and run', title: 'Docs are complete' },
      ],
      title: 'Structured goal',
      tasks: ['Only task'],
    });

    const criteriaIds = graph.goal.config?.acceptance?.criteriaIds ?? [];
    expect(criteriaIds).toHaveLength(2);

    const rows = await serverDB.query.verifyCriteria.findMany();
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(criteriaIds[0])?.title).toBe('Local run works');
    expect(byId.get(criteriaIds[1])?.title).toBe('Docs are complete');
    // the how-to-judge instruction landed in a linked document
    expect(byId.get(criteriaIds[1])?.documentId).toBeTruthy();
  });

  it('persists the reviewed goal document verbatim when structured criteria are supplied', async () => {
    const service = new GoalService(serverDB, userId);
    const instruction = '将办公体验提升到可交付水平，支持 PPT、XLSX、Word 的创建和定向修改。';
    const graph = await service.create({
      criteria: [{ instruction: '打开并编辑最终文件', title: '三类办公文档端到端可用' }],
      problemDescription: instruction,
      requirement: instruction,
      tasks: ['Only task'],
      title: '办公体验',
    });

    const persisted = await service.graph(graph.goal.id);
    expect(persisted.goal.requirement).toBe(instruction);
    expect(persisted.nodes.find((node) => node.kind === 'problem')?.description).toBe(instruction);
    expect(persisted.goal.config?.acceptance?.criteriaIds).toHaveLength(1);
  });

  it('rebinding criteria also updates the dispatched terminal acceptance task', async () => {
    // Editing the standard after the terminal Goal-acceptance Task exists must
    // not leave that Task's Acceptance gating on the stale id list.
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      criteria: [{ title: 'Original criterion' }],
      requirement: 'Deliver with evidence',
      title: 'Rebind criteria goal',
      tasks: ['Only task'],
    });

    const created = await service.tick(graph.goal.id);
    await taskModel.updateStatus(created.taskId!, 'completed');
    await service.tick(graph.goal.id); // synthesize finding
    await service.tick(graph.goal.id); // create acceptance task
    const acceptanceTaskCreated = await service.tick(graph.goal.id); // dispatch it
    expect(acceptanceTaskCreated.taskId).toBeDefined();

    const [replacementId] = await new VerifyPlanGeneratorService(
      serverDB,
      userId,
    ).createCriteriaFromDrafts([
      { onFail: 'manual', required: true, title: 'Replacement criterion', verifierType: 'agent' },
    ]);
    await service.setAcceptanceCriteria(graph.goal.id, [replacementId]);

    const goal = (await service.graph(graph.goal.id)).goal;
    expect(goal.config?.acceptance?.criteriaIds).toEqual([replacementId]);
    const acceptance = await new AcceptanceModel(serverDB, userId).findBySubject(
      'task',
      acceptanceTaskCreated.taskId!,
    );
    expect(acceptance?.config?.verifyCriteriaIds).toEqual([replacementId]);
  });
});
