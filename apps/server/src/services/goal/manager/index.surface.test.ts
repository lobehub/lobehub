// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import * as managerModule from './index';
import {
  answeredProblem,
  decideFailedTurn,
  GoalManagerService,
  goalPlanSchema,
  managerSnapshot,
  MAX_FAILED_MANAGER_TURNS,
  problemKey,
} from './index';

/**
 * Pins the public surface of `@/server/services/goal/manager`: the runtime
 * exports callers import and the members a `GoalManagerService` exposes. The
 * behavior behind them is covered by `../manager.test.ts` and friends.
 */
describe('goal manager public surface', () => {
  it('exports the same runtime names', () => {
    expect(Object.keys(managerModule).sort()).toEqual([
      'GoalManagerService',
      'MAX_FAILED_MANAGER_TURNS',
      'answeredProblem',
      'decideFailedTurn',
      'goalPlanSchema',
      'managerSnapshot',
      'problemKey',
    ]);
    expect(MAX_FAILED_MANAGER_TURNS).toBe(5);
  });

  it('exposes the same public members on the service', () => {
    const service = new GoalManagerService({} as LobeChatDatabase, 'user');
    const members = [
      'adoptConversationTurn',
      'admission',
      'advance',
      'assertOperationOwnsTurn',
      'bindTopic',
      'closeTurnOnStart',
      'confirmTurnExit',
      'moveConversationTo',
      'planInstead',
      'reconsiderAcceptance',
      'stop',
      'submit',
      'takeOver',
      'usage',
    ];
    for (const member of members)
      expect(typeof (service as unknown as Record<string, unknown>)[member]).toBe('function');
    // `planInstead` stays a prototype method: tests spy on it there.
    expect(Object.hasOwn(GoalManagerService.prototype, 'planInstead')).toBe(true);
  });

  it('keys a takeover problem by its task, and reads the answered one back', () => {
    expect(problemKey({ reason: 'stuck', taskId: 'task-1' })).toBe('task-1::stuck');
    expect(problemKey({ reason: 'stuck' })).toBe('goal::stuck');
    expect(answeredProblem(undefined)).toBeUndefined();
    expect(
      answeredProblem({
        consumed: true,
        problem: 'task-1::stuck',
        snapshot: 's',
        startedAt: '2026-01-01T00:00:00.000Z',
        submitted: { action: 'escalate', reason: 'needs a person' },
        token: 't',
        topicId: 'topic',
        turns: 1,
      }),
    ).toEqual({ ask: undefined, key: 'task-1::stuck', reason: 'needs a person' });
  });

  it('ignores bookkeeping fields in the planning snapshot', () => {
    const graph = {
      decisions: [],
      edges: [],
      goal: { config: { manager: {} }, maxRounds: 3, maxTotalCost: null, requirement: 'r' },
      nodes: [{ id: 'n1', status: 'active', updatedAt: new Date(1) }],
      workVersions: [],
    } as unknown as Parameters<typeof managerSnapshot>[0];
    const touched = {
      ...graph,
      goal: { ...graph.goal, config: { ...graph.goal.config, quotaRetryWakeAt: 'later' } },
      nodes: [{ ...graph.nodes[0], updatedAt: new Date(2) }],
    } as typeof graph;
    expect(managerSnapshot(touched)).toBe(managerSnapshot(graph));
    expect(
      managerSnapshot({
        ...graph,
        nodes: [{ ...graph.nodes[0], status: 'resolved' }],
      } as typeof graph),
    ).not.toBe(managerSnapshot(graph));
  });

  it('parses every plan action through one schema', () => {
    expect(goalPlanSchema.parse({ action: 'verify', reason: 'done' })).toEqual({
      action: 'verify',
      reason: 'done',
    });
    expect(
      goalPlanSchema.safeParse({
        action: 'escalate',
        ask: {
          options: [
            { id: 'retry', label: 'Retry' },
            { id: 'waive', label: 'Waive' },
          ],
          question: 'What now?',
        },
        reason: 'blocked',
      }).success,
    ).toBe(false);
    expect(decideFailedTurn(new Error('boom'), {}, 0)).toMatchObject({
      action: 'retry',
      charged: true,
      failedTurns: 1,
    });
  });
});
