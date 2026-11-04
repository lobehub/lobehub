// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import {
  agentOperations,
  agents,
  goalEdges,
  goalEvents,
  goalNodes,
  goals,
  messages,
  topics,
  users,
} from '@/database/schemas';
import { AiAgentService } from '@/server/services/aiAgent';

import { GoalService } from './index';
import { MAX_UNCONFIRMED_MANAGER_TURNS } from './manager';
import * as scheduler from './scheduler';
import type { GoalTickObservation } from './traceObservation';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => db }));

const db = await getTestDB();
const userId = 'goal-unconfirmed-turn-user';
const agentId = 'goal-unconfirmed-turn-agent';
let seq = 0;
const service = () => new GoalService(db, userId);
const model = () => new GoalModel(db, userId);
const ops = () => new AgentOperationModel(db, userId);
const exec = () => vi.mocked(AiAgentService.prototype.execAgent);

/** A dispatch that returns without its run ever writing an operation row. */
const silentDispatch = async (params: { agentId?: string; appContext?: { topicId?: string } }) =>
  ({
    agentId: params.agentId!,
    operationId: `op-never-recorded-${++seq}`,
    topicId: params.appContext!.topicId!,
  }) as any;

beforeEach(async () => {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
  await db.insert(agents).values({ id: agentId, userId });
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
    const operationId = `op-unconfirmed-turn-${++seq}`;
    const topicId = params.appContext!.topicId!;
    await ops().recordStart({
      agentId: params.agentId,
      appContext: { sourceMessageId: params.clientIds?.userMessageId },
      operationId,
      topicId,
    });
    return { agentId: params.agentId!, operationId, success: true, topicId } as any;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const table of [goalEdges, goalEvents, goalNodes, goals, agentOperations, messages, topics])
    await db.delete(table);
  await db.delete(agents);
  await db.delete(users);
});

/**
 * A manager-mode Goal whose work is done — its only Task node is resolved —
 * waiting on the planning turn that would wrap it up.
 */
async function goalAwaitingWrapUp() {
  const graph = await service().create({
    config: { manager: { maxTurns: 10 } },
    createdByAgentId: agentId,
    title: 'Finished work',
  });
  // Keep the manager's own path: supervision would take over failed turns.
  await db
    .update(goals)
    .set({ config: { manager: { maxTurns: 10 } } })
    .where(eq(goals.id, graph.goal.id));
  const node = await new GoalGraphModel(db, userId).createNode(graph.goal.id, {
    kind: 'task',
    title: 'Done task',
  });
  await db.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, node!.id));
  return graph.goal.id;
}

const receipt = async (id: string) => (await model().findById(id))!.config!.managerState!;

let clock = Date.now();
const passTimeout = () => {
  clock += 21 * 60_000;
  vi.spyOn(Date, 'now').mockReturnValue(clock);
};

/**
 * Regression: a planning turn that never left a run record paused the Goal with
 * "no replacement was dispatched" after 20 minutes, and every resume paused on
 * the same turn again. Six Goals whose tasks were all resolved sat paused until
 * someone noticed.
 */
