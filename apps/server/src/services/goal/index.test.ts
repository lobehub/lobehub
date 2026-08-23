// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { TaskModel } from '@/database/models/task';
import {
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goals,
  tasks,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { GoalService } from './index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
});

afterEach(async () => {
  // PGlite does not consistently order the nested user -> goal -> graph
  // cascades, so clear graph leaves explicitly before their owned roots.
  await serverDB.delete(goalNodeDecisions);
  await serverDB.delete(goalEdges);
  await serverDB.delete(goalEvents);
  await serverDB.delete(goalNodes);
  await serverDB.delete(goals);
  await serverDB.delete(tasks);
  await serverDB.delete(users);
});

describe('GoalService', () => {
  it('creates only one responsible task when ticks race on the same work node', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Concurrent goal', work: ['Single owner work'] });

    const results = await Promise.all([service.tick(graph.goal.id), service.tick(graph.goal.id)]);
    const current = await service.graph(graph.goal.id);
    const taskRows = await serverDB.select().from(tasks);

    expect(results.filter((result) => result.outcome === 'advanced')).toHaveLength(1);
    expect(taskRows).toHaveLength(1);
    expect(current.nodes.find((node) => node.kind === 'work')?.taskId).toBe(taskRows[0].id);
    expect(current.workVersions).toHaveLength(1);
  });

  it('keeps long goal requirements in the task instruction without overflowing its description', async () => {
    const service = new GoalService(serverDB, userId);
    const requirement = `Generate verified training data. ${'Detailed acceptance evidence. '.repeat(20)}`;
    const graph = await service.create({
      requirement,
      title: 'Long requirement goal',
      work: ['Generate training data'],
    });

    const created = await service.tick(graph.goal.id);
    const task = await new TaskModel(serverDB, userId).findById(created.taskId!);

    expect(created.outcome).toBe('advanced');
    expect(task?.description).toHaveLength(255);
    expect(task?.instruction).toContain(requirement);
  });

  it('advances create task -> finding -> achieved without treating task creation as completion', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      requirement: 'A runnable minimal training loop with evidence',
      title: 'Reproduce Ornith training',
      work: ['Implement minimal training loop'],
    });

    const created = await service.tick(graph.goal.id);
    expect(created).toMatchObject({ outcome: 'advanced' });
    expect(created.taskId).toBeDefined();

    const waitingGraph = await service.graph(graph.goal.id);
    expect(waitingGraph.nodes.find((node) => node.kind === 'work')).toMatchObject({
      status: 'active',
      taskId: created.taskId,
    });
    expect(waitingGraph.workVersions).toHaveLength(1);
    const responsibleTask = await taskModel.findById(created.taskId!);
    expect(responsibleTask).toBeDefined();
    expect(taskModel.shouldPauseOnTopicComplete(responsibleTask!)).toBe(false);

    await taskModel.updateStatus(created.taskId!, 'completed');
    const synthesized = await service.tick(graph.goal.id);
    expect(synthesized.outcome).toBe('advanced');

    const evolved = await service.graph(graph.goal.id);
    expect(evolved.nodes.some((node) => node.kind === 'finding')).toBe(true);
    expect(evolved.edges.some((edge) => edge.kind === 'produces')).toBe(true);

    const achieved = await service.tick(graph.goal.id);
    expect(achieved.outcome).toBe('achieved');
    expect((await service.graph(graph.goal.id)).goal.status).toBe('achieved');
  });

  it('evolves a failed work task into a durable decision gate', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ title: 'Failure recovery', work: ['Risky work'] });
    const created = await service.tick(graph.goal.id);

    await taskModel.updateStatus(created.taskId!, 'paused', { error: 'Verifier rejected output' });
    const waiting = await service.tick(graph.goal.id);
    expect(waiting.outcome).toBe('waiting_human');

    const gated = await service.graph(graph.goal.id);
    const decision = gated.decisions[0];
    expect(decision).toMatchObject({ recommendedOptionId: 'retry', status: 'pending' });
    expect(gated.nodes.some((node) => node.kind === 'decision')).toBe(true);

    await service.decide(graph.goal.id, decision.id, 'retire', 'This branch is not useful');
    const achieved = await service.tick(graph.goal.id);
    expect(achieved.outcome).toBe('achieved');
  });

  it('respects a manually paused responsible task without rerunning it', async () => {
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({ title: 'Paused work', work: ['Wait for review'] });
    const created = await service.tick(graph.goal.id);

    await taskModel.updateStatus(created.taskId!, 'paused', { error: null });
    const waiting = await service.tick(graph.goal.id);

    expect(waiting).toMatchObject({
      outcome: 'waiting_human',
      taskId: created.taskId,
    });
    expect((await service.graph(graph.goal.id)).decisions).toHaveLength(0);
  });

  it('only selects work whose explicit dependencies are resolved', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Dependency-aware goal' });
    const prerequisite = await service.addNode(graph.goal.id, {
      kind: 'work',
      priority: 0,
      title: 'Collect evidence',
    });
    const dependent = await service.addNode(graph.goal.id, {
      kind: 'work',
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