describe('GoalManagerService with a planning turn that never left a run record', () => {
  beforeEach(() => {
    clock = Date.now();
  });

  it('dispatches a replacement turn after the timeout instead of pausing', async () => {
    const id = await goalAwaitingWrapUp();
    exec().mockImplementationOnce(silentDispatch);
    expect((await service().tick(id)).outcome).toBe('waiting_external');
    const first = await receipt(id);

    passTimeout();
    const settled = await service().tick(id);
    expect(settled.outcome).toBe('advanced');
    expect(settled.message).toContain('dispatching a replacement turn');
    const goal = (await model().findById(id))!;
    expect(goal.status).toBe('running');
    expect(goal.config!.managerState!.consumed).toBe(true);
    expect(goal.config!.managerState!.unconfirmedTurns).toBe(1);
    // Nothing ran, so the turn is not charged.
    expect(goal.config!.managerState!.turns).toBe(first.turns - 1);

    expect((await service().tick(id)).outcome).toBe('waiting_external');
    const next = await receipt(id);
    expect(next.token).not.toBe(first.token);
    expect(next.consumed).not.toBe(true);
    expect(exec()).toHaveBeenCalledTimes(2);
    // The replacement's run was recorded, so the streak ends when it settles.
    const op = await ops().findByTopicSourceMessage(next.topicId, `msg_goal_manager_${next.token}`);
    await ops().recordCompletion(op!.id, { status: 'done' });
    await service().tick(id);
    expect((await receipt(id)).unconfirmedTurns).toBeUndefined();
  });

  it('pauses with the blocking reason once the turns keep failing to start', async () => {
    const id = await goalAwaitingWrapUp();
    exec().mockImplementation(silentDispatch);
    await service().tick(id);
    for (let turn = 1; turn < MAX_UNCONFIRMED_MANAGER_TURNS; turn++) {
      passTimeout();
      expect((await service().tick(id)).outcome).toBe('advanced');
      expect((await service().tick(id)).outcome).toBe('waiting_external');
    }

    passTimeout();
    const paused = await service().tick(id);
    expect(paused.outcome).toBe('no_progress');
    expect(paused.message).toContain(
      `did not start ${MAX_UNCONFIRMED_MANAGER_TURNS} planning turns in a row`,
    );
    expect(paused.message).toContain(agentId);
    expect(exec()).toHaveBeenCalledTimes(MAX_UNCONFIRMED_MANAGER_TURNS);
    const goal = (await model().findById(id))!;
    expect(goal.status).toBe('paused');
    // Settled with a fresh streak, so a plain resume plans again; no
    // --confirm-exit, and the next turn gets the full allowance.
    expect(goal.config!.managerState!.consumed).toBe(true);
    expect(goal.config!.managerState!.unconfirmedTurns).toBeUndefined();
    const events = await db.select().from(goalEvents).where(eq(goalEvents.goalId, id));
    expect(events.some((e) => e.reason === paused.message)).toBe(true);

    await service().resume(id);
    expect((await service().tick(id)).outcome).toBe('waiting_external');
    expect(exec()).toHaveBeenCalledTimes(MAX_UNCONFIRMED_MANAGER_TURNS + 1);
  });

  it('pauses on the dispatch error when it needs the owner', async () => {
    const id = await goalAwaitingWrapUp();
    exec().mockRejectedValueOnce(new Error('Invalid API key for provider claude-code'));
    await service().tick(id);
    expect((await receipt(id)).dispatchError?.message).toBe(
      'Invalid API key for provider claude-code',
    );

    passTimeout();
    const paused = await service().tick(id);
    expect(paused.outcome).toBe('no_progress');
    expect(paused.message).toContain('Main Agent needs credentials, spend or permission fixed');
    expect(paused.message).toContain('Invalid API key');
    expect((await model().findById(id))!.status).toBe('paused');
    expect(exec()).toHaveBeenCalledTimes(1);
  });

  it('waits for a usage window the dispatch error reports, without charging the turn', async () => {
    const id = await goalAwaitingWrapUp();
    const resetsAt = Math.floor((clock + 3 * 3_600_000) / 1000);
    exec().mockRejectedValueOnce(
      Object.assign(new Error('weekly limit reached'), {
        body: { code: 'rate_limit', rateLimitInfo: { resetsAt, status: 'rejected' } },
        category: 'quota',
      }),
    );
    await service().tick(id);
    const first = await receipt(id);

    passTimeout();
    const waiting = await service().tick(id);
    expect(waiting.outcome).toBe('waiting_external');
    expect(waiting.message).toContain('could not be dispatched without a plan (quota_reset)');
    const settled = await receipt(id);
    expect(settled.consumed).toBe(true);
    expect(Date.parse(settled.retryAfter!)).toBeGreaterThan(resetsAt * 1000);
    expect(settled.turns).toBe(first.turns - 1);
    expect((await model().findById(id))!.status).toBe('running');
    expect(exec()).toHaveBeenCalledTimes(1);
  });

  it('still pauses on a run that is on record and live past the timeout', async () => {
    const id = await goalAwaitingWrapUp();
    await service().tick(id);
    passTimeout();
    const paused = await service().tick(id);
    expect(paused.outcome).toBe('no_progress');
    expect(paused.message).toContain('is still running');
    expect((await model().findById(id))!.status).toBe('paused');
    expect(exec()).toHaveBeenCalledTimes(1);
  });

  it('records the replacement and its dispatch as manager ticks in the trace', async () => {
    const id = await goalAwaitingWrapUp();
    exec().mockImplementationOnce(silentDispatch);
    await service().tick(id);

    passTimeout();
    const observed: GoalTickObservation[] = [];
    const onDecision = (observation: GoalTickObservation) => observed.push(observation);
    await service().tick(id, { onDecision });
    await service().tick(id, { onDecision });

    expect(observed.map((o) => [o.branch, o.outcome])).toEqual([
      ['manager_turn', 'advanced'],
      ['manager_turn', 'waiting_external'],
    ]);
    expect(observed[0].message).toContain('dispatching a replacement turn');
    const next = await receipt(id);
    const op = await ops().findByTopicSourceMessage(next.topicId, `msg_goal_manager_${next.token}`);
    expect(observed[1].effects).toEqual([
      expect.objectContaining({ operationId: op!.id, type: 'started_planning_turn' }),
    ]);
  });
});
